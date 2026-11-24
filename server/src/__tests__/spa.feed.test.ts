// 362 N11 — spa.ts 피드 변형 선택(353 §6-3)·직접 요청 차단·피드 JSON 만료 404·WS_FEED_IMG_HOSTS CSP(353 §7).
//   dist 는 손으로 만든 최소 산출물(prerender-manifest·feed-manifest·변형 파일) — 서버는 파일 선택만 한다(외부 호출 0).
import { afterAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { securityHeaders } from '../middleware/security-headers.js';
import { cspForPath, mountSpa, parseFeedImgHosts, SPA_CSP, spaCsp, VET_CSP } from '../middleware/spa.js';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;
const T = 'hamster/golden';
const W = `${T}/supplies/wheel`;

function put(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

interface DistOpts {
  feedManifest?: string | null;
  full?: boolean;
}
function dist(o: DistOpts = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-spa-feed-'));
  temps.push(d);
  const full = o.full ?? true;
  put(d, 'index.html', 'HOME-DEFAULT');
  put(d, '404.html', 'NOT-FOUND-PAGE');
  put(d, `${T}/index.html`, 'TYPE-DEFAULT');
  put(d, `${W}/index.html`, 'WHEEL-DEFAULT');
  put(d, '/vet/index.html', 'VET-DEFAULT');
  const routes = [
    { path: '/', file: 'index.html', kind: 'HOME' },
    { path: '/hamster/golden', file: `${T}/index.html`, kind: 'TYPE' },
    { path: '/hamster/golden/supplies/wheel', file: `${W}/index.html`, kind: 'SUPPLY_ITEM_TYPE' },
    { path: '/vet', file: 'vet/index.html', kind: 'VET' },
    { path: '/404', file: '404.html', kind: 'NOT_FOUND' },
  ];
  put(d, 'prerender-manifest.json', JSON.stringify({ v: 1, routes }));
  if (full) {
    put(d, `${T}/index.feed.html`, 'TYPE-FULL');
    put(d, `${W}/index.feed.html`, 'WHEEL-FULL');
    put(d, `${T}/feed/wheel.json`, '{"stage":"full"}');
  }
  put(d, `${T}/index.feed-noprice.html`, 'TYPE-NOPRICE');
  put(d, `${W}/index.feed-noprice.html`, 'WHEEL-NOPRICE');
  put(d, `${T}/feed/wheel.noprice.json`, '{"stage":"noprice"}');
  put(d, `${T}/feed/stale.json`, '{"stage":"stale"}'); // manifest 목록 밖 잔재
  const man = {
    v: 1,
    generatedAt: GEN,
    priceUntil: '2026-11-26T09:12:00+09:00',
    blockUntil: '2026-11-30T09:12:00+09:00',
    variants: { full: full ? [`${T}/feed/wheel.json`] : [], noprice: [`${T}/feed/wheel.noprice.json`] },
    pages: { full: full ? [`${T}/index.feed.html`, `${W}/index.feed.html`] : [], noprice: [`${T}/index.feed-noprice.html`, `${W}/index.feed-noprice.html`] },
  };
  if (o.feedManifest !== null) put(d, 'feed-manifest.json', o.feedManifest ?? JSON.stringify(man));
  return d;
}

function appFor(d: string, now: number, env: Record<string, string> = {}): Express {
  const app = express();
  app.use(securityHeaders);
  mountSpa(app, { clientDist: d, nowMs: () => now, env });
  return app;
}

const get = async (app: Express, p: string): Promise<{ status: number; text: string; csp: string | undefined }> => {
  const r = await request(app).get(p);
  return { status: r.status, text: r.text, csp: r.headers['content-security-policy'] as string | undefined };
};

describe('N11 피드 변형 선택', () => {
  it('full 단계(≤72h) → full 변형, 홈은 기본(변형 없음)', async () => {
    const app = appFor(dist(), GEN_MS + H);
    expect((await get(app, '/hamster/golden')).text).toBe('TYPE-FULL');
    expect((await get(app, '/hamster/golden/supplies/wheel')).text).toBe('WHEEL-FULL');
    expect((await get(app, '/')).text).toBe('HOME-DEFAULT');
  });

  it('full 단계인데 full 변형 없음(빌드가 −80h) → noprice 로 대체', async () => {
    const app = appFor(dist({ full: false }), GEN_MS + H);
    expect((await get(app, '/hamster/golden')).text).toBe('TYPE-NOPRICE');
  });

  it('noprice 단계(72h<·≤168h) → noprice 변형, 경계 72h 는 full', async () => {
    const d = dist();
    expect((await get(appFor(d, GEN_MS + 72 * H), '/hamster/golden')).text).toBe('TYPE-FULL');
    expect((await get(appFor(d, GEN_MS + 72 * H + 1), '/hamster/golden')).text).toBe('TYPE-NOPRICE');
    expect((await get(appFor(d, GEN_MS + 168 * H), '/hamster/golden/supplies/wheel')).text).toBe('WHEEL-NOPRICE');
  });

  it('nofeed(168h 초과)·manifest 없음·손상 → 기본 파일(피드 꺼짐과 같은 응답)', async () => {
    expect((await get(appFor(dist(), GEN_MS + 168 * H + 1), '/hamster/golden')).text).toBe('TYPE-DEFAULT');
    expect((await get(appFor(dist({ feedManifest: null }), GEN_MS + H), '/hamster/golden')).text).toBe('TYPE-DEFAULT');
    for (const bad of ['{ not json', '{"v":2}', JSON.stringify({ v: 1, generatedAt: 'x', variants: { full: [], noprice: [] }, pages: { full: [], noprice: [] } }), JSON.stringify({ v: 1, generatedAt: GEN, variants: { full: [], noprice: [] }, pages: { full: ['../out.html'], noprice: [] } })]) {
      expect((await get(appFor(dist({ feedManifest: bad }), GEN_MS + H), '/hamster/golden')).text, bad).toBe('TYPE-DEFAULT');
    }
  });

  it('변형 HTML 직접 요청 → 404(대소문자·압축본·인코딩 우회 포함)', async () => {
    const app = appFor(dist(), GEN_MS + H);
    for (const p of [`/${T}/index.feed.html`, `/${T}/index.feed-noprice.html`, `/${T}/index.feed.html.br`, `/${T}/INDEX.FEED.HTML`, `/${T}/index%2efeed.html`, `/${T}/index.feed.html.`]) {
      const r = await get(app, p);
      expect(r.status, p).toBe(404);
      expect(r.text, p).not.toMatch(/FULL|NOPRICE/);
    }
  });

  it('피드 JSON: full 은 full 단계만, noprice 는 168h 까지, 목록 밖·만료·manifest 없음 → 404', async () => {
    const d = dist();
    const at = (h: number) => appFor(d, GEN_MS + h * H);
    expect((await get(at(1), `/${T}/feed/wheel.json`)).status).toBe(200);
    expect((await get(at(1), `/${T}/feed/wheel.noprice.json`)).status).toBe(200);
    expect((await get(at(80), `/${T}/feed/wheel.json`)).status).toBe(404);
    expect((await get(at(80), `/${T}/feed/wheel.noprice.json`)).status).toBe(200);
    expect((await get(at(169), `/${T}/feed/wheel.noprice.json`)).status).toBe(404);
    expect((await get(at(1), `/${T}/feed/stale.json`)).status).toBe(404);
    expect((await get(at(1), `/${T}/FEED/wheel.json`)).status).toBe(404);
    expect((await get(appFor(dist({ feedManifest: null }), GEN_MS + H), `/${T}/feed/wheel.noprice.json`)).status).toBe(404);
    expect((await get(appFor(dist({ feedManifest: '{ bad' }), GEN_MS + H), `/${T}/feed/wheel.noprice.json`)).status).toBe(404);
  });
});

describe('N11 WS_FEED_IMG_HOSTS', () => {
  it('빈 값(기본) → SPA_CSP 바이트 동일, VET_CSP 불변', async () => {
    expect(parseFeedImgHosts(undefined)).toEqual([]);
    expect(parseFeedImgHosts(' , ')).toEqual([]);
    expect(spaCsp([])).toBe(SPA_CSP);
    expect(cspForPath('/hamster/golden')).toBe(SPA_CSP);
    const app = appFor(dist(), GEN_MS + H);
    expect((await get(app, '/hamster/golden')).csp).toBe(SPA_CSP);
    expect((await get(app, '/vet')).csp).toBe(VET_CSP);
  });

  it('FEED_IMAGE_HOSTS 안 값 → SPA img-src 에만 https://호스트 추가, VET 불변', async () => {
    const app = appFor(dist(), GEN_MS + H, { WS_FEED_IMG_HOSTS: 'ae01.alicdn.com' });
    const csp = (await get(app, '/hamster/golden')).csp ?? '';
    expect(csp).toContain("img-src 'self' data: blob: https://ae01.alicdn.com;");
    expect(csp.replace(' https://ae01.alicdn.com', '')).toBe(SPA_CSP);
    expect((await get(app, '/vet')).csp).toBe(VET_CSP);
    expect((await get(app, '/nope')).csp).toBe(csp);
  });

  it('상수 밖 값 → 기동 거부(throw)', () => {
    for (const v of ['*', 'https:', 'evil.example', 'https://ae01.alicdn.com', 'ae01.alicdn.com:443', '*.alicdn.com', 'ae01.alicdn.com,evil.example']) {
      expect(() => parseFeedImgHosts(v), v).toThrow(/기동 거부/);
      expect(() => appFor(dist(), GEN_MS + H, { WS_FEED_IMG_HOSTS: v }), v).toThrow(/기동 거부/);
    }
  });
});
