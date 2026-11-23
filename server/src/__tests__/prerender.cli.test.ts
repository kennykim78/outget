// R3 F3 — 프리렌더 CLI(io 주입, 임시 디렉터리). seedDigest 는 lane E 구현과 같은 값이어야 한다.
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPrerenderCli, SHELL_FILE, type PrerenderIo } from '../prerender/cli.js';
import { seedDigest } from '../prerender/digest.js';
import { FIXTURE_AS_OF, FIXTURE_FIRST_STALE, FIXTURE_LAST_FRESH, patch, promoted, SEED_DIR, writeSeedDir, writeUnsignedSeedDir } from './fixtures/prerender-seed.js';

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
/** --now 가 없으면 FIXTURE_AS_OF 를 붙인다. io.today 는 기본적으로 던진다(실시계 결합 0, F14). */
async function run(argv: string[], env: Record<string, string> = {}, today?: () => string): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const noClock = (): string => {
    throw new Error('test: io.today() 호출 — --now 를 넘겨라');
  };
  const io: PrerenderIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env, today: today ?? noClock };
  const args = today || argv.some((a) => a === '--now' || a.startsWith('--now=')) ? argv : [...argv, '--now', FIXTURE_AS_OF];
  return { code: await runPrerenderCli(args, io), out, err };
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
    writeSeedDir(d, promoted({ publishable: true }));
    writeFileSync(join(d, 'taxa.json'), `\uFEFF${readFileSync(join(d, 'taxa.json'), 'utf8').replace(/\n/g, '\r\n')}`); // BOM·CRLF
    expect(seedDigest(d)).toBe(mod.seedDigest(d));
    expect(seedDigest(d)).not.toBe(seedDigest(SEED_DIR));
  });
});

