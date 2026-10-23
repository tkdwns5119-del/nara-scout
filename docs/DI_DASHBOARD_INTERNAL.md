# DI영업지원 나라장터 통합 조달 대시보드 내부 운영 문서

> 적용 대상: GitHub Pages 정적 UI + GitHub Actions 기반 나라장터 데이터 수집 구조  
> 문서 목적: DI UI 수정사항, 데이터 구조, 운영 절차, 장애 대응 기준을 GitHub 저장소 내부 문서로 정리한다.

---

## 1. 시스템 개요

DI영업지원 대시보드는 조달청 나라장터 데이터를 수집하여 `data/bids.json`으로 저장하고, 정적 HTML UI에서 해당 JSON을 로드해 입찰 정보를 시각화하는 내부 영업지원용 화면이다.

현재 운영 기준은 다음 구조를 따른다.

```txt
GitHub Actions
    ↓
scripts/fetch-nara-bids.mjs
    ↓
data/bids.json
    ↓
GitHub Pages / di.html
    ↓
DI영업지원 대시보드 UI
```

자동 수집기는 `입찰공고 · 사전규격 · 발주계획` 3대 조달 서비스를 각각 `물품/용역`으로 나눠 수집한다(데이터소스 6개).

---

## 2. GitHub 저장소 권장 구조

```txt
/
├─ index.html, di-actionboard.html   (di.html로 이동하는 안내 페이지)
├─ di.html
├─ data/
│  ├─ bids.json
│  ├─ workflow-config.json
│  └─ archive/  (YYYY-MM.json, index.json)
├─ scripts/
│  └─ fetch-nara-bids.mjs
├─ .github/
│  └─ workflows/
│     ├─ fetch-bids.yml
│     └─ validate-dashboard.yml
├─ database.rules.json, firebase.json
└─ docs/
   └─ DI_DASHBOARD_INTERNAL.md
```

| 경로 | 역할 |
|---|---|
| `di.html` | DI영업지원 대시보드 단일 HTML UI |
| `index.html`, `di-actionboard.html` | 기존 주소 호환용. 접속하면 `di.html`로 이동 |
| `data/bids.json` | GitHub Actions가 생성하는 정적 조달 데이터 (최근 30일 + 발주월이 남은 발주계획) |
| `data/archive/` | 등록월별 누적 데이터 (최근 12개월 목록을 `index.json`에 기록) |
| `data/workflow-config.json` | 검토 기록 공유용 Firebase 설정 |
| `scripts/fetch-nara-bids.mjs` | 나라장터 API 수집 스크립트 |
| `.github/workflows/fetch-bids.yml` | 자동 수집 워크플로 |
| `.github/workflows/validate-dashboard.yml` | `di.html` 스크립트 문법 검사 |
| `database.rules.json`, `firebase.json` | Firebase Realtime Database 보안 규칙 |
| `docs/DI_DASHBOARD_INTERNAL.md` | 본 내부 운영 문서 |

---

## 3. DI UI 주요 수정사항

### 3.1 브랜드 및 헤더

상단 헤더는 `싸인텔레콤 DI영업지원` 브랜딩을 기준으로 구성한다.

주요 요소:

- 좌측: DI영업지원 로고/타이틀
- 상태 표시: `실시간 조달 분석 가동`
- 우측: `🔒 관리자 설정` 버튼
- 관리자 설정은 일반 사용자 탭과 분리된 내부 접근 영역으로 운용

---

### 3.2 일반 사용자 탭 구조

일반 사용자는 아래 3개 핵심 화면만 사용한다.

| 탭 | 용도 |
|---|---|
| `통합 대시보드` | 전체 건수, 예산, 마감임박, 주요 사업, 추세 차트 확인 |
| `통합 사업 목록` | 필터/검색/CSV 다운로드 중심의 상세 목록 |
| `점유 및 트렌드 분석` | 서비스·지역·키워드 기준 분석 화면 |

