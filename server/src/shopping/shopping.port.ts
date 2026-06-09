// 네이버쇼핑 참고가 조회 포트(추상화) — PaymentRail 패턴 복제.
//
// 불변식 ①(무크롤링, 이 포트의 생존조건):
//   이 포트의 **유일한 외부 fetch 구현**은 naver.shopping.adapter.ts 이며 호스트는
//   openapi.naver.com 단 하나다(네이버쇼핑 검색 오픈API, 약관 내). 키 없을 때 폴백은
//   noop.shopping.adapter.ts(항상 null → 기존 '기준가 미확인' 유지). 포트 자체는 fetch 0(계약만).
// 불변식 ④(가격주장 금지): lookupLowest 결과는 외부 출처 스탬프일 뿐 플랫폼 단정가가 아니다.
import type { ShoppingPriceResult } from './shopping.types.js';

export interface ShoppingPriceRail {
  // 검색어로 네이버쇼핑 최저가 1건을 조회한다. 키 미설정/네트워크 오류/빈 결과는
  //   모두 graceful null(throw 금지) → 라우터가 폴백(기준가 미확인 유지)한다.
  lookupLowest(query: string): Promise<ShoppingPriceResult | null>;
}
