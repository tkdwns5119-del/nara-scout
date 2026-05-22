// 나라장터(G2B) 입찰공고 수집 스크립트 — GitHub Actions cron 환경에서 실행
// 매 실행 시 최근 90일치 데이터를 수집해 data/bids.json 에 덮어쓴다.
import fs from 'node:fs/promises';
import path from 'node:path';

const API_KEY = process.env.NARA_API_KEY;
if (!API_KEY) {
    console.error('[ERROR] NARA_API_KEY 환경변수가 설정되어 있지 않습니다.');
    console.error('  GitHub: Settings → Secrets and variables → Actions → NARA_API_KEY 등록 필요');
    process.exit(1);
}

const BASE_KEYWORDS = ["전광판", "미디어", "파사드", "사이니지", "디스플레이", "LED", "ITS", "VMS"];
const SEARCH_TERMS = BASE_KEYWORDS.flatMap(k => [k, `디지털 ${k}`]);

const KEYWORD_CATEGORY = {
    "디스플레이/사이니지 계열": ["전광판", "LED", "디스플레이", "사이니지"],
    "미디어/파사드 계열": ["미디어", "파사드"],
    "ITS/VMS 계열": ["ITS", "VMS"]
};

const ENDPOINTS = [
    { name: "물품", url: "https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoThngPPSSrch01" },
    { name: "용역", url: "https://apis.data.go.kr/1230000/BidPublicInfoService04/getBidPblancListInfoServcPPSSrch01" }
];

const NUM_OF_ROWS = 100;
const REQUEST_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 20000;

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

async function fetchOne(endpoint, keyword, dateRange) {
    const url = `${endpoint.url}?serviceKey=${API_KEY}&numOfRows=${NUM_OF_ROWS}&pageNo=1&inqryDiv=1&inqryBgnDt=${dateRange.bgn}&inqryEndDt=${dateRange.end}&bidNtceNm=${encodeURIComponent(keyword)}&type=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const trimmed = text.trim();
        if (trimmed.startsWith('<')) {
            const m = trimmed.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/);
            const reason = m ? m[1] : trimmed.substring(0, 120).replace(/\s+/g, ' ');
            return { items: [], error: `XML 응답: ${reason}` };
        }
        const json = JSON.parse(trimmed);
        const items = json?.response?.body?.items || [];
        return { items: Array.isArray(items) ? items : [], error: null };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    const now = new Date();
    const past = new Date();
    past.setDate(now.getDate() - 90);

    const dateRange = {
        bgn: formatG2BDate(past) + '0000',
        end: formatG2BDate(now) + '2359'
    };

    console.log(`[INFO] 수집 범위: ${dateRange.bgn} ~ ${dateRange.end}`);
    console.log(`[INFO] 검색어 ${SEARCH_TERMS.length}개 × 엔드포인트 ${ENDPOINTS.length}개 = ${SEARCH_TERMS.length * ENDPOINTS.length}회 호출`);

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
                    console.log(`  - OK   ${endpoint.name} / "${term}" — ${result.items.length}건`);
                    for (const i of result.items) {
                        const budget = Number(i.assignBudgetAmt) || Number(i.presmptPrce) || Number(i.assignBdgtAmt) || 0;
                        const regDt = (i.bidNtceRegistDt || i.bidNtceDt || '').toString().substring(0, 16);
                        const closeDt = (i.bidClseDt || '').toString().substring(0, 16);
                        const bidNtceNo = (i.bidNtceNo || '').toString();
                        const seqPart = bidNtceNo.split('-')[1] || '';
                        allBids.push({
                            bidNtceNo: bidNtceNo || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            bidNtceNm: i.bidNtceNm || '(공고명 없음)',
                            ntceInsttNm: i.ntceInsttNm || i.ntcgInsttNm || '자체공고기관',
                            dminsttNm: i.dminsttNm || i.ntceInsttNm || '자체수요기관',
                            assignBudgetAmt: budget,
                            bidNtceRegistDt: regDt,
                            bidClseDt: closeDt,
                            searchKeyword: term,
                            region: classifyRegion(i.ntceInsttNm || i.bidNtceNm),
                            g2bUrl: i.bidNtceDtlUrl || `https://www.g2b.go.kr:8401/egp/bi/bid/bidDetail.do?bidNo=${bidNtceNo.split('-')[0]}&bidSeq=${seqPart}`
                        });
                    }
                }
            } catch (e) {
                const msg = e.name === 'AbortError' ? '타임아웃' : e.message;
                errors.push(`[${endpoint.name}/${term}] ${msg}`);
                console.log(`  - FAIL ${endpoint.name} / "${term}" — ${msg}`);
            }
            await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
        }
    }

    // 중복 제거 (bidNtceNo 기준)
    const uniqueMap = new Map();
    for (const b of allBids) uniqueMap.set(b.bidNtceNo, b);
    const unique = Array.from(uniqueMap.values());
    unique.sort((a, b) => (b.bidNtceRegistDt || '').localeCompare(a.bidNtceRegistDt || ''));

    // 카테고리 분포 집계
    const categoryStats = {};
    for (const cat of Object.keys(KEYWORD_CATEGORY)) categoryStats[cat] = 0;
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
        rangeBegin: dateRange.bgn,
        rangeEnd: dateRange.end,
        totalCount: unique.length,
        successCalls: successCount,
        failedCalls: errors.length,
        categoryStats,
        errors: errors.slice(0, 20),
        bids: unique
    };

    const outDir = 'data';
    const outPath = path.join(outDir, 'bids.json');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log('');
    console.log(`[DONE] 총 ${unique.length}건 (중복 제거 후) → ${outPath}`);
    console.log(`[DONE] 성공 호출: ${successCount} / 실패 호출: ${errors.length}`);
    console.log(`[DONE] 카테고리: ${JSON.stringify(categoryStats)}`);
}

main().catch(e => {
    console.error('[FATAL]', e);
    process.exit(1);
});
