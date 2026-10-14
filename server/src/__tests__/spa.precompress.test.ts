// R6 F2a — 빌드 타임 사전 압축(prerender/compress.ts) + mountSpa 의 Accept-Encoding 협상.
//   dist 는 임시 디렉터리(실제 프리렌더 CLI, 승격 시드) + 합성 정적 자산. 원시 바이트는 node:http 로 받는다(자동 해제 없음).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { securityHeaders } from '../middleware/security-headers.js';
import { acceptedEncodings, mountSpa, SPA_CSP, VET_CSP } from '../middleware/spa.js';
import { precompressDir, PRECOMPRESS_MIN_BYTES } from '../prerender/compress.js';
import { runPrerenderCli } from '../prerender/cli.js';
import { FIXTURE_AS_OF, promoted, SEED_DIR, writeSeedDir } from './fixtures/prerender-seed.js';

const TEMPLATE = readFileSync(join(SEED_DIR, '..', '..', 'client', 'index.html'), 'utf8');
const temps: string[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-pc-${p}-`));
  temps.push(d);
  return d;
};

// 반복 텍스트(압축 잘 됨) — 1KB 이상.
const CSS = `.ws-a{color:#123456;margin:0 auto;padding:8px 12px}\n`.repeat(200);
const JS = `export const x${'y'.repeat(4)} = (a) => a.map((b) => b + 1);\n`.repeat(150);
const SMALL_JS = 'export const s = 1;\n';

async function buildDist(): Promise<string> {
  const out = tmp('dist');
  writeFileSync(join(out, 'index.html'), TEMPLATE);
  const seedDir = tmp('seed');
  writeSeedDir(seedDir, promoted());
  const err: string[] = [];
  const code = await runPrerenderCli(['--out', out, '--public-dir', tmp('pub'), '--now', FIXTURE_AS_OF, '--seed-dir', seedDir], {
    stdout: () => undefined,
    stderr: (l) => err.push(l),
    env: {},
    today: () => {
      throw new Error('test: --now 필수');
    },
  });
  if (code !== 0) throw new Error(`prerender 실패: ${err.join('\n')}`);
  mkdirSync(join(out, 'assets'), { recursive: true });
  writeFileSync(join(out, 'assets', 'index-abc.css'), CSS);
  writeFileSync(join(out, 'assets', 'index-abc.js'), JS);
  writeFileSync(join(out, 'assets', 'tiny.js'), SMALL_JS);
  writeFileSync(join(out, 'assets', 'font.woff2'), Buffer.alloc(4096, 7));
  return out;
}

function appFor(dist: string): Express {
  const app = express();
  app.use(securityHeaders);
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });
  mountSpa(app, { clientDist: dist });
  return app;
}

