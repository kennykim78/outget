import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// 앱 import 이전에 env 주입(테스트 시크릿 + CORS 화이트리스트).
//   리터럴을 별도 상수에 두고 env 에 대입(하드코딩 운영 시크릿 아님 — auth.test 와 동일 패턴).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
process.env.CORS_ORIGIN = 'https://allowed.example.com';

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp();
});

describe('security headers', () => {
  it('모든 응답에 보안 헤더가 존재한다', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.headers['permissions-policy']).toBe('geolocation=(), camera=(), microphone=(), payment=()');
  });

  it('404 응답에도 보안 헤더가 적용된다(초반 미들웨어)', async () => {
    const res = await request(app).get('/no-such-route');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CORS rejection → error handler', () => {
  it('화이트리스트 외 Origin 요청 → 403 cors_forbidden', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'cors_forbidden' });
  });

  it('화이트리스트 Origin 요청 → 정상 200', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://allowed.example.com');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('Origin 헤더 없음(same-origin/curl) → 정상 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('에러핸들러는 스택/상세를 노출하지 않는다', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://evil.example.com');
    expect(res.body).not.toHaveProperty('stack');
    expect(res.body).not.toHaveProperty('message');
  });
});

// R5 B1-4 리미터(계약 C-R5-2·C-R5-3·C-R5-4). createApp 마다 새 인스턴스(앱 간 상태 공유 없음).
//   test env 기본은 꺼짐 — rateLimits: true 로 켜서 실제 429 를 확인한다.
describe('rate limits (B1-4)', () => {
  it('makeAppLimiters: 수치는 계약대로', async () => {
    const { LIMITS } = await import('../middleware/rate-limit.js');
    expect(LIMITS.magic).toEqual({ windowMs: 15 * 60 * 1000, limit: 5 });
    expect(LIMITS.reaction).toEqual({ windowMs: 60 * 1000, limit: 20 });
    expect(LIMITS.vetReport).toEqual({ windowMs: 60 * 60 * 1000, limit: 5 });
    expect(LIMITS.save.limit).toBeGreaterThanOrEqual(30); // 2s 디바운스 PUT ≤ 30/분
  });

  it('POST /auth/magic/request: IP 당 15분 6번째 → 429(이메일을 바꿔도)', async () => {
    const { createApp } = await import('../app.js');
    const { makeInMemoryRepos } = await import('../db/repos.js');
    const sink = { async send() {} };
    const a = createApp(makeInMemoryRepos(), {
      rateLimits: true,
      save: { config: { publicOrigin: 'https://w.test', transport: sink, secureCookie: false } },
    });
    for (let i = 0; i < 5; i++) {
      const r = await request(a).post('/auth/magic/request').send({ email: `u${i}@example.com`, entry: 'home' });
      expect(r.status).toBe(202);
    }
    const over = await request(a).post('/auth/magic/request').send({ email: 'u9@example.com', entry: 'home' });
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'rate_limited' });
  });

  it('PUT /api/save: 리미터 초과 → 429(세션 검사 전)', async () => {
    const { createApp } = await import('../app.js');
    const { makeInMemoryRepos } = await import('../db/repos.js');
    const { LIMITS } = await import('../middleware/rate-limit.js');
    const a = createApp(makeInMemoryRepos(), { rateLimits: true });
    for (let i = 0; i < LIMITS.save.limit; i++) {
      expect((await request(a).put('/api/save').send({})).status).toBe(401);
    }
    expect((await request(a).put('/api/save').send({})).status).toBe(429);
    // GET 은 저장 리미터 대상 아님
    expect((await request(a).get('/api/save')).status).toBe(401);
  });

  it('reaction(20/분)·vetReport(5/시간) 리미터 단위 — 21번째·6번째 429', async () => {
    const express = (await import('express')).default;
    const { makeAppLimiters } = await import('../middleware/rate-limit.js');
    const l = makeAppLimiters(true);
    const a = express();
    a.post('/r', l.reaction, (_q, s) => void s.status(204).end());
    a.post('/v', l.vetReport, (_q, s) => void s.status(202).end());
    for (let i = 0; i < 20; i++) expect((await request(a).post('/r')).status).toBe(204);
    expect((await request(a).post('/r')).status).toBe(429);
    for (let i = 0; i < 5; i++) expect((await request(a).post('/v')).status).toBe(202);
    expect((await request(a).post('/v')).status).toBe(429);
  });

  it('makeAppLimiters(false) 는 전부 패스스루', async () => {
    const express = (await import('express')).default;
    const { makeAppLimiters } = await import('../middleware/rate-limit.js');
    const l = makeAppLimiters(false);
    const a = express();
    a.post('/v', l.vetReport, (_q, s) => void s.status(202).end());
    for (let i = 0; i < 10; i++) expect((await request(a).post('/v')).status).toBe(202);
  });

  it('POST /auth/login: 분당 11번째 → 429', async () => {
    const { createApp } = await import('../app.js');
    const a = createApp(undefined, { rateLimits: true });
    for (let i = 0; i < 10; i++) {
      expect((await request(a).post('/auth/login').send({ email: 'x@example.com', password: 'p' })).status).toBe(401);
    }
    expect((await request(a).post('/auth/login').send({ email: 'x@example.com', password: 'p' })).status).toBe(429);
  });
});

