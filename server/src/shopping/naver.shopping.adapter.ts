// 네이버쇼핑 참고가 — Naver 실어댑터. **유일한 외부 fetch 지점**.
//
// 불변식 ①(무크롤링, 최대 위험): 외부 호스트는 openapi.naver.com **단 하나**.
//   네이버쇼핑 검색 오픈API(약관 내, R1 화이트리스트)만 호출한다. 검색(search)은 폼 표시용
//   후보(title/mallName 포함)를 반환하지만, **확정(confirm) 결과(ShoppingPriceStamp)엔 외부
//   본문(title/image/link/mallName) 키가 0** — 숫자·productId·시각만 반환한다(DB 영속에 본문 0).
// 시크릿: 키는 env 주입(NAVER_SHOPPING_CLIENT_ID/_SECRET) — 하드코딩 0. 헤더 값은
//   생성자 인자(변수)로만 부착한다(리터럴 값 동반 금지 → SEC_NAVER 미히트).
// 불변식 ②(자금): 금액/잔액/정산 토큰 0. 불변식 ⑤(좌표): 위경도 토큰 0.
// graceful: 키 미설정·네트워크/타임아웃·non-200·빈 결과·파싱 실패·productId 미스는 모두
//   search→빈배열 / confirm→null(throw 금지).
//
// 관측(metrics): 모든 외부 실패는 graceful 폴백으로 삼켜지므로 shopping.metrics 카운터로
//   집계한다(silent degradation 가시화). 실패 경로엔 console.warn 한 줄(일반 사유만 —
//   ★시크릿/응답본문/검색어/키포함 URL 절대 미로그). 카운터/로그 모두 무차원·무본문.
// 캐시(중복 외부호출 제거): 정규화 query→{items, fetchedAt} 단기 TTL 캐시. search 가 채우고
//   confirm 이 신선하면 재사용(외부 0). 메모리 전용(영속 0) — title/mallName 이 캐시에 잠깐
//   있어도 DB 영속엔 여전히 0(confirm 스탬프는 숫자·productId·시각만).
import type { ShoppingPriceRail } from './shopping.port.js';
import type { ShoppingCandidate, ShoppingPriceStamp } from './shopping.types.js';
import { increment } from './shopping.metrics.js';

// 외부 호스트 단 하나(R1 화이트리스트). sort=sim·display=20 → 관련도순 후보 목록.
const NAVER_SHOPPING_ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json';
const REQUEST_TIMEOUT_MS = 4000; // rate-limit/지연 방어 — AbortController 타임아웃.
const SEARCH_DISPLAY = 20; // 후보 목록 크기(잡템필터 모집단).
// 잡템(절대 최저가 60원류) 제외 비율: 대표가의 10% 미만 이상치를 온라인 최저가 계산에서 뺀다.
const LOWEST_OUTLIER_RATIO = 0.1;

// 단기 캐시: search 직후 같은 query 의 confirm 이 동일 외부조회를 반복하지 않게 한다.
const CACHE_TTL_MS = 60_000; // 60s — 가격드리프트 창 축소 + 중복호출 제거.
const CACHE_MAX_ENTRIES = 200; // 상한 — 초과 시 가장 오래된 항목 제거(메모리 누수 방지).

// 외부 응답 중 우리가 신뢰·사용하는 최소 필드만 좁게 타입. brand/category 등은 무시한다.
interface NaverShopItem {
  productId?: unknown; // 불투명 식별자(본문 아님).
  title?: unknown; // 상품명(표시용으로만 — confirm/DB 에는 안 감).
  lprice?: unknown; // 최저가(문자열로 옴) — 숫자 파싱 후에만 사용.
  mallName?: unknown; // 판매몰명(표시용으로만).
}
interface NaverShopResponse {
  items?: NaverShopItem[];
}

// 캐시 엔트리 — 외부 응답 raw items + 실제 조회 시각(스탬프 정직성). 메모리 전용·영속 0.
interface CacheEntry {
  items: NaverShopItem[];
  fetchedAtMs: number; // 실제 외부조회 시각(Date.now) — TTL 판정용.
  fetchedAtIso: string; // confirm 스탬프용 — 캐시 적재(=실제 조회) 시각.
}

export class NaverShoppingPriceAdapter implements ShoppingPriceRail {
  // 인스턴스 단위 캐시(insertion-order Map → 가장 오래된 것이 첫 항목).
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async search(query: string): Promise<ShoppingCandidate[]> {
    increment('searchCalls');
    const q = query.trim();
    // search 는 항상 신선도 보장을 위해 외부조회(폼 표시용) — 결과를 캐시에 적재해 confirm 재사용.
    const items = await this.fetchItems(q);
    if (items === null) {
      increment('searchFails');
      return [];
    }
    this.cacheSet(q, items);
    const out: ShoppingCandidate[] = [];
    for (const item of items) {
      const productId = toText(item.productId);
      const lprice = toPrice(item.lprice);
      if (!productId || lprice === null) continue;
      out.push({
        productId,
        title: stripTags(toText(item.title) ?? ''),
        lprice,
        mallName: toText(item.mallName) ?? '',
      });
    }
    return out;
  }

