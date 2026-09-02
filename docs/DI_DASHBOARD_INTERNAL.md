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

현재 자동 수집기는 **입찰공고 데이터 중심**으로 구성되어 있다.  
UI는 `입찰공고 · 사전규격 · 발주계획` 3대 조달 서비스 화면 구조를 지원하지만, 현 수집 스크립트는 우선 `물품/용역 입찰공고`를 수집한다. 사전규격과 발주계획은 향후 API 확장 대상이다.

---

## 2. GitHub 저장소 권장 구조

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
└─ docs/
   └─ DI_DASHBOARD_INTERNAL.md
```

| 경로 | 역할 |
|---|---|
| `di.html` | DI영업지원 대시보드 단일 HTML UI |
| `data/bids.json` | GitHub Actions가 생성하는 정적 조달 데이터 |
| `scripts/fetch-nara-bids.mjs` | 나라장터 API 수집 스크립트 |
| `.github/workflows/fetch-bids.yml` | 자동 수집 워크플로 |
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
| 사전규격 공개 | 향후 사전규격 API 확장 시 표시 |
| 발주계획 현황 | 향후 발주계획 API 확장 시 표시 |
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
| `rangeDays` | 수집 대상 기간 |
| `chunkDays` | 날짜 분할 단위 |
| `rangeBegin` | 수집 시작 일시 |
| `rangeEnd` | 수집 종료 일시 |
| `totalCount` | 중복 제거 후 최종 건수 |
| `rawCount` | 중복 제거 전 원본 건수 |
| `successCalls` | 성공 호출 수 |
| `failedCalls` | 실패 호출 수 |
| `requestDelayMs` | 요청 간격 |
| `maxPagesPerQuery` | 검색어별 최대 페이지 |
| `categoryStats` | 키워드 계열별 건수 |
| `errors` | 오류 목록 |
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
| `bidClseDt` | 입찰 마감일 |
| `searchKeyword` | 매칭 검색어 |
| `region` | 분류 지역 |
| `g2bUrl` | 나라장터 상세 URL |
| `serviceType` | 서비스 구분. 없으면 UI에서 자동 보정 |

---

## 5. 자동 수집 스크립트 운영 기준

### 5.1 수집 범위

현재 운영 기준:

```txt
수집 기간: 최근 30일
데이터 보관: 최근 12개월 월별 파일로 누적
날짜 분할: 15일 단위
검색어: 30개
엔드포인트: 물품 / 용역
요청 간격: 1000ms
재시도: 3회
최대 페이지: 검색어/엔드포인트/날짜구간당 5페이지
```

검색어 기준:

```txt
전광판, 디지털 전광판
미디어, 디지털 미디어
파사드, 디지털 파사드
사이니지, 디지털 사이니지
디스플레이, 디지털 디스플레이
LED, 디지털 LED
ITS, 디지털 ITS
VMS, 디지털 VMS

전광판 외 간접 사업/문화시설:
문화센터, 체육센터, 복합센터, 커뮤니티센터

전광판 외 간접 사업/건립:
건립, 신축

전광판 외 간접 사업/체육시설:
체육관, 운동장, 경기장, 수영장, 축구, 야구, 스포츠파크, 스포츠타운
```

---

### 5.2 사용 API

현재 스크립트는 차세대 나라장터 신규 API 경로를 사용한다.

```txt
물품:
https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoThngPPSSrch

용역:
https://apis.data.go.kr/1230000/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch
```

기존 `BidPublicInfoService04/...01` 경로는 HTTP 500이 반복될 수 있으므로 운영 코드에서 사용하지 않는다.

---

### 5.3 실패 보호 로직

모든 API 호출이 실패하면 기존 `data/bids.json`을 덮어쓰지 않는다.

운영 원칙:

```txt
일부 실패 + 일부 성공 → data/bids.json 갱신
전체 실패 → 프로세스 실패 처리, 기존 JSON 유지
```

이 원칙은 빈 데이터가 운영 화면에 배포되는 사고를 막기 위한 필수 방어 로직이다.

---

## 6. GitHub Actions 운영 기준

워크플로 파일:

```txt
.github/workflows/fetch-bids.yml
```

현재 권장 설정:

```yaml
name: Sync Nara Bids

on:
  schedule:
    - cron: '0 */1 * * *'
  workflow_dispatch:
```

운영 관점에서는 1시간 주기를 기본으로 한다.  
나라장터 데이터는 초 단위 실시간성이 필요한 데이터가 아니므로, 장애가 반복될 경우 3시간 주기로 낮춘다.

```yaml
schedule:
  - cron: '0 */3 * * *'
```

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

## 9. 장애 대응표

| 증상 | 가능 원인 | 조치 |
|---|---|---|
| 대시보드 0건 표시 | `data/bids.json` 미로드 | GitHub Pages 경로와 JSON 위치 확인 |
| Actions HTTP 500 반복 | 구형 API 경로 사용 또는 API 승인 문제 | 신규 `/ad/BidPublicInfoService` 경로 확인 |
| `NARA_API_KEY is empty` | GitHub Secret 누락 | Repository secrets에 `NARA_API_KEY` 등록 |
| 일부 검색어만 실패 | 나라장터 일시 장애 또는 검색어별 응답 문제 | 재실행 후 `errors` 확인 |
| 전체 실패 | 인증키/활용신청/API 경로 문제 | 키 재발급, 활용신청 상태, API URL 확인 |
| CSV 한글 깨짐 | BOM 누락 | UTF-8 BOM 포함 로직 유지 |
| UI는 열리는데 차트 오류 | Chart.js CDN 차단 | 네트워크/방화벽/CDN 접근 확인 |

---

## 10. 향후 개선 과제

### 10.1 진짜 3대 서비스 수집 확장

현재 UI는 3대 서비스 구조를 갖췄지만, 자동 수집기는 입찰공고 중심이다.  
아래 API 수집을 추가하면 UI와 데이터 구조가 완전히 일치한다.

```txt
1. 입찰공고: 현재 적용
2. 사전규격: 추가 필요
3. 발주계획: 추가 필요
```

확장 시 권장 ID 규칙:

```txt
입찰공고: 기존 bidNtceNo 사용
사전규격: BF-{원본번호}
발주계획: PL-{원본번호}
```

이 규칙을 적용하면 현재 UI의 `serviceType` 자동 보정 로직과 호환된다.

---

### 10.2 데이터 품질 개선

추가 검토 항목:

```txt
공고명 기준 불필요 데이터 제외 키워드 추가
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
수집 범위: 최근 30일
장애 보호: 전체 실패 시 기존 JSON 유지
향후 확장: 사전규격/발주계획 API 추가
```

이 구조가 현재 DI UI 수정안에 맞는 GitHub 내부 운영 기준이다.
