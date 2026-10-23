# nara-scout · DI 조달 검토 보드

나라장터(조달청) 입찰공고·사전규격·발주계획 중 전광판·LED·미디어파사드·ITS/VMS·버스정보(BIT/BIS) 관련 사업과 체육·문화시설 신축 같은 간접 사업을 모아, 영업 담당자가 참여 여부와 검토 순서를 빠르게 정리하는 정적 대시보드입니다.

- 대시보드: https://tkdwns5119-del.github.io/nara-scout/ (→ `di.html`)
- 운영 문서: [docs/DI_DASHBOARD_INTERNAL.md](docs/DI_DASHBOARD_INTERNAL.md)

## 구조

```txt
GitHub Actions (fetch-bids.yml, 하루 6회: 07·09·11·13·15·17시)
  → scripts/fetch-nara-bids.mjs  (data.go.kr OpenAPI 호출)
  → data/bids.json, data/archive/YYYY-MM.json  (자동 커밋)
  → GitHub Pages의 di.html 이 정적 JSON을 읽어 표시
검토 상태·메모 → Firebase Realtime Database (Google 로그인 + 허용 목록)
```

| 경로 | 역할 |
|---|---|
| `di.html` | 대시보드 (단일 HTML) |
| `index.html`, `di-actionboard.html` | 기존 주소 호환용 이동 페이지 |
| `scripts/fetch-nara-bids.mjs` | 수집 스크립트 |
| `data/` | 수집 결과와 Firebase 설정 (`workflow-config.json`) |
| `.github/workflows/fetch-bids.yml` | 자동 수집 |
| `.github/workflows/validate-dashboard.yml` | `di.html` 스크립트 문법 검사 |
| `database.rules.json`, `firebase.json` | Firebase 보안 규칙 |

## 처음 설정

1. **API 키**: 공공데이터포털에서 입찰공고정보·사전규격정보·발주계획현황 서비스 활용신청 → Settings → Secrets and variables → Actions에 `NARA_API_KEY` 등록 (Decoding 키 권장)
2. **Actions 권한**: Settings → Actions → General → Workflow permissions → Read and write
3. **Pages**: Settings → Pages → Deploy from a branch → `main` / root
4. **정시 수집**: cron-job.org가 07·09·11·13·15·17시에 수집을 시작합니다. GitHub 토큰 1개와 cron-job.org 작업 1개가 필요합니다 (운영 문서 6.2)
5. **검토 기록 공유**: Firebase Google 로그인, 승인 도메인, `members` 등록, 보안 규칙 게시 (운영 문서 8.4)

## 수동 수집

Actions → **Sync Nara Bids** → Run workflow. 최근 90분 안에 수집했으면 건너뛰므로, 바로 다시 받으려면 `force`를 체크합니다 (30일 전체 재수집).

## 로컬에서 보기

`file://`로 열면 브라우저가 JSON 로드를 막으므로 정적 서버로 엽니다.

```bash
python -m http.server 8080
```

→ http://localhost:8080/di.html
