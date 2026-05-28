# DI영업지원 나라장터 통합 조달 대시보드

싸인텔레콤 DI영업지원용 나라장터 조달 데이터 대시보드입니다.

GitHub Actions가 조달청 나라장터 API를 호출해 `data/bids.json`을 생성하고, `di.html`이 해당 정적 JSON을 읽어 대시보드를 표시합니다.

---

## 1. 파일 구조

```txt
/
├─ di.html
├─ data/
│  └─ bids.json
├─ scripts/
│  └─ fetch-nara-bids.mjs
├─ .github/
│  └─ workflows/
│     └─ fetch-bids.yml
├─ docs/
│  └─ DI_DASHBOARD_INTERNAL.md
└─ README.md
```

| 경로 | 역할 |
|---|---|
| `di.html` | DI영업지원 대시보드 단일 HTML UI |
| `data/bids.json` | GitHub Actions가 생성하는 정적 조달 데이터 |
| `scripts/fetch-nara-bids.mjs` | 나라장터 API 수집 스크립트 |
| `.github/workflows/fetch-bids.yml` | 자동 수집 워크플로 |
| `docs/DI_DASHBOARD_INTERNAL.md` | 내부 운영 문서 |
| `README.md` | 저장소 안내 문서 |

---

## 2. 실행 방법

### 2.1 GitHub Secret 등록

GitHub 저장소에서 아래 경로로 이동합니다.

```txt
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

아래 Secret을 등록합니다.

```txt
Name: NARA_API_KEY
Value: 공공데이터포털 Decoding 인증키
```

API 키는 `di.html`이나 README에 직접 작성하지 않습니다.

---

### 2.2 GitHub Actions 실행

```txt
Actions
→ Sync Nara Bids
→ Run workflow
```

정상 실행 기준:

```txt
NARA_API_KEY exists
[INFO] 수집 범위: ...
[DONE] 성공 호출: 1 이상
```

정상 실행되면 `data/bids.json`이 갱신됩니다.

---

### 2.3 GitHub Pages 설정

```txt
Settings
→ Pages
→ Build and deployment
→ Source: Deploy from a branch
→ Branch: main
→ Folder: /root
→ Save
```

대시보드 접속 주소 예시:

```txt
https://계정명.github.io/저장소명/di.html
```

데이터 확인 주소 예시:

```txt
https://계정명.github.io/저장소명/data/bids.json
```

---

## 3. 운영 기준

현재 수집 기준:

```txt
수집 범위: 최근 30일
날짜 분할: 15일 단위
검색어: 전광판, 미디어, 파사드, 사이니지, 디스플레이, LED, ITS, VMS
엔드포인트: 물품 / 용역
요청 간격: 1000ms
재시도: 3회
```

현재 UI는 `입찰공고 · 사전규격 · 발주계획` 3대 조달 서비스 구조를 지원합니다.

다만 현재 자동 수집 스크립트는 우선 `입찰공고` 중심으로 구성되어 있습니다.  
사전규격과 발주계획 수집은 향후 확장 대상입니다.

---

## 4. 주요 화면

| 화면 | 설명 |
|---|---|
| 통합 대시보드 | 전체 건수, 예산, 마감임박, 주요 사업, 추세 차트 |
| 통합 사업 목록 | 검색, 필터, CSV 다운로드 |
| 점유 및 트렌드 분석 | 키워드, 지역, 서비스 유형별 분석 |
| 관리자 설정 | 데이터 로드 방식 및 진단 설정 |

---

## 5. 장애 대응

| 증상 | 조치 |
|---|---|
| 대시보드가 0건으로 표시됨 | `data/bids.json` 경로 확인 |
| Actions에서 `NARA_API_KEY is empty` 발생 | GitHub Secret 등록 확인 |
| HTTP 500 반복 | API 활용신청 상태, 인증키, 신규 API 경로 확인 |
| GitHub Pages에서 화면이 안 뜸 | `/di.html` 직접 접속 |
| README가 안 보임 | 저장소 루트에 `README.md`가 있는지 확인 |

---

## 6. 내부 문서

상세 운영 기준은 아래 문서를 확인합니다.

```txt
docs/DI_DASHBOARD_INTERNAL.md
```
