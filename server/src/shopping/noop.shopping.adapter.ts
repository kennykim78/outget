// 네이버쇼핑 참고가 — Noop 어댑터(폴백). GuidancePaymentRail 대응.
//
// 불변식 ①(무크롤링): 외부 fetch 0 · 외부 URL 0 · 키 0. 항상 null 을 반환해
//   라우터가 기존 '기준가 미확인'(unverifiedBase) 동선을 유지하게 한다.
//   env 키(NAVER_SHOPPING_CLIENT_ID/_SECRET) 미설정 시 app.ts 가 이 어댑터를 기본 선택한다.
import type { ShoppingPriceRail } from './shopping.port.js';
import type { ShoppingPriceResult } from './shopping.types.js';

export class NoopShoppingPriceAdapter implements ShoppingPriceRail {
  // 항상 null — 외부 조회 없음(폴백). query 는 계약상 받되 사용하지 않는다.
  async lookupLowest(query: string): Promise<ShoppingPriceResult | null> {
    void query;
    return null;
  }
}
