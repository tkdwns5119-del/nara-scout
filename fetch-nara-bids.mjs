// 나라장터(G2B) 입찰공고 수집 스크립트 — GitHub Actions cron 환경에서 실행
// 매 실행 시 최근 90일치 데이터를 수집해 data/bids.json 에 덮어쓴다.

import fs from 'node:fs/promises';
import path from 'node:path';

const RAW_API_KEY = process.env.NARA_API_KEY?.trim();

if (!RAW_API_KEY) {
    console.error('[ERROR] NARA_API_KEY 환경변수가 설정되어 있지 않습니다.');
    console.error('  GitHub: Settings → Secrets and variables → Actions → NARA_API_KEY 등록 필요');
    process.exit(1);
}

// GitHub Secret에 Encoding 키가 들어가 있어도 1회 디코딩해서 URLSearchParams에 태운다.
// 권장값은 공공데이터포털의 Decoding 키.
function normalizeServiceKey(key) {
    try {
        return key.includes('%') ? decodeURIComponent(key) : key;
    } catch {
        return key;
    }
}

const API_KEY = normalizeServiceKey(RAW_API_KEY);

const BASE_KEYWORDS = ["전광판", "미디어", "파사드", "사이니지", "디스플레이", "LED", "ITS", "VMS"];
const SEARCH_TERMS = BASE_KEYWORDS.flatMap(k => [k, `디지털 ${k}`]);

const KEYWORD_CATEGORY = {
    "디스플레이/사이니지 계열": ["전광판", "LED", "디스플레이", "사이니지"],
    "미디어/파사드 계열": ["미디어", "파사드"],
    "ITS/VMS 계열": ["ITS", "VMS"]
};

const ENDPOINTS = [
    {
        name: "물품",
        url: "https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoThngPPSSrch01"
    },
    {
        name: "용역",
        url: "https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServcPPSSrch01"
    }
];

const DAYS_TO_FETCH = 90;
const NUM_OF_ROWS = 100;

// 기존 250ms는 너무 짧음. 공공데이터 API는 최소 1초 텀 권장.
const REQUEST_DELAY_MS = 1000;
const PAGE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_COUNT = 3;

// 검색어 1개당 최대 페이지 제한.
// 90일 조회에서 특정 키워드가 너무 많이 걸릴 경우 API 과부하 방지.
const MAX_PAGES_PER_QUERY = 5;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getKstDate() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

function formatG2BDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function normalizeKeyword(kw) {
    return String(kw || '').replace(/^디지털\s*/i, '').trim();
}

function classifyRegion(name) {
    const map = [
        ["서울", "서울"], ["경기", "경기"], ["인천", "인천"], ["부산", "부산"],
        ["강원", "강원"], ["대전", "대전"], ["대구", "대구"], ["광주", "광주"],
        ["울산", "울산"], ["세종", "세종"], ["제주", "제주"],
        ["충북", "충청"], ["충남", "충청"], ["충청", "충청"],
        ["전북", "전라"], ["전남", "전라"], ["전라", "전라"],
        ["경북", "경상"], ["경남", "경상"], ["경상", "경상"]
    ];

    const s = String(name || '');

    for (const [needle, label] of map) {
        if (s.includes(needle)) return label;
    }

    return "전국";
}

function bodyPreview(text, max = 500) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .slice(0, max);
}

function parseXmlError(trimmed) {
    const authMsg = trimmed.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1];
    const reasonCode = trimmed.match(/<returnReasonCode>([^<]+)<\/returnReasonCode>/)?.[1];
    const errMsg = trimmed.match(/<errMsg>([^<]+)<\/errMsg>/)?.[1];

    return authMsg || errMsg || reasonCode || bodyPreview(trimmed, 300);
}

function extractItems(json) {
    const rawItems =
        json?.response?.body?.items?.item ??
        json?.response?.body?.items ??
        [];

    if (!rawItems) return [];
    return Array.isArray(rawItems) ? rawItems : [rawItems];
}

function extractTotalCount(json) {
    return Number(json?.response?.body?.totalCount || 0);
}

function checkApiHeader(json) {
    const header = json?.response?.header;
    if (!header) return null;

    const resultCode = String(header.resultCode ?? '');
    const resultMsg = String(header.resultMsg ?? header.resultMessage ?? '');

    if (resultCode && !['00', '0'].includes(resultCode)) {
        return `API 오류 ${resultCode}: ${resultMsg || '상세 메시지 없음'}`;
    }

    return null;
}

