// R3 F3 — 프리렌더 CLI(io 주입, 임시 디렉터리). seedDigest 는 lane E 구현과 같은 값이어야 한다.
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPrerenderCli, SHELL_FILE, type PrerenderIo } from '../prerender/cli.js';
import { seedDigest } from '../prerender/digest.js';
import { patch, promoted, SEED_DIR, writeSeedDir } from './fixtures/prerender-seed.js';

const ROOT = join(SEED_DIR, '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-${p}-`));
  temps.push(d);
  return d;
};

function outDir(): string {
  const d = tmp('dist');
  writeFileSync(join(d, 'index.html'), TEMPLATE);
  return d;
}

interface Run {
  code: number;
  out: string[];
  err: string[];
}
async function run(argv: string[], env: Record<string, string> = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: PrerenderIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env, today: () => '2026-10-01' };
  return { code: await runPrerenderCli(argv, io), out, err };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
function treeDigest(dir: string): string {
  const h = createHash('sha256');
  for (const f of walk(dir).map((p) => relative(dir, p).split('\\').join('/')).sort()) {
    h.update(`${f}\n`);
    h.update(readFileSync(join(dir, f)));
  }
  return h.digest('hex');
}

describe('seedDigest — lane E 구현과 동일', () => {
  it('실시드·승격 시드 모두 scripts/lib/seed-exposure.mjs seedDigest() 와 같다', async () => {
    const mod = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
      seedDigest: (d: string) => string;
    };
    expect(seedDigest(SEED_DIR)).toMatch(/^[0-9a-f]{64}$/);
    expect(seedDigest(SEED_DIR)).toBe(mod.seedDigest(SEED_DIR));
    const d = tmp('seed');
    writeSeedDir(d, promoted());
    writeFileSync(join(d, 'taxa.json'), `\uFEFF${readFileSync(join(d, 'taxa.json'), 'utf8').replace(/\n/g, '\r\n')}`); // BOM·CRLF
    expect(seedDigest(d)).toBe(mod.seedDigest(d));
    expect(seedDigest(d)).not.toBe(seedDigest(SEED_DIR));
  });
});

