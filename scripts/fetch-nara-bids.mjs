// 나라장터(G2B) 3대 조달 서비스 수집 스크립트 — GitHub Actions cron 환경에서 실행
// 적용 API 참고자료:
// - 나라장터 입찰공고정보서비스 1.2
// - 나라장터 사전규격정보서비스 1.0
// - 나라장터 발주계획현황서비스 1.0
//
// 수집 대상: 입찰공고 + 사전규격 + 발주계획
// 매 실행 시 최근 30일치 데이터를 15일 단위로 나누어 수집해 data/bids.json에 덮어쓴다.

import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');

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
const INDIRECT_KEYWORDS = {
    "문화시설": ["문화센터", "체육센터", "복합센터", "커뮤니티센터"],
    "건립": ["건립", "신축"],
    "체육시설": ["체육관", "운동장", "경기장", "수영장", "축구", "야구", "스포츠파크", "스포츠타운"]
};
const SEARCH_TERMS = [
    ...BASE_KEYWORDS.flatMap(k => [k, `디지털 ${k}`]),
    ...Object.values(INDIRECT_KEYWORDS).flat()
];

const KEYWORD_CATEGORY = {
    "디스플레이/사이니지 계열": ["전광판", "LED", "디스플레이", "사이니지"],
    "미디어/파사드 계열": ["미디어", "파사드"],
    "ITS/VMS 계열": ["ITS", "VMS"],
    "전광판 외 간접 사업/문화시설": INDIRECT_KEYWORDS["문화시설"],
    "전광판 외 간접 사업/건립": INDIRECT_KEYWORDS["건립"],
    "전광판 외 간접 사업/체육시설": INDIRECT_KEYWORDS["체육시설"]
};

// 문서 기준 서비스 URL + 오퍼레이션명 적용.
// 입찰공고: /1230000/ad/BidPublicInfoService
// 사전규격: /1230000/ao/HrcspSsstndrdInfoService
// 발주계획: /1230000/ao/OrderPlanSttusService
const DATA_SOURCES = [
    {
        serviceType: "공고",
        businessType: "물품",
        keyType: "BID",
        url: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThngPPSSrch",
        keywordParam: "bidNtceNm",
        dateMode: "datetimeWithDiv",
        mapType: "bid"
    },
    {
        serviceType: "공고",
        businessType: "용역",
        keyType: "BID",
        url: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch",
        keywordParam: "bidNtceNm",
        dateMode: "datetimeWithDiv",
        mapType: "bid"
    },
    {
        serviceType: "사전규격",
        businessType: "물품",
        keyType: "PRESPEC",
        url: "https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoThngPPSSrch",
        keywordParam: "prdctClsfcNoNm",
        dateMode: "datetimeWithDiv",
        mapType: "prespec",
        localKeywordFilter: true
    },
    {
        serviceType: "사전규격",
        businessType: "용역",
        keyType: "PRESPEC",
        url: "https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServcPPSSrch",
        keywordParam: "prdctClsfcNoNm",
        dateMode: "datetimeWithDiv",
        mapType: "prespec",
        localKeywordFilter: true
    },
    {
        serviceType: "발주계획",
        businessType: "물품",
        keyType: "PLAN",
        url: "https://apis.data.go.kr/1230000/ao/OrderPlanSttusService/getOrderPlanSttusListThngPPSSrch",
        keywordParam: "bizNm",
        dateMode: "planYmAndPostDate",
        mapType: "plan",
        localKeywordFilter: true
    },
    {
        serviceType: "발주계획",
        businessType: "용역",
        keyType: "PLAN",
        url: "https://apis.data.go.kr/1230000/ao/OrderPlanSttusService/getOrderPlanSttusListServcPPSSrch",
        keywordParam: "bizNm",
        dateMode: "planYmAndPostDate",
        mapType: "plan",
        localKeywordFilter: true
    }
];

