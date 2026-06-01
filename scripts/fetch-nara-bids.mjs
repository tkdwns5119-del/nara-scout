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

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'llama-3.1-8b-instant').trim();
const AI_ANALYSIS_LIMIT = Number(process.env.AI_ANALYSIS_LIMIT || 20);
const GROQ_DELAY_MS = Number(process.env.GROQ_DELAY_MS || 1200);
const GROQ_REQUEST_TIMEOUT_MS = Number(process.env.GROQ_REQUEST_TIMEOUT_MS || 30000);
const GROQ_RETRY_COUNT = Number(process.env.GROQ_RETRY_COUNT || 2);

const BASE_KEYWORDS = ["전광판", "미디어", "파사드", "사이니지", "디스플레이", "LED", "ITS", "VMS"];
const SEARCH_TERMS = BASE_KEYWORDS.flatMap(k => [k, `디지털 ${k}`]);

const KEYWORD_CATEGORY = {
    "디스플레이/사이니지 계열": ["전광판", "LED", "디스플레이", "사이니지"],
    "미디어/파사드 계열": ["미디어", "파사드"],
    "ITS/VMS 계열": ["ITS", "VMS"]
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
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_COUNT = 3;
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

function buildPrespecUrl(i, id) {
    return pick(i, [
        'specDocFileUrl1',
        'specDocFileUrl2',
        'specDocFileUrl3',
        'specDocFileUrl4',
        'specDocFileUrl5'
    ], id ? `https://www.g2b.go.kr/link/PRCA001_04/single/?srch=${encodeURIComponent(id)}` : '');
}

function buildPlanUrl(i, id) {
    if (i.orderPlanDtlUrl) return i.orderPlanDtlUrl;
    if (i.detailUrl) return i.detailUrl;
    return id ? `https://www.g2b.go.kr/link/PRCA001_04/single/?orderPlanUntyNo=${encodeURIComponent(id)}` : '';
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
        businessType: source.businessType
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
        orderYear,
        orderMnth: pick(i, ['orderMnth'])
    };
}

function makeRecord(i, source, term) {
    if (source.mapType === 'prespec') return mapPrespecRecord(i, source, term);
    if (source.mapType === 'plan') return mapPlanRecord(i, source, term);
    return mapBidRecord(i, source, term);
}


async function loadExistingAiCache() {
    const cache = new Map();

    try {
        const raw = await fs.readFile(path.join('data', 'bids.json'), 'utf-8');
        const prev = JSON.parse(raw);

        for (const b of prev?.bids || []) {
            if (!b?.bidId) continue;
            if (!b.aiSummary && !b.aiPriority) continue;

            cache.set(b.bidId, {
                aiPriority: b.aiPriority || '',
                aiScore: b.aiScore ?? null,
                aiSummary: b.aiSummary || '',
                aiReason: b.aiReason || '',
                aiAction: b.aiAction || '',
                aiTags: Array.isArray(b.aiTags) ? b.aiTags : [],
                aiStatus: b.aiStatus || 'CACHED',
                aiProvider: b.aiProvider || 'groq',
                aiModel: b.aiModel || '',
                aiGeneratedAt: b.aiGeneratedAt || prev.generatedAt || ''
            });
        }
    } catch {
        // 최초 실행 또는 파일 없음. 정상 상황.
    }

    return cache;
}

function isDirectDiKeyword(text) {
    const s = String(text || '').toLowerCase();

    return [
        '전광판',
        'led',
        '미디어월',
        '미디어 아트',
        '미디어아트',
        '디스플레이',
        '사이니지',
        '파사드',
        'vms',
        'its',
        '스마트 교통',
        '지능형교통'
    ].some(k => s.includes(k));
}

function scoreAiCandidate(b) {
    const title = `${b.bidNtceNm || ''} ${b.searchKeyword || ''} ${b.serviceType || ''}`;
    let score = 0;

    if (isDirectDiKeyword(title)) score += 45;

    const budget = Number(b.assignBudgetAmt || 0);
    if (budget >= 500000000) score += 25;
    else if (budget >= 200000000) score += 18;
    else if (budget >= 50000000) score += 12;
    else if (budget > 0) score += 5;

    if (b.serviceType === '공고') score += 14;
    if (b.serviceType === '사전규격') score += 11;
    if (b.serviceType === '발주계획') score += 8;

    const clse = String(b.bidClseDt || '');
    if (clse) {
        const datePart = clse.slice(0, 10);
        const clseDate = new Date(datePart);
        if (!Number.isNaN(clseDate.getTime())) {
            const daysLeft = Math.ceil((clseDate.getTime() - Date.now()) / 86400000);
            if (daysLeft >= 0 && daysLeft <= 7) score += 15;
            else if (daysLeft > 7 && daysLeft <= 21) score += 8;
        }
    }

    return score;
}

function selectAiTargets(bids, limit) {
    return [...bids]
        .map(b => ({ b, score: scoreAiCandidate(b) }))
        .filter(x => x.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, limit))
        .map(x => x.b);
}

function stripJsonFence(text) {
    return String(text || '')
        .trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
}