describe('prerender CLI', () => {
  it('실시드: 요약 한 줄, 파일 생성, 2회 실행 트리 동일, 셸 보존', async () => {
    const out = outDir();
    const r1 = await run(['--out', out, '--public-dir', tmp('pub')]);
    expect(r1.err).toEqual([]);
    expect(r1.code).toBe(0);
    expect(r1.out).toEqual(['prerender — pages 3 (+404), indexable 1, types 0']);
    for (const f of ['index.html', 'supplies/index.html', 'vet/index.html', '404.html', 'sitemap.xml', 'robots.txt', 'prerender-manifest.json', SHELL_FILE]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    expect(readFileSync(join(out, SHELL_FILE), 'utf8')).toBe(TEMPLATE);
    expect(readdirSync(join(out, 'data')).filter((f) => /^catalog\.v1\.[0-9a-f]{8}\.json$/.test(f))).toHaveLength(1);
    const man = JSON.parse(readFileSync(join(out, 'prerender-manifest.json'), 'utf8')) as { seedDigest: string; indexable: boolean };
    expect(man.seedDigest).toBe(seedDigest(SEED_DIR));
    expect(man.indexable).toBe(false);
    expect(readFileSync(join(out, 'robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
    const d1 = treeDigest(out);
    const r2 = await run(['--out', out, '--public-dir', tmp('pub')]);
    expect(r2.code).toBe(0);
    expect(treeDigest(out)).toBe(d1);
  });

  it('SITE_ORIGIN·WS_INDEXABLE=1 → canonical origin, robots Allow + Sitemap', async () => {
    const out = outDir();
    const r = await run(['--out', out], { SITE_ORIGIN: 'https://example.org', WS_INDEXABLE: '1' });
    expect(r.code).toBe(0);
    expect(readFileSync(join(out, 'robots.txt'), 'utf8')).toBe('User-agent: *\nAllow: /\n\nSitemap: https://example.org/sitemap.xml\n');
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('<link rel="canonical" href="https://example.org/">');
    // --site-origin 이 env 보다 우선, WS_INDEXABLE 이 '1' 이 아니면 Disallow
    const out2 = outDir();
    expect((await run(['--out', out2, '--site-origin', 'https://b.example'], { SITE_ORIGIN: 'https://a.example', WS_INDEXABLE: 'true' })).code).toBe(0);
    expect(readFileSync(join(out2, 'robots.txt'), 'utf8')).toContain('Disallow: /');
    expect(readFileSync(join(out2, 'index.html'), 'utf8')).toContain('https://b.example/');
  });

  it('승격 시드 → types 1, 이어서 실시드로 재실행하면 이전 타입 페이지가 남지 않는다', async () => {
    const out = outDir();
    const seedDir = tmp('seed');
    writeSeedDir(seedDir, promoted());
    const r = await run(['--out', out, '--seed-dir', seedDir]);
    expect(r.err).toEqual([]);
    expect(r.out).toEqual(['prerender — pages 17 (+404), indexable 14, types 1']);
    expect(existsSync(join(out, 'hamster', 'golden', 'supplies', 'cage', 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'vet', '서울-마포구', 'index.html'))).toBe(true);
    const r2 = await run(['--out', out]);
    expect(r2.code).toBe(0);
    expect(existsSync(join(out, 'hamster', 'golden', 'index.html'))).toBe(false);
    expect(existsSync(join(out, 'credits', 'index.html'))).toBe(false);
    expect(readdirSync(join(out, 'data'))).toHaveLength(1);
  });

  it('시드 오류 → exit 1, 아무것도 쓰지 않음(D20)', async () => {
    const out = outDir();
    const seedDir = tmp('seed');
    const s = promoted();
    patch(s, 'curatedProducts', 'cp-001', { reviewerType: 'AI_DRAFT' }); // VERIFIED ∧ AI_DRAFT → V01
    writeSeedDir(seedDir, s);
    const r = await run(['--out', out, '--seed-dir', seedDir]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(/V01/);
    expect(existsSync(join(out, 'prerender-manifest.json'))).toBe(false);
  });

  it('참조 /assets/* 가 없으면 exit 1, client/public 에 있으면 통과', async () => {
    const out = outDir();
    const pub = tmp('pub');
    const seedDir = tmp('seed');
    const s = promoted();
    patch(s, 'curatedProducts', 'cp-001', { imageAsset: '/assets/products/cp-001.webp', imageLicense: 'OWN_PHOTO' });
    writeSeedDir(seedDir, s);
    const r = await run(['--out', out, '--seed-dir', seedDir, '--public-dir', pub]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('/assets/products/cp-001.webp');
    expect(existsSync(join(out, 'prerender-manifest.json'))).toBe(false);
    mkdirSync(join(pub, 'assets', 'products'), { recursive: true });
    writeFileSync(join(pub, 'assets', 'products', 'cp-001.webp'), 'x');
    expect((await run(['--out', out, '--seed-dir', seedDir, '--public-dir', pub])).code).toBe(0);
  });

  it('마커 없는 템플릿·잘못된 인자 → exit 2', async () => {
    const out = tmp('dist');
    writeFileSync(join(out, 'index.html'), '<html><title>x</title><div id="root"></div></html>');
    expect((await run(['--out', out])).code).toBe(2);
    expect((await run(['--bogus', 'x'])).code).toBe(2);
    expect((await run(['--now', '2026-1-1'])).code).toBe(2);
  });

  it('실제 client/dist 복사본(vite 자산 포함)으로 동작 — /assets 참조가 out 에 있으면 통과', async () => {
    const dist = join(ROOT, 'client', 'dist');
    if (!existsSync(join(dist, 'index.html'))) return; // 클라이언트 미빌드 환경
    const out = tmp('dist');
    cpSync(dist, out, { recursive: true });
    const r = await run(['--out', out, '--public-dir', tmp('pub')]);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
  });
});
