// 294(Kenny 2026-11-16): 처리방침 6값 미정({{KENNY:…}})인 채 운영 배포 — 운영 빌드(production) ∧ 자리표시 남음이면 /privacy 를 내보내지 않는다.
//   빌드 시 결정: 페이지·sitemap·푸터 링크 0, manifest privacyPage:false, #root data-ws-privacy="off", 산출물 어디에도 '{{KENNY:' 0,
//   서버 /privacy 404(정적 폴백 없음), 운영 기동 검사는 WS_ALLOW_PRIVACY_PLACEHOLDER=1 일 때만 경고로 통과(공개 전환이면 거부).
//   6값이 채워지면(시험용 해결값) 운영 빌드에서도 /privacy 가 자동으로 돌아온다. 개발·시험 빌드는 기존 그대로(prerender.privacy.test.ts).
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { buildSite, PRIVACY_OFF_ATTR, PRIVACY_OFF_VALUE, type SiteBuild } from '../prerender/site.js';
import { runPrerenderCli, type PrerenderIo } from '../prerender/cli.js';
import { COPY } from '../prerender/copy.js';
import { hasUnresolvedPlaceholders, privacyPagePublished, PRIVACY_POLICY, type PrivacyPolicy } from '../prerender/privacy-content.js';
import { ALLOW_PRIVACY_PLACEHOLDER_ENV, INDEXABLE_ENV, privacyPageOff, privacyPlaceholderCheck } from '../config/env.js';
import { mountSpa } from '../middleware/spa.js';
import { FIXTURE_AS_OF, promoted, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const ORIGIN = 'https://withsmall.example';
const DIGEST = 'b'.repeat(64);
const MARK = ['{{KEN', 'NY:'].join('');
const PH = (k: string): string => `${MARK}${k}}}`;

/** 자리표시가 반드시 있는 처리방침(지금 본문이 채워진 뒤에도 이 시험은 자리표시 경로를 본다). */
const UNRESOLVED: PrivacyPolicy = { ...PRIVACY_POLICY, effectiveDate: PH('effectiveDate') };
/** 시험용 해결값 — 모든 {{KENNY:키}} 를 사실이 아닌 시험 문자열로 바꾼 처리방침(본문 사실 변경 0 — 시험 안에서만). */
const RESOLVED: PrivacyPolicy = JSON.parse(
  JSON.stringify(PRIVACY_POLICY).replace(/\{\{KENNY:([A-Za-z0-9]+)\}\}/g, (_m, k: string) => (k === 'effectiveDate' ? '2099-01-01' : `시험값-${k}`)),
) as PrivacyPolicy;

const build = (production: boolean, privacyPolicy: PrivacyPolicy, seed = promoted()): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, asOf: FIXTURE_AS_OF, production, privacyPolicy });

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-294-${p}-`));
  temps.push(d);
  return d;
};
function writeDist(b: SiteBuild): string {
  const d = tmp('dist');
  for (const [rel, content] of b.files) {
    const abs = join(d, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  writeFileSync(join(d, 'shell.html'), TEMPLATE);
  return d;
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('privacyPagePublished · hasUnresolvedPlaceholders', () => {
  it('운영 ∧ 자리표시 → 비노출, 운영 ∧ 해결 → 노출, 개발은 항상 노출', () => {
    expect(hasUnresolvedPlaceholders(UNRESOLVED)).toBe(true);
    expect(hasUnresolvedPlaceholders(RESOLVED)).toBe(false);
    expect(privacyPagePublished(true, UNRESOLVED)).toBe(false);
    expect(privacyPagePublished(true, RESOLVED)).toBe(true);
    expect(privacyPagePublished(false, UNRESOLVED)).toBe(true);
    expect(privacyPagePublished(false, RESOLVED)).toBe(true);
  });

  it('판정은 필드 전부(본문·표·목록·버전) — 표 셀 한 곳에만 남아도 자리표시로 본다', () => {
    const cellOnly: PrivacyPolicy = {
      ...RESOLVED,
      sections: [{ id: 'x', title: 't', legal: 'l', blocks: [{ table: { caption: 'c', head: ['a'], rows: [[{ text: 'x', meta: PH('officerName') }]] } }] }],
    };
    expect(hasUnresolvedPlaceholders(cellOnly)).toBe(true);
  });
});

describe('운영 빌드 + 자리표시 남음 → /privacy 비노출', () => {
  const b = build(true, UNRESOLVED);

  it('라우트·페이지·sitemap 에 /privacy 0, manifest privacyPage:false', () => {
    expect(b.privacyPage).toBe(false);
    expect(b.routes.some((r) => r.path === '/privacy' || r.kind === 'PRIVACY')).toBe(false);
    expect(b.files.has('privacy/index.html')).toBe(false);
    expect(b.files.get('sitemap.xml')).not.toContain('/privacy');
    expect(b.manifest.privacyPage).toBe(false);
    expect(b.manifest.routes.some((r) => r.path === '/privacy')).toBe(false);
    expect(JSON.parse(b.files.get('prerender-manifest.json') as string)).toMatchObject({ mode: 'production', privacyPage: false });
  });

  it("산출물 파일 전부에 '{{KENNY:' 0", () => {
    for (const [rel, content] of b.files) expect(content.includes(MARK), rel).toBe(false);
  });

  it('모든 페이지(404 포함): 처리방침 링크 0, 푸터는 사진 출처만, #root data-ws-privacy="off"', () => {
    expect(b.pages.length).toBeGreaterThan(5);
    for (const p of b.pages) {
      expect(p.html, p.route.path).not.toContain('href="/privacy"');
      expect(p.html, p.route.path).toContain(`<p class="ws-footer-links"><a href="/credits">${COPY.credits.footerLink}</a></p>`);
      expect(p.html, p.route.path).toMatch(new RegExp(`<div id="root"[^>]* ${PRIVACY_OFF_ATTR}="${PRIVACY_OFF_VALUE}"`));
    }
  });

  it('서버(manifest 모드): /privacy → 404 + 404.html, 정적 폴백·자리표시 0, 나머지 페이지 200', async () => {
    const dist = writeDist(b);
    const app = express();
    mountSpa(app, { clientDist: dist });
    for (const p of ['/privacy', '/privacy/', '/privacy/index.html']) {
      const r = await request(app).get(p).redirects(1);
      expect(r.status, p).toBe(404);
      expect(r.text, p).not.toContain(MARK);
      expect(r.text, p).not.toContain('data-ws-route="PRIVACY"');
    }
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/credits')).status).toBe(200);
  });

  it('운영 기동 검사: 허용 변수=1 → 경고로 기동, 없거나 1 아님 → 거부, 공개 전환이면 허용 변수와 무관하게 거부', () => {
    const dist = writeDist(b);
    expect(privacyPageOff(dist)).toBe(true);
    const PROD = { NODE_ENV: 'production' };
    const ok = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, dist);
    expect(ok.problems).toEqual([]);
    expect(ok.warnings).toHaveLength(1);
    expect(ok.warnings[0]).toMatch(/privacyPage:false/);
    for (const v of [undefined, '0', 'true', '']) {
      const r = privacyPlaceholderCheck(v === undefined ? PROD : { ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: v }, dist);
      expect(r.problems, String(v)).toHaveLength(1);
      expect(r.problems[0]).toMatch(/운영 기동 거부/);
    }
    const pub = privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1', [INDEXABLE_ENV]: '1' }, dist);
    expect(pub.problems).toHaveLength(1);
    expect(pub.problems[0]).toMatch(/공개 전환/);
    // 빌드가 공개(indexable:true)로 나간 비노출 빌드도 거부.
    const pubBuild = writeDist(buildSite(promoted(), { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, asOf: FIXTURE_AS_OF, production: true, indexable: true, privacyPolicy: UNRESOLVED }));
    expect(privacyPlaceholderCheck({ ...PROD, [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, pubBuild).problems[0]).toMatch(/공개 전환/);
  });

  it('기동 검사 우회 불가: privacyPage:false 라도 privacy/index.html 이 있으면 기존 자리표시 검사, manifest 가 /privacy 라우트를 가지면 비노출로 보지 않음', () => {
    const dist = writeDist(b);
    mkdirSync(join(dist, 'privacy'));
    writeFileSync(join(dist, 'privacy', 'index.html'), `<main>${PH('officerName')}</main>`);
    const r = privacyPlaceholderCheck({ NODE_ENV: 'production' }, dist);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain('officerName');

    const d2 = writeDist(b);
    const man = JSON.parse(readFileSync(join(d2, 'prerender-manifest.json'), 'utf8')) as { routes: unknown[] };
    man.routes.push({ path: '/privacy', file: 'privacy/index.html', kind: 'PRIVACY', indexable: true });
    writeFileSync(join(d2, 'prerender-manifest.json'), JSON.stringify(man));
    expect(privacyPageOff(d2)).toBe(false);
    expect(privacyPlaceholderCheck({ NODE_ENV: 'production', [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, d2).problems[0]).toMatch(/페이지 없음/);
  });

  it('manifest 없음·손상·privacyPage 가 false 아님 → 비노출로 보지 않음(기존: 페이지 없음 = 기동 거부)', () => {
    const none = tmp('none');
    expect(privacyPageOff(none)).toBe(false);
    const bad = tmp('bad');
    writeFileSync(join(bad, 'prerender-manifest.json'), '{ not json');
    expect(privacyPageOff(bad)).toBe(false);
    for (const v of [0, 'false', null, true]) {
      const d = tmp('v');
      writeFileSync(join(d, 'prerender-manifest.json'), JSON.stringify({ v: 1, privacyPage: v, routes: [] }));
      expect(privacyPageOff(d), String(v)).toBe(false);
      expect(privacyPlaceholderCheck({ NODE_ENV: 'production', [ALLOW_PRIVACY_PLACEHOLDER_ENV]: '1' }, d).problems[0]).toMatch(/페이지 없음/);
    }
  });
});

describe('운영 빌드 + 시험용 해결값 → /privacy 자동 노출', () => {
  const b = build(true, RESOLVED);

  it('라우트·sitemap·푸터 링크·본문 정상, manifest 에 privacyPage 키 없음, #root 표식 없음, 자리표시 0', () => {
    expect(b.privacyPage).toBe(true);
    expect(b.routes.find((r) => r.path === '/privacy')).toMatchObject({ kind: 'PRIVACY', indexable: true });
    expect(b.files.get('sitemap.xml')).toContain(`<loc>${ORIGIN}/privacy</loc>`);
    expect('privacyPage' in b.manifest).toBe(false);
    const html = b.files.get('privacy/index.html') ?? '';
    expect(html).toContain(`<h1>${COPY.privacy.title}</h1>`);
    expect(html).toContain('2099-01-01');
    for (const [rel, content] of b.files) expect(content.includes(MARK), rel).toBe(false);
    for (const p of b.pages) {
      expect(p.html, p.route.path).toContain(`<a href="/privacy">${COPY.footer.privacy}</a>`);
      expect(p.html, p.route.path).not.toContain(`${PRIVACY_OFF_ATTR}=`);
    }
  });

  it('운영 기동 검사: 허용 변수 없이 통과(problems·warnings 0)', () => {
    const dist = writeDist(b);
    expect(privacyPageOff(dist)).toBe(false);
    expect(privacyPlaceholderCheck({ NODE_ENV: 'production' }, dist)).toEqual({ problems: [], warnings: [] });
  });
});

describe('개발 빌드 + 자리표시 → 기존 그대로(노출 + 자리표시, privacyPage 키 없음)', () => {
  it('기본 buildSite(privacyPolicy 생략·production 생략) 산출물은 이 변경 전과 같은 형태', () => {
    const b = buildSite(realSeed(), { template: TEMPLATE, origin: ORIGIN, seedDigest: DIGEST, asOf: FIXTURE_AS_OF });
    expect(b.privacyPage).toBe(true);
    expect(b.files.has('privacy/index.html')).toBe(true);
    expect('privacyPage' in b.manifest).toBe(false);
    for (const p of b.pages) expect(p.html).not.toContain(`${PRIVACY_OFF_ATTR}=`);
    const dev = build(false, UNRESOLVED);
    expect(dev.files.get('privacy/index.html')).toContain(PH('effectiveDate'));
  });
});

describe('CLI(NODE_ENV=production) — 실제 처리방침 본문 기준, 옛 /privacy 사본 정리', () => {
  it('자리표시가 남았으면 privacy/ 산출물 0(이전 개발 빌드 사본·압축본까지 정리), 채워졌으면 노출', async () => {
    const out = tmp('cli');
    writeFileSync(join(out, 'index.html'), TEMPLATE);
    const io = (env: Record<string, string>): PrerenderIo => ({ stdout: () => {}, stderr: () => {}, env, today: () => FIXTURE_AS_OF });
    // 1) 개발 빌드 — /privacy 생성, 그 위에 압축본 흉내
    expect(await runPrerenderCli(['--out', out, '--now', FIXTURE_AS_OF], io({ NODE_ENV: 'development' }))).toBe(0);
    expect(existsSync(join(out, 'privacy', 'index.html'))).toBe(true);
    writeFileSync(join(out, 'privacy', 'index.html.br'), 'x');
    writeFileSync(join(out, 'privacy', 'index.html.gz'), 'x');
    // 2) 운영 빌드
    const code = await runPrerenderCli(['--out', out, '--now', FIXTURE_AS_OF, '--allow-past-now'], io({ NODE_ENV: 'production', SITE_ORIGIN: ORIGIN }));
    expect(code).toBe(0);
    const hidden = hasUnresolvedPlaceholders();
    const man = JSON.parse(readFileSync(join(out, 'prerender-manifest.json'), 'utf8')) as { privacyPage?: unknown };
    if (hidden) {
      expect(man.privacyPage).toBe(false);
      for (const f of ['index.html', 'index.html.br', 'index.html.gz']) expect(existsSync(join(out, 'privacy', f)), f).toBe(false);
      for (const f of walk(out)) expect(readFileSync(f, 'utf8').includes(MARK), f).toBe(false);
    } else {
      expect('privacyPage' in man).toBe(false);
      expect(existsSync(join(out, 'privacy', 'index.html'))).toBe(true);
    }
  });
});