const DAYS_TO_FETCH = 30;
const CHUNK_DAYS = 15;
const NUM_OF_ROWS = 100;
const REQUEST_DELAY_MS = 1000;
const PAGE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = Number(process.env.NARA_REQUEST_TIMEOUT_MS || 30000);
const RETRY_COUNT = Number(process.env.NARA_RETRY_COUNT || 3);
const MAX_CONSECUTIVE_CONNECTIVITY_FAILURES = Number(process.env.NARA_MAX_CONSECUTIVE_FAILURES || 3);
const MIN_SUCCESS_RATIO = Number(process.env.NARA_MIN_SUCCESS_RATIO || 0.8);
const MAX_PAGES_PER_QUERY = 5;
const UPDATE_SCHEDULE_KST = ['07:00', '11:00', '16:00'];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function describeRequestError(error) {
    if (!error) return 'Unknown request error';

    const details = [];
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        details.push(`timeout (${REQUEST_TIMEOUT_MS}ms)`);
    } else if (error.message) {
        details.push(error.message);
    }

    let cause = error.cause;
    while (cause) {
        const causeDetail = [cause.code, cause.message].filter(Boolean).join(': ');
        if (causeDetail) details.push(causeDetail);
        cause = cause.cause;
    }

    return [...new Set(details)].join(' | ') || String(error);
}