관리자 설정 화면은 상단 `🔒 관리자 설정` 버튼으로만 접근한다.

---

### 3.3 통합 대시보드 구성

대시보드는 다음 카드 및 분석 블록으로 구성한다.

| 영역 | 설명 |
|---|---|
| 실시간 입찰공고 | 현재 수집된 입찰공고 건수 및 예산 |
| 사전규격 공개 | 사전규격 공개 건수 |
| 발주계획 현황 | 발주계획 건수 (발주월이 지나지 않은 계획 포함) |
| 3대 정보망 누적 집계 | 전체 데이터 합산 지표 |
| 마감 임박 TOP 3 | 각 서비스 유형별 우선 검토 항목 |
| 3대 통합 조달 트렌드 | 등록 추세 차트 |
| 최고가 주요 전략 사업 | 예산 규모가 큰 사업 TOP 4 |

현재 `data/bids.json`에 `serviceType`이 없는 경우 UI는 아래 기준으로 자동 보정한다.

```txt
bidNtceNo가 BF로 시작 → 사전규격
bidNtceNo가 PL로 시작 → 발주계획
그 외 → 공고
```

현재 수집 데이터는 대부분 일반 입찰공고이므로 기본값은 `공고`로 표시된다.

---

### 3.4 통합 사업 목록 화면

목록 화면은 영업 검토 실무에 맞춰 검색과 필터를 우선한다.

지원 기능:

- 사업명, 공고명, 수요기관, 번호 검색
- 서비스 필터: 전체 / 입찰공고 / 사전규격 / 발주계획
- 키워드 필터: 전광판, LED, 디스플레이, 사이니지, 미디어, 파사드, ITS, VMS
- 지역 필터: 서울, 경기, 인천, 부산, 강원, 충청, 전라, 경상, 제주
- 예산 필터:
  - 5천만 원 미만
  - 5천만 ~ 2억 원
  - 2억 ~ 5억 원
  - 5억 원 이상
- Excel CSV 다운로드

CSV는 한글 깨짐 방지를 위해 UTF-8 BOM을 포함한다.

---

### 3.5 점유 및 트렌드 분석 화면

분석 화면은 다음 목적에 사용한다.

- 키워드 계열별 시장 분포 파악
- 지역별 사업 분포 확인
- 예산 규모 기준 우선순위 도출
- DI영업지원 관점의 유망 공고 선별

키워드 카테고리는 아래 기준을 따른다.

| 카테고리 | 포함 키워드 |
|---|---|
| 디스플레이/사이니지 계열 | 전광판, LED, 디스플레이, 사이니지 |
| 미디어/파사드 계열 | 미디어, 파사드 |
| ITS/VMS 계열 | ITS, VMS |

---

## 4. 데이터 로드 방식

### 4.1 기본 모드

UI 기본 데이터 로드 방식은 **GitHub Static JSON**이다.

```js
fetch('./data/bids.json?t=' + Date.now(), { cache: 'no-store' })
```

이 구조를 기본으로 유지한다.  
브라우저에서 나라장터 API를 직접 호출하면 CORS, 인증키 노출, 호출 제한 문제가 발생할 수 있으므로 운영 환경에서는 정적 JSON 로드 방식을 우선한다.

---

### 4.2 `data/bids.json` 메타데이터

현재 `bids.json`은 다음 메타 필드를 가진다.

