// spa.ts sendFile 오류 경로(QA141 m6 + 헤더 전송 뒤 매달림). 읽기 스트림을 모의해 OS·권한과 무관하게 재현한다.
//   (a) 헤더 전 오류 → 사용자 정의 404.html + 경로 CSP.  (b) 헤더 뒤 오류 → 소켓이 닫힌다(응답이 매달리지 않음).
//   (c) QA143 gap 1: 사전 압축 사본(.br/.gz, sendNegotiated) 경로 — 헤더 뒤 오류 → 소켓 닫힘, 헤더 전 오류 → 원본(identity) → 404.html.
//   매달림 판정(QA143 gap 2): 클라이언트 타임아웃(superagent: code ECONNABORTED 또는 err.timeout)이 아니고 1.5s 이내 종료.
//   이전 `not.toMatch(/timeout/i)` 는 code 가 먼저 읽혀 'timeout' 문자열을 볼 수 없어 무의미했다.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import fs, { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { securityHeaders } from '../middleware/security-headers.js';
import { mountSpa, SPA_CSP, VET_CSP } from '../middleware/spa.js';

function buildApp(): Express {
  const dist = join(mkdtempSync(join(tmpdir(), 'sfe-')), 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<html>idx</html>');
  writeFileSync(join(dist, 'inner.html'), '<p>inner-page ' + 'x'.repeat(50000) + '</p>');
  writeFileSync(join(dist, 'vinner.html'), '<p>vet-inner-page ' + 'x'.repeat(50000) + '</p>');
  writeFileSync(join(dist, '404.html'), '<p>not-found-page</p>');
  const routes = [
    { path: '/inner', file: 'inner.html', kind: 'HOME', indexable: false },
    { path: '/vet/inner', file: 'vinner.html', kind: 'VET', indexable: false },
    { path: '/404', file: '404.html', kind: 'NOT_FOUND', indexable: false },
  ];
  writeFileSync(join(dist, 'prerender-manifest.json'), JSON.stringify({ v: 1, seedDigest: 'a'.repeat(64), indexable: false, routes }));
  const app = express();
  app.use(securityHeaders);
  mountSpa(app, { clientDist: dist });
  return app;
}

/** 사전 압축 사본(.gz·.br)이 있는 dist — 난수 본문이라 압축해도 커서(>100KB) 첫 조각 뒤 오류면 응답이 끝나지 않는다. */
function buildVariantApp(): Express {
  const dist = join(mkdtempSync(join(tmpdir(), 'sfe-var-')), 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  const html = '<p>inner-page ' + randomBytes(120000).toString('base64') + '</p>';
  writeFileSync(join(dist, 'index.html'), '<html>idx</html>');
  writeFileSync(join(dist, 'inner.html'), html);
  writeFileSync(join(dist, 'inner.html.gz'), gzipSync(Buffer.from(html)));
  writeFileSync(join(dist, 'inner.html.br'), brotliCompressSync(Buffer.from(html)));
  const js = 'var a="' + randomBytes(120000).toString('base64') + '";';
  writeFileSync(join(dist, 'assets', 'app.js'), js);
  writeFileSync(join(dist, 'assets', 'app.js.gz'), gzipSync(Buffer.from(js)));
  writeFileSync(join(dist, '404.html'), '<p>not-found-page</p>');
  const routes = [
    { path: '/inner', file: 'inner.html', kind: 'HOME', indexable: false },
    { path: '/404', file: '404.html', kind: 'NOT_FOUND', indexable: false },
  ];
  writeFileSync(join(dist, 'prerender-manifest.json'), JSON.stringify({ v: 1, seedDigest: 'a'.repeat(64), indexable: false, routes }));
  const app = express();
  app.use(securityHeaders);
  mountSpa(app, { clientDist: dist });
  return app;
}

/**
 * re 에 맞는 파일만 모의 스트림으로 바꾼다(404.html 등 나머지는 실제).
 *   before: 첫 읽기에서 오류(헤더 전).  after: 첫 조각(실제 파일 앞 1000바이트)을 보낸 뒤 오류(헤더 뒤).
 */
function mockStream(mode: 'before' | 'after', re: RegExp = /inner\.html$/): void {
  const real = fs.createReadStream;
  vi.spyOn(fs, 'createReadStream').mockImplementation(((p: fs.PathLike, o?: unknown) => {
    if (re.test(String(p))) {
      let n = 0;
      return new Readable({
        read() {
          if (mode === 'before') {
            setImmediate(() => this.destroy(Object.assign(new Error('EIO probe'), { code: 'EIO' })));
          } else if (n++ === 0) {
            this.push(fs.readFileSync(String(p)).subarray(0, 1000));
          } else {
            setTimeout(() => this.destroy(Object.assign(new Error('EIO probe'), { code: 'EIO' })), 20);
          }
        },
      }) as unknown as fs.ReadStream;
    }
    return real(p, o as never);
  }) as typeof fs.createReadStream);
}

interface Hit {
  /** 'response <status> ce=<content-encoding>' 또는 'error <code|message>' */
  outcome: string;
  /** superagent 클라이언트 타임아웃으로 끝났는가(= 서버가 소켓을 닫지 않고 매달림). */
  clientTimeout: boolean;
  ms: number;
}

/** 본문을 끝까지 읽는다. 클라이언트 타임아웃 3s(판정 상한 1.5s 의 두 배). */
async function hit(a: Express, url: string, acceptEncoding?: string): Promise<Hit> {
  const t0 = Date.now();
  let outcome: string;
  let clientTimeout = false;
  try {
    let req = request(a).get(url);
    if (acceptEncoding !== undefined) req = req.set('Accept-Encoding', acceptEncoding);
    const r = await req
      .buffer(true)
      .parse((res, cb) => {
        const parts: Buffer[] = [];
        res.on('data', (c: Buffer) => parts.push(c));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      })
      .timeout(3000);
    outcome = `response ${r.status} ce=${String(r.headers['content-encoding'])}`;
  } catch (e) {
    const err = e as { code?: string; timeout?: number };
    // superagent 타임아웃 = code ECONNABORTED + timeout(ms) 속성. 서버가 소켓을 끊으면 ECONNRESET·aborted 등.
    clientTimeout = err.code === 'ECONNABORTED' || typeof err.timeout === 'number';
    outcome = `error ${err.code ?? (e as Error).message}`;
  }
  return { outcome, clientTimeout, ms: Date.now() - t0 };
}

let app: Express;
let varApp: Express;
beforeAll(() => {
  app = buildApp();
  varApp = buildVariantApp();
});
afterEach(() => vi.restoreAllMocks());

describe('spa — sendFile 오류', () => {
  it('헤더 전 오류 → 404 + 404.html 본문 + 경로 CSP(오류 무시 금지)', async () => {
    mockStream('before');
    for (const [p, csp] of [['/inner', SPA_CSP], ['/vet/inner', VET_CSP]] as const) {
      const r = await request(app).get(p);
      expect(r.status).toBe(404);
      expect(r.text).toContain('not-found-page');
      expect(r.text).not.toContain('inner-page');
      expect(r.headers['content-security-policy']).toBe(csp);
    }
  });

  it('헤더 뒤 오류 → 소켓이 닫혀 응답이 매달리지 않는다(1.5s 이내, 클라이언트 타임아웃 아님)', async () => {
    mockStream('after');
    // 선언한 Content-Length(5만 바이트)보다 적게 보낸 뒤 오류 — 소켓을 끊지 않으면 응답이 끝나지 않는다.
    const h = await hit(app, '/inner');
    expect(h.clientTimeout, h.outcome).toBe(false);
    expect(h.outcome).toMatch(/^error /);
    expect(h.ms, h.outcome).toBeLessThan(1500);
  });
});

describe('spa — 사전 압축 사본(.br/.gz) sendFile 오류(QA143 gap 1, sendNegotiated)', () => {
  it('정상: 사본 경로가 실제로 쓰인다(Content-Encoding gzip·br)', async () => {
    expect((await hit(varApp, '/inner', 'gzip')).outcome).toBe('response 200 ce=gzip');
    expect((await hit(varApp, '/inner', 'br')).outcome).toBe('response 200 ce=br');
    expect((await hit(varApp, '/assets/app.js', 'gzip')).outcome).toBe('response 200 ce=gzip');
  });

  for (const [name, url, ae, re] of [
    ['html .gz', '/inner', 'gzip', /inner\.html\.gz$/],
    ['html .br', '/inner', 'br', /inner\.html\.br$/],
    ['asset .gz', '/assets/app.js', 'gzip', /app\.js\.gz$/],
  ] as const) {
    it(`${name} 헤더 뒤 오류 → 소켓이 닫혀 1.5s 이내 종료(클라이언트 타임아웃 아님)`, async () => {
      mockStream('after', re);
      const h = await hit(varApp, url, ae);
      expect(h.clientTimeout, h.outcome).toBe(false);
      expect(h.outcome).toMatch(/^error /);
      expect(h.ms, h.outcome).toBeLessThan(1500);
    });
  }

  it('html .gz 헤더 전 오류 → 인코딩 헤더를 걷고 원본(identity) 200 + 경로 CSP', async () => {
    mockStream('before', /inner\.html\.gz$/);
    const r = await request(varApp).get('/inner').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(200);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.headers['etag'] ?? '').not.toMatch(/-gzip"$/);
    expect(r.text).toContain('inner-page');
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
  });

  it('html .gz + 원본 모두 헤더 전 오류 → 404 + 404.html + 경로 CSP', async () => {
    mockStream('before', /inner\.html(\.gz)?$/);
    const r = await request(varApp).get('/inner').set('Accept-Encoding', 'gzip');
    expect(r.status).toBe(404);
    expect(r.headers['content-encoding']).toBeUndefined();
    expect(r.text).toContain('not-found-page');
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
  });
});
