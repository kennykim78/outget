// 362 N3(배선)·N6·N7 — CLI 상품 피드 게이트. 꺼짐이면 피드 디렉터리를 읽지 않는다(깨진 파일이어도 exit 0·산출물 불변).
//   켜짐 = production ∧ WS_PRODUCT_FEED=public ∧ origin ∈ WS_AFFILIATE_ORIGINS. 켜짐 + 무효 피드 → exit 2·산출물 0.
//   빌드 시각은 io.nowMs 주입(실시계 결합 0). 키·실호출 0 — 손으로 만든 피드 파일만.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSearchKeyword, createCatalog, resolveRequirement, type AnimalTypeRec } from '../engine/index.js';
import { runPrerenderCli, type PrerenderIo } from '../prerender/cli.js';
import { DEFAULT_PRODUCT_FEED_DIR } from '../prerender/product-feed.js';
import { FIXTURE_AS_OF, promoted, writeSeedDir } from './fixtures/prerender-seed.js';
import { TEMPLATE } from './fixtures/affiliate/baseline.js';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string): string => {
  const d = mkdtempSync(join(tmpdir(), `ws-feed-${p}-`));
  temps.push(d);
  return d;
};
function outDir(): string {
  const d = tmp('dist');
  writeFileSync(join(d, 'index.html'), TEMPLATE);
  return d;
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = (d: string): string[] => walk(d).map((f) => f.slice(d.length + 1).split('\\').join('/')).sort();

const ORIGIN = 'https://withsmall.example';
const PROD = { NODE_ENV: 'production', SITE_ORIGIN: ORIGIN };
const PROD_ON = { ...PROD, WS_PRODUCT_FEED: 'public', WS_AFFILIATE_ORIGINS: ORIGIN };
const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;

async function run(argv: string[], env: Record<string, string>, nowMs = GEN_MS + H): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: PrerenderIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env, today: () => FIXTURE_AS_OF, nowMs: () => nowMs };
  return { code: await runPrerenderCli([...argv, '--now', FIXTURE_AS_OF, '--allow-past-now'], io), out, err };
}

const seed = promoted({ publishable: true });
const seedDir = tmp('seed');
writeSeedDir(seedDir, seed);
const cat = createCatalog(seed);
const G = 'hamster-golden';
const golden = seed.animalTypes.find((a) => a.id === G) as AnimalTypeRec;
const wheelReq = resolveRequirement(cat, G, 'wheel');
if (!wheelReq) throw new Error('fixture: golden wheel 없음');
const KW = buildSearchKeyword(golden, wheelReq);

function feedDir(aliRows: unknown[], coupang = '{}', coupangRows: unknown[] = []): string {
  const d = tmp('pf');
  const empty = (p: string) => ({ v: 1, provider: p, source: 'OFFICIAL_API', api: { method: null, sort: null }, terms: { checkedAt: null, displayFields: [] }, generatedAt: null, rows: [] });
  const cp = { v: 1, provider: 'COUPANG', source: 'OFFICIAL_API', api: { method: 'search', sort: 'S' }, terms: { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'imageUrl', 'price'] }, generatedAt: GEN, rows: coupangRows };
  writeFileSync(join(d, 'coupang.json'), coupang !== '{}' ? coupang : coupangRows.length ? JSON.stringify(cp) : JSON.stringify(empty('COUPANG')));
  const ali =
    aliRows.length === 0
      ? empty('ALIEXPRESS')
      : { v: 1, provider: 'ALIEXPRESS', source: 'OFFICIAL_API', api: { method: 'm.q', sort: 'S' }, terms: { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'imageUrl', 'price'] }, generatedAt: GEN, rows: aliRows };
  writeFileSync(join(d, 'aliexpress.json'), JSON.stringify(ali));
  return d;
}
const wheelRow = (rank: number, title: string) => ({
  animalTypeId: G,
  supplyItemId: 'wheel',
  keyword: KW,
  rank,
  title,
  url: `https://s.click.aliexpress.com/e/_Fz${rank}abcd`,
  imageUrl: null,
  price: { amount: 15900, currency: 'KRW' },
  fetchedAt: GEN,
});
// 362 N9: 알리 행은 고지 문안(Kenny 결정 K2) 전까지 마크업이 빌드를 멈춘다 → 유효 피드 픽스처는 쿠팡 행.
const coupangWheelRow = (rank: number, title: string) => ({ ...wheelRow(rank, title), url: `https://link.coupang.com/a/Fz${rank}abcd` });
const VALID = feedDir([], '{}', [coupangWheelRow(1, '햄스터 쳇바퀴 30cm 통면')]);
const ALI = feedDir([wheelRow(1, '햄스터 쳇바퀴 30cm 통면')]);