| 필드 | 설명 |
|---|---|
| `generatedAt` | 데이터 생성 시각 |
| `timezone` | 기준 시간대 |
| `fetchMode` | 이번 실행 방식. `full`(30일 전체) 또는 `incremental`(최근 3일) |
| `fetchDays` | 이번 실행에서 API로 받은 기간(일) |
| `lastFullRefreshAt` | 마지막 전체 재수집 시각 |
| `planLookaheadEndYm` | 발주계획 선행 조회 끝 월. 빈 값이면 이번 실행에서 선행 조회가 거부되어 기존 범위로 수집 |
| `rangeDays` | 데이터셋 유지 기간 |
| `chunkDays` | 날짜 분할 단위 |
| `rangeBegin` | 데이터셋 시작 일시 |
| `rangeEnd` | 데이터셋 종료 일시 |
| `totalCount` | 중복 제거 후 최종 건수 |
| `rawCount` | 이번 실행에서 받은 원본 건수 |
| `successCalls` | 성공 호출 수 |
| `failedCalls` | 실패 호출 수 |
| `requestDelayMs` | 요청 간격 |
| `maxPagesPerQuery` | 검색어별 최대 페이지 |
| `serviceStats` | 서비스(공고·사전규격·발주계획)별 건수 |
| `categoryStats` | 키워드 계열별 건수 (대표 검색어 기준) |
| `errors` | 오류 목록 |
| `warnings` | 경고 목록. 페이지 상한(500건) 잘림, 발주계획 선행 조회 전환 등 |
| `bids` | 실제 공고 배열 |

---

### 4.3 `bids` 항목 스키마

각 공고 데이터는 다음 필드를 기준으로 사용한다.

| 필드 | 설명 |
|---|---|
| `bidId` | 내부 고유 ID |
| `bidNtceNo` | 나라장터 공고번호 |
| `bidNtceOrd` | 공고 차수 |
| `bidNtceNm` | 공고명 |
| `ntceInsttNm` | 공고기관 |
| `dminsttNm` | 수요기관 |
| `assignBudgetAmt` | 배정예산액 |
| `bidNtceRegistDt` | 공고 등록일 |
| `bidClseDt` | 입찰 마감일. 사전규격은 의견등록 마감일, 발주계획은 발주 예정월 |
| `deadlineBasis` | `개찰`이면 입찰마감일이 없어 개찰일을 마감으로 사용한 공고 |
| `searchKeyword` | 대표 검색어 (직접 키워드 우선) |
| `matchedKeywords` | 이 공고에 걸린 검색어 전체 |
| `region` | 분류 지역. 수요기관 → 공고명 → 공고기관 순으로 판단, 조달청 기관명은 제외 |
| `g2bUrl` | 나라장터 상세 URL |
| `serviceType` | 서비스 구분. 없으면 UI에서 자동 보정 |

---

## 5. 자동 수집 스크립트 운영 기준

### 5.1 수집 범위

현재 운영 기준:

```txt
데이터셋: 최근 30일 등록분 + 발주월이 지나지 않은 발주계획
수집 방식: 하루 첫 실행(직전 전체 수집 후 20시간 경과)은 30일 전체, 나머지는 최근 3일 증분
           수동 실행에서 force 체크 시 항상 30일 전체
발주계획: 발주 예정월을 6개월 앞까지 조회 (API가 거부하면 그 실행만 기존 범위로 자동 전환, warnings에 기록)
데이터 보관: 최근 12개월 월별 파일로 누적
날짜 분할: 15일 단위
검색어: 26개
데이터소스: 입찰공고 / 사전규격 / 발주계획 × 물품 / 용역
호출 수: 전체 312회, 증분 156회
요청 간격: 1000ms
재시도: 3회
최대 페이지: 검색어/데이터소스/날짜구간당 5페이지(500건). 넘으면 warnings에 기록
```

정정공고(같은 공고번호의 차수 000 → 001 …)는 최신 차수 1건만 남긴다.

검색어 기준:

`디지털 전광판` 같은 변형 검색어는 결과가 `전광판` 검색 결과에 모두 포함되므로 쓰지 않는다.

```txt
전광판, 미디어, 파사드, 사이니지, 디스플레이, LED, ITS, VMS

버스정보(BIT/BIS):
BIT, BIS, 버스정보, 정류장

전광판 외 간접 사업/문화시설:
문화센터, 체육센터, 복합센터, 커뮤니티센터

전광판 외 간접 사업/건립:
건립, 신축

전광판 외 간접 사업/체육시설:
체육관, 운동장, 경기장, 수영장, 축구, 야구, 스포츠파크, 스포츠타운
```

