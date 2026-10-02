// CORS 범위·동일 오리진(QA S0 회귀) — CORS_ORIGIN 미설정 단일 컨테이너 배포에서
//   Vite crossorigin 자산(/assets/*, Origin=자기 오리진)이 403 되어 빈 화면이 되던 결함.
//   교차 오리진 API 는 허용목록 밖이면 계속 403(기존 의미), 허용목록 오리진은 계속 허용.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';

const HOST = 'withsmall.test';
const SELF = `http://${HOST}`;
const EVIL = 'http://evil.example';
const SELF_TLS = `https://${HOST}`;
const SELF_OTHER_PORT = `${SELF}:8080`;
const SUBDOMAIN = `http://api.${HOST}`;
const SELF_WITH_PATH = `${SELF}/path`;
const ALLOWED = 'https://allowed.example.com';
const SK = '3f2b8c1e-9a4d-4c7e-8f10-2b3c4d5e6f70';

let dist: string;

function appWith(corsOrigin: string | undefined): Express {
  const prev = process.env.CORS_ORIGIN;
  if (corsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = corsOrigin;
  try {
    return createApp(makeInMemoryRepos(), { clientDist: dist });
  } finally {
    if (prev === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = prev;
  }
}

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), 'ws-cors-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'x.js'), 'export const x = 1;\n');
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>t</title><div id="root"></div>');
});

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('CORS_ORIGIN 미설정 — 정적 자산(동일 오리진 crossorigin)', () => {
  it('(a) GET /assets/x.js, Origin = 자기 오리진 → 200(정적 서빙), 403 아님', async () => {
    const app = appWith(undefined);
    const res = await request(app).get('/assets/x.js').set('Host', HOST).set('Origin', SELF);
    expect(res.status).toBe(200);
    expect(res.text).toContain('export const x');
  });

  it('(a) 없는 자산도 403 아님(정적/SPA 폴백 처리 — manifest 없는 dist 는 기존 spa.ts 동작대로 index 폴백)', async () => {
    const app = appWith(undefined);
    const res = await request(app).get('/assets/missing.js').set('Host', HOST).set('Origin', SELF);
    expect(res.status).not.toBe(403);
    expect([200, 404]).toContain(res.status);
    expect(res.text).not.toContain('export const x');
  });

  it('정적 자산은 CORS 대상 밖 — 교차 오리진에 ACAO 를 주지 않는다(브라우저가 읽기 차단)', async () => {
    const app = appWith(undefined);
    const res = await request(app).get('/assets/x.js').set('Host', HOST).set('Origin', EVIL);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('CORS_ORIGIN 미설정 — API', () => {
  it('(b) GET /api/vets, Origin = evil → 403 cors_forbidden, evil 에 ACAO 없음', async () => {
    const app = appWith(undefined);
    const res = await request(app).get('/api/vets').set('Host', HOST).set('Origin', EVIL);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'cors_forbidden' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('동일 오리진 POST(브라우저는 Origin 동봉) → 허용: /api/events 204', async () => {
    const app = appWith(undefined);
    const res = await request(app)
      .post('/api/events')
      .set('Host', HOST)
      .set('Origin', SELF)
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify({ events: [{ name: 'vet_clicked', ts: 1_790_000_000_000, sessionKey: SK, props: { clinicId: 'vc-mapo-01', action: 'call' } }] }));
    expect(res.status).toBe(204);
  });

  it('TLS 종단 프록시 뒤(Origin https, req.protocol http) 동일 호스트 → 허용', async () => {
    const app = appWith(undefined);
    const res = await request(app).get('/api/vets').set('Host', HOST).set('Origin', SELF_TLS);
    expect(res.status).toBe(200);
  });

  it('호스트·포트가 다르거나 X-Forwarded-Host 로 맞춘 척하면 거부', async () => {
    const app = appWith(undefined);
    const port = await request(app).get('/api/vets').set('Host', HOST).set('Origin', SELF_OTHER_PORT);
    expect(port.status).toBe(403);
    const sub = await request(app).get('/api/vets').set('Host', HOST).set('Origin', SUBDOMAIN);
    expect(sub.status).toBe(403);
    const xfh = await request(app)
      .get('/api/vets')
      .set('Host', HOST)
      .set('X-Forwarded-Host', 'evil.example')
      .set('Origin', EVIL);
    expect(xfh.status).toBe(403);
    const weird = await request(app).get('/api/vets').set('Host', HOST).set('Origin', SELF_WITH_PATH);
    expect(weird.status).toBe(403);
    const nul = await request(app).get('/api/vets').set('Host', HOST).set('Origin', 'null');
    expect(nul.status).toBe(403);
  });

  it('/auth·/health 도 같은 규칙(교차 오리진 403, Origin 없음 허용)', async () => {
    const app = appWith(undefined);
    expect((await request(app).get('/health').set('Host', HOST).set('Origin', EVIL)).status).toBe(403);
    expect((await request(app).post('/auth/login').set('Host', HOST).set('Origin', EVIL).send({})).status).toBe(403);
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('CORS_ORIGIN 설정 — 허용목록', () => {
  it('(c) 허용목록 오리진 → 200 + ACAO = 그 오리진', async () => {
    const app = appWith(ALLOWED);
    const res = await request(app).get('/api/vets').set('Host', HOST).set('Origin', ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('허용목록이 있어도 목록 밖 교차 오리진은 403', async () => {
    const app = appWith(ALLOWED);
    const res = await request(app).get('/api/vets').set('Host', HOST).set('Origin', EVIL);
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
