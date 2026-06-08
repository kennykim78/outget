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