describe('prerender CLI', () => {
  it('실시드(2026-11-16 서명 + 2026-11-23 활성화): 요약 한 줄(골든·드워프·기니피그 3타입), 파일 생성, 2회 실행 트리 동일, 셸 보존 · 서명 전 기준은 types 0', async () => {
    const pre = outDir();
    const pr = await run(['--out', pre, '--public-dir', tmp('pub'), '--seed-dir', writeUnsignedSeedDir(tmp('seed-unsigned'))]);
    expect([pr.code, pr.out]).toEqual([0, ['prerender — pages 7 (+404), indexable 2, types 0']]);
    expect(existsSync(join(pre, 'hamster'))).toBe(false);
    const out = outDir();
    const r1 = await run(['--out', out, '--public-dir', tmp('pub')]);
    expect(r1.err).toEqual([]);
    expect(r1.code).toBe(0);
    expect(r1.out).toEqual(['prerender — pages 171 (+404), indexable 125, types 3' /* 2026-11-23 드워프·기니피그 활성화(옛 61·44·1) · 315 총괄 11/22: 실시드 팁 검수 기록(summaryCheck·vetReview) null → /tips 0 */]);
    // 노출은 ACTIVE 골든·드워프·기니피그 — PLANNED 저빌·앵무(서명됐어도) 경로 0.
    for (const f of ['hamster/index.html', 'hamster/golden/index.html', 'hamster/golden/supplies/cage/index.html', 'hamster/golden/check/wheel/index.html', 'hamster/dwarf/index.html', 'guinea-pig/index.html']) expect(existsSync(join(out, f)), f).toBe(true);
    for (const f of ['gerbil', 'parrot']) expect(existsSync(join(out, f)), f).toBe(false);
    for (const f of ['index.html', 'supplies/index.html', 'vet/index.html', 'credits/index.html', '404.html', 'sitemap.xml', 'robots.txt', 'prerender-manifest.json', SHELL_FILE]) {
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
    expect(readFileSync(join(out, 'robots.txt'), 'utf8')).toBe('User-agent: *\nAllow: /\nDisallow: /save\n\nSitemap: https://example.org/sitemap.xml\n');
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('<link rel="canonical" href="https://example.org/">');
    // --site-origin 이 env 보다 우선, WS_INDEXABLE 이 '1' 이 아니면 Disallow
    const out2 = outDir();
    expect((await run(['--out', out2, '--site-origin', 'https://b.example'], { SITE_ORIGIN: 'https://a.example', WS_INDEXABLE: 'true' })).code).toBe(0);
    expect(readFileSync(join(out2, 'robots.txt'), 'utf8')).toContain('Disallow: /');
    expect(readFileSync(join(out2, 'index.html'), 'utf8')).toContain('https://b.example/');
  });

  it('G-4: VITE_NAVER_MAP_CLIENT_ID 가 있으면 /vet layout=map, 키 값은 어떤 산출물에도 0 / 없으면 list', async () => {
    const KEY = 'ncpKeyValueShouldNeverLeak42';
    const seedDir = tmp('seed');
    writeSeedDir(seedDir, promoted({ publishable: true }));
    const on = outDir();
    expect((await run(['--out', on, '--seed-dir', seedDir], { VITE_NAVER_MAP_CLIENT_ID: KEY })).code).toBe(0);
    expect(readFileSync(join(on, 'vet', 'index.html'), 'utf8')).toContain('data-ws-vet-layout="map"');
    for (const f of walk(on)) expect(readFileSync(f, 'utf8'), f).not.toContain(KEY);
    const off = outDir();
    expect((await run(['--out', off, '--seed-dir', seedDir], { VITE_NAVER_MAP_CLIENT_ID: '  ' })).code).toBe(0);
    expect(readFileSync(join(off, 'vet', 'index.html'), 'utf8')).toContain('data-ws-vet-layout="list"');
    expect(readFileSync(join(off, 'vet', 'index.html'), 'utf8')).not.toContain('ws-vet-map');
  });

  it('승격 시드 → types 1, 이어서 노출 0 시드(서명 전 기준)로 재실행하면 이전 타입 페이지가 남지 않는다', async () => {
    const out = outDir();
    const seedDir = tmp('seed');
    writeSeedDir(seedDir, promoted({ publishable: true }));
    const r = await run(['--out', out, '--seed-dir', seedDir]);
    expect(r.err).toEqual([]);
    expect(r.out).toEqual(['prerender — pages 36 (+404), indexable 27, types 1' /* 보안 79 M-1: publishable 픽스처 = 필수 6항목 노출 · 308 /tips +1 → 315 검수 기록 null 로 /tips 0(−1) */]);
    expect(existsSync(join(out, 'hamster', 'golden', 'supplies', 'cage', 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'vet', '서울-마포구', 'index.html'))).toBe(true);
    // 이어서 노출 0 시드(서명 전 기준 디렉터리)로 재실행 — 이전 타입 페이지가 남지 않는다(디스크 실시드는 2026-11-16 서명 뒤 골든을 노출하므로 빈 상태 기준으로 본다).
    const r2 = await run(['--out', out, '--seed-dir', writeUnsignedSeedDir(tmp('seed-unsigned'))]);
    expect(r2.code).toBe(0);
    expect(r2.out).toEqual(['prerender — pages 7 (+404), indexable 2, types 0']);
    expect(existsSync(join(out, 'hamster', 'golden', 'index.html'))).toBe(false);
    expect(existsSync(join(out, 'vet', '서울-마포구', 'index.html'))).toBe(false);
    expect(existsSync(join(out, 'credits', 'index.html'))).toBe(true); // R4 D6: 항상(빈 상태)
    expect(readFileSync(join(out, 'credits', 'index.html'), 'utf8')).not.toContain('Fixture Author');
    expect(readdirSync(join(out, 'data'))).toHaveLength(1);
  });

  // M-1(R4 A1): --now 가 노출 기준일 — verifiedAt + 180 노출, + 181 강등. 기준일은 산출물에 쓰지 않는다.
  it('--now 는 노출 기준일: verifiedAt+180 → types 1, +181 → types 0(타입 페이지 없음), 산출물에 날짜 없음', async () => {
    const seedDir = tmp('seed');
    writeSeedDir(seedDir, promoted({ publishable: true }));
    const fresh = outDir();
    const r1 = await run(['--out', fresh, '--seed-dir', seedDir, '--now', FIXTURE_LAST_FRESH]);
    expect(r1.err).toEqual([]);
    expect(r1.out).toEqual(['prerender — pages 36 (+404), indexable 27, types 1' /* 보안 79 M-1: publishable 픽스처 = 필수 6항목 노출 · 308 /tips +1 → 315 검수 기록 null 로 /tips 0(−1) */]);
    const stale = outDir();
    const r2 = await run(['--out', stale, '--seed-dir', seedDir, '--now', FIXTURE_FIRST_STALE]);
    expect(r2.err).toEqual([]);
    expect(r2.code).toBe(0);
    expect(r2.out[0]).toMatch(/types 0$/);
    expect(existsSync(join(stale, 'hamster', 'golden', 'index.html'))).toBe(false);
    for (const f of walk(stale)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toContain(FIXTURE_FIRST_STALE);
      expect(text, f).not.toContain('픽스처 쳇바퀴 A');
    }
    for (const f of walk(fresh)) expect(readFileSync(f, 'utf8'), f).not.toContain(FIXTURE_LAST_FRESH);
  });

  it('--now 없으면 io.today() 가 노출 기준일(고정 값 주입 — 실시계 아님)', async () => {
    const seedDir = tmp('seed');
    writeSeedDir(seedDir, promoted({ publishable: true }));
    const r = await run(['--out', outDir(), '--seed-dir', seedDir], {}, () => FIXTURE_FIRST_STALE);
    expect(r.code).toBe(0);
    expect(r.out[0]).toMatch(/types 0$/);
    const r2 = await run(['--out', outDir(), '--seed-dir', seedDir], {}, () => FIXTURE_LAST_FRESH);
    expect(r2.out[0]).toMatch(/types 1$/);
  });

  it('시드 오류 → exit 1, 아무것도 쓰지 않음(D20)', async () => {
    const out = outDir();
    const seedDir = tmp('seed');
    const s = promoted({ publishable: true });
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
    const s = promoted({ publishable: true });
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

  it('354: 사용 가능 생성 이미지 행의 asset 파일이 없으면 exit 1, public 에 있으면 통과', async () => {
    const out = outDir();
    const pub = tmp('pub');
    const seedDir = tmp('seed');
    const s = promoted({ publishable: true });
    patch(s, 'photos', 'ph-01', {
      status: 'READY', license: 'AI_GENERATED', source: 'CODEX', sourceUrl: null, licenseUrl: null,
      generatedAt: '2026-11-20', promptPath: 'docs/assets/prompts/intro-1.md', asset: '/assets/photos/intro-1.webp',
      speciesCheck: { checkedBy: 'Kenny', checkedAt: '2026-11-21' },
    });
    writeSeedDir(seedDir, s);
    const r = await run(['--out', out, '--seed-dir', seedDir, '--public-dir', pub]);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('참조 자산 없음: /assets/photos/intro-1.webp');
    expect(existsSync(join(out, 'prerender-manifest.json'))).toBe(false);
    mkdirSync(join(pub, 'assets', 'photos'), { recursive: true });
    writeFileSync(join(pub, 'assets', 'photos', 'intro-1.webp'), 'x');
    expect((await run(['--out', out, '--seed-dir', seedDir, '--public-dir', pub])).code).toBe(0);
  });

  it('354: SLOT·기록 미비 사진의 asset 은 실재를 요구하지 않는다(사용 불가 = 화면에 안 나감)', async () => {
    const out = outDir();
    const pub = tmp('pub');
    const seedDir = tmp('seed');
    const s = promoted({ publishable: true });
    // promoted() 픽스처는 ph-01 을 READY·CC_BY(사용 가능)로 올린다 — 여기서는 SLOT 으로 되돌린다.
    //   (READY 인데 생성 기록이 빠진 AI 행은 validate I04 ERROR 로 먼저 막힌다 — engine.photo-ai.test.ts.)
    patch(s, 'photos', 'ph-01', { status: 'SLOT', asset: '/assets/photos/intro-1.webp' });
    writeSeedDir(seedDir, s);
    const rr = await run(['--out', out, '--seed-dir', seedDir, '--public-dir', pub]);
    expect(rr.code, rr.err.join('\n')).toBe(0);
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

// R6 N-2: 운영(NODE_ENV=production) 프리렌더는 SITE_ORIGIN 폴백 없음 — canonical·sitemap 이 localhost 로 굽히지 않게.
describe('R6 N-2 운영 SITE_ORIGIN 가드', () => {
  const today = (): string => FIXTURE_AS_OF;

  it('미설정·빈 값·localhost·loopback·http·경로 포함 → exit 2 + 변수명 SITE_ORIGIN, 산출물 0', async () => {
    const bad: Array<Record<string, string>> = [
      {},
      { SITE_ORIGIN: '' },
      { SITE_ORIGIN: '   ' },
      { SITE_ORIGIN: 'http://localhost:3001' },
      { SITE_ORIGIN: 'https://localhost' },
      { SITE_ORIGIN: 'https://127.0.0.1:8443' },
      { SITE_ORIGIN: 'https://[::1]' },
      { SITE_ORIGIN: 'https://app.localhost' },
      { SITE_ORIGIN: 'http://staging.example' },
      { SITE_ORIGIN: 'https://staging.example/sub' },
      { SITE_ORIGIN: 'not a url' },
    ];
    for (const env of bad) {
      const out = outDir();
      const r = await run(['--out', out], { NODE_ENV: 'production', ...env }, today);
      expect(r.code, JSON.stringify(env)).toBe(2);
      expect(r.err.join('\n'), JSON.stringify(env)).toMatch(/SITE_ORIGIN/);
      expect(existsSync(join(out, 'prerender-manifest.json')), JSON.stringify(env)).toBe(false);
    }
    // --site-origin 도 같은 검사(env 가 유효해도 플래그가 우선).
    const r = await run(['--out', outDir(), '--site-origin', 'http://localhost:3001'], { NODE_ENV: 'production', SITE_ORIGIN: 'https://ok.example' }, today);
    expect(r.code).toBe(2);
  });

  it('https 공개 오리진 → 통과, canonical·sitemap 에 localhost 0건(끝 슬래시는 제거)', async () => {
    const out = outDir();
    const r = await run(['--out', out], { NODE_ENV: 'production', SITE_ORIGIN: 'https://staging.example/' }, today);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    expect(html).toContain('https://staging.example/');
    expect(html).not.toContain('https://staging.example//');
    for (const f of walk(out).filter((p) => /\.(html|xml|txt)$/.test(p))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/localhost:3001/);
    }
    const viaFlag = await run(['--out', outDir(), '--site-origin', 'https://www.example.kr'], { NODE_ENV: 'production' }, today);
    expect(viaFlag.code).toBe(0);
  });

  it('비운영은 기존 의미 유지(미설정 → http://localhost:3001 기본값)', async () => {
    const out = outDir();
    expect((await run(['--out', out])).code).toBe(0);
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('http://localhost:3001');
  });
});
