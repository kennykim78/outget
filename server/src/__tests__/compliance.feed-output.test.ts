// 362 N12 — 피드 있는 실제 프리렌더 산출물(변형 HTML·피드 JSON·feed-manifest)을 compliance 산출물 규칙
//   (scanOutputs·scanAffiliateOutputs)에 통과시키고, 변이(○ 배지·카드 표지 삭제·기본 파일 피드·noprice 가격·외부 img·수수료 키)는 FAIL 로 잡히는지 본다.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSearchKeyword, createCatalog, resolveRequirement, type AnimalTypeRec, type SeedBundle } from '../engine/index.js';
import type { FeedRowIn } from '../engine/feed-types.js';
import { FEED_IMAGE_HOSTS, FEED_LINK_RE } from '../engine/providers.js';
import { lintText } from '../seed/lint.js';
import { buildSite } from '../prerender/site.js';
import { SEED_FILES } from '../seed/common.js';
import { realSeed } from './fixtures/prerender-seed.js';
import { baseOptions } from './fixtures/affiliate/baseline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const imp = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(join(ROOT, ...rel.split('/'))).href)) as T;
type Finding = { rule: string; severity: string; file: string; message: string };
type Add = (rule: string, severity: string, file: string, line: number | null, message: string) => void;
const out = await imp<{ scanOutputs: (o: Record<string, unknown>) => string }>('scripts/lib/rules-output.mjs');
const aff = await imp<{
  scanAffiliateOutputs: (o: Record<string, unknown>) => void;
  FEED_LINK_RES: Record<string, RegExp>;
  FEED_IMG_HOSTS: Record<string, readonly string[]>;
}>('scripts/lib/rules-affiliate.mjs');
const exm = await imp<{ computeExposure: (s: Record<string, unknown[]>, asOf: string) => unknown }>('scripts/lib/seed-exposure.mjs');
const norm = await imp<{ loadBannedWords: (p: string) => unknown }>('scripts/lib/normalize.mjs');
const BW = norm.loadBannedWords(join(ROOT, 'server', 'src', 'seed', 'banned-words.json'));

const seed = realSeed();
const cat = createCatalog(seed);
const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;
const G = 'hamster-golden';
const DIGEST = 'a'.repeat(64);
const AS_OF = '2026-11-23'; // 9타입 전부 노출(compliance.tips-output 과 같은 기준일)
const opt = () => ({ ...baseOptions(AS_OF), production: true, indexable: false }); // 처리방침 6값 없는 시험 빌드 — 비공개(C9-PRIVACY)

function kw(t: string, i: string): string {
  const at = seed.animalTypes.find((a) => a.id === t) as AnimalTypeRec;
  const r = resolveRequirement(cat, t, i);
  if (!r) throw new Error(`no requirement ${t}/${i}`);
  return buildSearchKeyword(at, r);
}
let seq = 0;
const row = (t: string, i: string, title: string): FeedRowIn => {
  seq += 1;
  return { provider: 'COUPANG', animalTypeId: t, supplyItemId: i, keyword: kw(t, i), rank: seq, title, url: `https://link.coupang.com/a/Mk${seq}x`, imageUrl: null, price: { amount: 12900, currency: 'KRW' }, fetchedAt: GEN };
};
const ROWS: FeedRowIn[] = [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면'), row(G, 'wheel', '햄스터 쳇바퀴 32cm 통면'), row(G, 'hideout', '햄스터 나무 은신처')];

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const raw = (s: SeedBundle): Record<string, unknown[]> => Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, (s[k as keyof SeedBundle] ?? []) as unknown[]]));

function scanBuilt(buildAtMs: number, mutate: (files: Map<string, string>) => void = () => {}): Finding[] {
  const b = buildSite(seed, { ...opt(), productFeed: { rows: ROWS, generatedAt: GEN, buildAtMs, isTitleBanned: (t) => lintText(t).length > 0 } });
  const files = new Map(b.files);
  mutate(files);
  const root = mkdtempSync(join(tmpdir(), 'ws-362-'));
  temps.push(root);
  const dist = join(root, 'dist');
  mkdirSync(join(root, 'server', 'src', 'privacy'), { recursive: true });
  writeFileSync(join(root, 'server', 'src', 'privacy', 'policy.ts'), readFileSync(join(ROOT, 'server', 'src', 'privacy', 'policy.ts')));
  for (const [rel, c] of files) {
    const abs = join(dist, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, c);
  }
  const findings: Finding[] = [];
  const add: Add = (rule, severity, file, _line, message) => findings.push({ rule, severity, file, message });
  const ex = exm.computeExposure(raw(seed), AS_OF);
  expect(out.scanOutputs({ root, dist, ex, digest: DIGEST, bw: BW, add, requireOutput: true, seed: raw(seed) })).toBe('RUN');
  aff.scanAffiliateOutputs({ root, dist, add });
  return findings.filter((f) => f.severity === 'FAIL');
}
const edit = (path: string, f: (s: string) => string) => (files: Map<string, string>) => {
  const s = files.get(path);
  if (s === undefined) throw new Error(`no file ${path}`);
  const n = f(s);
  if (n === s) throw new Error(`mutation no-op ${path}`);
  files.set(path, n);
};
const T_FULL = 'hamster/golden/supplies/wheel/index.feed.html';
const T_NP = 'hamster/golden/supplies/wheel/index.feed-noprice.html';
const HOME_FULL = 'index.feed.html';

