// 나라장터(G2B) 3대 조달 서비스 수집 스크립트 — GitHub Actions cron 환경에서 실행
// 수집 대상: 입찰공고 + 사전규격 + 발주계획
// 매 실행 시 최근 30일치 데이터를 15일 단위로 나누어 수집해 data/bids.json 에 덮어쓴다.

import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeServiceKey(key) {
    const raw = String(key || '').trim();
    if (!raw) return '';
    try {
        return raw.includes('%') ? decodeURIComponent(raw) : raw;
    } catch {
        return raw;
    }
}

const API_KEYS = {
    BID: normalizeServiceKey(process.env.NARA_API_KEY),
    PRESPEC: normalizeServiceKey(process.env.NARA_PRESPEC_API_KEY || process.env.NARA_API_KEY),
    PLAN: normalizeServiceKey(process.env.NARA_PLAN_API_KEY || process.env.NARA_API_KEY)
};

if (!API_KEYS.BID) {
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

// serviceType 값은 di.html의 서비스 필터와 직접 연결된다.
// 공고 / 사전규격 / 발주계획
const DATA_SOURCES = [
    // 1) 입찰공고
    {
        serviceType: "공고",
        businessType: "물품",
        keyType: "BID",
        url: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThngPPSSrch",
        dateMode: "datetime",
        keywordParams: ["bidNtceNm"],
        mapType: "bid"
    },
    {
        serviceType: "공고",
        businessType: "용역",
        keyType: "BID",
        url: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch",
        dateMode: "datetime",
        keywordParams: ["bidNtceNm"],
        mapType: "bid"
    },

    // 2) 사전규격
    // 공공데이터포털에서 "조달청_나라장터 사전규격정보서비스" 활용신청 필요.
    // 별도 키가 있으면 NARA_PRESPEC_API_KEY를 등록하고, 없으면 NARA_API_KEY를 재사용한다.
    {
        serviceType: "사전규격",
        businessType: "물품/용역",
        keyType: "PRESPEC",
        url: process.env.NARA_PRESPEC_ENDPOINT || "https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServcPPSSrch",
        dateMode: "datetime",
        keywordParams: [
            "bidNtceNm",
            "prdctClsfcNoNm",
            "prdctNm",
            "bsnsNm",
            "publicPrcureNm",
            "purchsObjNm"
        ],
        mapType: "prespec",
        localKeywordFilter: true
    },

    // 3) 발주계획
    // 공공데이터포털에서 "조달청_나라장터 발주계획현황서비스" 활용신청 필요.
    // 별도 키가 있으면 NARA_PLAN_API_KEY를 등록하고, 없으면 NARA_API_KEY를 재사용한다.
    // 발주계획 API의 상세 오퍼레이션명이 계정별 명세에서 다를 경우 아래 환경변수로 덮어쓴다.
    // NARA_PLAN_THNG_ENDPOINT, NARA_PLAN_SERVC_ENDPOINT
    {
        serviceType: "발주계획",
        businessType: "물품",
        keyType: "PLAN",
        url: process.env.NARA_PLAN_THNG_ENDPOINT || "https://apis.data.go.kr/1230000/ao/OrderPlanInfoService/getOrderPlanListInfoThng",
        dateMode: "ym",
        keywordParams: [
            "bizNm",
            "bsnsNm",
            "orderPlanNm",
            "prdctClsfcNoNm",
            "prdctNm",
            "purchsObjNm"
        ],
        mapType: "plan",
        localKeywordFilter: true
    },
    {
        serviceType: "발주계획",
        businessType: "용역",
        keyType: "PLAN",
        url: process.env.NARA_PLAN_SERVC_ENDPOINT || "https://apis.data.go.kr/1230000/ao/OrderPlanInfoService/getOrderPlanListInfoServc",
        dateMode: "ym",
        keywordParams: [
            "bizNm",
            "bsnsNm",
            "orderPlanNm",
            "servcNm",
            "purchsObjNm"
        ],
        mapType: "plan",
        localKeywordFilter: true
    }
];

const DAYS_TO_FETCH = 30;
const CHUNK_DAYS = 15;
const NUM_OF_ROWS = 100;
const REQUEST_DELAY_MS = 1000;
const PAGE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_COUNT = 3;

// 사전규격/발주계획은 검색 파라미터명이 입찰공고와 다를 수 있으므로
// 너무 깊은 페이지까지 들어가지 않고 1차 수집 후 로컬 키워드 필터링한다.
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

function formatYm(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${yyyy}${mm}`;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function makeDateRanges(startDate, endDate, chunkDays) {
    const ranges = [];
    let cur = new Date(startDate);

    while (cur <= endDate) {
        const chunkEnd = addDays(cur, chunkDays - 1);
        const actualEnd = chunkEnd > endDate ? new Date(endDate) : chunkEnd;

        ranges.push({
            startDate: new Date(cur),
            endDate: new Date(actualEnd),
            bgn: formatG2BDate(cur) + '0000',
            end: formatG2BDate(actualEnd) + '2359',
            bgnYm: formatYm(cur),
            endYm: formatYm(actualEnd)
        });

        cur = addDays(actualEnd, 1);
    }

    return ranges;
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
    return String(text || '').replace(/\s+/g, ' ').slice(0, max);
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
        json?.items?.item ??
        json?.items ??
        [];

    if (!rawItems) return [];
    return Array.isArray(rawItems) ? rawItems : [rawItems];
}

function extractTotalCount(json) {
    return Number(
        json?.response?.body?.totalCount ??
        json?.totalCount ??
        0
    );
}

function checkApiHeader(json) {
    const header = json?.response?.header ?? json?.header;
    if (!header) return null;

    const resultCode = String(header.resultCode ?? header.resultCd ?? '');
    const resultMsg = String(header.resultMsg ?? header.resultMessage ?? header.resultMsgKo ?? '');

    if (resultCode && !['00', '0', 'NORMAL_CODE'].includes(resultCode)) {
        return `API 오류 ${resultCode}: ${resultMsg || '상세 메시지 없음'}`;
    }

    return null;
}

function pick(obj, keys, fallback = '') {
    for (const key of keys) {
        const value = obj?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }
    return fallback;
}

function pickNumber(obj, keys) {
    for (const key of keys) {
        const raw = obj?.[key];
        if (raw === undefined || raw === null || raw === '') continue;

        const num = Number(String(raw).replace(/[^\d.-]/g, ''));
        if (!Number.isNaN(num) && num !== 0) return num;
    }

    return 0;
}

function normalizeDateText(value) {
    const s = String(value || '').trim();
    if (!s) return '';

    // YYYYMMDDHHmm 형태
    if (/^\d{12}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
    }

    // YYYYMMDD 형태
    if (/^\d{8}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }

    return s.substring(0, 16);
}

function itemContainsKeyword(item, term) {
    const base = normalizeKeyword(term).toLowerCase();
    if (!base) return true;

    const text = [
        item.bidNtceNm,
        item.prdctNm,
        item.bsnsNm,
        item.bizNm,
        item.publicPrcureNm,
        item.purchsObjNm,
        item.orderPlanNm,
        item.prcrmntReqNm,
        item.cntrctNm,
        item.prdctClsfcNoNm,
        item.ntceInsttNm,
        item.dminsttNm,
        item.rlDminsttNm,
        item.orderInsttNm
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes(base);
}

function buildUrl(source, keyword, dateRange, pageNo) {
    const url = new URL(source.url);
    const apiKey = API_KEYS[source.keyType] || API_KEYS.BID;

    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('numOfRows', String(NUM_OF_ROWS));
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('type', 'json');

    if (source.dateMode === 'ym') {
        // 발주계획은 발주년월범위 조건을 쓰는 명세가 많아서 복수 파라미터를 같이 넣는다.
        url.searchParams.set('inqryBgnDt', dateRange.bgn);
        url.searchParams.set('inqryEndDt', dateRange.end);
        url.searchParams.set('orderBgnYm', dateRange.bgnYm);
        url.searchParams.set('orderEndYm', dateRange.endYm);
        url.searchParams.set('orderPlanBgnYm', dateRange.bgnYm);
        url.searchParams.set('orderPlanEndYm', dateRange.endYm);
        url.searchParams.set('bgnYm', dateRange.bgnYm);
        url.searchParams.set('endYm', dateRange.endYm);
    } else {
        url.searchParams.set('inqryDiv', '1');
        url.searchParams.set('inqryBgnDt', dateRange.bgn);
        url.searchParams.set('inqryEndDt', dateRange.end);
    }

    for (const param of source.keywordParams || []) {
        url.searchParams.set(param, keyword);
    }

    return url;
}

async function fetchPage(source, keyword, dateRange, pageNo) {
    const url = buildUrl(source, keyword, dateRange, pageNo);

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

        let items = extractItems(json);

        if (source.localKeywordFilter) {
            items = items.filter(item => itemContainsKeyword(item, keyword));
        }

        return {
            items,
            totalCount: extractTotalCount(json),
            error: null
        };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchPageWithRetry(source, keyword, dateRange, pageNo) {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            const result = await fetchPage(source, keyword, dateRange, pageNo);

            // 인증/파라미터 오류는 재시도해도 의미가 적어서 그대로 반환.
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

async function fetchOne(source, keyword, dateRange) {
    const allItems = [];
    let totalCount = 0;
    let totalPages = 1;

    for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
        const result = await fetchPageWithRetry(source, keyword, dateRange, pageNo);

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
                console.log(`    WARN ${source.serviceType}/${source.businessType} / "${keyword}" — ${totalCount}건, ${totalPages}페이지 중 ${MAX_PAGES_PER_QUERY}페이지만 수집`);
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

function buildG2bBidUrl(i, bidNtceNo, bidNtceOrd) {
    if (i.bidNtceDtlUrl) return i.bidNtceDtlUrl;

    if (bidNtceNo) {
        return `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${encodeURIComponent(bidNtceNo)}&bidPbancOrd=${encodeURIComponent(bidNtceOrd || '000')}`;
    }

    return '';
}

function buildG2bPrespecUrl(i, id) {
    if (i.publicPrcureDtlUrl) return i.publicPrcureDtlUrl;
    if (i.bfSpecDtlUrl) return i.bfSpecDtlUrl;
    if (i.specDtlUrl) return i.specDtlUrl;

    return id
        ? `https://www.g2b.go.kr/link/PRCA001_04/single/?srch=${encodeURIComponent(id)}`
        : '';
}

function buildG2bPlanUrl(i, id) {
    if (i.orderPlanDtlUrl) return i.orderPlanDtlUrl;
    if (i.detailUrl) return i.detailUrl;

    return id
        ? `https://www.g2b.go.kr/link/PRCA001_04/single/?orderPlanUntyNo=${encodeURIComponent(id)}`
        : '';
}

function mapBidRecord(i, source, term) {
    const bidNtceNo = pick(i, ['bidNtceNo']);
    const bidNtceOrd = pick(i, ['bidNtceOrd'], '000');
    const seqPart = bidNtceNo.split('-')[1] || '';
    const bidSeq = bidNtceOrd || seqPart || '000';

    const bidId = bidNtceNo
        ? [bidNtceNo, bidSeq].filter(Boolean).join('-')
        : `BID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const title = pick(i, ['bidNtceNm'], '(공고명 없음)');
    const ntceInsttNm = pick(i, ['ntceInsttNm', 'ntcgInsttNm'], '자체공고기관');
    const dminsttNm = pick(i, ['dminsttNm', 'rlDminsttNm', 'ntceInsttNm'], '자체수요기관');

    return {
        bidId,
        bidNtceNo: bidNtceNo || bidId,
        bidNtceOrd: bidSeq,
        bidNtceNm: title,
        ntceInsttNm,
        dminsttNm,
        assignBudgetAmt: pickNumber(i, ['assignBudgetAmt', 'asignBdgtAmt', 'presmptPrce', 'assignBdgtAmt']),
        bidNtceRegistDt: normalizeDateText(pick(i, ['bidNtceRegistDt', 'bidNtceDt', 'rgstDt'])),
        bidClseDt: normalizeDateText(pick(i, ['bidClseDt', 'opengDt', 'bidBeginDt'])),
        searchKeyword: term,
        region: classifyRegion(`${ntceInsttNm} ${dminsttNm} ${title}`),
        g2bUrl: buildG2bBidUrl(i, bidNtceNo, bidSeq),
        serviceType: source.serviceType,
        businessType: source.businessType
    };
}

function mapPrespecRecord(i, source, term) {
    const id = pick(i, [
        'bfSpecRgstNo',
        'bfSpecRegNo',
        'publicPrcureNo',
        'prcrmntReqNo',
        'refNo',
        'bidNtceNo'
    ]);

    const title = pick(i, [
        'bidNtceNm',
        'prdctNm',
        'bsnsNm',
        'bizNm',
        'publicPrcureNm',
        'purchsObjNm',
        'specNm',
        'prcrmntReqNm'
    ], '(사전규격명 없음)');

    const ntceInsttNm = pick(i, ['ntceInsttNm', 'ntcgInsttNm', 'orderInsttNm', 'rlDminsttNm'], '자체공개기관');
    const dminsttNm = pick(i, ['dminsttNm', 'rlDminsttNm', 'orderInsttNm', 'ntceInsttNm'], '자체수요기관');

    const internalId = id
        ? `BF-${id}`
        : `BF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
        bidId: internalId,
        bidNtceNo: internalId,
        bidNtceOrd: '',
        bidNtceNm: title,
        ntceInsttNm,
        dminsttNm,
        assignBudgetAmt: pickNumber(i, [
            'assignBudgetAmt',
            'asignBdgtAmt',
            'asignBdgtAmt',
            'presmptPrce',
            'budgetAmt',
            'prdctUprc',
            'totPrdprc'
        ]),
        bidNtceRegistDt: normalizeDateText(pick(i, [
            'opengDt',
            'rlsDt',
            'rcptDt',
            'registDt',
            'rgstDt',
            'inqryDt'
        ])),
        bidClseDt: normalizeDateText(pick(i, [
            'opninRgstClseDt',
            'opinRgstClseDt',
            'opinionRgstClseDt',
            'clseDt',
            'dlvrTmlmtDt'
        ])),
        searchKeyword: term,
        region: classifyRegion(`${ntceInsttNm} ${dminsttNm} ${title}`),
        g2bUrl: buildG2bPrespecUrl(i, id),
        serviceType: source.serviceType,
        businessType: source.businessType
    };
}

