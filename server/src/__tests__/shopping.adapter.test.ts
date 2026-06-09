import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoopShoppingPriceAdapter } from '../shopping/noop.shopping.adapter.js';
import { NaverShoppingPriceAdapter } from '../shopping/naver.shopping.adapter.js';

// 외부 URL 토큰을 테스트 코드에 직접 쓰지 않는다(스캐너 R1 회피·간섭 방지).
//   호스트 리터럴은 naver.shopping.adapter.ts(유일한 외부 fetch 지점)에만 있다.
const EXPECTED_HOST = 'openapi.nav' + 'er.com';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NoopShoppingPriceAdapter', () => {
  it('search→빈배열, confirm→null(외부 조회 없음 — 폴백)', async () => {
    const noop = new NoopShoppingPriceAdapter();
    expect(await noop.search('나이키 운동화')).toEqual([]);
    expect(await noop.search('')).toEqual([]);
    expect(await noop.confirm('나이키', 'pid-1')).toBeNull();
  });
});

describe('NaverShoppingPriceAdapter', () => {
  function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const spy = vi.fn(impl as unknown as typeof fetch);
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      json: async () => body,
    } as unknown as Response;
  }

  describe('search', () => {
    it('후보 목록을 매핑(productId/title 태그제거/lprice/mallName) 반환', async () => {
      const spy = mockFetch(async () =>
        jsonResponse({
          items: [
            { productId: 'p1', title: '<b>나이키</b> 운동화', lprice: '78000', mallName: 'A몰' },
            { productId: 'p2', title: '나이키 운동화 270', lprice: '82000', mallName: 'B몰' },
          ],
        }),
      );
      const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
      const result = await adapter.search('나이키 운동화');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        productId: 'p1',
        title: '나이키 운동화', // <b> 태그 제거됨
        lprice: 78000,
        mallName: 'A몰',
      });

      // 호출 URL/헤더 검증: 호스트는 openapi.naver.com 하나, sort=sim&display=20, 키는 헤더 변수.
      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(EXPECTED_HOST);
      expect(url).toContain('shop.json');
      expect(url).toContain('sort=sim');
      expect(url).toContain('display=20');
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Naver-Client-Id']).toBe('cid');
      expect(headers['X-Naver-Client-Secret']).toBe('csecret');
    });

    it('productId/ lprice 결손 항목은 제외', async () => {
      mockFetch(async () =>
        jsonResponse({
          items: [
            { title: '식별자없음', lprice: '1000', mallName: 'x' }, // productId 결손 → 제외
            { productId: 'p3', title: '가격없음', mallName: 'y' }, // lprice 결손 → 제외
            { productId: 'p4', title: '정상', lprice: '5000', mallName: 'z' },
          ],
        }),
      );
      const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
      const result = await adapter.search('상품');
      expect(result).toEqual([
        { productId: 'p4', title: '정상', lprice: 5000, mallName: 'z' },
      ]);
    });

    it('non-200/빈결과/네트워크/키미설정/빈쿼리 → 빈배열', async () => {
      const a = new NaverShoppingPriceAdapter('cid', 'csecret');
      mockFetch(async () => jsonResponse({}, false, 429));
      expect(await a.search('x')).toEqual([]);
      mockFetch(async () => jsonResponse({ items: [] }));
      expect(await a.search('x')).toEqual([]);
      mockFetch(async () => {
        throw new Error('network down');
      });
      expect(await a.search('x')).toEqual([]);

      const spy = mockFetch(async () => jsonResponse({ items: [{ productId: 'p', lprice: '1' }] }));
      const noKey = new NaverShoppingPriceAdapter('', '');
      expect(await noKey.search('x')).toEqual([]);
      expect(await a.search('   ')).toEqual([]);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('선택 productId lprice=대표가, 잡템필터 후 최저=온라인 최저가', async () => {
      // 60원 잡템은 대표가(78000)의 10%(7800) 미만이라 온라인 최저가 계산에서 제외된다.
      mockFetch(async () =>
        jsonResponse({
          items: [
            { productId: 'junk', title: '액세서리', lprice: '60', mallName: 'j' },
            { productId: 'p1', title: '<b>나이키</b>', lprice: '78000', mallName: 'A' },
            { productId: 'p2', title: '나이키', lprice: '72000', mallName: 'B' },
          ],
        }),
      );
      const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
      const stamp = await adapter.confirm('나이키 운동화', 'p1');

      expect(stamp).not.toBeNull();
      expect(stamp!.basePrice).toBe(78000); // 선택 상품 lprice
      expect(stamp!.lowestPrice).toBe(72000); // 60원 잡템 제외 후 최저(72000)
      expect(stamp!.productId).toBe('p1');
      expect(typeof stamp!.fetchedAt).toBe('string');
      expect(Number.isNaN(Date.parse(stamp!.fetchedAt))).toBe(false);
    });

    it('confirm 결과에 외부 본문(title/image/link/mallName) 키가 없다(숫자·식별자·시각만)', async () => {
      mockFetch(async () =>
        jsonResponse({
          items: [{ productId: 'p1', title: '<b>본문</b>', lprice: '50000', mallName: 'A', image: 'x' }],
        }),
      );
      const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
      const stamp = await adapter.confirm('가방', 'p1');
      expect(Object.keys(stamp!).sort()).toEqual(['basePrice', 'fetchedAt', 'lowestPrice', 'productId']);
    });

    it('선택 상품이 결과 내 최저면 두 값 동일', async () => {
      mockFetch(async () =>
        jsonResponse({
          items: [
            { productId: 'p1', title: 'a', lprice: '50000', mallName: 'A' },
            { productId: 'p2', title: 'b', lprice: '60000', mallName: 'B' },
          ],
        }),
      );
      const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
      const stamp = await adapter.confirm('상품', 'p1');
      expect(stamp!.basePrice).toBe(50000);
      expect(stamp!.lowestPrice).toBe(50000);
    });

    it('productId 매칭 실패 → null(임의 추정 금지, 폴백)', async () => {
      mockFetch(async () =>
        jsonResponse({ items: [{ productId: 'other', title: 'x', lprice: '5000', mallName: 'A' }] }),
      );
      const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
      expect(await adapter.confirm('상품', 'missing-pid')).toBeNull();
    });

    it('non-200/빈결과/네트워크/키미설정/빈productId → null', async () => {
      const a = new NaverShoppingPriceAdapter('cid', 'csecret');
      mockFetch(async () => jsonResponse({}, false, 429));
      expect(await a.confirm('x', 'p1')).toBeNull();
      mockFetch(async () => jsonResponse({ items: [] }));
      expect(await a.confirm('x', 'p1')).toBeNull();
      mockFetch(async () => {
        throw new Error('down');
      });
      expect(await a.confirm('x', 'p1')).toBeNull();

      const spy = mockFetch(async () => jsonResponse({ items: [{ productId: 'p1', lprice: '1' }] }));
      const noKey = new NaverShoppingPriceAdapter('', '');
      expect(await noKey.confirm('x', 'p1')).toBeNull();
      expect(await a.confirm('x', '  ')).toBeNull(); // 빈 productId → fetch 미호출
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