// SEC-3 M-2: trust proxy 정수 홉 수 + IPv6 /64 키. L-7: 가벼운 읽기 리미터. L-5: 운영 JWT 시크릿 길이.
describe('SEC-3 M-2 · L-5 · L-7', () => {
  const sink = { async send() {} };
  const saveCfg = { config: { publicOrigin: 'https://w.test', transport: sink, secureCookie: false } };

  async function magicApp(trustProxy: number) {
    const { createApp } = await import('../app.js');
    const { makeInMemoryRepos } = await import('../db/repos.js');
    return createApp(makeInMemoryRepos(), { rateLimits: true, trustProxy, save: saveCfg });
  }

  const ask = (a: import('express').Express, xff: string, i: number) =>
    request(a).post('/auth/magic/request').set('X-Forwarded-For', xff).send({ email: `x${i}@example.com`, entry: 'home' });

  it('hops=0: X-Forwarded-For 무시 — XFF 를 바꿔도 같은 소켓 IP 버킷(6번째 429)', async () => {
    const a = await magicApp(0);
    for (let i = 0; i < 5; i++) expect((await ask(a, `203.0.113.${i}`, i)).status).toBe(202);
    expect((await ask(a, '198.51.100.9', 9)).status).toBe(429);
  });

  it('hops=1: XFF 의 클라이언트 IP 로 키 — 다른 클라이언트는 별도 버킷', async () => {
    const a = await magicApp(1);
    for (let i = 0; i < 5; i++) expect((await ask(a, '203.0.113.7', i)).status).toBe(202);
    expect((await ask(a, '203.0.113.7', 5)).status).toBe(429);
    expect((await ask(a, '198.51.100.9', 6)).status).toBe(202);
  });

  it('hops=1: 같은 IPv6 /64 는 한 버킷, 다른 /64 는 별도', async () => {
    const a = await magicApp(1);
    for (let i = 0; i < 5; i++) expect((await ask(a, `2001:db8:1:2::${i + 1}`, i)).status).toBe(202);
    expect((await ask(a, '2001:db8:1:2:ffff:ffff:ffff:ffff', 5)).status).toBe(429);
    expect((await ask(a, '2001:db8:1:3::1', 6)).status).toBe(202);
  });

  it('ipKey: IPv4·IPv4-mapped·IPv6 /64·압축·존 id·이상값', async () => {
    const { ipKey } = await import('../middleware/rate-limit.js');
    expect(ipKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipKey('2001:db8::1')).toBe('2001:0db8:0000:0000::/64');
    expect(ipKey('2001:DB8:0:0:abcd::1')).toBe('2001:0db8:0000:0000::/64');
    expect(ipKey('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
    expect(ipKey('::1')).toBe('0000:0000:0000:0000::/64');
    expect(ipKey(undefined)).toBe('unknown');
    expect(ipKey('garbage')).toBe('garbage');
  });

  it('TRUST_PROXY=true·비정수 → createApp 기동 throw', async () => {
    const { createApp } = await import('../app.js');
    const prev = process.env.TRUST_PROXY;
    try {
      for (const v of ['true', '1.5', 'loopback']) {
        process.env.TRUST_PROXY = v;
        expect(() => createApp(), v).toThrow(/TRUST_PROXY/);
      }
      process.env.TRUST_PROXY = '2';
      expect(createApp().get('trust proxy')).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = prev;
    }
  });

  it('L-7 읽기 리미터: GET /auth/session 121번째 → 429', async () => {
    const { createApp } = await import('../app.js');
    const { LIMITS } = await import('../middleware/rate-limit.js');
    expect(LIMITS.read).toEqual({ windowMs: 60 * 1000, limit: 120 });
    const a = createApp(undefined, { rateLimits: true, save: saveCfg });
    for (let i = 0; i < 120; i++) expect((await request(a).get('/auth/session')).status).toBe(200);
    expect((await request(a).get('/auth/session')).status).toBe(429);
    // 다른 읽기 경로도 같은 IP 의 read 버킷 — counts·save 도 이미 소진
    expect((await request(a).get('/api/save')).status).toBe(429);
    expect((await request(a).get('/api/reactions/counts').query({ targetType: 'PRODUCT', ids: 'a' })).status).toBe(429);
  });

  it('L-5: 운영(NODE_ENV 미설정 포함)에서 JWT 시크릿 32자 미만 → createApp throw', async () => {
    const { createApp } = await import('../app.js');
    const { makeInMemoryRepos } = await import('../db/repos.js');
    const keys = ['NODE_ENV', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'REACTION_KEY_SECRET', 'PUBLIC_ORIGIN'] as const;
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      delete process.env.NODE_ENV;
      process.env.PUBLIC_ORIGIN = 'https://w.test';
      process.env.REACTION_KEY_SECRET = 'r'.repeat(32);
      process.env.JWT_ACCESS_SECRET = 'short';
      process.env.JWT_REFRESH_SECRET = 'j'.repeat(32);
      expect(() => createApp(makeInMemoryRepos(), { clientDist: '__none__' })).toThrow(/JWT_ACCESS_SECRET/);
      process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
      expect(() => createApp(makeInMemoryRepos(), { clientDist: '__none__' })).not.toThrow();
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
});