describe('N12 스캐너 상수 = providers.ts', () => {
  it('FEED_LINK_RES·FEED_IMG_HOSTS 일치', () => {
    for (const p of ['COUPANG', 'ALIEXPRESS'] as const) {
      expect(aff.FEED_LINK_RES[p].source).toBe(FEED_LINK_RE[p].source);
      expect([...aff.FEED_IMG_HOSTS[p]]).toEqual([...FEED_IMAGE_HOSTS[p]]);
    }
  });
});

describe('N12 피드 산출물(C11-FEED-OUT·C2-PRICE·C8)', () => {
  it('full·noprice 실제 빌드 — 산출물 FAIL 0', () => {
    let has = false;
    expect(scanBuilt(GEN_MS + H, (f) => (has = f.has(T_FULL) && f.has('feed-manifest.json')))).toEqual([]);
    expect(has).toBe(true);
    expect(scanBuilt(GEN_MS + 80 * H, (f) => (has = f.has(T_NP)))).toEqual([]);
    expect(has).toBe(true);
  });

  it.each([
    ['피드 카드 ○ 배지', T_FULL, (s: string) => s.replace('ws-feed-badge--', 'ws-badge ws-feed-badge--'), 'C11-FEED-OUT'],
    ['카드 표지 삭제', T_FULL, (s: string) => s.replace(/<span[^>]*data-ws-aff="card"[^>]*>[^<]*<\/span>/, ''), null],
    ['noprice 에 가격 줄', T_NP, (s: string) => s.replace(/(<li class="ws-feed-row[\s\S]*?)<\/li>/, '$1<p class="ws-feed-price">12,900원 · 11월 23일 확인</p></li>'), 'C11-FEED-OUT'],
    ['피드 밖 외부 img', T_FULL, (s: string) => s.replace('</main>', '<img src="https://ae01.alicdn.com/x.jpg" alt=""></main>'), 'C8'],
    ['ws-data 피드 밖 가격 키', T_FULL, (s: string) => s.replace('"route":{', '"route":{"price":1,'), 'C2-PRICE'],
  ])('%s → FAIL', (_n, file, f, rule) => {
    const at = file === T_NP ? GEN_MS + 80 * H : GEN_MS + H;
    const r = scanBuilt(at, edit(file, f));
    expect(r.length, JSON.stringify(r)).toBeGreaterThan(0);
    if (rule) expect(r.some((x) => x.rule.startsWith(rule)), JSON.stringify(r)).toBe(true);
  });

  it('기본 파일에 피드 블록 이식 → C11-FEED-OUT', () => {
    const r = scanBuilt(GEN_MS + H, (files) => {
      const v = files.get(T_FULL) as string;
      const sec = /<section class="ws-supply-part ws-feed"[\s\S]*?<\/section>/.exec(v)?.[0] ?? '';
      expect(sec).not.toBe('');
      files.set('hamster/golden/supplies/wheel/index.html', (files.get('hamster/golden/supplies/wheel/index.html') as string).replace('</main>', `${sec}</main>`));
    });
    expect(r.some((x) => x.rule === 'C11-FEED-OUT' || x.rule.startsWith('C10')), JSON.stringify(r)).toBe(true);
  });

  it('피드 JSON 수수료 키·noprice 가격 키 → C11-FEED-OUT', () => {
    const r = scanBuilt(GEN_MS + H, (files) => {
      const k = [...files.keys()].find((p) => /\/feed\/[^/]+\.noprice\.json$/.test(p)) as string;
      expect(k).toBeTruthy();
      const d = JSON.parse(files.get(k) as string) as Record<string, unknown>;
      files.set(k, JSON.stringify({ ...d, commission: 1, price: 3 }));
    });
    expect(r.filter((x) => x.rule === 'C11-FEED-OUT').length, JSON.stringify(r)).toBeGreaterThanOrEqual(2);
  });

  it('홈 변형 피드 카드 0 유지(홈 기본 파일 피드 없음)', () => {
    const b = buildSite(seed, { ...opt(), productFeed: { rows: ROWS, generatedAt: GEN, buildAtMs: GEN_MS + H, isTitleBanned: () => false } });
    expect(b.files.get('index.html') ?? '').not.toContain('ws-feed-card');
    void HOME_FULL;
  });
});