function safeAiText(v, max = 180) {
    return String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildAiPrompt(bid) {
    const payload = {
        serviceType: bid.serviceType,
        businessType: bid.businessType,
        title: bid.bidNtceNm,
        contractMethod: bid.contractMethod,
        agency: bid.ntceInsttNm,
        demandAgency: bid.dminsttNm,
        budgetWon: bid.assignBudgetAmt,
        registerDate: bid.bidNtceRegistDt,
        closeDate: bid.bidClseDt,
        keyword: bid.searchKeyword,
        region: bid.region
    };

    return `아래 조달 정보를 보고 LED 전광판, 미디어월, 디지털 사이니지, 미디어파사드, ITS/VMS 사업 관점에서 영업 검토 우선순위를 판단하라.

반드시 JSON만 반환하라. 설명 문장이나 마크다운 금지.

반환 형식:
{
  "aiPriority": "HIGH | MEDIUM | LOW | EXCLUDE",
  "aiScore": 0,
  "aiSummary": "한 줄 요약",
  "aiReason": "우선순위 판단 근거",
  "aiAction": "다음 실행 조치",
  "aiTags": ["태그1", "태그2"]
}

판단 기준:
- HIGH: 전광판/LED/미디어월/사이니지/ITS/VMS 직접 관련 + 예산 또는 실행 가능성 높음
- MEDIUM: 관련성은 있으나 범위 확인 필요
- LOW: 간접 관련 또는 소액/불명확
- EXCLUDE: DI사업부와 관련 낮음

조달 정보:
${JSON.stringify(payload, null, 2)}`;
}

async function fetchGroqJson(prompt) {
    const endpoint = 'https://api.groq.com/openai/v1/chat/completions';

    for (let attempt = 1; attempt <= GROQ_RETRY_COUNT; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: GROQ_MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: '너는 싸인텔레콤 DI영업지원팀의 조달 공고 검토 비서다. 반드시 유효한 JSON만 반환한다.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.2,
                    response_format: { type: 'json_object' }
                })
            });

            const text = await res.text();

            if (!res.ok) {
                throw new Error(`Groq HTTP ${res.status}: ${bodyPreview(text, 500)}`);
            }

            let raw = '';
            try {
                const json = JSON.parse(text);
                raw = json?.choices?.[0]?.message?.content || '';
            } catch {
                raw = text;
            }

            const parsed = JSON.parse(stripJsonFence(raw));

            return {
                aiPriority: safeAiText(parsed.aiPriority, 20) || 'LOW',
                aiScore: Number(parsed.aiScore || 0),
                aiSummary: safeAiText(parsed.aiSummary, 180),
                aiReason: safeAiText(parsed.aiReason, 240),
                aiAction: safeAiText(parsed.aiAction, 240),
                aiTags: Array.isArray(parsed.aiTags)
                    ? parsed.aiTags.map(x => safeAiText(x, 30)).filter(Boolean).slice(0, 6)
                    : [],
                aiStatus: 'OK',
                aiProvider: 'groq',
                aiModel: GROQ_MODEL,
                aiGeneratedAt: new Date().toISOString()
            };
        } catch (e) {
            const isLast = attempt === GROQ_RETRY_COUNT;
            const msg = e.name === 'AbortError' ? 'Groq 타임아웃' : e.message;

            if (isLast) throw new Error(msg);

            const waitMs = attempt * 2000;
            console.log(`    Groq retry ${attempt}/${GROQ_RETRY_COUNT - 1} — ${msg}, ${waitMs}ms 대기`);
            await sleep(waitMs);
        } finally {
            clearTimeout(timer);
        }
    }

    throw new Error('Groq 분석 실패');
}

async function enrichWithGroq(bids, errors) {
    if (!GROQ_API_KEY) {
        console.log('[INFO] GROQ_API_KEY 없음: AI 요약/우선순위 분석은 건너뜁니다.');
        return {
            provider: 'groq',
            analyzed: 0,
            cached: 0,
            skipped: bids.length,
            model: null
        };
    }

    const cache = await loadExistingAiCache();
    const targets = selectAiTargets(bids, AI_ANALYSIS_LIMIT);
    let analyzed = 0;
    let cached = 0;

    console.log(`[INFO] Groq 분석 대상: ${targets.length}건 / limit ${AI_ANALYSIS_LIMIT} / model ${GROQ_MODEL}`);

    for (const b of targets) {
        const cachedAi = cache.get(b.bidId);
        if (cachedAi) {
            Object.assign(b, cachedAi, {
                aiStatus: 'CACHED'
            });
            cached++;
            continue;
        }

        try {
            const ai = await fetchGroqJson(buildAiPrompt(b));
            Object.assign(b, ai);
            analyzed++;
            console.log(`  - AI ${b.aiPriority} / ${b.bidNtceNm?.slice(0, 40)}`);
        } catch (e) {
            const msg = `[Groq/${b.bidId}] ${e.message}`;
            errors.push(msg);
            b.aiStatus = 'ERROR';
            b.aiError = safeAiText(e.message, 200);
            console.log(`  - AI FAIL ${b.bidNtceNm?.slice(0, 40)} — ${e.message}`);
        }

        await sleep(GROQ_DELAY_MS);
    }

    return {
        provider: 'groq',
        analyzed,
        cached,
        skipped: Math.max(0, bids.length - targets.length),
        model: GROQ_MODEL
    };
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
    past.setDate(now.getDate() - DAYS_TO_FETCH);

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
        uniqueMap.set(`${b.serviceType}:${b.bidId || b.bidNtceNo}`, b);
    }

    const unique = Array.from(uniqueMap.values());

    unique.sort((a, b) =>
        String(b.bidNtceRegistDt || '').localeCompare(String(a.bidNtceRegistDt || ''))
    );

    const aiStats = await enrichWithGroq(unique, errors);

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
        aiStats,
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
    console.log(`[DONE] AI 분석: ${JSON.stringify(aiStats)}`);
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
