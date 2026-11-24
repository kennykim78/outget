// 362 N6·N7 — 정적 피드 JSON(C1: ws-data 밖) + 만료 변형(full/noprice, nofeed = 파일 0) + feed-manifest + 홈 레일 최소 모델.
//   실시드 + 손으로 만든 행. 피드 옵션이 없으면 buildSite 산출물은 그대로(off 기준선 sha256 은 prerender.affiliate-toggle 이 지킨다).
import { describe, expect, it } from 'vitest';
import { buildSearchKeyword, createCatalog, resolveRequirement, type AnimalTypeRec } from '../engine/index.js';
import type { FeedRowIn } from '../engine/feed-types.js';
import { lintText } from '../seed/lint.js';
import { buildSite, type BuildSiteOptions } from '../prerender/site.js';
import { WS_DATA_MAX_BYTES } from '../prerender/cli.js';
import { realSeed } from './fixtures/prerender-seed.js';
import { REAL_AS_OF, baseOptions } from './fixtures/affiliate/baseline.js';

const seed = realSeed();
const cat = createCatalog(seed);
const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;
const G = 'hamster-golden';

function kw(t: string, i: string): string {
  const at = seed.animalTypes.find((a) => a.id === t) as AnimalTypeRec;
  const r = resolveRequirement(cat, t, i);
  if (!r) throw new Error(`no requirement ${t}/${i}`);
  return buildSearchKeyword(at, r);
}
let seq = 0;
function row(t: string, i: string, title: string, over: Partial<FeedRowIn> = {}): FeedRowIn {
  seq += 1;
  return {
    provider: 'COUPANG',
    animalTypeId: t,
    supplyItemId: i,
    keyword: kw(t, i),
    rank: seq,
    title,
    url: `https://link.coupang.com/a/Fz${seq}x`,
    imageUrl: null,
    price: { amount: 12900, currency: 'KRW' },
    fetchedAt: GEN,
    ...over,
  };
}

const ROWS: FeedRowIn[] = [
  row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면'),
  row(G, 'wheel', '햄스터 쳇바퀴 28cm 통면'),
  row(G, 'hideout', '햄스터 나무 은신처'),
  row(G, 'food', '햄스터 사료'),
];

const opts = (buildAtMs: number, rows = ROWS, generatedAt: string | null = GEN): BuildSiteOptions => ({
  ...baseOptions(REAL_AS_OF),
  productFeed: { rows, generatedAt, buildAtMs, isTitleBanned: (t) => lintText(t).length > 0 },
});

const off = buildSite(seed, baseOptions(REAL_AS_OF));
const feedKeys = (files: Map<string, string>) => [...files.keys()].filter((k) => k.includes('/feed/') || k === 'feed-manifest.json').sort();

describe('N6 정적 피드 JSON', () => {
  const on = buildSite(seed, opts(GEN_MS + H));

  it('/hamster/golden/feed/wheel.json 생성, FOOD/HEALTH 품목 JSON 0', () => {
    expect(feedKeys(on.files)).toEqual([
      'feed-manifest.json',
      'hamster/golden/feed/hideout.json',
      'hamster/golden/feed/hideout.noprice.json',
      'hamster/golden/feed/wheel.json',
      'hamster/golden/feed/wheel.noprice.json',
    ]);
    const j = JSON.parse(on.files.get('hamster/golden/feed/wheel.json') as string);
    expect(j).toMatchObject({ v: 1, typeId: G, supplyItemId: 'wheel', badge: 'LISTED_PASS', generalInfo: false, priceCheckedOn: '2026-11-23' });
    expect(j.rows.map((r: { verdict: string }) => r.verdict)).toEqual(['OK', 'BELOW_RECOMMENDED']);
    expect(Object.keys(j.rows[0])).toEqual(['provider', 'title', 'url', 'imageUrl', 'price', 'verdict', 'specValues']);
    expect(j.rows[0].price).toEqual({ amount: 12900, currency: 'KRW' });
    // 수집 메타(rank·keyword·fetchedAt)는 싣지 않는다
    expect(on.files.get('hamster/golden/feed/wheel.json')).not.toMatch(/"rank"|"keyword"|"fetchedAt"/);
  });

  it('피드 밖 파일은 off 빌드와 바이트 동일(ws-data 증가 0 ≤ 1.5KB·≤ 32KB)', () => {
    for (const [k, v] of off.files) expect(on.files.get(k), k).toBe(v);
    for (const p of on.pages) {
      const o = off.pages.find((x) => x.route.path === p.route.path);
      expect(p.wsDataBytes - (o?.wsDataBytes ?? 0)).toBeLessThanOrEqual(1536);
      expect(p.wsDataBytes).toBeLessThanOrEqual(WS_DATA_MAX_BYTES);
    }
  });

  it('홈 레일 모델: LISTED_PASS·비 GENERAL_INFO 만, 품목당 1장(첫 행)', () => {
    const rail = on.feedRail.get(G) ?? [];
    expect(rail.map((c) => [c.supplyItemId, c.title])).toEqual([['wheel', '햄스터 쳇바퀴 30cm 통면']]);
    expect(off.feedRail.size).toBe(0);
  });

  it('결정론: 두 번 빌드해도 같은 바이트', () => {
    const again = buildSite(seed, opts(GEN_MS + H));
    for (const k of feedKeys(on.files)) expect(again.files.get(k)).toBe(on.files.get(k));
  });

  it('행이 남지 않는 품목은 파일 0, 행 0 이면 manifest 도 0', () => {
    const b = buildSite(seed, opts(GEN_MS + H, [row(G, 'wheel', '햄스터 쳇바퀴 25cm 통면')]));
    expect(feedKeys(b.files)).toEqual([]);
  });
});

