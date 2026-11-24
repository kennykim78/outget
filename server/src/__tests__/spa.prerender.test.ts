// R3 F4 — spa.ts 프리렌더 서빙(manifest 모드, D16): 경로 정규화·후행 슬래시 301·manifest 라우트·/save 셸·404·경로 이탈.
//   dist 는 임시 디렉터리에 CLI 로 만든다(실시드 / 메모리 승격 시드).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { securityHeaders } from '../middleware/security-headers.js';
import { cspForPath, mountSpa, normalizeRequestPath, SPA_CSP, VET_CSP } from '../middleware/spa.js';
import { runPrerenderCli } from '../prerender/cli.js';
import { FIXTURE_AS_OF, promoted, SEED_DIR, writeSeedDir } from './fixtures/prerender-seed.js';

const TEMPLATE = readFileSync(join(SEED_DIR, '..', '..', 'client', 'index.html'), 'utf8');
const temps: string[] = [];
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-spa-${p}-`));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

async function prerendered(seedDir?: string): Promise<string> {
  const out = tmp('dist');
  writeFileSync(join(out, 'index.html'), TEMPLATE);
  const argv = ['--out', out, '--public-dir', tmp('pub'), '--now', FIXTURE_AS_OF, ...(seedDir ? ['--seed-dir', seedDir] : [])];
  const err: string[] = [];
  const code = await runPrerenderCli(argv, { stdout: () => undefined, stderr: (l) => err.push(l), env: {}, today: () => {
    throw new Error('test: --now 필수(실시계 결합 0)');
  } });
  if (code !== 0) throw new Error(`prerender 실패: ${err.join('\n')}`);
  // 경로 이탈 표적(dist 밖)
  writeFileSync(join(out, '..', `${out.split(/[\\/]/).pop()}-secret.env`), 'SECRET=1');
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

describe('normalizeRequestPath', () => {
  it('정상 경로·한글 percent-encode·NFD → NFC', () => {
    expect(normalizeRequestPath('/')).toEqual({ kind: 'ok', path: '/' });
    expect(normalizeRequestPath('/hamster/golden')).toEqual({ kind: 'ok', path: '/hamster/golden' });
    expect(normalizeRequestPath(`/vet/${encodeURIComponent('서울-마포구')}`)).toEqual({ kind: 'ok', path: '/vet/서울-마포구' });
    expect(normalizeRequestPath(`/vet/${encodeURIComponent('서울-마포구'.normalize('NFD'))}`)).toEqual({ kind: 'ok', path: '/vet/서울-마포구' });
  });
  it('후행 슬래시 → 301 대상', () => {
    expect(normalizeRequestPath('/hamster/golden/')).toEqual({ kind: 'redirect', location: '/hamster/golden' });
    expect(normalizeRequestPath(`/vet/${encodeURIComponent('서울-마포구')}/`)).toEqual({ kind: 'redirect', location: `/vet/${encodeURIComponent('서울-마포구')}` });
  });
  it('이탈·우회·허용 밖 문자 → bad', () => {
    for (const p of [
      '/../server/.env',
      '/%2e%2e/server/.env',
      '/%2E%2E/x',
      '/%2e%2e%2fserver%2f.env',
      '/vet/%5c..%5cserver',
      '/vet/%5cserver',
      '/a%00b',
      '/a%2520b',
      '/Hamster',
      '/a b',
      '//evil.example',
      '/a//b',
      '/%',
      '/%e0%a4%a',
      '/x.html',
      '///',
    ]) {
      expect(normalizeRequestPath(p).kind, p).toBe('bad');
    }
  });
});

describe('spa — 실시드 dist(manifest 있음)', () => {
  let app: Express;
  beforeAll(async () => {
    app = appFor(await prerendered());
  }, 60_000);

  it('/ → 200 프리렌더 + SPA_CSP', async () => {
    const r = await request(app).get('/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('data-ws-prerendered="1"');
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
  });

  it('/hamster/golden·/hamster/dwarf·/guinea-pig·/gerbil·/parrot/*·/hamster/robo → 200(2026-11-16 서명 + 2026-11-23 9종 활성화) · 시드에 없는 종 경로 → 404 + 404.html 본문', async () => {
    for (const p of ['/hamster/golden', '/hamster/dwarf', '/guinea-pig', '/gerbil', '/parrot/budgie', '/parrot/cockatiel', '/parrot/lovebird-peach', '/parrot/sun-conure', '/hamster/robo']) {
      const g = await request(app).get(p);
      expect([p, g.status]).toEqual([p, 200]);
      expect(g.text).toContain('data-ws-prerendered="1"');
      expect(g.text).not.toContain('data-ws-route="NOT_FOUND"');
      expect(g.headers['content-security-policy']).toBe(SPA_CSP);
    }
    // 356: 저빌은 ACTIVE(GENERAL_INFO)가 되어 200 — 404 확인은 시드에 없는 종 경로로 옮긴다.
    for (const p of ['/rabbit', '/parrot/macaw', '/hamster/campbell']) {
      const r = await request(app).get(p);
      expect([p, r.status]).toEqual([p, 404]);
      expect(r.text).toContain('data-ws-route="NOT_FOUND"');
      expect(r.headers['content-security-policy']).toBe(SPA_CSP);
    }
  });

  it('/save → 200(R5 D11: 프리렌더면 noindex, 아니면 셸) + 기본 CSP', async () => {
    const r = await request(app).get('/save');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
    if (r.text.includes('data-ws-prerendered')) expect(r.text).toMatch(/<meta name="robots" content="[^"]*noindex/);
    else expect(r.text).toContain('<!--ws:body-->');
  });

  it('/supplies·/vet → 200, /404 → 404', async () => {
    expect((await request(app).get('/supplies')).status).toBe(200);
    expect((await request(app).get('/vet')).status).toBe(200);
    expect((await request(app).get('/404')).status).toBe(404);
  });

  it('후행 슬래시 301(쿼리 보존)', async () => {
    const r = await request(app).get('/supplies/?a=1');
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe('/supplies?a=1');
  });

  it('경로 이탈·인코딩 우회 → 404, dist 밖 파일 내용 없음', async () => {
    for (const p of ['/../server/.env', '/%2e%2e/server/.env', '/%2e%2e%2fserver%2f.env', '/vet/%5c..%5cserver', '/..%5c..%5cserver']) {
      // 주: '/%2e%2e/' 같은 점 세그먼트는 클라이언트(WHATWG URL)가 먼저 '/' 로 접는다 — 단위 테스트에서 검사.
      const r = await request(app).get(p);
      expect(r.status, p).toBe(404);
      expect(r.text).not.toContain('SECRET');
    }
  });

  it('정적 파일은 그대로(robots.txt, sitemap.xml), 디렉터리 301 없음', async () => {
    const r = await request(app).get('/robots.txt');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Disallow: /');
    expect((await request(app).get('/data')).status).toBe(404);
  });

  it('API 경로·비 GET 은 건드리지 않는다', async () => {
    expect((await request(app).get('/api/ping')).body).toEqual({ ok: true });
    expect((await request(app).get('/api/nope')).status).toBe(404);
    expect((await request(app).get('/api/nope')).text).not.toContain('data-ws-route');
    expect((await request(app).post('/')).status).toBe(404);
  });
});

describe('spa — 승격 픽스처 dist', () => {
  let app: Express;
  beforeAll(async () => {
    const seedDir = tmp('seed');
    writeSeedDir(seedDir, promoted({ publishable: true }));
    app = appFor(await prerendered(seedDir));
  }, 60_000);

  it('/hamster/golden/supplies/cage → 200 + 부모 본문 + L4 본문 + CSP', async () => {
    const r = await request(app).get('/hamster/golden/supplies/cage');
    expect(r.status).toBe(200);
    expect(r.text).toContain('data-ws-section="now"');
    expect(r.text).toContain('data-ws-layer="L4"');
    expect(r.text).toContain('바닥 가로 100cm 이상');
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
  });

  it('/hamster/golden/ → 301 /hamster/golden', async () => {
    const r = await request(app).get('/hamster/golden/');
    expect(r.status).toBe(301);
    expect(r.headers.location).toBe('/hamster/golden');
  });

  it('한글 지역 경로(NFC·NFD 인코딩 모두) → 200', async () => {
    for (const s of ['서울-마포구', '서울-마포구'.normalize('NFD')]) {
      const r = await request(app).get(`/vet/${encodeURIComponent(s)}`);
      expect(r.status).toBe(200);
      expect(r.text).toContain('data-ws-route="VET_REGION"');
    }
  });

  it('manifest 에 없는 타입 하위 경로 → 404', async () => {
    expect((await request(app).get('/hamster/golden/supplies/scale')).status).toBe(404); // scale 은 DRAFT(publishable 픽스처에서도 비노출)
    expect((await request(app).get('/hamster/dwarf')).status).toBe(404);
  });
});

describe('spa — manifest 없음(현행 동작, D16)', () => {
  it('모든 HTML GET → index.html 200', async () => {
    const dist = tmp('plain');
    writeFileSync(join(dist, 'index.html'), TEMPLATE);
    const app = appFor(dist);
    const r = await request(app).get('/anything/here');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<div id="root">');
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
  });
});

describe('spa — manifest file 경로 이탈(containedFile, Q1 D2)', () => {
  const SECRET = 'TOP-SECRET-CONTAINED-FILE';
  const BACKSLASH = String.fromCharCode(0x5c); // 소스에 역슬래시 이스케이프를 두지 않는다(편집 도구가 해석한 전례)
  let app: Express;
  beforeAll(() => {
    const parent = tmp('contain');
    const dist = join(parent, 'dist');
    mkdirSync(join(dist, 'sub'), { recursive: true });
    writeFileSync(join(parent, 'secret.txt'), SECRET); // dist 한 단계 위
    writeFileSync(join(dist, 'index.html'), TEMPLATE);
    writeFileSync(join(dist, 'ok.html'), '<p>ok-page</p>');
    writeFileSync(join(dist, '404.html'), '<p>not-found-page</p>');
    const manifest = {
      v: 1,
      seedDigest: 'a'.repeat(64),
      indexable: false,
      routes: [
        { path: '/ok', file: 'ok.html', kind: 'HOME', indexable: false },
        { path: '/leak-a', file: '../secret.txt', kind: 'HOME', indexable: false },
        { path: '/leak-b', file: `..${BACKSLASH}secret.txt`, kind: 'HOME', indexable: false },
        { path: '/leak-c', file: join(parent, 'secret.txt'), kind: 'HOME', indexable: false },
        { path: '/leak-d', file: 'sub/../../secret.txt', kind: 'HOME', indexable: false },
        { path: '/404', file: '404.html', kind: 'NOT_FOUND', indexable: false },
      ],
    };
    writeFileSync(join(dist, 'prerender-manifest.json'), JSON.stringify(manifest));
    app = appFor(dist);
  });

  it('대조: dist 내부 manifest 파일은 200(manifest 모드 동작)', async () => {
    const r = await request(app).get('/ok');
    expect(r.status).toBe(200);
    expect(r.text).toContain('ok-page');
  });

  it.each(['/leak-a', '/leak-b', '/leak-c', '/leak-d'])('%s(dist 밖 file) → 404, 비밀 내용 없음', async (p) => {
    const r = await request(app).get(p);
    expect(r.status).toBe(404);
    expect(r.text).not.toContain(SECRET);
    expect(r.text).toContain('not-found-page');
  });
});

// CI(ubuntu)·로컬(Windows) 동일 동작: manifest 가 가리키는 파일이 없음·디렉터리·역슬래시 경로면 OS 무관하게 사용자 정의 404.
//   역슬래시 경로 sub\inner.html 은 Windows 에선 실제 파일(dist/sub/inner.html), Linux 에선 없는 파일명 — 둘 다 404 여야 한다.
describe('spa — manifest 파일 누락·역슬래시 → 사용자 정의 404(OS 무관)', () => {
  const BACKSLASH = String.fromCharCode(0x5c);
  const build = (with404: boolean): Express => {
    const dist = join(tmp('missing'), 'dist');
    mkdirSync(join(dist, 'sub'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), TEMPLATE);
    writeFileSync(join(dist, 'sub', 'inner.html'), '<p>inner-page</p>');
    if (with404) writeFileSync(join(dist, '404.html'), '<p>not-found-page</p>');
    const manifest = {
      v: 1,
      seedDigest: 'a'.repeat(64),
      indexable: false,
      routes: [
        { path: '/inner', file: 'sub/inner.html', kind: 'HOME', indexable: false },
        { path: '/bs', file: `sub${BACKSLASH}inner.html`, kind: 'HOME', indexable: false },
        { path: '/missing', file: 'missing.html', kind: 'HOME', indexable: false },
        { path: '/dir', file: 'sub', kind: 'HOME', indexable: false },
        { path: '/vet/missing', file: 'vet-missing.html', kind: 'VET', indexable: false },
        { path: '/404', file: '404.html', kind: 'NOT_FOUND', indexable: false },
      ],
    };
    writeFileSync(join(dist, 'prerender-manifest.json'), JSON.stringify(manifest));
    return appFor(dist);
  };
  let app: Express;
  let bare: Express;
  beforeAll(() => {
    app = build(true);
    bare = build(false);
  });

  it('대조: 정상 슬래시 경로는 200', async () => {
    const r = await request(app).get('/inner');
    expect(r.status).toBe(200);
    expect(r.text).toContain('inner-page');
  });

  it.each(['/bs', '/missing', '/dir'])('%s → 404 + 404.html 본문 + SPA CSP(Express 기본 404 아님)', async (p) => {
    const r = await request(app).get(p);
    expect(r.status).toBe(404);
    expect(r.text).toContain('not-found-page');
    expect(r.text).not.toContain('inner-page');
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['content-security-policy']).toBe(SPA_CSP);
  });

  it('/vet/missing → 404.html, CSP 는 경로 규칙 그대로(VET)', async () => {
    const r = await request(app).get('/vet/missing');
    expect(r.status).toBe(404);
    expect(r.text).toContain('not-found-page');
    expect(r.headers['content-security-policy']).toBe(VET_CSP);
  });

  it('404.html 도 없으면 text/plain 404(무한 재귀 없음)', async () => {
    for (const p of ['/bs', '/missing', '/dir', '/nope']) {
      const r = await request(bare).get(p);
      expect(r.status).toBe(404);
      expect(r.headers['content-type']).toMatch(/^text\/plain/);
      expect(r.text).toBe('Not Found');
    }
  });
});

// R5 B3-3(D21, SEC L4): CSP 경로 분리 — 기본은 외부 출처 0·unsafe-inline 스크립트 0, 네이버 지도 호스트는 /vet·/vet/* 에만.
describe('CSP 경로 분리(D21)', () => {
  const directive = (csp: string, name: string): string =>
    csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

  it('기본 CSP: script-src self 만, base-uri·object-src none, frame-ancestors none, form-action self, 네이버 0', () => {
    expect(directive(SPA_CSP, 'script-src')).toBe("script-src 'self'");
    expect(directive(SPA_CSP, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(SPA_CSP, 'object-src')).toBe("object-src 'none'");
    expect(directive(SPA_CSP, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(SPA_CSP, 'form-action')).toBe("form-action 'self'");
    expect(directive(SPA_CSP, 'default-src')).toBe("default-src 'self'");
    expect(SPA_CSP).not.toMatch(/naver|pstatic|unsafe-eval/);
    expect(directive(SPA_CSP, 'script-src')).not.toContain('unsafe-inline');
    expect(SPA_CSP).not.toMatch(/https?:/);
  });

  it('/vet CSP: 기본 + 네이버 지도 호스트(script oapi, img·connect 지도), 스크립트 unsafe-inline 0', () => {
    expect(directive(VET_CSP, 'script-src')).toBe("script-src 'self' https://oapi.map.naver.com");
    expect(directive(VET_CSP, 'img-src')).toContain('https://*.map.naver.com');
    expect(directive(VET_CSP, 'img-src')).toContain('https://*.pstatic.net');
    expect(directive(VET_CSP, 'connect-src')).toContain('https://*.map.naver.com');
    for (const d of ['base-uri', 'object-src', 'frame-ancestors', 'form-action', 'default-src', 'font-src', 'style-src']) {
      expect(directive(VET_CSP, d), d).toBe(directive(SPA_CSP, d));
    }
  });

  it('cspForPath: /vet·/vet/* 만 지도 CSP', () => {
    expect(cspForPath('/vet')).toBe(VET_CSP);
    expect(cspForPath('/vet/서울-마포구')).toBe(VET_CSP);
    for (const p of ['/', '/vets', '/vetx', '/save', '/credits', '/hamster/golden', '/hamster/vet', '/x/vet/y', '']) expect(cspForPath(p), p).toBe(SPA_CSP);
  });

  describe('supertest — manifest 모드', () => {
    let app: Express;
    beforeAll(async () => {
      app = appFor(await prerendered());
    }, 60_000);
    it('/ · /save · 404 → 네이버 0', async () => {
      for (const p of ['/', '/save', '/hamster/golden', '/vetx']) {
        const r = await request(app).get(p);
        expect(r.headers['content-security-policy'], p).toBe(SPA_CSP);
        expect(r.headers['content-security-policy'], p).not.toContain('naver');
      }
    });
    it('/vet · /vet/<지역> → 네이버 포함', async () => {
      const r = await request(app).get('/vet');
      expect(r.status).toBe(200);
      expect(r.headers['content-security-policy']).toBe(VET_CSP);
      const r2 = await request(app).get(`/vet/${encodeURIComponent('서울-없는구')}`);
      expect(r2.headers['content-security-policy']).toBe(VET_CSP);
    });
    it('Permissions-Policy 가 / · /vet · /api 모두에 존재', async () => {
      for (const p of ['/', '/vet', '/api/ping']) {
        const r = await request(app).get(p);
        expect(r.headers['permissions-policy'], p).toBe('geolocation=(), camera=(), microphone=(), payment=()');
      }
    });
    it('/api 는 securityHeaders 의 default-src none 유지', async () => {
      const r = await request(app).get('/api/ping');
      expect(r.headers['content-security-policy']).not.toContain('naver');
    });
  });

  describe('supertest — manifest 없음(현행 fallback)', () => {
    let app: Express;
    beforeAll(() => {
      const d = tmp('plain');
      writeFileSync(join(d, 'index.html'), TEMPLATE);
      app = appFor(d);
    });
    it('/ → 기본, /vet → 지도', async () => {
      expect((await request(app).get('/')).headers['content-security-policy']).toBe(SPA_CSP);
      expect((await request(app).get('/vet')).headers['content-security-policy']).toBe(VET_CSP);
      expect((await request(app).get('/vet/x')).headers['content-security-policy']).toBe(VET_CSP);
    });
  });
});
