# DI영업지원 3대 조달 API 참고자료 반영본

## 반영 내용

업로드된 조달청 OpenAPI 참고자료 기준으로 아래 API 주소와 오퍼레이션명을 반영했습니다.

### 입찰공고정보서비스

```txt
서비스 ID: BidPublicInfoService
Base URL: https://apis.data.go.kr/1230000/ad/BidPublicInfoService

물품: getBidPblancListInfoThngPPSSrch
용역: getBidPblancListInfoServcPPSSrch
검색 파라미터: bidNtceNm
```

### 사전규격정보서비스

```txt
서비스 ID: HrcspSsstndrdInfoService
Base URL: https://apis.data.go.kr/1230000/ao/HrcspSsstndrdInfoService

물품: getPublicPrcureThngInfoThngPPSSrch
용역: getPublicPrcureThngInfoServcPPSSrch
검색 파라미터: prdctClsfcNoNm
```

### 발주계획현황서비스

```txt
서비스 ID: OrderPlanSttusService
Base URL: https://apis.data.go.kr/1230000/ao/OrderPlanSttusService

물품: getOrderPlanSttusListThngPPSSrch
용역: getOrderPlanSttusListServcPPSSrch
검색 파라미터: bizNm
기간 파라미터: orderBgnYm, orderEndYm, inqryBgnDt, inqryEndDt
```

## GitHub 반영 위치

```txt
scripts/fetch-nara-bids.mjs
.github/workflows/fetch-bids.yml
```

## 필수 Secret

```txt
NARA_API_KEY
```

## 선택 Secret

```txt
NARA_PRESPEC_API_KEY
NARA_PLAN_API_KEY
```

등록하지 않으면 `NARA_API_KEY`를 재사용합니다.

## 주의

공공데이터포털에서 아래 3개 서비스 활용신청이 되어 있어야 합니다.

```txt
조달청_나라장터 입찰공고정보서비스
조달청_나라장터 사전규격정보서비스
조달청_나라장터 발주계획현황서비스
```