describe('N7 만료 변형', () => {
  it('빌드 −1h: full·noprice 둘 다, manifest priceUntil/blockUntil = +72h/+168h(+09:00)', () => {
    const b = buildSite(seed, opts(GEN_MS + H));
    const m = JSON.parse(b.files.get('feed-manifest.json') as string);
    expect(m).toEqual({
      v: 1,
      generatedAt: GEN,
      priceUntil: '2026-11-26T09:12:00+09:00',
      blockUntil: '2026-11-30T09:12:00+09:00',
      variants: {
        full: ['hamster/golden/feed/hideout.json', 'hamster/golden/feed/wheel.json'],
        noprice: ['hamster/golden/feed/hideout.noprice.json', 'hamster/golden/feed/wheel.noprice.json'],
      },
      pages: { full: b.feedPages.filter((x) => x.stage === 'full').map((x) => x.file).sort(), noprice: b.feedPages.filter((x) => x.stage === 'noprice').map((x) => x.file).sort() },
    });
    // N9 HTML 변형 목록: 골든 TYPE 라우트 전부 + 블록 있는 /supplies/{item}/{type}, 두 단계 같은 경로 집합
    expect(m.pages.full).toContain('hamster/golden/index.feed.html');
    expect(m.pages.full).toContain('supplies/wheel/hamster-golden/index.feed.html');
    expect(m.pages.noprice).toEqual(m.pages.full.map((f: string) => f.replace(/index\.feed\.html$/, 'index.feed-noprice.html')));
    for (const f of [...m.pages.full, ...m.pages.noprice]) expect(b.files.has(f), f).toBe(true);
    const np = b.files.get('hamster/golden/feed/wheel.noprice.json') as string;
    expect(np).not.toMatch(/price|원/);
  });

  it('빌드 −80h: full 미생성, noprice 에 가격 키·가격 줄 0', () => {
    const b = buildSite(seed, opts(GEN_MS + 80 * H));
    expect(feedKeys(b.files)).toEqual(['feed-manifest.json', 'hamster/golden/feed/hideout.noprice.json', 'hamster/golden/feed/wheel.noprice.json']);
    const m = JSON.parse(b.files.get('feed-manifest.json') as string);
    expect(m.variants.full).toEqual([]);
    for (const k of feedKeys(b.files).filter((x) => x.endsWith('.noprice.json'))) expect(b.files.get(k)).not.toMatch(/price/i);
  });

  it('빌드 −170h·generatedAt null: 피드 JSON·manifest 0, 나머지는 off 와 같다', () => {
    for (const b of [buildSite(seed, opts(GEN_MS + 170 * H)), buildSite(seed, opts(GEN_MS + H, ROWS, null))]) {
      expect(feedKeys(b.files)).toEqual([]);
      expect([...b.files.keys()].sort()).toEqual([...off.files.keys()].sort());
      expect(b.feedRail.size).toBe(0);
    }
  });

  it('noprice 변형에서는 홈 레일 카드에 price 키 0', () => {
    const b = buildSite(seed, opts(GEN_MS + 80 * H));
    const rail = b.feedRail.get(G) ?? [];
    expect(rail.length).toBe(1);
    expect(Object.keys(rail[0])).not.toContain('price');
  });
});
