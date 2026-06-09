// 네이버쇼핑 참고가 검색/확정 포트(추상화) — PaymentRail 패턴 복제.
//
// 불변식 ①(무크롤링, 이 포트의 생존조건):
//   이 포트의 **유일한 외부 fetch 구현**은 naver.shopping.adapter.ts 이며 호스트는
//   openapi.naver.com 단 하나다(네이버쇼핑 검색 오픈API, 약관 내). 키 없을 때 폴백은
//   noop.shopping.adapter.ts(search→[], confirm→null → 기존 '기준가 미확인' 유지).
//   포트 자체는 fetch 0(계약만). 검색도 서버가 호출(키 비노출).
// 불변식 ④(가격주장 금지): 결과는 외부 출처 스탬프일 뿐 플랫폼 단정가가 아니다.
import type { ShoppingCandidate, ShoppingPriceStamp } from './shopping.types.js';

export interface ShoppingPriceRail {
  // 검색어로 네이버쇼핑 결과 후보 목록을 조회한다(폼 표시용). 키 미설정/네트워크 오류/
  //   빈 결과/빈 쿼리는 모두 graceful 빈배열(throw 금지).
  search(query: string): Promise<ShoppingCandidate[]>;
  // 사용자가 고른 productId 의 가격을 동일 검색 재조회로 확정한다(서버 권위).
  //   basePrice=선택 상품 lprice, lowestPrice=잡템필터 후 결과 내 최저 lprice.
  //   productId 매칭 실패/빈 결과/오류/키 미설정은 모두 graceful null(throw 금지) → 라우터 폴백.
  confirm(query: string, productId: string): Promise<ShoppingPriceStamp | null>;
}