  async confirm(query: string, productId: string): Promise<ShoppingPriceStamp | null> {
    increment('confirmCalls');
    const wanted = productId.trim();
    if (wanted.length === 0) return null;
    const q = query.trim();

    // 신선한 캐시가 있으면 외부 0(중복 외부호출 제거). 만료/미스면 평소대로 fetch.
    //   fetchedAtIso 는 캐시 히트 시 실제 조회 시각(적재 시각)으로 정직하게 쓴다.
    const cached = this.cacheGet(q);
    let items: NaverShopItem[] | null;
    let fetchedAtIso: string;
    if (cached) {
      increment('cacheHits');
      items = cached.items;
      fetchedAtIso = cached.fetchedAtIso;
    } else {
      items = await this.fetchItems(q);
      if (items !== null) {
        const entry = this.cacheSet(q, items);
        fetchedAtIso = entry.fetchedAtIso;
      } else {
        fetchedAtIso = ''; // 실패 — 아래 null 폴백에서 미사용.
      }
    }
    if (items === null || items.length === 0) return null;

    // 선택 상품(productId 매칭)의 lprice = 대표가. 매칭 실패면 폴백(null) — 임의 추정 금지.
    let basePrice: number | null = null;
    const prices: number[] = [];
    for (const item of items) {
      const lprice = toPrice(item.lprice);
      if (lprice === null) continue;
      prices.push(lprice);
      if (toText(item.productId) === wanted) basePrice = lprice;
    }
    if (basePrice === null) {
      increment('confirmNullMatch');
      return null;
    }

    // 온라인 최저가 = 잡템필터(대표가 10% 미만 이상치 제외) 후 결과 내 최저. 후보 없으면 대표가 폴백.
    const floor = Math.round(basePrice * LOWEST_OUTLIER_RATIO);
    const filtered = prices.filter((p) => p >= floor);
    const lowestPrice = filtered.length > 0 ? Math.min(...filtered) : basePrice;

    // 외부 본문(title/image/link/mallName)은 일절 담지 않는다 — 숫자·productId·시각만 스탬프.
    return {
      basePrice,
      lowestPrice,
      productId: wanted,
      fetchedAt: fetchedAtIso,
    };
  }

  // 캐시 조회 — 신선(TTL 내)하면 엔트리, 만료/미스면 undefined. 만료분은 즉시 제거.
  private cacheGet(q: string): CacheEntry | undefined {
    if (q.length === 0) return undefined;
    const entry = this.cache.get(q);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAtMs > CACHE_TTL_MS) {
      this.cache.delete(q);
      return undefined;
    }
    return entry;
  }

  // 캐시 적재 — 실제 조회 시각 스탬프. 상한 초과 시 가장 오래된 항목 제거(메모리 누수 방지).
  private cacheSet(q: string, items: NaverShopItem[]): CacheEntry {
    const now = Date.now();
    const entry: CacheEntry = {
      items,
      fetchedAtMs: now,
      fetchedAtIso: new Date(now).toISOString(),
    };
    // 갱신 시 insertion-order 를 최신으로 유지(재삽입).
    this.cache.delete(q);
    this.cache.set(q, entry);
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return entry;
  }

  // 공통 외부 조회. 성공 시 items 배열, 모든 실패/빈쿼리/키미설정은 null(graceful).
  //   실패(non-200·네트워크·타임아웃·파싱)는 externalFails 카운트 + console.warn 한 줄(일반 사유만).
  private async fetchItems(query: string): Promise<NaverShopItem[] | null> {
    const q = query.trim();
    if (q.length === 0) return null;
    if (!this.clientId || !this.clientSecret) return null;

    const url = `${NAVER_SHOPPING_ENDPOINT}?query=${encodeURIComponent(q)}&sort=sim&display=${SEARCH_DISPLAY}`;
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
      if (!res.ok) {
        // non-200(429 rate-limit 포함) → 폴백. ★상태코드/본문/URL/키 미로그 — 일반 사유만.
        increment('externalFails');
        console.warn('[shopping] naver lookup failed (non-200) — falling back');
        return null;
      }
      const data = (await res.json()) as NaverShopResponse;
      return Array.isArray(data.items) ? data.items : [];
    } catch {
      // 네트워크/타임아웃/JSON 파싱 오류 → 폴백(throw 금지). ★에러객체/메시지 미로그.
      increment('externalFails');
      console.warn('[shopping] naver lookup failed (network/timeout/non-200) — falling back');
      return null;
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

// 문자열 필드(productId/title/mallName) — 문자열일 때만 trim 후 반환, 아니면 undefined.
function toText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

// 네이버쇼핑 title 은 <b> 등 태그를 포함한다(표시용만). 태그 제거 후 표시한다.
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}
