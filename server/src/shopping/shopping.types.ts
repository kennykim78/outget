// 네이버쇼핑 참고가 검색/확정 계약 원본 — 대화형 검색→사용자 선택→두 가격 스탬프.
//
// 불변식 ①(무크롤링): 외부 호스트는 openapi.naver.com **단 하나**(naver.shopping.adapter.ts).
//   검색 결과(ShoppingCandidate)는 폼 표시용으로만 title/mallName 을 싣는다 — DB 영속/스탬프
//   객체(ShoppingPriceStamp)엔 외부 본문(title/image/link/mallName) 키가 **0**이다. 숫자·식별자·
//   출처·시각만 저장한다.
// 불변식 ④(가격주장 금지): 결과는 **외부 출처 스탬프**(source/query/fetchedAt 동반)일 뿐
//   플랫폼 단정가가 아니다. platform/our/official price 류 네이밍(R5) 금지. "정가" 변수 0.

// 검색 결과 후보(임시·표시용). 사용자가 폼에서 1건을 고르도록 목록 렌더에 쓴다.
//   title/mallName 은 폼 표시용으로만 응답에 싣고, **DB 영속 객체엔 저장하지 않는다**(불변식 ①).
//   클라가 되돌려 보내도 서버는 productId+query 로만 재조회한다(되돌림 본문 무시).
export interface ShoppingCandidate {
  productId: string; // 네이버 productId(불투명 식별자 — 본문 아님).
  title: string; // 상품명(표시용, HTML 태그 제거). DB 미저장.
  lprice: number; // 최저가(외부 출처 — 플랫폼 단정가 아님).
  mallName: string; // 판매몰명(표시용). DB 미저장.
}

// 가격 확정 스탬프(서버 권위, 숫자/메타만). 사용자가 고른 productId 를 서버가 재조회해 확정한다.
//   **외부 본문(title/image/link/mallName) 키 0** — 무크롤링 본문 미저장(불변식 ①).
//   basePrice=선택 상품 lprice(대표가), lowestPrice=잡템필터 후 결과 내 최저 lprice(온라인 최저가).
//   referenceSource('네이버쇼핑')/referenceQuery 는 라우터가 입력으로 채운다 — 어댑터는
//   외부 응답에서 확정 가능한 basePrice/lowestPrice/productId/fetchedAt 만 반환한다.
export interface ShoppingPriceStamp {
  basePrice: number; // 대표(기본)가 = 사용자가 선택한 상품의 lprice. 외부 출처.
  lowestPrice: number; // 온라인 최저가 = 잡템필터 후 결과 내 최저 lprice. 외부 출처.
  productId: string; // 선택 상품의 불투명 식별자(본문 아님).
  fetchedAt: string; // ISO 조회시각(서버 권위 스탬프).
}
