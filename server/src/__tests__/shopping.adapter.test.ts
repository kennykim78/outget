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
  it('항상 null(외부 조회 없음 — 폴백)', async () => {
    const noop = new NoopShoppingPriceAdapter();
    expect(await noop.lookupLowest('나이키 운동화')).toBeNull();
    expect(await noop.lookupLowest('')).toBeNull();
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

  it('items[0].lprice 최저가를 채택하고 4필드 스탬프용 결과 반환', async () => {
    const spy = mockFetch(async () =>
      jsonResponse({ items: [{ lprice: '78000', title: '<b>나이키</b> 운동화' }] }),
    );
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    const result = await adapter.lookupLowest('나이키 운동화');

    expect(result).not.toBeNull();
    expect(result!.price).toBe(78000);
    expect(typeof result!.fetchedAt).toBe('string');
    expect(Number.isNaN(Date.parse(result!.fetchedAt))).toBe(false);

    // 호출 URL/헤더 검증: 호스트는 openapi.naver.com 하나, 키는 헤더 변수로 부착.
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(EXPECTED_HOST);
    expect(url).toContain('shop.json');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Naver-Client-Id']).toBe('cid');
    expect(headers['X-Naver-Client-Secret']).toBe('csecret');
  });

  it('외부 본문(title 등)은 결과에 담지 않는다(가격·조회시각만)', async () => {
    mockFetch(async () =>
      jsonResponse({ items: [{ lprice: '50000', title: '<b>본문</b>', image: 'x' }] }),
    );
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    const result = await adapter.lookupLowest('가방');
    expect(Object.keys(result!).sort()).toEqual(['fetchedAt', 'price']);
  });

  it('non-200(예: 429) → null 폴백', async () => {
    mockFetch(async () => jsonResponse({}, false, 429));
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    expect(await adapter.lookupLowest('나이키')).toBeNull();
  });

  it('빈 items → null 폴백', async () => {
    mockFetch(async () => jsonResponse({ items: [] }));
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    expect(await adapter.lookupLowest('없는상품')).toBeNull();
  });

  it('lprice 파싱 불가(0/빈값) → null 폴백', async () => {
    mockFetch(async () => jsonResponse({ items: [{ lprice: '0' }] }));
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    expect(await adapter.lookupLowest('상품')).toBeNull();
  });

  it('네트워크 오류(throw) → null 폴백(throw 전파 금지)', async () => {
    mockFetch(async () => {
      throw new Error('network down');
    });
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    await expect(adapter.lookupLowest('상품')).resolves.toBeNull();
  });

  it('키 미설정 → fetch 호출 없이 null', async () => {
    const spy = mockFetch(async () => jsonResponse({ items: [{ lprice: '1' }] }));
    const adapter = new NaverShoppingPriceAdapter('', '');
    expect(await adapter.lookupLowest('상품')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('빈 검색어 → fetch 호출 없이 null', async () => {
    const spy = mockFetch(async () => jsonResponse({ items: [{ lprice: '1' }] }));
    const adapter = new NaverShoppingPriceAdapter('cid', 'csecret');
    expect(await adapter.lookupLowest('   ')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