function mapPlanRecord(i, source, term) {
    const id = pick(i, [
        'orderPlanUntyNo',
        'orderPlanNo',
        'orderPlanMngNo',
        'prcrmntReqNo',
        'refNo'
    ]);

    const title = pick(i, [
        'bizNm',
        'bsnsNm',
        'orderPlanNm',
        'prdctNm',
        'servcNm',
        'purchsObjNm',
        'cntrctNm',
        'prcrmntReqNm'
    ], '(발주계획명 없음)');

    const ntceInsttNm = pick(i, ['orderInsttNm', 'ntceInsttNm', 'dminsttNm', 'rlDminsttNm'], '자체발주기관');
    const dminsttNm = pick(i, ['dminsttNm', 'rlDminsttNm', 'orderInsttNm', 'ntceInsttNm'], '자체수요기관');

    const internalId = id
        ? `PL-${id}`
        : `PL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const orderYm = pick(i, ['orderYm', 'orderPlanYm', 'exctvYm', 'rlsYm']);

    return {
        bidId: internalId,
        bidNtceNo: internalId,
        bidNtceOrd: '',
        bidNtceNm: title,
        ntceInsttNm,
        dminsttNm,
        assignBudgetAmt: pickNumber(i, [
            'sumOrderAmt',
            'orderAmt',
            'orderBudgetAmt',
            'assignBudgetAmt',
            'asignBdgtAmt',
            'presmptPrce',
            'totPrdprc',
            'budgetAmt'
        ]),
        bidNtceRegistDt: normalizeDateText(pick(i, ['rgstDt', 'registDt', 'rlsDt', 'inqryDt', 'orderYm', 'orderPlanYm'])),
        bidClseDt: orderYm ? `${orderYm.slice(0, 4)}-${orderYm.slice(4, 6)}` : '',
        searchKeyword: term,
        region: classifyRegion(`${ntceInsttNm} ${dminsttNm} ${title}`),
        g2bUrl: buildG2bPlanUrl(i, id),
        serviceType: source.serviceType,
        businessType: source.businessType
    };
}

function makeRecord(i, source, term) {
    if (source.mapType === 'prespec') return mapPrespecRecord(i, source, term);
    if (source.mapType === 'plan') return mapPlanRecord(i, source, term);
    return mapBidRecord(i, source, term);
}

function initStats() {
    return {
        "공고": 0,
        "사전규격": 0,
        "발주계획": 0
    };
}

async function main() {
    const now = getKstDate();
    const past = getKstDate();

    past.setDate(now.getDate() - DAYS_TO_FETCH);

    const dateRanges = makeDateRanges(past, now, CHUNK_DAYS);

    console.log(`[INFO] 수집 범위: ${formatG2BDate(past)}0000 ~ ${formatG2BDate(now)}2359`);
    console.log(`[INFO] 날짜 분할: ${dateRanges.length}개 구간 / ${CHUNK_DAYS}일 단위`);
    console.log(`[INFO] 검색어 ${SEARCH_TERMS.length}개 × 데이터소스 ${DATA_SOURCES.length}개 × 날짜구간 ${dateRanges.length}개 = ${SEARCH_TERMS.length * DATA_SOURCES.length * dateRanges.length}개 기본 호출`);
    console.log(`[INFO] 최대 페이지: 검색어/데이터소스/날짜구간당 ${MAX_PAGES_PER_QUERY}페이지`);
    console.log(`[INFO] 요청 간격: ${REQUEST_DELAY_MS}ms, 타임아웃: ${REQUEST_TIMEOUT_MS}ms, 재시도: ${RETRY_COUNT}회`);
    console.log(`[INFO] 키 설정: BID=${API_KEYS.BID ? 'Y' : 'N'}, PRESPEC=${API_KEYS.PRESPEC ? 'Y' : 'N'}, PLAN=${API_KEYS.PLAN ? 'Y' : 'N'}`);

    const allBids = [];
    const errors = [];
    let successCount = 0;

    for (const dateRange of dateRanges) {
        console.log(`[INFO] 구간 처리: ${dateRange.bgn} ~ ${dateRange.end}`);

        for (const source of DATA_SOURCES) {
            if (!API_KEYS[source.keyType]) {
                const msg = `${source.keyType} 인증키 없음`;
                errors.push(`[${source.serviceType}/${source.businessType}] ${msg}`);
                console.log(`  - SKIP ${source.serviceType} / ${source.businessType} — ${msg}`);
                continue;
            }

            for (const term of SEARCH_TERMS) {
                try {
                    const result = await fetchOne(source, term, dateRange);

                    if (result.error) {
                        errors.push(`[${source.serviceType}/${source.businessType}/${term}/${dateRange.bgn}-${dateRange.end}] ${result.error}`);
                        console.log(`  - FAIL ${source.serviceType} / ${source.businessType} / "${term}" — ${result.error}`);
                    } else {
                        successCount++;
                        console.log(`  - OK   ${source.serviceType} / ${source.businessType} / "${term}" — ${result.items.length}건 / totalCount ${result.totalCount}`);

                        for (const i of result.items) {
                            allBids.push(makeRecord(i, source, term));
                        }
                    }
                } catch (e) {
                    const msg = e.name === 'AbortError' ? '타임아웃' : e.message;
                    errors.push(`[${source.serviceType}/${source.businessType}/${term}/${dateRange.bgn}-${dateRange.end}] ${msg}`);
                    console.log(`  - FAIL ${source.serviceType} / ${source.businessType} / "${term}" — ${msg}`);
                }

                await sleep(REQUEST_DELAY_MS);
            }
        }
    }

    if (successCount === 0) {
        console.error('');
        console.error('[ERROR] 모든 API 호출 실패. 기존 data/bids.json 보호를 위해 파일을 덮어쓰지 않습니다.');
        console.error('[ERROR] 상위 오류 목록:');
        for (const err of errors.slice(0, 10)) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    const uniqueMap = new Map();

    for (const b of allBids) {
        uniqueMap.set(b.bidId || b.bidNtceNo, b);
    }

    const unique = Array.from(uniqueMap.values());

    unique.sort((a, b) =>
        String(b.bidNtceRegistDt || '').localeCompare(String(a.bidNtceRegistDt || ''))
    );

    const categoryStats = {};
    for (const cat of Object.keys(KEYWORD_CATEGORY)) {
        categoryStats[cat] = 0;
    }

    const serviceStats = initStats();

    for (const b of unique) {
        const serviceType = b.serviceType || "공고";
        if (serviceStats[serviceType] !== undefined) {
            serviceStats[serviceType]++;
        }

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
        chunkDays: CHUNK_DAYS,
        rangeBegin: formatG2BDate(past) + '0000',
        rangeEnd: formatG2BDate(now) + '2359',
        totalCount: unique.length,
        rawCount: allBids.length,
        successCalls: successCount,
        failedCalls: errors.length,
        requestDelayMs: REQUEST_DELAY_MS,
        maxPagesPerQuery: MAX_PAGES_PER_QUERY,
        serviceStats,
        categoryStats,
        errors: errors.slice(0, 30),
        bids: unique
    };

    const outDir = 'data';
    const outPath = path.join(outDir, 'bids.json');

    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log('');
    console.log(`[DONE] 총 ${unique.length}건 / 원본 ${allBids.length}건 → ${outPath}`);
    console.log(`[DONE] 성공 호출: ${successCount} / 실패 호출: ${errors.length}`);
    console.log(`[DONE] 서비스: ${JSON.stringify(serviceStats)}`);
    console.log(`[DONE] 카테고리: ${JSON.stringify(categoryStats)}`);

    if (errors.length > 0) {
        console.log('[WARN] 일부 호출 실패 있음. data/bids.json의 errors 필드 확인 필요.');
    }
}

main().catch(e => {
    console.error('[FATAL]', e);
    process.exit(1);
});