간접 사업 중 감리·폐기물·조경·소방·자재 구매처럼 전광판 영업과 무관한 공고는 대시보드에서 `연관성 낮음`으로 내려 기본 검토 목록에서 뺀다(전체 보기에는 남는다). 제외어 목록은 `di.html`의 `INDIRECT_NOISE_PATTERN` 한 곳에서 관리한다.

---

### 5.2 사용 API

차세대 나라장터 신규 API 경로를 사용한다. 공공데이터포털에서 아래 3개 서비스 활용신청이 되어 있어야 한다.

| 서비스 | Base URL | 물품 / 용역 오퍼레이션 | 검색 파라미터 |
|---|---|---|---|
| 입찰공고정보서비스 | `https://apis.data.go.kr/1230000/ad/BidPublicInfoService` | `getBidPblancListInfoThngPPSSrch` / `getBidPblancListInfoServcPPSSrch` | `bidNtceNm` |
| 사전규격정보서비스 | `https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService` | `getPublicPrcureThngInfoThngPPSSrch` / `getPublicPrcureThngInfoServcPPSSrch` | `prdctClsfcNoNm` |
| 발주계획현황서비스 | `https://apis.data.go.kr/1230000/ao/OrderPlanSttusService` | `getOrderPlanSttusListThngPPSSrch` / `getOrderPlanSttusListServcPPSSrch` | `bizNm` (기간: `orderBgnYm`, `orderEndYm`, `inqryBgnDt`, `inqryEndDt`) |

인증키 Secret: `NARA_API_KEY`(필수). 서비스별로 키를 따로 쓰려면 `NARA_PRESPEC_API_KEY`, `NARA_PLAN_API_KEY`를 등록한다. 없으면 `NARA_API_KEY`를 재사용한다.

기존 `BidPublicInfoService04/...01` 경로는 HTTP 500이 반복될 수 있으므로 운영 코드에서 사용하지 않는다.

---

### 5.3 실패 보호 로직

API 호출 성공률이 80% 미만이면 기존 `data/bids.json`을 덮어쓰지 않는다.

운영 원칙:

```txt
성공률 80% 이상 → data/bids.json 갱신 (실패 내역은 errors에 기록)
성공률 80% 미만 → 프로세스 실패 처리, 기존 JSON 유지
연결 오류 3회 연속 → 즉시 중단, 워크플로가 대기 후 최대 3회 재시도
```

이 원칙은 빈 데이터가 운영 화면에 배포되는 사고를 막기 위한 필수 방어 로직이다.

---

## 6. GitHub Actions 운영 기준

워크플로 파일:

```txt
.github/workflows/fetch-bids.yml
```

### 6.1 수집 시각

목표 수집 시각은 **KST 07:00 / 09:00 / 11:00 / 13:00 / 15:00 / 17:00** 하루 6회다(업무 시간 2시간 간격). 17시 이후 등록 공고는 다음 날 07시 실행에서 반영된다.

호출 한도: 하루 첫 실행만 30일 전체(서비스당 약 104회), 나머지는 3일 증분(서비스당 약 52회)이라 하루 서비스당 약 365회에 페이지 추가분을 더해도 개발계정 한도(보통 서비스당 1,000회/일) 안에 든다. 공공데이터포털 마이페이지에서 서비스별 일일 트래픽을 확인한다.

GitHub Actions의 `schedule`은 이 저장소에서 2~5시간 늦거나 아예 실행되지 않았다(2026년 10월 실측, 15분 간격 예약도 2시간 넘게 한 번도 실행 안 됨). 그래서 **외부 스케줄러(cron-job.org)가 정시에 `workflow_dispatch`로 수집을 시작한다**(설정은 6.2).

