import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { NaverShoppingPriceAdapter } from '../shopping/naver.shopping.adapter.js';
import {
  increment,
  reset,
  snapshot,
} from '../shopping/shopping.metrics.js';

// 앱 import 전 JWT 시크릿 주입(더미 — 변수 경유, 하드코딩 운영 시크릿 금지).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as unknown as typeof fetch);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const ITEMS = {
  items: [
    { productId: 'p1', title: '<b>나이키</b>', lprice: '78000', mallName: 'A' },
    { productId: 'p2', title: '나이키', lprice: '72000', mallName: 'B' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

beforeEach(() => {
  reset();
});

describe('shopping.metrics 카운터(인메모리, 숫자뿐)', () => {
  it('초기 스냅샷은 전부 0, increment/reset 동작', () => {
    expect(snapshot()).toEqual({
      searchCalls: 0,
      searchFails: 0,
      confirmCalls: 0,
      confirmNullMatch: 0,
      externalFails: 0,
      cacheHits: 0,
    });
    increment('searchCalls');
    increment('externalFails');
    expect(snapshot().searchCalls).toBe(1);
    expect(snapshot().externalFails).toBe(1);
    reset();
    expect(snapshot().searchCalls).toBe(0);
  });

  it('snapshot 은 복사본 — 반환값 변형이 카운터에 영향 없음', () => {
    const s = snapshot();
    s.searchCalls = 999;
    expect(snapshot().searchCalls).toBe(0);
  });

  it('search 성공 → searchCalls++ (searchFails 불변)', async () => {
    mockFetch(async () => jsonResponse(ITEMS));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    await a.search('나이키');
    expect(snapshot().searchCalls).toBe(1);
    expect(snapshot().searchFails).toBe(0);
    expect(snapshot().externalFails).toBe(0);
  });

  it('search 외부 실패(non-200) → searchFails++ + externalFails++', async () => {
    mockFetch(async () => jsonResponse({}, false, 429));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    await a.search('나이키');
    expect(snapshot().searchCalls).toBe(1);
    expect(snapshot().searchFails).toBe(1);
    expect(snapshot().externalFails).toBe(1);
  });

  it('confirm 성공 → confirmCalls++ (confirmNullMatch 불변)', async () => {
    mockFetch(async () => jsonResponse(ITEMS));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    const stamp = await a.confirm('나이키', 'p1');
    expect(stamp).not.toBeNull();
    expect(snapshot().confirmCalls).toBe(1);
    expect(snapshot().confirmNullMatch).toBe(0);
  });

  it('confirm productId 미매칭 → confirmNullMatch++ (externalFails 아님)', async () => {
    mockFetch(async () =>
      jsonResponse({ items: [{ productId: 'other', lprice: '5000' }] }),
    );
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    expect(await a.confirm('가방', 'missing')).toBeNull();
    expect(snapshot().confirmCalls).toBe(1);
    expect(snapshot().confirmNullMatch).toBe(1);
    expect(snapshot().externalFails).toBe(0);
  });

  it('confirm 외부 실패(네트워크) → externalFails++ (confirmNullMatch 아님)', async () => {
    mockFetch(async () => {
      throw new Error('down');
    });
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    expect(await a.confirm('가방', 'p1')).toBeNull();
    expect(snapshot().externalFails).toBe(1);
    expect(snapshot().confirmNullMatch).toBe(0);
  });

  it('실패 경로 console.warn 은 일반 사유만 — 키/시크릿/검색어/URL 미로그(★보안)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch(async () => jsonResponse({}, false, 429));
    const a = new NaverShoppingPriceAdapter('super-secret-id', 'super-secret-key');
    await a.search('나이키 비밀검색어');
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain('super-secret-id');
    expect(logged).not.toContain('super-secret-key');
    expect(logged).not.toContain('나이키 비밀검색어');
    expect(logged).not.toContain('openapi.nav' + 'er.com');
    expect(logged).not.toContain('X-Naver-Client');
  });
});

describe('GET /api/shopping/metrics (운영자 전용 읽기)', () => {
  let app: Express;
  async function tokenFor(email: string, role: string): Promise<string> {
    const reg = await request(app)
      .post('/auth/register')
      .send({ email, password: 'pw-12345', role });
    return reg.body.accessToken as string;
  }

  beforeEach(async () => {
    const { createApp } = await import('../app.js');
    app = createApp();
  });

  it('비인가 → 401', async () => {
    const res = await request(app).get('/api/shopping/metrics');
    expect(res.status).toBe(401);
  });

  it('운영자 외 역할(소식알림자) → 403', async () => {
    const token = await tokenFor('metrics-news@example.com', '소식알림자');
    const res = await request(app)
      .get('/api/shopping/metrics')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('운영자 → 200 + 카운터 6키 숫자(시크릿/본문 키 0)', async () => {
    const token = await tokenFor('metrics-admin@example.com', '운영자');
    const res = await request(app)
      .get('/api/shopping/metrics')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'cacheHits',
      'confirmCalls',
      'confirmNullMatch',
      'externalFails',
      'searchCalls',
      'searchFails',
    ]);
    for (const v of Object.values(res.body)) expect(typeof v).toBe('number');
  });
});

describe('confirm 캐시(중복 외부호출 제거 + TTL)', () => {
  it('같은 query search→confirm = fetch 1회만(캐시 히트)', async () => {
    const spy = mockFetch(async () => jsonResponse(ITEMS));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    await a.search('나이키 운동화');
    expect(spy).toHaveBeenCalledTimes(1);
    const stamp = await a.confirm('나이키 운동화', 'p1');
    expect(spy).toHaveBeenCalledTimes(1); // confirm 은 캐시 재사용 → 외부 0
    expect(stamp!.basePrice).toBe(78000);
    expect(snapshot().cacheHits).toBe(1);
  });

  it('confirm 캐시 히트의 fetchedAt = 캐시 적재(실제 조회) 시각', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T00:00:00.000Z'));
    mockFetch(async () => jsonResponse(ITEMS));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    await a.search('나이키');
    vi.setSystemTime(new Date('2026-06-09T00:00:30.000Z')); // 30s 경과(TTL 내)
    const stamp = await a.confirm('나이키', 'p1');
    expect(stamp!.fetchedAt).toBe('2026-06-09T00:00:00.000Z'); // 적재 시각(now 아님)
    expect(snapshot().cacheHits).toBe(1);
  });

  it('TTL(60s) 만료 후 confirm → 재fetch(캐시 미스)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-09T00:00:00.000Z'));
    const spy = mockFetch(async () => jsonResponse(ITEMS));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    await a.search('나이키');
    expect(spy).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-06-09T00:01:01.000Z')); // 61s 경과(TTL 초과)
    await a.confirm('나이키', 'p1');
    expect(spy).toHaveBeenCalledTimes(2); // 만료 → 재fetch
    expect(snapshot().cacheHits).toBe(0);
  });

  it('다른 query 는 캐시 공유 안 함 → 각자 fetch', async () => {
    const spy = mockFetch(async () => jsonResponse(ITEMS));
    const a = new NaverShoppingPriceAdapter('cid', 'csecret');
    await a.search('나이키');
    await a.confirm('아디다스', 'p1'); // 다른 query → 캐시 미스 → fetch
    expect(spy).toHaveBeenCalledTimes(2);
    expect(snapshot().cacheHits).toBe(0);
  });
});
