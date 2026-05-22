# 나라장터 실시간 입찰 정보망 (Nara Scout Neo)

GitHub Actions 가 매일 정해진 시간에 data.go.kr OpenAPI 를 호출하여 입찰 데이터를 수집하고,
HTML 대시보드는 자동 커밋된 정적 JSON 파일을 직접 로드합니다 (CORS / 프록시 의존 없음).

## 셋업 단계

### 1) 레포 생성 및 푸시

```bash
git init
git add .
git commit -m "init: nara scout neo with github actions"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/<REPO_NAME>.git
git push -u origin main
```

### 2) API 키 Secret 등록 (필수)

GitHub 레포 페이지 → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `NARA_API_KEY` | data.go.kr 발급 인증키 (Decoding 버전 사용 권장) |

> ⚠️ Secret 으로 등록하면 워크플로 로그에 노출되지 않습니다. 절대 코드에 직접 박지 마세요.

### 3) Actions 권한 활성화

**Settings → Actions → General → Workflow permissions** 에서:
- ✅ **Read and write permissions** 선택 (자동 커밋용)
- ✅ Allow GitHub Actions to create and approve pull requests (선택)

### 4) 첫 수집 트리거

레포 → **Actions** 탭 → **Sync Nara Bids** 워크플로 선택 → **Run workflow** 클릭
- 보통 1~2분 안에 완료
- 성공하면 `data/bids.json` 이 자동 커밋됨

### 5) GitHub Pages 배포

**Settings → Pages**
- Source: **Deploy from a branch**
- Branch: **main** / **/ (root)**
- Save

배포 URL: `https://<YOUR_USER>.github.io/<REPO_NAME>/nara_scout_neo_dashboard.html`

대시보드 접속 후 **CORS & API 자가진단** 탭에서 모드가 **★ GitHub Actions Static JSON** 으로 선택되어 있는지 확인.

## 자동 수집 스케줄

`.github/workflows/fetch-bids.yml` 에 정의:

| 시간 (KST) | UTC | cron |
|---|---|---|
| 09:00 | 00:00 | `0 0 * * *` |
| 13:00 | 04:00 | `0 4 * * *` |
| 17:00 | 08:00 | `0 8 * * *` |

스케줄 변경하려면 cron 문자열 수정:
```yaml
- cron: '0 0,4,8 * * *'   # KST 09/13/17시
```

수동 실행은 **Actions → Sync Nara Bids → Run workflow** 로 언제든 가능.

## 파일 구조

```
.
├── .github/
│   └── workflows/
│       └── fetch-bids.yml          # 크론 워크플로
├── scripts/
│   └── fetch-nara-bids.mjs         # Node.js 수집 스크립트
├── data/
│   └── bids.json                   # 자동 수집 결과 (Actions가 덮어씀)
├── nara_scout_neo_dashboard.html   # 대시보드 본체
└── README.md                       # 본 문서
```

## 데이터 스키마 (`data/bids.json`)

```jsonc
{
  "generatedAt": "2026-05-22T08:00:00.000Z",   // 수집 시각 (UTC)
  "rangeBegin": "202602220000",                // 조회 시작
  "rangeEnd": "202605222359",                  // 조회 끝
  "totalCount": 234,                           // 중복 제거 후 총 건수
  "successCalls": 30,                          // 성공한 API 호출 수
  "failedCalls": 2,                            // 실패한 호출 수
  "categoryStats": {
    "디스플레이/사이니지 계열": 142,
    "미디어/파사드 계열": 56,
    "ITS/VMS 계열": 36
  },
  "errors": ["...최대 20개 오류 메시지"],
  "bids": [
    {
      "bidNtceNo": "2026...-00",
      "bidNtceNm": "[서울] 한국전력공사 - 옥외 LED 전광판 설치 공사",
      "ntceInsttNm": "...",
      "dminsttNm": "...",
      "assignBudgetAmt": 230000000,
      "bidNtceRegistDt": "2026-04-12 10:30",
      "bidClseDt": "2026-04-25 18:00",
      "searchKeyword": "전광판",
      "region": "서울",
      "g2bUrl": "https://www.g2b.go.kr:8401/..."
    }
  ]
}
```

## 검색 키워드

`scripts/fetch-nara-bids.mjs` 의 `BASE_KEYWORDS` 배열:

- **디스플레이/사이니지**: 전광판 · LED · 디스플레이 · 사이니지
- **미디어/파사드**: 미디어 · 파사드
- **교통/ITS**: ITS · VMS

각 키워드는 `디지털 ${키워드}` 변형도 함께 검색되어 총 **16개 검색어 × 2 엔드포인트(물품/용역) = 매 실행 32회 API 호출** 입니다.

## 로컬 테스트

`file://` 로 직접 열면 브라우저가 보안 정책상 `./data/bids.json` 을 차단합니다. 로컬 정적 서버 사용:

```bash
# Node 환경
npx http-server -p 8080

# Python 환경
python -m http.server 8080
```

→ `http://localhost:8080/nara_scout_neo_dashboard.html` 접속

## 트러블슈팅

| 증상 | 원인 / 해결 |
|---|---|
| Actions 실행 시 `NARA_API_KEY 환경변수가 설정되어 있지 않습니다` | Step 2의 Secret 등록 누락. 이름 정확히 `NARA_API_KEY` |
| Actions 가 커밋을 못 함 (`Permission denied`) | Step 3의 Workflow permissions 미설정 |
| 대시보드에서 "GitHub Static 모드 실패" | `file://` 로 열었거나 GitHub Pages 미배포. Step 5 확인 |
| `XML 응답: SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | data.go.kr 인증키 활성화 대기 중 (최대 1~2시간) |
| 0건 수집됨 | 키워드가 너무 좁거나 해당 기간 공고 부재. `BASE_KEYWORDS` 조정 |

## 정책

- API 키는 절대 코드/커밋에 노출 금지. 반드시 GitHub Secret 사용.
- data.go.kr 일일 호출 쿼터 (보통 1000회/일) 내에서 운영 중 — 현재 스케줄로 일 96회 사용.
