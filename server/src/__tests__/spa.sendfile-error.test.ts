// spa.ts sendFile 오류 경로(QA141 m6 + 헤더 전송 뒤 매달림). 읽기 스트림을 모의해 OS·권한과 무관하게 재현한다.
//   (a) 헤더 전 오류 → 사용자 정의 404.html + 경로 CSP.  (b) 헤더 뒤 오류 → 소켓이 닫힌다(응답이 매달리지 않음).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import fs, { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** inner/vinner 파일만 모의 스트림으로 바꾼다(404.html 등 나머지는 실제). */
function mockStream(mode: 'before' | 'after'): void {
  const real = fs.createReadStream;
  vi.spyOn(fs, 'createReadStream').mockImplementation(((p: fs.PathLike, o?: unknown) => {
    if (/inner\.html$/.test(String(p))) {
      let n = 0;
      return new Readable({
        read() {
          if (mode === 'before') {
            setImmediate(() => this.destroy(Object.assign(new Error('EIO probe'), { code: 'EIO' })));
          } else if (n++ === 0) {
            this.push(Buffer.from('<p>inner-page partial'));
          } else {
            setTimeout(() => this.destroy(Object.assign(new Error('EIO probe'), { code: 'EIO' })), 20);
          }
        },
      }) as unknown as fs.ReadStream;
    }
    return real(p, o as never);
  }) as typeof fs.createReadStream);
}

let app: Express;
beforeAll(() => {
  app = buildApp();
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

  it('헤더 뒤 오류 → 소켓이 닫혀 응답이 매달리지 않는다(~1s 이내)', async () => {
    mockStream('after');
    const t0 = Date.now();
    let outcome = 'ended';
    try {
      const r = await request(app).get('/inner').timeout(3000);
      // 선언한 Content-Length(5만 바이트)보다 적게 보낸 뒤 오류 — 소켓을 끊지 않으면 응답이 끝나지 않는다.
      outcome = `response ${r.status}`;
    } catch (e) {
      outcome = `error ${(e as { code?: string }).code ?? (e as Error).message}`;
    }
    expect(outcome).not.toMatch(/timeout/i);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