function isRetryableRequestError(error) {
    if (!error) return false;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    if (error instanceof TypeError && error.message === 'fetch failed') return true;
    if (/^HTTP (408|425|429|5\d\d)\b/.test(error.message || '')) return true;

    const retryableCodes = new Set([
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_SOCKET',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'ENETUNREACH'
    ]);

    let cause = error.cause;
    while (cause) {
        if (retryableCodes.has(cause.code)) return true;
        cause = cause.cause;
    }

    return false;
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
    const resultMsg = trimmed.match(/<resultMsg>([^<]+)<\/resultMsg>/)?.[1];

    return authMsg || errMsg || resultMsg || reasonCode || bodyPreview(trimmed, 300);
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

    if (/^\d{12}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`;
    }

    if (/^\d{8}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }

    if (/^\d{6}$/.test(s)) {
        return `${s.slice(0, 4)}-${s.slice(4, 6)}`;
    }

    return s.substring(0, 16);
}

function itemContainsKeyword(item, term) {
    const base = normalizeKeyword(term).toLowerCase();
    if (!base) return true;

    const text = [
        item.bidNtceNm,
        item.prdctClsfcNoNm,
        item.dtilPrdctClsfcNoNm,
        item.prdctDtlList,
        item.prdctNm,
        item.bizNm,
        item.bsnsNm,
        item.purchsObjNm,
        item.orderPlanNm,
        item.specItemNm1,
        item.specItemNm2,
        item.specItemNm3,
        item.specItemNm4,
        item.specItemNm5,
        item.usgCntnts,
        item.orderInsttNm,
        item.ntceInsttNm,
        item.dminsttNm,
        item.rlDminsttNm
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

    if (source.dateMode === 'datetimeWithDiv') {
        url.searchParams.set('inqryDiv', '1');
        url.searchParams.set('inqryBgnDt', dateRange.bgn);
        url.searchParams.set('inqryEndDt', dateRange.end);
    }

    if (source.dateMode === 'planYmAndPostDate') {
        url.searchParams.set('orderBgnYm', dateRange.bgnYm);
        url.searchParams.set('orderEndYm', dateRange.endYm);
        url.searchParams.set('inqryBgnDt', dateRange.bgn);
        url.searchParams.set('inqryEndDt', dateRange.end);
    }

    if (source.keywordParam) {
        url.searchParams.set(source.keywordParam, keyword);
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
            if (result.error) return result;
            return result;
        } catch (e) {
            const isLast = attempt === RETRY_COUNT;
            const retryable = isRetryableRequestError(e);
            const msg = describeRequestError(e);

            if (isLast || !retryable) {
                const finalError = new Error(msg);
                finalError.isConnectivityFailure = retryable;
                throw finalError;
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

function buildPrespecUrl(i, id) {
    // 원문 이동 버튼은 파일 다운로드 URL이 아니라 나라장터 화면으로 이동해야 한다.
    // specDocFileUrl 계열은 documentUrls에만 보관한다.
    const directPage = pick(i, [
        'publicPrcureDtlUrl',
        'bfSpecDtlUrl',
        'preSpecDtlUrl',
        'specDtlUrl',
        'detailUrl'
    ]);

    if (directPage && !/File|file|download|Down|down|atch|specDoc/i.test(directPage)) {
        return directPage;
    }

    const query = id || pick(i, ['refNo', 'bfSpecRgstNo', 'bfSpecRegNo', 'prdctClsfcNoNm', 'purchsObjNm']);
    return query
        ? `https://www.g2b.go.kr/search.do?category=TGONG&kwd=${encodeURIComponent(query)}`
        : 'https://www.g2b.go.kr/';
}


function buildPlanUrl(i, id) {
    const directPage = pick(i, ['orderPlanDtlUrl', 'orderPlanDetailUrl', 'detailUrl']);

    if (directPage && !/File|file|download|Down|down|atch|specDoc/i.test(directPage)) {
        return directPage;
    }

    const query = id || pick(i, ['orderPlanUntyNo', 'bizNm', 'bsnsNm', 'orderPlanNm']);
    return query
        ? `https://www.g2b.go.kr/search.do?category=TPLAN&kwd=${encodeURIComponent(query)}`
        : 'https://www.g2b.go.kr/';
}




function addUniqueMethod(list, value) {
    const s = String(value || '').replace(/\s+/g, ' ').trim();
    if (!s) return;
    if (!list.includes(s)) list.push(s);
}

function extractContractMethods(i, source, title = '') {
    const methods = [];
    const raw = [
        pick(i, ['cntrctCnclsMthdNm']),
        pick(i, ['cntrctMthdNm']),
        pick(i, ['cntrctMthd']),
        pick(i, ['cntrctTyNm']),
        pick(i, ['bidMethdNm']),
        pick(i, ['sucsfbidMthdNm']),
        pick(i, ['prcrmntMethd']),
        pick(i, ['prcrmntMethdNm']),
        pick(i, ['bidNtceKindNm']),
        pick(i, ['ntceKindNm']),
        pick(i, ['prtcptLmtRgnNm']),
        pick(i, ['prtcptPsblRgnNm']),
        pick(i, ['rgnLmtNm']),
        pick(i, ['jntcontrctDutyRgnNm1']),
        pick(i, ['jntcontrctDutyRgnNm2']),
        pick(i, ['jntcontrctDutyRgnNm3']),
        title,
        pick(i, ['bidNtceNm', 'bizNm', 'bsnsNm', 'prdctClsfcNoNm'])
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ');

    if (
        raw.includes('지역제한') ||
        raw.includes('지역 제한') ||
        raw.includes('참가제한지역') ||
        raw.includes('지역의무') ||
        pick(i, ['prtcptLmtRgnNm', 'prtcptPsblRgnNm', 'rgnLmtNm'])
    ) addUniqueMethod(methods, '지역제한');

    if (raw.includes('수의')) addUniqueMethod(methods, '수의계약');

    if (raw.includes('지명경쟁') && (raw.includes('조합추천') || raw.includes('전자조합'))) {
        addUniqueMethod(methods, '지명경쟁(전자조합추천)');
    } else if (raw.includes('지명경쟁')) {
        addUniqueMethod(methods, '지명경쟁');
    }

    if (raw.includes('제한경쟁') || raw.includes('제한(총액') || raw.includes('제한입찰')) addUniqueMethod(methods, '제한경쟁');
    if (raw.includes('일반경쟁') || raw.includes('일반(총액') || raw.includes('일반입찰')) addUniqueMethod(methods, '일반경쟁');
    if (raw.includes('협상')) addUniqueMethod(methods, '협상계약');
    if (raw.includes('적격심사')) addUniqueMethod(methods, '적격심사');
    if (raw.includes('규격가격')) addUniqueMethod(methods, '규격가격동시');
    if (raw.includes('다수공급자') || raw.includes('MAS')) addUniqueMethod(methods, '다수공급자');
    if (raw.includes('제3자단가')) addUniqueMethod(methods, '제3자단가');

    if (methods.length === 0) {
        const direct = pick(i, [
            'cntrctCnclsMthdNm',
            'cntrctMthdNm',
            'cntrctMthd',
            'bidMethdNm',
            'sucsfbidMthdNm',
            'prcrmntMethd',
            'prcrmntMethdNm'
        ]);

        if (direct) addUniqueMethod(methods, direct.length > 28 ? `${direct.slice(0, 28)}…` : direct);
    }

    if (methods.length === 0 && source?.serviceType === '사전규격') addUniqueMethod(methods, '사전규격');
    if (methods.length === 0 && source?.serviceType === '발주계획') addUniqueMethod(methods, '발주계획');
    if (methods.length === 0) addUniqueMethod(methods, '계약방법 미확인');

    return methods;
}

function inferContractMethod(i, source, title = '') {
    return extractContractMethods(i, source, title).join(' / ');
}


function collectOriginalPageCandidates(i) {
    return [
        i.bidNtceDtlUrl,
        i.publicPrcureDtlUrl,
        i.bfSpecDtlUrl,
        i.preSpecDtlUrl,
        i.specDtlUrl,
        i.orderPlanDtlUrl,
        i.orderPlanDetailUrl,
        i.detailUrl
    ].filter(Boolean).filter(u => !/File|file|download|Down|down|atch|specDoc/i.test(String(u)));
}

function collectDocumentUrls(i) {
    const docs = [];

    function add(label, url) {
        const u = String(url || '').trim();
        if (!u) return;
        if (docs.some(d => d.url === u)) return;
        docs.push({ label, url: u });
    }

    for (let idx = 1; idx <= 10; idx++) {
        add(`공고규격서 ${idx}`, i[`ntceSpecDocUrl${idx}`]);
        add(`공고첨부파일 ${idx}`, i[`ntceSpecFileUrl${idx}`]);
        add(`규격문서 ${idx}`, i[`specDocFileUrl${idx}`]);
        add(`첨부파일 ${idx}`, i[`atchFileUrl${idx}`]);
    }

    add('상세 URL', i.bidNtceDtlUrl);
    add('발주계획 상세 URL', i.orderPlanDtlUrl);
    add('상세 URL', i.detailUrl);

    return docs.slice(0, 12);
}

function buildDetailInfo(i, source) {
    return {
        serviceType: source?.serviceType || '',
        businessType: source?.businessType || '',
        originalPageUrl: collectOriginalPageCandidates(i)[0] || '',
        contractMethodRaw: pick(i, ['cntrctCnclsMthdNm', 'cntrctMthdNm', 'cntrctMthd', 'bidMethdNm', 'sucsfbidMthdNm', 'prcrmntMethd']),
        bidMethod: pick(i, ['bidMethdNm']),
        awardMethod: pick(i, ['sucsfbidMthdNm', 'sucsfbidMthd']),
        contractType: pick(i, ['cntrctCnclsMthdNm', 'cntrctMthdNm', 'cntrctMthd']),
        noticeKind: pick(i, ['ntceKindNm', 'bidNtceKindNm']),
        restrictionRegion: pick(i, ['prtcptLmtRgnNm', 'prtcptPsblRgnNm', 'rgnLmtNm']),
        bidBeginDt: normalizeDateText(pick(i, ['bidBeginDt'])),
        bidClseDt: normalizeDateText(pick(i, ['bidClseDt'])),
        openDt: normalizeDateText(pick(i, ['opengDt'])),
        registerDeadline: normalizeDateText(pick(i, ['bidQlfctRgstDt', 'cmmnSpldmdAgrmntClseDt', 'pqApplDocRcptDt', 'arsltApplDocRcptDt'])),
        opinionCloseDt: normalizeDateText(pick(i, ['opninRgstClseDt', 'opinRgstClseDt', 'opinionRgstClseDt'])),
        deliveryLimitDt: normalizeDateText(pick(i, ['dlvrTmlmtDt'])),
        orderYear: pick(i, ['orderYear']),
        orderMonth: pick(i, ['orderMnth', 'orderYm', 'orderPlanYm']),
        department: pick(i, ['deptNm']),
        officerName: pick(i, ['ntceInsttOfclNm', 'ofclNm', 'exctvNm']),
        officerTel: pick(i, ['ntceInsttOfclTelNo', 'ofclTelNo', 'telNo']),
        officerEmail: pick(i, ['ntceInsttOfclEmailAdrs']),
        referenceNo: pick(i, ['refNo']),
        linkedBidNoList: pick(i, ['bidNtceNoList']),
        productName: pick(i, ['prdctClsfcNoNm', 'dtilPrdctClsfcNoNm']),
        productDetails: pick(i, ['prdctDtlList']),
        purpose: pick(i, ['usgCntnts']),
        quantity: pick(i, ['qtyCntnts']),
        unit: pick(i, ['unit']),
        orderAmount: pickNumber(i, ['sumOrderAmt', 'orderContrctAmt', 'orderGovsplyMtrcst', 'orderEtcAmt']),
        rawBusinessDivision: pick(i, ['bsnsDivNm', 'bsnsTyNm'])
    };
}


function mapBidRecord(i, source, term) {
    const bidNtceNo = pick(i, ['bidNtceNo']);
    const bidNtceOrd = pick(i, ['bidNtceOrd'], '000');
    const seqPart = bidNtceNo.split('-')[1] || '';
    const bidSeq = bidNtceOrd || seqPart || '000';

    const bidId = bidNtceNo
        ? `BID-${bidNtceNo}-${bidSeq}`
        : `BID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const title = pick(i, ['bidNtceNm'], '(공고명 없음)');
    const ntceInsttNm = pick(i, ['ntceInsttNm', 'ntcgInsttNm'], '자체공고기관');
    const dminsttNm = pick(i, ['dminsttNm', 'rlDminsttNm', 'ntceInsttNm'], '자체수요기관');
    const contractMethods = extractContractMethods(i, source, title);
    const contractMethod = contractMethods.join(' / ');

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
        contractMethod,
        contractMethods,
        contractMethodRaw: pick(i, ['cntrctCnclsMthdNm', 'cntrctMthdNm', 'bidMethdNm', 'sucsfbidMthdNm']),
        serviceType: source.serviceType,
        businessType: source.businessType,
        documentUrls: collectDocumentUrls(i),
        detailInfo: buildDetailInfo(i, source)
    };
}

function mapPrespecRecord(i, source, term) {
    const bfSpecRgstNo = pick(i, ['bfSpecRgstNo', 'bfSpecRegNo', 'refNo']);
    const refNo = pick(i, ['refNo']);
    const id = bfSpecRgstNo || refNo;

    const title = pick(i, [
        'prdctClsfcNoNm',
        'dtilPrdctClsfcNoNm',
        'prdctNm',
        'purchsObjNm',
        'bsnsNm',
        'bizNm'
    ], '(사전규격명 없음)');

    const ntceInsttNm = pick(i, ['orderInsttNm', 'ntceInsttNm', 'ntcgInsttNm'], '자체공개기관');
    const dminsttNm = pick(i, ['rlDminsttNm', 'dminsttNm', 'orderInsttNm'], '자체수요기관');
    const contractMethods = extractContractMethods(i, source, title);
    const contractMethod = contractMethods.join(' / ');

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
        assignBudgetAmt: pickNumber(i, ['asignBdgtAmt', 'assignBudgetAmt', 'assignBdgtAmt', 'presmptPrce', 'budgetAmt']),
        bidNtceRegistDt: normalizeDateText(pick(i, ['rcptDt', 'rgstDt', 'chgDt'])),
        bidClseDt: normalizeDateText(pick(i, ['opninRgstClseDt', 'opinRgstClseDt', 'opinionRgstClseDt', 'dlvrTmlmtDt'])),
        searchKeyword: term,
        region: classifyRegion(`${ntceInsttNm} ${dminsttNm} ${title}`),
        g2bUrl: buildPrespecUrl(i, id),
        contractMethod,
        contractMethods,
        contractMethodRaw: pick(i, ['cntrctCnclsMthdNm', 'cntrctMthdNm', 'bidMethdNm', 'sucsfbidMthdNm']),
        serviceType: source.serviceType,
        businessType: source.businessType,
        documentUrls: collectDocumentUrls(i),
        detailInfo: buildDetailInfo(i, source),
        refNo,
        linkedBidNtceNoList: pick(i, ['bidNtceNoList'])
    };
}

function mapPlanRecord(i, source, term) {
    const orderPlanUntyNo = pick(i, ['orderPlanUntyNo']);
    const orderYear = pick(i, ['orderYear']);
    const orderInsttCd = pick(i, ['orderInsttCd']);
    const orderPlanSno = pick(i, ['orderPlanSno']);
    const syntheticId = [pick(i, ['bsnsDivCd']), orderYear, orderInsttCd, orderPlanSno].filter(Boolean).join('-');
    const id = orderPlanUntyNo || syntheticId;

    const title = pick(i, ['bizNm', 'bsnsNm', 'orderPlanNm', 'prdctClsfcNoNm', 'dtilPrdctClsfcNoNm'], '(발주계획명 없음)');
    const ntceInsttNm = pick(i, ['orderInsttNm', 'totlmngInsttNm'], '자체발주기관');
    const dminsttNm = pick(i, ['orderInsttNm', 'totlmngInsttNm'], '자체수요기관');
    const contractMethods = extractContractMethods(i, source, title);
    const contractMethod = contractMethods.join(' / ');

    const orderYm = orderYear && pick(i, ['orderMnth'])
        ? `${orderYear}${String(pick(i, ['orderMnth'])).padStart(2, '0')}`
        : pick(i, ['orderYm', 'orderPlanYm']);

    const internalId = id
        ? `PL-${id}`
        : `PL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
        bidId: internalId,
        bidNtceNo: internalId,
        bidNtceOrd: '',
        bidNtceNm: title,
        ntceInsttNm,
        dminsttNm,
        assignBudgetAmt: pickNumber(i, [
            'sumOrderAmt',
            'orderContrctAmt',
            'orderGovsplyMtrcst',
            'orderEtcAmt',
            'orderBudgetAmt',
            'assignBudgetAmt',
            'asignBdgtAmt'
        ]),
        bidNtceRegistDt: normalizeDateText(pick(i, ['nticeDt', 'rgstDt', 'chgDt', 'orderYm', 'orderPlanYm'])),
        bidClseDt: normalizeDateText(orderYm),
        searchKeyword: term,
        region: classifyRegion(`${ntceInsttNm} ${dminsttNm} ${title} ${pick(i, ['cnstwkRgnNm', 'insttLctNm'])}`),
        g2bUrl: buildPlanUrl(i, id),
        contractMethod,
        contractMethods,
        contractMethodRaw: pick(i, ['cntrctMthdNm', 'cntrctCnclsMthdNm', 'prcrmntMethd', 'cntrctMthd']),
        serviceType: source.serviceType,
        businessType: source.businessType,
        documentUrls: collectDocumentUrls(i),
        detailInfo: buildDetailInfo(i, source),
        orderYear,
        orderMnth: pick(i, ['orderMnth'])
    };
}

function makeRecord(i, source, term) {
    if (source.mapType === 'prespec') return mapPrespecRecord(i, source, term);
    if (source.mapType === 'plan') return mapPlanRecord(i, source, term);
    return mapBidRecord(i, source, term);
}


function initServiceStats() {
    return {
        "공고": 0,
        "사전규격": 0,
        "발주계획": 0
    };
}

async function main() {
    const now = getKstDate();
    const past = getKstDate();
    past.setDate(now.getDate() - (DAYS_TO_FETCH - 1));

    const dateRanges = makeDateRanges(past, now, CHUNK_DAYS);

    console.log(`[INFO] 수집 범위: ${formatG2BDate(past)}0000 ~ ${formatG2BDate(now)}2359`);
    console.log(`[INFO] 날짜 분할: ${dateRanges.length}개 구간 / ${CHUNK_DAYS}일 단위`);
    console.log(`[INFO] 검색어 ${SEARCH_TERMS.length}개 × 데이터소스 ${DATA_SOURCES.length}개 × 날짜구간 ${dateRanges.length}개 = ${SEARCH_TERMS.length * DATA_SOURCES.length * dateRanges.length}개 기본 호출`);
    console.log(`[INFO] 최대 페이지: 검색어/데이터소스/날짜구간당 ${MAX_PAGES_PER_QUERY}페이지`);
    console.log(`[INFO] 요청 간격: ${REQUEST_DELAY_MS}ms, 타임아웃: ${REQUEST_TIMEOUT_MS}ms, 재시도: ${RETRY_COUNT}회`);
    console.log(`[INFO] 활성 데이터소스: ${DATA_SOURCES.map(s => `${s.serviceType}/${s.businessType}`).join(', ')}`);
    console.log(`[INFO] 키 설정: BID=${API_KEYS.BID ? 'Y' : 'N'}, PRESPEC=${API_KEYS.PRESPEC ? 'Y' : 'N'}, PLAN=${API_KEYS.PLAN ? 'Y' : 'N'}`);

    const allBids = [];
    const errors = [];
    let successCount = 0;
    let attemptedCount = 0;
    let consecutiveConnectivityFailures = 0;

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
                attemptedCount++;
                try {
                    const result = await fetchOne(source, term, dateRange);

                    if (result.error) {
                        consecutiveConnectivityFailures = 0;
                        errors.push(`[${source.serviceType}/${source.businessType}/${term}/${dateRange.bgn}-${dateRange.end}] ${result.error}`);
                        console.log(`  - FAIL ${source.serviceType} / ${source.businessType} / "${term}" — ${result.error}`);
                    } else {
                        successCount++;
                        consecutiveConnectivityFailures = 0;
                        console.log(`  - OK   ${source.serviceType} / ${source.businessType} / "${term}" — ${result.items.length}건 / totalCount ${result.totalCount}`);

                        for (const i of result.items) {
                            allBids.push(makeRecord(i, source, term));
                        }
                    }
                } catch (e) {
                    const msg = describeRequestError(e);
                    errors.push(`[${source.serviceType}/${source.businessType}/${term}/${dateRange.bgn}-${dateRange.end}] ${msg}`);
                    console.log(`  - FAIL ${source.serviceType} / ${source.businessType} / "${term}" — ${msg}`);

                    if (e.isConnectivityFailure || isRetryableRequestError(e)) {
                        consecutiveConnectivityFailures++;
                    } else {
                        consecutiveConnectivityFailures = 0;
                    }
                }

                if (consecutiveConnectivityFailures >= MAX_CONSECUTIVE_CONNECTIVITY_FAILURES) {
                    throw new Error(
                        `Connectivity failed ${consecutiveConnectivityFailures} times in a row. ` +
                        'Stopping early so the workflow can retry after a cooldown.'
                    );
                }

                await sleep(REQUEST_DELAY_MS);
            }
        }
    }

    const successRatio = attemptedCount > 0 ? successCount / attemptedCount : 0;

    if (successCount === 0 || successRatio < MIN_SUCCESS_RATIO) {
        console.error('');
        console.error(
            `[ERROR] API success ratio is below the safety threshold: ${successCount}/${attemptedCount} ` +
            `(${(successRatio * 100).toFixed(1)}%, required ${(MIN_SUCCESS_RATIO * 100).toFixed(0)}%).`
        );
        console.error('[ERROR] Keeping the previous data/bids.json instead of publishing partial data.');
        console.error('[ERROR] 상위 오류 목록:');
        for (const err of errors.slice(0, 10)) {
            console.error(`  - ${err}`);
        }
        process.exit(1);
    }

    const uniqueMap = new Map();

    for (const b of allBids) {
        uniqueMap.set(`${b.serviceType}:${b.bidId || b.bidNtceNo}`, b);
    }

    const unique = Array.from(uniqueMap.values());

    unique.sort((a, b) =>
        String(b.bidNtceRegistDt || '').localeCompare(String(a.bidNtceRegistDt || ''))
    );

    const categoryStats = {};
    for (const cat of Object.keys(KEYWORD_CATEGORY)) {
        categoryStats[cat] = 0;
    }

    const serviceStats = initServiceStats();

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
        generatedAt: new Date().toISOString(),
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
        updateSchedule: {
            timezone: 'Asia/Seoul',
            times: UPDATE_SCHEDULE_KST,
            source: 'GitHub Actions',
            note: 'GitHub Actions schedules use UTC and may start a few minutes late depending on platform load.'
        },
        serviceStats,
        categoryStats,
        errors: errors.slice(0, 50),
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