function buildUrl(endpoint, keyword, dateRange, pageNo) {
    const url = new URL(endpoint.url);

    url.searchParams.set('serviceKey', API_KEY);
    url.searchParams.set('numOfRows', String(NUM_OF_ROWS));
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('inqryDiv', '1');
    url.searchParams.set('inqryBgnDt', dateRange.bgn);
    url.searchParams.set('inqryEndDt', dateRange.end);
    url.searchParams.set('bidNtceNm', keyword);
    url.searchParams.set('type', 'json');

    return url;
}

async function fetchPage(endpoint, keyword, dateRange, pageNo) {
    const url = buildUrl(endpoint, keyword, dateRange, pageNo);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(url, { signal: controller.signal });
        const text = await res.text();
        const trimmed = text.trim();

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${bodyPreview(trimmed)}`);
        }

        if (!trimmed) {
            throw new Error('빈 응답');
        }

        if (trimmed.startsWith('<')) {
            return {
                items: [],
                totalCount: 0,
                error: `XML 응답: ${parseXmlError(trimmed)}`
            };
        }

        let json;
        try {
            json = JSON.parse(trimmed);
        } catch {
            throw new Error(`JSON 파싱 실패: ${bodyPreview(trimmed)}`);
        }

        const headerError = checkApiHeader(json);
        if (headerError) {
            return {
                items: [],
                totalCount: 0,
                error: headerError
            };
        }

        return {
            items: extractItems(json),
            totalCount: extractTotalCount(json),
            error: null
        };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchPageWithRetry(endpoint, keyword, dateRange, pageNo) {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            const result = await fetchPage(endpoint, keyword, dateRange, pageNo);

            // 인증/파라미터성 XML 또는 API 오류는 재시도해도 의미가 작아서 그대로 반환.
            if (result.error) return result;

            return result;
        } catch (e) {
            const isLast = attempt === RETRY_COUNT;
            const msg = e.name === 'AbortError' ? '타임아웃' : e.message;

            if (isLast) {
                throw new Error(msg);
            }

            const waitMs = attempt * 2000;
            console.log(`    retry ${attempt}/${RETRY_COUNT - 1} page ${pageNo} — ${msg}, ${waitMs}ms 대기`);
            await sleep(waitMs);
        }
    }

    return {
        items: [],
        totalCount: 0,
        error: '알 수 없는 재시도 실패'
    };
}

async function fetchOne(endpoint, keyword, dateRange) {
    const allItems = [];
    let totalCount = 0;
    let totalPages = 1;

    for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
        const result = await fetchPageWithRetry(endpoint, keyword, dateRange, pageNo);

        if (result.error) {
            return {
                items: allItems,
                totalCount,
                error: result.error
            };
        }

        allItems.push(...result.items);

        if (pageNo === 1) {
            totalCount = result.totalCount || result.items.length;
            totalPages = Math.max(1, Math.ceil(totalCount / NUM_OF_ROWS));

            if (totalPages > MAX_PAGES_PER_QUERY) {
                console.log(`    WARN ${endpoint.name} / "${keyword}" — ${totalCount}건, ${totalPages}페이지 중 ${MAX_PAGES_PER_QUERY}페이지만 수집`);
                totalPages = MAX_PAGES_PER_QUERY;
            }
        }

        if (pageNo < totalPages) {
            await sleep(PAGE_DELAY_MS);
        }
    }

    return {
        items: allItems,
        totalCount,
        error: null
    };
}

function makeBidRecord(i, term) {
    const bidNtceNo = String(i.bidNtceNo || '');
    const bidNtceOrd = String(i.bidNtceOrd || '');
    const seqPart = bidNtceNo.split('-')[1] || '';
    const bidSeq = bidNtceOrd || seqPart;

    const bidId = bidNtceNo
        ? [bidNtceNo, bidSeq].filter(Boolean).join('-')
        : `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const budget =
        Number(i.assignBudgetAmt) ||
        Number(i.presmptPrce) ||
        Number(i.assignBdgtAmt) ||
        0;

    const regDt = String(i.bidNtceRegistDt || i.bidNtceDt || '').substring(0, 16);
    const closeDt = String(i.bidClseDt || '').substring(0, 16);

    const bidNoForUrl = bidNtceNo.split('-')[0] || bidNtceNo;

    return {
        bidId,
        bidNtceNo: bidNtceNo || bidId,
        bidNtceOrd: bidNtceOrd || '',
        bidNtceNm: i.bidNtceNm || '(공고명 없음)',
        ntceInsttNm: i.ntceInsttNm || i.ntcgInsttNm || '자체공고기관',
        dminsttNm: i.dminsttNm || i.ntceInsttNm || '자체수요기관',
        assignBudgetAmt: budget,
        bidNtceRegistDt: regDt,
        bidClseDt: closeDt,
        searchKeyword: term,
        region: classifyRegion(i.ntceInsttNm || i.dminsttNm || i.bidNtceNm),
        g2bUrl: i.bidNtceDtlUrl || (
            bidNoForUrl
                ? `https://www.g2b.go.kr:8401/egp/bi/bid/bidDetail.do?bidNo=${bidNoForUrl}&bidSeq=${bidSeq}`
                : ''
        )
    };
}

