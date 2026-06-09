// 네이버쇼핑 참고가 조회 계약 원본 — payment.types.ts 패턴 복제.
//
// 불변식 ①(무크롤링): 외부 호스트는 openapi.naver.com **단 하나**(naver.shopping.adapter.ts).
//   본문/이미지 수집 0 — 가격(lprice)·조회시각만 사용한다. HTML 태그가 섞인 title 등
//   외부 본문은 저장/반환하지 않는다.
// 불변식 ④(가격주장 금지): 결과는 **외부 출처 스탬프**(source/query/fetchedAt 동반)일 뿐
//   플랫폼 단정가가 아니다. platform/our/official price 류 네이밍(R5) 금지.

// 조회 입력. 사용자가 입력한 검색어 하나만 — 금액/좌표/자금 필드 없음.
export interface ShoppingPriceQuery {
  query: string;
}

// 조회 결과(성공). 최저가 1건 + 조회시각. null 이면 폴백(기준가 미확인 유지).
//   referenceSource('네이버쇼핑')/referenceQuery 는 라우터가 입력 검색어로 채운다 —
//   어댑터는 외부 응답에서 확정 가능한 price·fetchedAt 만 반환한다.
export interface ShoppingPriceResult {
  price: number; // 네이버쇼핑 최저가(lprice). 외부 출처 — 플랫폼 단정가 아님.
  fetchedAt: string; // ISO 조회시각(서버 권위 스탬프).
}