interface Raw {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let server: http.Server;
let port = 0;
function get(path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Raw> {
  return new Promise((ok, fail) => {
    // agent:false + Connection:close — keep-alive 소켓 재사용이 서버 keep-alive 타임아웃과 경쟁해 ECONNRESET 나는 플레이크 방지.
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { ...headers, Connection: 'close' }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  });
}
const decoded = (r: Raw): Buffer =>
  r.headers['content-encoding'] === 'br' ? brotliDecompressSync(r.body) : r.headers['content-encoding'] === 'gzip' ? gunzipSync(r.body) : r.body;

let dist: string;
beforeAll(async () => {
  dist = await buildDist();
  precompressDir(dist);
  const app = appFor(dist);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe('acceptedEncodings', () => {
  it('q 순서·동률 br 우선·q=0 거부·* 와 x-gzip·형식 오류', () => {
    expect(acceptedEncodings(undefined)).toEqual([]);
    expect(acceptedEncodings('')).toEqual([]);
    expect(acceptedEncodings('gzip, deflate, br, zstd')).toEqual(['br', 'gzip']);
    expect(acceptedEncodings('gzip')).toEqual(['gzip']);
    expect(acceptedEncodings('br;q=0, gzip')).toEqual(['gzip']);
    expect(acceptedEncodings('br;q=0.5, gzip;q=0.8')).toEqual(['gzip', 'br']);
    expect(acceptedEncodings('identity')).toEqual([]);
    expect(acceptedEncodings('*')).toEqual(['br', 'gzip']);
    expect(acceptedEncodings('*;q=0, gzip')).toEqual(['gzip']);
    expect(acceptedEncodings('x-gzip')).toEqual(['gzip']);
    expect(acceptedEncodings('BR')).toEqual(['br']);
    expect(acceptedEncodings('br;q=abc, gzip;q=2')).toEqual([]);
    expect(acceptedEncodings(['gzip', 'br'])).toEqual(['br', 'gzip']);
  });
});

describe('precompressDir', () => {
  it('대상 확장자 ≥1KB 만 .br/.gz, 해제 = 원본, 작은 파일·woff2 제외', () => {
    for (const f of ['index.html', '404.html', 'hamster/golden/index.html', 'assets/index-abc.css', 'assets/index-abc.js']) {
      const src = readFileSync(join(dist, f));
      expect(src.length, f).toBeGreaterThanOrEqual(PRECOMPRESS_MIN_BYTES);
      expect(brotliDecompressSync(readFileSync(join(dist, `${f}.br`))).equals(src), f).toBe(true);
      expect(gunzipSync(readFileSync(join(dist, `${f}.gz`))).equals(src), f).toBe(true);
    }
    expect(existsSync(join(dist, 'assets', 'tiny.js.br'))).toBe(false);
    expect(existsSync(join(dist, 'assets', 'font.woff2.br'))).toBe(false);
    expect(existsSync(join(dist, 'robots.txt.br'))).toBe(false); // < 1KB
    expect(existsSync(join(dist, 'shell.html.br'))).toBe(false); // 테스트 템플릿 셸 < 1KB
  });

  it('재실행: 같은 바이트(결정론), 고아·낡은 사본 제거', () => {
    const d = tmp('re');
    writeFileSync(join(d, 'a.css'), CSS);
    writeFileSync(join(d, 'gone.js.br'), 'stale');
    writeFileSync(join(d, 'keep.tar.gz'), 'not ours');
    const r1 = precompressDir(d);
    expect(r1.removed).toBe(1);
    expect(existsSync(join(d, 'gone.js.br'))).toBe(false);
    expect(existsSync(join(d, 'keep.tar.gz'))).toBe(true);
    const b1 = readFileSync(join(d, 'a.css.br'));
    const g1 = readFileSync(join(d, 'a.css.gz'));
    const r2 = precompressDir(d);
    expect(r2.removed).toBe(2);
    expect(readFileSync(join(d, 'a.css.br')).equals(b1)).toBe(true);
    expect(readFileSync(join(d, 'a.css.gz')).equals(g1)).toBe(true);
    expect(readdirSync(d).sort()).toEqual(['a.css', 'a.css.br', 'a.css.gz', 'keep.tar.gz']);
    expect(r2.entries[0].br).toBeLessThan(CSS.length / 10);
  });
});

describe('mountSpa 협상', () => {
  it('정적 JS/CSS: br·gzip·없음 — 본문·Content-Type·Vary·ETag', async () => {
    for (const f of ['/assets/index-abc.js', '/assets/index-abc.css']) {
      const orig = readFileSync(join(dist, f));
      const id = await get(f);
      expect(id.status).toBe(200);
      expect(id.headers['content-encoding']).toBeUndefined();
      expect(id.headers.vary).toMatch(/Accept-Encoding/);
      expect(id.body.equals(orig)).toBe(true);
      const br = await get(f, { 'Accept-Encoding': 'gzip, deflate, br' });
      expect(br.headers['content-encoding']).toBe('br');
      expect(br.headers.vary).toMatch(/Accept-Encoding/);
      expect(br.headers['content-type']).toBe(id.headers['content-type']);
      expect(br.headers['cache-control']).toBe(id.headers['cache-control']);
      expect(Number(br.headers['content-length'])).toBe(br.body.length);
      expect(br.body.length).toBeLessThan(orig.length / 5);
      expect(decoded(br).equals(orig)).toBe(true);
      const gz = await get(f, { 'Accept-Encoding': 'gzip' });
      expect(gz.headers['content-encoding']).toBe('gzip');
      expect(decoded(gz).equals(orig)).toBe(true);
      const etags = new Set([id.headers.etag, br.headers.etag, gz.headers.etag]);
      expect(etags.size).toBe(3);
      // 인코딩 접미사 — 사본 크기·mtime 이 우연히 같아도 br·gz ETag 가 갈리게
      expect(br.headers.etag).toMatch(/-br"$/);
      expect(gz.headers.etag).toMatch(/-gzip"$/);
      expect((await get(f, { 'Accept-Encoding': 'br;q=0, gzip' })).headers['content-encoding']).toBe('gzip');
      expect((await get(f, { 'Accept-Encoding': 'identity' })).headers['content-encoding']).toBeUndefined();
    }
    expect((await get('/assets/index-abc.js', { 'Accept-Encoding': 'br' })).headers['content-type']).toMatch(/^application\/javascript/);
    expect((await get('/assets/index-abc.css', { 'Accept-Encoding': 'br' })).headers['content-type']).toMatch(/^text\/css/);
  });

  it('조건부 요청: br ETag → 304, HEAD 는 본문 없이 같은 헤더', async () => {
    const br = await get('/assets/index-abc.js', { 'Accept-Encoding': 'br' });
    const nm = await get('/assets/index-abc.js', { 'Accept-Encoding': 'br', 'If-None-Match': String(br.headers.etag) });
    expect(nm.status).toBe(304);
    // 다른 인코딩의 ETag 로는 304 아님
    expect((await get('/assets/index-abc.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': String(br.headers.etag) })).status).toBe(200);
    const head = await get('/assets/index-abc.js', { 'Accept-Encoding': 'br' }, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.body.length).toBe(0);
  });

  it('사본 없음(작은 파일·woff2) → 원본, Vary·Content-Encoding 없음', async () => {
    for (const f of ['/assets/tiny.js', '/assets/font.woff2']) {
      const r = await get(f, { 'Accept-Encoding': 'br, gzip' });
      expect(r.status).toBe(200);
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.headers.vary).toBeUndefined();
      expect(r.body.equals(readFileSync(join(dist, f)))).toBe(true);
    }
  });

  it('HTML 라우트(/ · /hamster/golden · /vet · 404): br 본문 = 프리렌더 파일, CSP·상태 불변', async () => {
    const cases: Array<[string, string, number, string]> = [
      ['/', 'index.html', 200, SPA_CSP],
      ['/hamster/golden', 'hamster/golden/index.html', 200, SPA_CSP],
      ['/vet', 'vet/index.html', 200, VET_CSP],
      ['/save', 'save/index.html', 200, SPA_CSP],
      ['/nope', '404.html', 404, SPA_CSP],
      ['/%2e%2e/secret.js', '404.html', 404, SPA_CSP], // 이탈 시도 → 404 HTML(압축본도 404.html 그 자체)
    ];
    for (const [p, file, status, csp] of cases) {
      const orig = readFileSync(join(dist, file));
      const id = await get(p);
      const br = await get(p, { 'Accept-Encoding': 'gzip, deflate, br, zstd' });
      const gz = await get(p, { 'Accept-Encoding': 'gzip' });
      for (const r of [id, br, gz]) {
        expect(r.status, p).toBe(status);
        expect(r.headers['content-security-policy'], p).toBe(csp);
        expect(r.headers['content-type'], p).toBe(id.headers['content-type']);
        expect(r.headers['x-frame-options'], p).toBe('DENY');
        expect(r.headers.vary, p).toMatch(/Accept-Encoding/);
        expect(decoded(r).equals(orig), p).toBe(true);
      }
      expect(id.headers['content-encoding'], p).toBeUndefined();
      expect(br.headers['content-encoding'], p).toBe('br');
      expect(gz.headers['content-encoding'], p).toBe('gzip');
      expect(br.headers['content-type']).toMatch(/^text\/html/);
    }
  });

  it('사본 없는 HTML(1KB 미만 셸 직접 요청) → 원본 그대로, Vary 없음', async () => {
    const r = await get('/shell.html', { 'Accept-Encoding': 'br, gzip' });
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.headers.vary).toBeUndefined();
    expect(r.body.equals(readFileSync(join(dist, 'shell.html')))).toBe(true);
  });

  it('/index.html 직접(정적) 도 같은 규칙, API 는 대상 아님', async () => {
    const r = await get('/index.html', { 'Accept-Encoding': 'br' });
    expect(r.headers['content-encoding']).toBe('br');
    expect(r.headers['content-security-policy']).toBe("default-src 'none'"); // 기존 정적 서빙 CSP 그대로
    const api = await get('/api/ping', { 'Accept-Encoding': 'br, gzip' });
    expect(api.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(api.body.toString('utf8'))).toEqual({ ok: true });
  });

  it('낡은 사본(원본이 나중에 바뀜) → 보내지 않고 원본', async () => {
    const d = await buildDist();
    precompressDir(d);
    const css = join(d, 'assets', 'index-abc.css');
    const changed = `${CSS}/* v2 */\n`;
    writeFileSync(css, changed);
    const app = appFor(d);
    const s = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => s.once('listening', () => r()));
    const save = port;
    port = (s.address() as AddressInfo).port;
    try {
      const r = await get('/assets/index-abc.css', { 'Accept-Encoding': 'br, gzip' });
      expect(r.headers['content-encoding']).toBeUndefined();
      expect(r.body.toString('utf8')).toBe(changed);
      // 프리렌더 HTML 도: 원본 교체 + mtime 을 사본과 같게 맞춰도 내용 검증으로 걸러진다
      const home = join(d, 'index.html');
      const brStat = statSync(`${home}.br`);
      writeFileSync(home, readFileSync(home, 'utf8').replace('</body>', '<!-- x --></body>'));
      utimesSync(home, brStat.atime, brStat.mtime);
      const h = await get('/', { 'Accept-Encoding': 'br, gzip' });
      expect(h.headers['content-encoding']).toBeUndefined();
      expect(h.body.equals(readFileSync(home))).toBe(true);
    } finally {
      port = save;
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('변형 캐시 서명: 사본을 한 번 제공(캐시)한 뒤 원본이 같은 크기로 바뀌고 mtime 이 달라지면 낡은 사본을 보내지 않는다', async () => {
    const d = await buildDist();
    precompressDir(d);
    const css = join(d, 'assets', 'index-abc.css');
    const before = readFileSync(css, 'utf8');
    const app = appFor(d);
    const s = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => s.once('listening', () => r()));
    const save = port;
    port = (s.address() as AddressInfo).port;
    try {
      const first = await get('/assets/index-abc.css', { 'Accept-Encoding': 'br' });
      expect(first.headers['content-encoding']).toBe('br'); // 검증 결과가 캐시에 들어간다
      expect(decoded(first).toString('utf8')).toBe(before);
      const changed = before.replace(/#123456/g, '#654321'); // 같은 길이, 다른 내용
      expect(changed.length).toBe(before.length);
      expect(changed).not.toBe(before);
      writeFileSync(css, changed);
      const future = new Date(Date.now() + 60_000);
      utimesSync(css, future, future); // mtime 변경(사본은 그대로)
      const second = await get('/assets/index-abc.css', { 'Accept-Encoding': 'br' });
      expect(second.headers['content-encoding']).toBeUndefined();
      expect(second.body.toString('utf8')).toBe(changed);
    } finally {
      port = save;
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it('역슬래시·dot 세그먼트 경로는 정적 압축 대상 아님(기존 거부·404 동작)', async () => {
    writeFileSync(join(dist, 'assets', '.hidden.js'), JS);
    precompressDir(dist);
    for (const p of ['/assets/..%5cindex-abc.js', '/assets/.hidden.js', '/assets/%2ehidden.js']) {
      const r = await get(p, { 'Accept-Encoding': 'br' });
      expect([403, 404], p).toContain(r.status);
      expect(decoded(r).toString('utf8'), p).not.toContain('export const');
    }
  });
});
