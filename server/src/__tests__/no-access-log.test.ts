import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 접속 기록 0(Kenny 2026-10-27 "접속 기록 남기지 않음", 처리방침 '웹 접속 기록: 남기지 않아요').
//   앞단 Caddy 는 deploy/Caddyfile(scripts/__tests__/deploy-config.test.mjs), 앱은 여기 —
//   ① 요청 로거 의존성·호출 0(정적)  ② 요청을 처리하면서 콘솔에 아무것도 쓰지 않는다(IP·요청 주소 포함 0, 런타임).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod-0000';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod-000';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = resolve(SRC, '..', 'package.json');
const CLIENT_IP = '198.51.100.77';
const PATH_MARK = 'secret-path-mark';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue;
      walk(p, out);
    } else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('정적: 요청 로거 0', () => {
  it('server 의존성에 요청 로거(morgan·pino-http·winston·express-winston·bunyan) 없음', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const bad of ['morgan', 'pino', 'pino-http', 'winston', 'express-winston', 'bunyan', 'express-pino-logger']) expect(deps, bad).not.toContain(bad);
  });

  it('소스(테스트 제외)의 콘솔·표준 출력 호출은 요청 정보(req.ip·url·headers·socket)를 담지 않는다', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (/from ['"](morgan|pino|pino-http|winston|express-winston)['"]/.test(l)) offenders.push(`${relative(SRC, f)}:${i + 1} import`);
        if (/(console\.\w+|process\.(stdout|stderr)\.write|\blog\()\s*\(?[^)]*\b(req|request)\.(ip|ips|url|originalUrl|path|headers|socket|get\()/.test(l)) {
          offenders.push(`${relative(SRC, f)}:${i + 1} ${l.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('런타임: 요청 처리 중 콘솔 출력 0', () => {
  let app: Express;
  const spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeAll(async () => {
    const { createApp } = await import('../app.js');
    // 운영과 같은 프록시 1홉 + 리미터 켬(429 경로 포함).
    app = createApp(undefined, { trustProxy: 1, rateLimits: true });
  });
  beforeEach(() => {
    for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => undefined));
  });
  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
  });

  it('정상·404·잘못된 본문·CORS 거부·429 응답 모두 로그 0줄', async () => {
    const xff = { 'X-Forwarded-For': CLIENT_IP };
    expect((await request(app).get('/health').set(xff)).status).toBe(200);
    expect((await request(app).get(`/api/${PATH_MARK}?q=1`).set(xff)).status).toBe(404);
    expect((await request(app).get('/api/vets').set(xff)).status).toBe(200);
    await request(app).post('/api/events').set(xff).set('Content-Type', 'application/json').send('{bad json');
    await request(app).post('/api/reactions').set(xff).set('Content-Type', 'application/json').send('x'.repeat(4096));
    const corsRejected = await request(app)
      .get('/health')
      .set(xff)
      .set('Origin', 'https://evil.example.com');
    expect(corsRejected.status).toBe(403);
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post('/auth/login').set(xff).send({ email: 'a@b.c', password: 'x' });
      if (r.status === 429) limited = true;
    }
    expect(limited).toBe(true);

    const written = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' ')));
    expect(written).toEqual([]);
    expect(written.join('\n')).not.toContain(CLIENT_IP);
    expect(written.join('\n')).not.toContain(PATH_MARK);
  });
});
