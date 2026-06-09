// 네이버쇼핑 참고가 — Naver 실어댑터. **유일한 외부 fetch 지점**.
//
// 불변식 ①(무크롤링, 최대 위험): 외부 호스트는 openapi.naver.com **단 하나**.
//   네이버쇼핑 검색 오픈API(약관 내, R1 화이트리스트)만 호출한다. 본문/이미지 수집 0 —
//   응답 items 중 lprice(최저가)·조회시각만 사용한다. HTML 태그가 섞인 title 등 외부
//   본문은 저장/반환하지 않는다.
// 시크릿: 키는 env 주입(NAVER_SHOPPING_CLIENT_ID/_SECRET) — 하드코딩 0. 헤더 값은
//   생성자 인자(변수)로만 부착한다(리터럴 값 동반 금지).
// 불변식 ②(자금): 금액/잔액/정산 토큰 0. 불변식 ⑤(좌표): 위경도 토큰 0.
// graceful: 키 미설정·네트워크/타임아웃·non-200·빈 결과·파싱 실패는 모두 null(throw 금지).
import type { ShoppingPriceRail } from './shopping.port.js';
import type { ShoppingPriceResult } from './shopping.types.js';

// 외부 호스트 단 하나(R1 화이트리스트). sort=asc·display=1 → 최저가 1건.
const NAVER_SHOPPING_ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';
const REQUEST_TIMEOUT_MS = 4000; // rate-limit/지연 방어 — AbortController 타임아웃.

// 외부 응답 중 우리가 신뢰·사용하는 최소 필드만 좁게 타입. title 등 본문은 무시한다.
interface NaverShopItem {
  lprice?: unknown; // 최저가(문자열로 옴) — 숫자 파싱 후에만 사용.
}
interface NaverShopResponse {
  items?: NaverShopItem[];
}

export class NaverShoppingPriceAdapter implements ShoppingPriceRail {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async lookupLowest(query: string): Promise<ShoppingPriceResult | null> {
    const q = query.trim();
    if (q.length === 0) return null;
    if (!this.clientId || !this.clientSecret) return null;

    const url = `${NAVER_SHOPPING_ENDPOINT}?query=${encodeURIComponent(q)}&sort=asc&display=1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Naver-Client-Id': this.clientId,
          'X-Naver-Client-Secret': this.clientSecret,
        },
        signal: controller.signal,
      });
      if (!res.ok) return null; // non-200(429 rate-limit 포함) → 폴백.

      const data = (await res.json()) as NaverShopResponse;
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) return null;

      const price = toPrice(items[0]?.lprice);
      if (price === null) return null;

      // 외부 본문(title/link/image)은 일절 사용하지 않는다 — 가격·조회시각만 스탬프.
      return { price, fetchedAt: new Date().toISOString() };
    } catch {
      return null; // 네트워크/타임아웃/JSON 파싱 오류 → 폴백(throw 금지).
    } finally {
      clearTimeout(timer);
    }
  }
}

// lprice 는 문자열로 오므로 정수 파싱. 비정상(빈값/0이하/NaN)은 null.
function toPrice(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