| 구성 | 하는 일 |
|---|---|
| cron-job.org | 07·09·11·13·15·17시 정각에 `Sync Nara Bids`를 `slot=true`로 시작 |
| `Sync Nara Bids` (`fetch-bids.yml`) | `gate`(ubuntu, 수 초)가 수집 여부를 판정하고 `fetch`(macOS)가 API 수집과 데이터 커밋을 한다. 판정은 `.github/scripts/should-fetch.mjs` |
| GitHub 15분 예약 | **예비.** 외부 스케줄러가 멈췄을 때, GitHub이 예약을 실행해 주면 같은 기준으로 수집 |

판정 기준:

- 외부 스케줄러(`slot=true`)·예약 실행: "오늘 지난 수집 시각 중 가장 최근 시각 이후로 아직 수집하지 않았을 때"만 수집한다. 둘이 겹쳐도 중복 수집은 없다.
- 수동 실행: 마지막 수집 후 90분이 지났을 때, 또는 `force`를 체크했을 때 수집한다.
- `fetch`는 시작할 때 최신 데이터로 같은 판정을 다시 해서, 줄을 서 있던 두 번째 수집은 API를 호출하지 않는다.

수동으로 즉시 다시 수집하려면 **Actions → Sync Nara Bids → Run workflow**에서 `force`를 체크한다.

대시보드 상단 상태 표시는 마지막 수집 후 18시간이 지나면 주황색 `갱신 지연`으로 바뀐다.

### 6.2 외부 스케줄러 설정 (cron-job.org)