async function main() {
    const now = getKstDate();
    const past = getKstDate();

    past.setDate(now.getDate() - DAYS_TO_FETCH);

    const dateRange = {
        bgn: formatG2BDate(past) + '0000',
        end: formatG2BDate(now) + '2359'
    };

    console.log(`[INFO] 수집 범위: ${dateRange.bgn} ~ ${dateRange.end}`);
    console.log(`[INFO] 검색어 ${SEARCH_TERMS.length}개 × 엔드포인트 ${ENDPOINTS.length}개 = ${SEARCH_TERMS.length * ENDPOINTS.length}개 기본 호출`);
    console.log(`[INFO] 최대 페이지: 검색어/엔드포인트당 ${MAX_PAGES_PER_QUERY}페이지`);
    console.log(`[INFO] 요청 간격: ${REQUEST_DELAY_MS}ms, 타임아웃: ${REQUEST_TIMEOUT_MS}ms, 재시도: ${RETRY_COUNT}회`);

    const allBids = [];
    const errors = [];
    let successCount = 0;

    for (const endpoint of ENDPOINTS) {
        for (const term of SEARCH_TERMS) {
            try {
                const result = await fetchOne(endpoint, term, dateRange);

                if (result.error) {
                    errors.push(`[${endpoint.name}/${term}] ${result.error}`);
                    console.log(`  - FAIL ${endpoint.name} / "${term}" — ${result.error}`);
                } else {
                    successCount++;
                    console.log(`  - OK   ${endpoint.name} / "${term}" — ${result.items.length}건 / totalCount ${result.totalCount}`);

                    for (const i of result.items) {
                        allBids.push(makeBidRecord(i, term));
                    }
                }
            } catch (e) {
                const msg = e.name === 'AbortError' ? '타임아웃' : e.message;
                errors.push(`[${endpoint.name}/${term}] ${msg}`);
                console.log(`  - FAIL ${endpoint.name} / "${term}" — ${msg}`);
            }

            await sleep(REQUEST_DELAY_MS);
        }
    }

    // 전부 실패한 경우 기존 정상 bids.json 보호.
    if (successCount === 0) {
        console.error('');
        console.error('[ERROR] 모든 API 호출 실패. 기존 data/bids.json 보호를 위해 파일을 덮어쓰지 않습니다.');
        console.error('[ERROR] 상위 오류 목록:');
        for (const err of errors.slice(0, 10)) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    // 중복 제거: bidId 우선, 없으면 bidNtceNo 기준.
    const uniqueMap = new Map();

    for (const b of allBids) {
        uniqueMap.set(b.bidId || b.bidNtceNo, b);
    }

    const unique = Array.from(uniqueMap.values());

    unique.sort((a, b) =>
        String(b.bidNtceRegistDt || '').localeCompare(String(a.bidNtceRegistDt || ''))
    );

    // 카테고리 분포 집계
    const categoryStats = {};

    for (const cat of Object.keys(KEYWORD_CATEGORY)) {
        categoryStats[cat] = 0;
    }

    for (const b of unique) {
        const base = normalizeKeyword(b.searchKeyword);

        for (const [cat, list] of Object.entries(KEYWORD_CATEGORY)) {
            if (list.includes(base)) {
                categoryStats[cat]++;
                break;
            }
        }
    }

    const output = {
        generatedAt: now.toISOString(),
        timezone: 'Asia/Seoul',
        rangeDays: DAYS_TO_FETCH,
        rangeBegin: dateRange.bgn,
        rangeEnd: dateRange.end,
        totalCount: unique.length,
        rawCount: allBids.length,
        successCalls: successCount,
        failedCalls: errors.length,
        requestDelayMs: REQUEST_DELAY_MS,
        maxPagesPerQuery: MAX_PAGES_PER_QUERY,
        categoryStats,
        errors: errors.slice(0, 20),
        bids: unique
    };

    const outDir = 'data';
    const outPath = path.join(outDir, 'bids.json');

    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log('');
    console.log(`[DONE] 총 ${unique.length}건 / 원본 ${allBids.length}건 → ${outPath}`);
    console.log(`[DONE] 성공 호출: ${successCount} / 실패 호출: ${errors.length}`);
    console.log(`[DONE] 카테고리: ${JSON.stringify(categoryStats)}`);

    if (errors.length > 0) {
        console.log('[WARN] 일부 호출 실패 있음. data/bids.json의 errors 필드 확인 필요.');
    }
}

main().catch(e => {
    console.error('[FATAL]', e);
    process.exit(1);
});