describe('CLI 상품 피드 게이트', () => {
  it('꺼짐(개발·env 없음·오리진 밖) → 깨진 피드 디렉터리도 읽지 않고 exit 0, 피드 산출물 0', async () => {
    const broken = feedDir([], '{ not json');
    for (const env of [{ ...PROD_ON, NODE_ENV: 'development', SITE_ORIGIN: 'http://localhost:3001' }, PROD, { ...PROD_ON, WS_AFFILIATE_ORIGINS: 'https://other.example' }]) {
      const out = outDir();
      const r = await run(['--out', out, '--seed-dir', seedDir, '--product-feed-dir', broken], env);
      expect(r.code, JSON.stringify(env)).toBe(0);
      expect(files(out).filter((f) => f.includes('/feed/') || f === 'feed-manifest.json')).toEqual([]);
    }
  });

  it('켜짐 + 무효 피드(JSON 아님·없는 디렉터리) → exit 2, 산출물 0', async () => {
    for (const d of [feedDir([], '{ not json'), join(tmp('none'), 'missing')]) {
      const out = outDir();
      const r = await run(['--out', out, '--seed-dir', seedDir, '--product-feed-dir', d], PROD_ON);
      expect(r.code, d).toBe(2);
      expect(files(out)).toEqual(['index.html']);
    }
  });

  it('켜짐 + 커밋된 빈 피드 → 꺼짐 빌드와 바이트 동일', async () => {
    const on = outDir();
    const off = outDir();
    const r1 = await run(['--out', on, '--seed-dir', seedDir, '--product-feed-dir', DEFAULT_PRODUCT_FEED_DIR], PROD_ON);
    const r2 = await run(['--out', off, '--seed-dir', seedDir], PROD);
    expect([r1.code, r2.code]).toEqual([0, 0]);
    expect(files(on)).toEqual(files(off));
    for (const f of files(on)) expect(readFileSync(join(on, f), 'utf8'), f).toBe(readFileSync(join(off, f), 'utf8'));
  });

  it('켜짐 + 유효 피드 → feed JSON 2변형 + manifest, 재빌드(−170h)는 옛 피드 파일을 지운다', async () => {
    const out = outDir();
    const r = await run(['--out', out, '--seed-dir', seedDir, '--product-feed-dir', VALID], PROD_ON);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(files(out).filter((f) => f.includes('/feed/') || f === 'feed-manifest.json')).toEqual([
      'feed-manifest.json',
      'hamster/golden/feed/wheel.json',
      'hamster/golden/feed/wheel.noprice.json',
    ]);
    expect(r.out.some((l) => l.startsWith('prerender — product feed on'))).toBe(true);
    // N9: HTML 변형도 쓰고, 재빌드(−170h)는 변형도 지운다(기본 index.html 은 남는다)
    const variants = (d: string) => files(d).filter((f) => /index\.feed(-noprice)?\.html$/.test(f));
    expect(variants(out)).toContain('hamster/golden/supplies/wheel/index.feed.html');
    expect(variants(out)).toContain('hamster/golden/supplies/wheel/index.feed-noprice.html');
    const r2 = await run(['--out', out, '--seed-dir', seedDir, '--product-feed-dir', VALID], PROD_ON, GEN_MS + 170 * H);
    expect(r2.code).toBe(0);
    expect(files(out).filter((f) => f.includes('/feed/') || f === 'feed-manifest.json')).toEqual([]);
    expect(variants(out)).toEqual([]);
    expect(files(out)).toContain('hamster/golden/supplies/wheel/index.html');
  });

  it('알리 행 → exit 1(알리 고지 문안 결정 전), 산출물 쓰기 0', async () => {
    const out = outDir();
    const r = await run(['--out', out, '--seed-dir', seedDir, '--product-feed-dir', ALI], PROD_ON);
    expect(r.code).toBe(1);
    expect(r.err.join(' ')).toMatch(/알리 고지 문안 Kenny 결정 전/);
    expect(files(out).filter((f) => f.includes('/feed/') || f === 'feed-manifest.json')).toEqual([]);
  });

  it('−80h → full 미생성, noprice 에 price 키 0', async () => {
    const out = outDir();
    const r = await run(['--out', out, '--seed-dir', seedDir, '--product-feed-dir', VALID], PROD_ON, GEN_MS + 80 * H);
    expect(r.err).toEqual([]);
    expect(r.code).toBe(0);
    expect(files(out).filter((f) => f.includes('/feed/'))).toEqual(['hamster/golden/feed/wheel.noprice.json']);
    expect(readFileSync(join(out, 'hamster/golden/feed/wheel.noprice.json'), 'utf8')).not.toMatch(/price/);
  });
});