1. GitHub → Settings → Developer settings → **Fine-grained personal access token** 생성 (https://github.com/settings/personal-access-tokens/new)
   - Repository access: `nara-scout`만 선택
   - Permissions: **Actions: Read and write** (그 외 권한 없음)
   - 만료일을 정하고, **만료 전에 재발급해 cron-job.org의 헤더 값을 바꾼다.** 만료되면 정시 수집이 멈추고 GitHub 15분 예약만 남는다.
2. cron-job.org에서 작업 1개를 만들고 실행 시각을 07·09·11·13·15·17시 정각(시간대 `Asia/Seoul`)으로 지정한다.
   - URL: `https://api.github.com/repos/tkdwns5119-del/nara-scout/actions/workflows/fetch-bids.yml/dispatches`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer <토큰>`
     - `Accept: application/vnd.github+json`
     - `X-GitHub-Api-Version: 2022-11-28`
   - Body: `{"ref":"main","inputs":{"slot":"true"}}`
3. 성공 응답은 `204 No Content`다(TEST RUN으로 확인). `401`은 토큰 오류, `403`/`404`는 저장소 선택이나 Actions 권한 문제다. Actions 탭에서 `workflow_dispatch` 실행이 정시에 시작되는지 확인한다.

토큰은 저장소 Secret이 아니라 외부 스케줄러에만 저장된다. 노출되면 즉시 폐기하고 재발급한다.

필수 Secret:

```txt
NARA_API_KEY
```

GitHub 설정 위치:

```txt
Settings
→ Secrets and variables
→ Actions
→ Repository secrets
→ NARA_API_KEY
```

인증키는 가능하면 공공데이터포털의 **Decoding 인증키**를 사용한다.

---

## 7. 배포 및 반영 절차

### 7.1 UI 수정 반영

```txt
1. di.html 수정
2. 로컬 브라우저에서 화면 확인
3. GitHub 저장소에 커밋
4. GitHub Pages 배포 확인
5. 관리자 설정 → GitHub Static JSON 모드 확인
6. data/bids.json 로드 여부 확인
```

### 7.2 수집 스크립트 수정 반영

```txt
1. scripts/fetch-nara-bids.mjs 수정
2. GitHub 저장소에 커밋
3. Actions → Sync Nara Bids → Run workflow 실행
4. 로그에서 성공 호출/실패 호출 확인
5. data/bids.json 갱신 여부 확인
6. 대시보드 새로고침 후 통계 반영 확인
```

### 7.3 데이터 검증 기준

정상 기준:

```txt
successCalls > 0
failedCalls = 0 또는 일부 실패
totalCount > 0
errors = []
data/bids.json 접근 가능
대시보드 카드/목록/차트 정상 표시
```

비정상 기준:

```txt
successCalls = 0
failedCalls만 존재
data/bids.json 404
브라우저 콘솔 CORS 오류
대시보드 건수 0건
공고 상세 URL 미작동
```

---

## 8. 보안 및 운영 주의사항

### 8.1 API Key 관리

API Key는 절대 `di.html`에 직접 하드코딩하지 않는다.  
운영 기준은 GitHub Secret `NARA_API_KEY`에 저장하고, GitHub Actions에서만 사용한다.

금지:

```txt
HTML 내부에 실제 API Key 작성
README에 실제 API Key 작성
Issues/PR/커밋 메시지에 API Key 작성
브라우저 콘솔에 API Key 출력
```

이미 노출된 키는 즉시 재발급 후 교체한다.

---

### 8.2 관리자 설정

현재 관리자 설정은 프론트엔드 보호 구조이므로 강한 보안 기능으로 보면 안 된다.  
내부 편의용 잠금 장치로만 취급한다.

운영 환경에서는 다음 기준을 따른다.

```txt
일반 사용자: 대시보드/목록/분석 탭만 사용
관리자: API 설정, 진단, 수동 동기화 기능 확인
API Key: GitHub Secret에서만 관리
```

---

### 8.3 GitHub Pages 캐시

UI는 `data/bids.json?t=Date.now()` 형태로 캐시 우회를 수행한다.  
그래도 갱신이 늦게 보이면 다음 순서로 확인한다.

```txt
1. 브라우저 강력 새로고침 Ctrl + F5
2. data/bids.json 직접 열기
3. Actions 마지막 실행 시간 확인
4. GitHub Pages 배포 상태 확인
```

---

### 8.4 검토 기록 공유 (Firebase) 권한

검토 상태·메모는 Firebase Realtime Database `importantIssues/{공고번호}`에 항목 단위로 저장된다.

| 대상 | 읽기 | 쓰기 |
|---|---|---|
| 로그인하지 않은 방문자 | 가능 | 불가 (이 브라우저에만 저장) |
| Google 로그인 + `members` 미등록 | 가능 | 불가 (상단에 `공유 권한 없음 · UID 복사` 표시) |
| Google 로그인 + `members/{uid} = true` | 가능 | 가능 |

규칙 파일은 저장소의 `database.rules.json`이다. `firebase.json`이 이 파일을 가리킨다.

**최초 적용 절차 (Firebase 콘솔, 관리자가 1회 수행):**

1. **Authentication → Sign-in method → Google** 사용 설정
2. **Authentication → Settings → 승인된 도메인**에 `tkdwns5119-del.github.io` 추가
3. 팀원 등록: 팀원이 대시보드에서 Google 로그인 → `UID 복사` 버튼으로 UID 전달
   → 관리자가 **Realtime Database → 데이터**에서 `members/<UID>` 값을 `true`로 추가
4. **Realtime Database → 규칙**에 `database.rules.json` 내용을 붙여넣고 게시
   - CLI를 쓴다면 `firebase deploy --only database`

> 대시보드는 `members`에 등록된 사용자만 공유 저장을 시도한다. 그래서 코드 배포 후 3번이 끝날 때까지는 검토 기록이 각자 브라우저에만 저장된다. 등록 후 대시보드를 다시 열면 그동안의 기록 중 더 최신인 항목이 자동으로 공유 저장된다.
>
> 4번(규칙 게시) 전에는 DB가 여전히 누구나 쓸 수 있는 상태다. 3번이 끝나면 바로 게시한다.

`members` 노드는 콘솔(관리자 권한)에서만 수정할 수 있다. 클라이언트에서는 본인 항목 읽기만 허용된다.

---

## 9. 장애 대응표

| 증상 | 가능 원인 | 조치 |
|---|---|---|
| 대시보드 0건 표시 | `data/bids.json` 미로드 | GitHub Pages 경로와 JSON 위치 확인 |
| Actions HTTP 500 반복 | 구형 API 경로 사용 또는 API 승인 문제 | 신규 `/ad/BidPublicInfoService` 경로 확인 |
| `NARA_API_KEY is empty` | GitHub Secret 누락 | Repository secrets에 `NARA_API_KEY` 등록 |
| 일부 검색어만 실패 | 나라장터 일시 장애 또는 검색어별 응답 문제 | 재실행 후 `errors` 확인 |
| 전체 실패 | 인증키/활용신청/API 경로 문제 | 키 재발급, 활용신청 상태, API URL 확인 |
| CSV 한글 깨짐 | BOM 누락 | UTF-8 BOM 포함 로직 유지 |
| UI는 열리는데 아이콘이 안 보임 | unpkg CDN(lucide) 차단 | 네트워크/방화벽/CDN 접근 확인 |
| 상단 상태가 주황색 `갱신 지연` | 18시간 넘게 수집 성공 없음 | Actions 실행 기록, 외부 스케줄러 토큰 만료 여부 확인 |
| 발주계획에 다음 달 이후 계획이 없음 | API가 발주월 선행 조회를 거부 | `bids.json`의 `warnings`, `planLookaheadEndYm` 확인 (10.1 참고) |

---

## 10. 향후 개선 과제

### 10.1 3대 서비스 수집 (적용 완료)

입찰공고·사전규격·발주계획 모두 수집 중이다. ID 규칙:

```txt
입찰공고: 기존 bidNtceNo 사용
사전규격: BF-{원본번호}
발주계획: PL-{원본번호}
```

남은 확인 사항: 발주계획 API가 발주월 6개월 선행 조회를 받아들이는지 실제 실행 로그로 확인한다. `planLookaheadEndYm`이 비어 있고 warnings에 `선행 조회 실패`가 있으면 API가 거부한 것이므로, 참고문서(`조달청_OpenAPI참고자료_나라장터_발주계획현황서비스_1.1.docx`)의 기간 파라미터 제약을 확인해 범위를 조정한다.

---

### 10.2 데이터 품질 개선

추가 검토 항목:

```txt
간접 사업 제외어(INDIRECT_NOISE_PATTERN) 운영하며 보정
예산 0원 데이터 별도 표시
마감일 없는 공고 상태값 분리
관심 지역 우선 정렬
공고기관/수요기관 기준 즐겨찾기
```

---

### 10.3 영업 활용 기능 개선

DI영업지원 목적에 맞춰 다음 기능을 추가할 수 있다.

```txt
관심 공고 북마크
검토 상태값: 미검토 / 검토중 / 제안가능 / 제외
담당자 지정
견적 검토 메모
카카오톡/메일 공유용 요약 생성
전광판·미디어월·ITS 관련도 점수화
```

---

## 11. 커밋 메시지 예시

UI 수정:

```txt
feat(ui): update DI procurement dashboard layout
```

수집 스크립트 수정:

```txt
fix(data): update Nara bid API endpoint and retry logic
```

문서 수정:

```txt
docs: update DI dashboard internal operation guide
```

데이터 갱신:

```txt
chore(data): sync bids 2026-05-28T08:14Z
```

---

## 12. 최종 운영 기준

현재 DI 대시보드는 다음 기준으로 관리한다.

```txt
UI: di.html 단일 페이지
데이터: data/bids.json 정적 로드
수집: GitHub Actions + Node.js
인증키: GitHub Secret 관리
기본 운영 모드: GitHub Static JSON
수집 대상: 입찰공고 / 사전규격 / 발주계획 × 물품 / 용역
수집 범위: 최근 30일 (하루 1회 전체, 나머지 3일 증분) + 발주월이 남은 발주계획
장애 보호: 호출 성공률 80% 미만이면 기존 JSON 유지
검토 기록: Firebase, Google 로그인 + members 허용 목록만 쓰기
```

이 구조가 현재 DI UI 수정안에 맞는 GitHub 내부 운영 기준이다.
