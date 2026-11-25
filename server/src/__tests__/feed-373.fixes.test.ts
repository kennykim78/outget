// 373 — QA 372 결함 D1~D5 회귀 시험(TDD: 먼저 실패 확인 → 수정). 실호출·키 0, 손으로 만든 dist·행만.
//   D1 spa 피드 가드 = 정적 서빙이 실제로 고르는 정규화 경로 기준(이중 슬래시·대소문자·%2F·%5C·역슬래시·후행 문자·변형 HTML 직접).
//   D2 상품 제목 가격·날짜 → selectFeedRows 가 행을 싣지 않음(규격 치수는 그대로).
//   D3 미래 generatedAt(시계 오차 초과) → 로더 throw·엔진/런타임 nofeed.
//   D4 확인일 = fetchedAt(Asia/Seoul), 신선도 기준 = generatedAt·fetchedAt 중 가장 오래된 값.
//   D5 린트 정규화 Default_Ignorable 전부 제거 + 영문 금지어 대소문자 무시(server lint ↔ scripts normalize 동일).
import { afterAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { securityHeaders } from '../middleware/security-headers.js';
import { mountSpa } from '../middleware/spa.js';
import { buildSearchKeyword, createCatalog, resolveRequirement, selectFeedRows, type AnimalTypeRec } from '../engine/index.js';
import { FEED_CLOCK_SKEW_MS, feedFreshAt, feedStage, feedTitleHasPriceOrDate, type FeedRowIn } from '../engine/feed-types.js';
import { loadProductFeeds, parseProductFeed } from '../prerender/product-feed.js';
import { buildSite } from '../prerender/site.js';
import { lintText, normalizeLintText } from '../seed/lint.js';
import { realSeed } from './fixtures/prerender-seed.js';
import { REAL_AS_OF, baseOptions } from './fixtures/affiliate/baseline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;
const T = 'hamster/golden';
const W = `${T}/supplies/wheel`;

// ── D1 ────────────────────────────────────────────────────────────────────────────────
function put(root: string, rel: string, body: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}
function dist(generatedAt = GEN): string {
  const d = mkdtempSync(join(tmpdir(), 'ws-373-spa-'));
  temps.push(d);
  put(d, 'index.html', 'HOME-DEFAULT');
  put(d, '404.html', 'NOT-FOUND-PAGE');
  put(d, `${T}/index.html`, 'TYPE-DEFAULT');
  put(d, `${W}/index.html`, 'WHEEL-DEFAULT');
  put(d, 'assets/app.js', 'APP-JS');
  const routes = [
    { path: '/', file: 'index.html', kind: 'HOME' },
    { path: '/hamster/golden', file: `${T}/index.html`, kind: 'TYPE' },
    { path: '/hamster/golden/supplies/wheel', file: `${W}/index.html`, kind: 'SUPPLY_ITEM_TYPE' },
    { path: '/404', file: '404.html', kind: 'NOT_FOUND' },
  ];
  put(d, 'prerender-manifest.json', JSON.stringify({ v: 1, routes }));
  put(d, `${T}/index.feed.html`, 'TYPE-FULL');
  put(d, `${W}/index.feed.html`, 'WHEEL-FULL');
  put(d, `${T}/index.feed-noprice.html`, 'TYPE-NOPRICE');
  put(d, `${W}/index.feed-noprice.html`, 'WHEEL-NOPRICE');
  put(d, `${T}/feed/wheel.json`, '{"stage":"full","price":12900}');
  put(d, `${T}/feed/wheel.noprice.json`, '{"stage":"noprice"}');
  const man = {
    v: 1,
    generatedAt,
    priceUntil: '2026-11-26T09:12:00+09:00',
    blockUntil: '2026-11-30T09:12:00+09:00',
    variants: { full: [`${T}/feed/wheel.json`], noprice: [`${T}/feed/wheel.noprice.json`] },
    pages: { full: [`${T}/index.feed.html`, `${W}/index.feed.html`], noprice: [`${T}/index.feed-noprice.html`, `${W}/index.feed-noprice.html`] },
  };
  put(d, 'feed-manifest.json', JSON.stringify(man));
  return d;
}
function appFor(d: string, now: number): Express {
  const app = express();
  app.use(securityHeaders);
  mountSpa(app, { clientDist: d, nowMs: () => now });
  return app;
}
const get = async (app: Express, p: string) => {
  const r = await request(app).get(p);
  return { status: r.status, text: r.text };
};

/** 같은 파일을 가리키는 우회 표기(정적 서빙·OS 가 정규화해 주는 꼴). */
const bypasses = (dir: string, file: string): string[] => {
  const [a, b] = [dir, file];
  const up = (s: string) => s.toUpperCase();
  return [
    `/${a}//${b}`,
    `/${a.replace('/feed', '//feed')}/${b}`,
    `//${a}/${b}`,
    `/${a}///${b}`,
    `/${a}/./${b}`,
    `/${a}/x/../${b}`,
    `/${a}%2F${b}`,
    `/${a}%2f${b}`,
    `/${a.replace(/\//g, '%2F')}%2F${b}`,
    `/${a}%5C${b}`,
    `/${a}%5c${b}`,
    `/${a}\\${b}`,
    `/${a.replace(/\//g, '\\')}\\${b}`,
    `/${up(a)}/${b}`,
    `/${a}/${up(b)}`,
    `/${a.replace('feed', 'Feed')}/${b.replace('json', 'Json')}`,
    `/${a}/${b}.`,
    `/${a}/${b}%20`,
    `/${a}/${b}%2E`,
    `/${a}/${b}::$DATA`,
    `/${a}/${b}%3A%3A%24DATA`,
    `/${a}/${b}/`,
    `/${a}/${b.replace('.', '%2E')}`,
    `/${a}/${b}.br`,
    `/${a}/${b}.gz`,
  ];
};

describe('D1 피드 가드 = 정규화된 정적 경로 기준', () => {
  it('만료 full JSON(80h·169h): 우회 표기 전부 200 아님·본문 노출 0', async () => {
    const d = dist();
    for (const h of [80, 169]) {
      const app = appFor(d, GEN_MS + h * H);
      for (const p of bypasses(`${T}/feed`, 'wheel.json')) {
        const r = await get(app, p);
        expect(r.status, `${h}h ${p}`).not.toBe(200);
        expect(r.text, `${h}h ${p}`).not.toMatch(/stage|12900/);
      }
    }
  });

  it('만료 noprice JSON(169h): 우회 표기 전부 200 아님', async () => {
    const app = appFor(dist(), GEN_MS + 169 * H);
    for (const p of bypasses(`${T}/feed`, 'wheel.noprice.json')) {
      const r = await get(app, p);
      expect(r.status, p).not.toBe(200);
      expect(r.text, p).not.toMatch(/stage/);
    }
  });

  it('변형 HTML 직접 요청(full 단계): 우회 표기 전부 200 아님', async () => {
    const app = appFor(dist(), GEN_MS + H);
    for (const [dir, f] of [
      [T, 'index.feed.html'],
      [T, 'index.feed-noprice.html'],
      [W, 'index.feed.html'],
      [W, 'index.feed-noprice.html'],
    ] as const) {
      for (const p of bypasses(dir, f)) {
        const r = await get(app, p);
        expect(r.status, p).not.toBe(200);
        expect(r.text, p).not.toMatch(/FULL|NOPRICE/);
      }
    }
  });

  it('정상 경로·정상 자산은 그대로(full 단계 JSON 200, 자산 200, 라우트 변형 선택)', async () => {
    const app = appFor(dist(), GEN_MS + H);
    expect((await get(app, `/${T}/feed/wheel.json`)).status).toBe(200);
    expect((await get(app, `/${T}/feed/wheel.noprice.json`)).status).toBe(200);
    expect((await get(app, '/assets/app.js')).text).toBe('APP-JS');
    expect((await get(app, '/hamster/golden')).text).toBe('TYPE-FULL');
  });
});

// ── 공용: 실시드 행 ─────────────────────────────────────────────────────────────────
const seed = realSeed();
const cat = createCatalog(seed);
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
    rank: (seq % 10) + 1,
    title,
    url: `https://link.coupang.com/a/Fx${seq}y`,
    imageUrl: null,
    price: { amount: 12900, currency: 'KRW' },
    fetchedAt: GEN,
    ...over,
  };
}
const isTitleBanned = (t: string): boolean => lintText(t).length > 0;
const sel = (rows: FeedRowIn[], buildAtMs = GEN_MS + H, generatedAt: string | null = GEN) =>
  selectFeedRows(cat, G, 'wheel', rows, { asOf: REAL_AS_OF, buildAtMs, generatedAt, isTitleBanned });
const siteOpts = (buildAtMs: number, rows: FeedRowIn[], generatedAt: string | null = GEN) => ({
  ...baseOptions(REAL_AS_OF),
  productFeed: { rows, generatedAt, buildAtMs, isTitleBanned },
});

// ── D2 ────────────────────────────────────────────────────────────────────────────────
const PRICE_DATE_TITLES = [
  '햄스터 쳇바퀴 30cm 통면 12,900원',
  '햄스터 쳇바퀴 30cm 통면 12900 원',
  '₩12,900 햄스터 쳇바퀴 30cm 통면',
  '￦12900 햄스터 쳇바퀴 30cm 통면',
  'KRW 12900 햄스터 쳇바퀴 30cm 통면',
  '햄스터 쳇바퀴 30cm 통면 12900krw',
  '햄스터 쳇바퀴 30cm 통면 1만원',
  '햄스터 쳇바퀴 30cm 통면 $9.99',
  '햄스터 쳇바퀴 30cm 통면 11월 20일 입고',
  '햄스터 쳇바퀴 30cm 통면 2026-11-20',
  '햄스터 쳇바퀴 30cm 통면 2026.11.20 출고',
  '햄스터 쳇바퀴 30cm 통면 11/20 입고',
  '햄스터 쳇바퀴 30cm 통면 2026년',
  '햄스터 쳇바퀴 30cm 통면 １２，９００원',
];
const SPEC_TITLES = ['햄스터 쳇바퀴 30cm 통면', '햄스터 쳇바퀴 32cm 통면 스탠드', '케이지 60×40×35cm', '베딩 1.5kg 15cm', '원형 쳇바퀴 30cm 통면', '28cm 원목 쳇바퀴', '2단 원목 은신처', '6개월 이상 사용'];

describe('D2 제목 가격·날짜 → 행을 싣지 않음(selectFeedRows 한 곳)', () => {
  it('판정 함수: 가격·날짜 표기는 적중, 규격 치수는 적중 0', () => {
    for (const t of PRICE_DATE_TITLES) expect(feedTitleHasPriceOrDate(t), t).toBe(true);
    for (const t of SPEC_TITLES) expect(feedTitleHasPriceOrDate(t), t).toBe(false);
  });

  it('selectFeedRows: 가격·날짜 제목 행 0, 규격 제목 행은 남는다', () => {
    const s = sel([...PRICE_DATE_TITLES.map((t) => row(G, 'wheel', t)), row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면')]);
    expect(s?.rows.map((r) => r.title)).toEqual(['햄스터 쳇바퀴 30cm 통면']);
  });

  it('buildSite noprice(80h): 가격·날짜 제목이 산출물 어디에도 없다', () => {
    const b = buildSite(seed, siteOpts(GEN_MS + 80 * H, [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면 12,900원'), row(G, 'wheel', '햄스터 쳇바퀴 32cm 통면 11월 20일 입고'), row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면')]));
    for (const [k, v] of b.files) {
      expect(v.includes('12,900원'), k).toBe(false);
      expect(v.includes('11월 20일 입고'), k).toBe(false);
    }
    expect(b.files.get('hamster/golden/feed/wheel.noprice.json')).toContain('햄스터 쳇바퀴 30cm 통면');
  });
});

// ── 374 D2 재검(N1 누수·N2 오탐) ─────────────────────────────────────────────────────────
const N1_LEAKS = [
  '12,900 ₩', '12,900₩', '12900￦', '12.99$', '1290¥', '€12', '£12', 'EUR 12', 'usd 12', 'JPY 1290', 'CNY 69', 'GBP 9', '1290円', '69元',
  '구천구백원', '만원', `12,900${String.fromCodePoint(0x301)}원`,
  '11.20 입고', '11-20 입고', '20일 입고', '20/11 입고', '입고 11.20', '11.25 까지', '11/30 마감', '11.20 특가', '세일 11-20', '11.20 기준',
  'Nov 20', '20 Nov', 'November 20', 'dec. 3', '26년형', '25년식',
].map((s) => `햄스터 쳇바퀴 30cm 통면 ${s}`);
const N2_SPECS = ['21/27/30cm', '12/16cm', '8/10mm', '1/2 사이즈', '3/4인치', '60.5-40-35cm', '3원통', '2원단', '24시간', '5000mAh', 'Deco 3', 'Max 20'].map(
  (s) => `햄스터 쳇바퀴 ${s} 통면`,
);

describe('374 D2 재검 — 통화 기호·코드·수사+원·맥락 날짜·월 이름·년형 적중, 규격 표기 비적중', () => {
  it.each(N1_LEAKS.map((t) => [t] as const))('N1 적중: %s', (t) => {
    expect(feedTitleHasPriceOrDate(t)).toBe(true);
  });
  it.each(N2_SPECS.map((t) => [t] as const))('N2 비적중: %s', (t) => {
    expect(feedTitleHasPriceOrDate(t)).toBe(false);
  });
  it('기존 372·373 표기·규격 판정 유지', () => {
    for (const t of PRICE_DATE_TITLES) expect(feedTitleHasPriceOrDate(t), t).toBe(true);
    for (const t of SPEC_TITLES) expect(feedTitleHasPriceOrDate(t), t).toBe(false);
  });
  it('374 재현: buildSite noprice(80h) — 「12,900 ₩」·「11.20 입고」 제목이 산출물 어디에도 없다', () => {
    const b = buildSite(
      seed,
      siteOpts(GEN_MS + 80 * H, [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면 12,900 ₩'), row(G, 'wheel', '햄스터 쳇바퀴 32cm 통면 11.20 입고'), row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면')]),
    );
    for (const [k, v] of b.files) {
      expect(v.includes('12,900 ₩'), k).toBe(false);
      expect(v.includes('11.20 입고'), k).toBe(false);
    }
    expect(b.files.get('hamster/golden/feed/wheel.noprice.json')).toContain('햄스터 쳇바퀴 30cm 통면');
  });
  it('N3: 결합 부호로 쪼갠 금지어 → 적중(server·scripts 같은 정규화)', async () => {
    const mod = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'normalize.mjs')).href)) as ScriptsNormalize;
    const bw = mod.compileBannedWords(JSON.parse(readFileSync(join(ROOT, 'server', 'src', 'seed', 'banned-words.json'), 'utf8')));
    for (const mark of [0x300, 0x301, 0x323]) {
      const s = `햄스터 인${String.fromCodePoint(mark)}기 구${String.fromCodePoint(mark)}매`;
      expect(lintText(s).map((h) => h.term), s).toEqual(expect.arrayContaining(['인기', '구매']));
      expect(mod.lintText(s, bw).map((h) => h.term), s).toEqual(expect.arrayContaining(['인기', '구매']));
      expect(mod.normalizeLintText(s, 'spaced')).toBe(normalizeLintText(s, 'spaced'));
    }
  });
});

// ── D3 ────────────────────────────────────────────────────────────────────────────────
const FUT = '2027-11-23T09:12:00+09:00';
function aliFile(generatedAt: string, fetchedAt: string): Record<string, unknown> {
  return {
    v: 1,
    provider: 'ALIEXPRESS',
    source: 'OFFICIAL_API',
    api: { method: 'aliexpress.affiliate.product.query', sort: 'LAST_VOLUME_DESC' },
    terms: { checkedAt: '2026-11-23', displayFields: ['title', 'url', 'imageUrl', 'price'] },
    generatedAt,
    rows: [
      {
        animalTypeId: G,
        supplyItemId: 'wheel',
        keyword: '골든햄스터 쳇바퀴',
        rank: 1,
        title: '햄스터 쳇바퀴 30cm 통면',
        url: 'https://s.click.aliexpress.com/e/_AbCd1234',
        imageUrl: null,
        price: { amount: 12900, currency: 'KRW' },
        fetchedAt,
      },
    ],
  };
}
const EMPTY_COUPANG = '{"v":1,"provider":"COUPANG","source":"OFFICIAL_API","api":{"method":null,"sort":null},"terms":{"checkedAt":null,"displayFields":[]},"generatedAt":null,"rows":[]}';

describe('D3 미래 generatedAt 거부(빌드·런타임)', () => {
  it('feedStage: 시계 오차(FEED_CLOCK_SKEW_MS) 이내 미래는 full, 넘으면 nofeed', () => {
    expect(FEED_CLOCK_SKEW_MS).toBeGreaterThan(0);
    expect(FEED_CLOCK_SKEW_MS).toBeLessThanOrEqual(10 * 60_000);
    expect(feedStage(GEN_MS - FEED_CLOCK_SKEW_MS, GEN)).toBe('full');
    expect(feedStage(GEN_MS - FEED_CLOCK_SKEW_MS - 1, GEN)).toBe('nofeed');
    expect(feedStage(Date.UTC(2026, 10, 23), FUT)).toBe('nofeed');
  });

  it('로더: 빌드 시각보다 미래인 generatedAt·fetchedAt → throw', () => {
    const now = GEN_MS + H;
    const read = (ali: Record<string, unknown>) => (name: string) => (name === 'coupang.json' ? EMPTY_COUPANG : JSON.stringify(ali));
    expect(() => loadProductFeeds(read(aliFile(FUT, FUT)), now)).toThrow(/미래/);
    expect(() => loadProductFeeds(read(aliFile(GEN, '2026-11-23T10:00:00+09:00')), GEN_MS)).toThrow(/미래/);
    expect(() => parseProductFeed(aliFile(FUT, FUT), 'ALIEXPRESS', { nowMs: now })).toThrow(/미래/);
    expect(loadProductFeeds(read(aliFile(GEN, GEN)), now)[1].rows).toHaveLength(1);
  });

  it('엔진·빌드: 미래 generatedAt → 피드 0(manifest 0)', () => {
    expect(sel([row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면', { fetchedAt: FUT })], Date.UTC(2026, 10, 23), FUT)).toBeNull();
    const b = buildSite(seed, siteOpts(Date.UTC(2026, 10, 23), [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면', { fetchedAt: FUT })], FUT));
    expect([...b.files.keys()].filter((k) => k.includes('/feed/') || k === 'feed-manifest.json')).toEqual([]);
  });

  it('런타임: manifest generatedAt 이 미래 → 변형·피드 JSON 0', async () => {
    const app = appFor(dist(FUT), GEN_MS + H);
    expect((await get(app, '/hamster/golden')).text).toBe('TYPE-DEFAULT');
    expect((await get(app, `/${T}/feed/wheel.json`)).status).toBe(404);
    expect((await get(app, `/${T}/feed/wheel.noprice.json`)).status).toBe(404);
  });
});

// ── D4 ────────────────────────────────────────────────────────────────────────────────
describe('D4 확인일 = fetchedAt(Asia/Seoul) · 신선도 = 가장 오래된 값', () => {
  it('feedFreshAt: generatedAt·행 fetchedAt 중 가장 이른 값, 형식 밖 fetchedAt → null', () => {
    const old = '2026-09-20T10:00:00+09:00';
    expect(feedFreshAt(GEN, [row(G, 'wheel', 'x', { fetchedAt: '2026-11-23T09:12:03+09:00' })])).toBe(GEN);
    expect(feedFreshAt(GEN, [row(G, 'wheel', 'x'), row(G, 'wheel', 'y', { fetchedAt: old })])).toBe(old);
    expect(feedFreshAt(GEN, [row(G, 'wheel', 'x', { fetchedAt: 'nope' })])).toBeNull();
    expect(feedFreshAt(null, [])).toBeNull();
  });

  it('오래된 fetchedAt(2개월) → 가격 노출 0·블록 0(generatedAt 이 오늘이어도)', () => {
    const rows = [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면', { fetchedAt: '2026-09-20T10:00:00+09:00' })];
    expect(sel(rows)).toBeNull();
    const b = buildSite(seed, siteOpts(GEN_MS + H, rows));
    expect([...b.files.keys()].filter((k) => k.includes('/feed/') || k === 'feed-manifest.json')).toEqual([]);
  });

  it('fetchedAt 이 80h 전 → noprice 만, manifest 기한도 그 값 기준', () => {
    const fAt = '2026-11-20T01:00:00+09:00'; // GEN+1h 빌드 기준 ≈ 81h 전
    const rows = [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면', { fetchedAt: fAt })];
    expect(sel(rows)?.showPrice).toBe(false);
    const b = buildSite(seed, siteOpts(GEN_MS + H, rows));
    expect(b.files.has('hamster/golden/feed/wheel.json')).toBe(false);
    const m = JSON.parse(b.files.get('feed-manifest.json') as string);
    expect(m.generatedAt).toBe(fAt);
    expect(m.priceUntil).toBe('2026-11-23T01:00:00+09:00');
    expect(m.blockUntil).toBe('2026-11-27T01:00:00+09:00');
  });

  it('priceCheckedOn = fetchedAt 의 서울 날짜(generatedAt 날짜 아님)', () => {
    // generatedAt 은 서울 11/24 00:30, fetchedAt 은 서울 11/23 23:50(같은 실행, 자정 걸침)
    const gen = '2026-11-23T15:30:00Z';
    const fAt = '2026-11-23T14:50:00Z';
    const buildAt = Date.UTC(2026, 10, 23, 16, 0, 0);
    const b = buildSite(seed, siteOpts(buildAt, [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면', { fetchedAt: fAt })], gen));
    const j = JSON.parse(b.files.get('hamster/golden/feed/wheel.json') as string);
    expect(j.priceCheckedOn).toBe('2026-11-23');
  });
});

// ── D5 ────────────────────────────────────────────────────────────────────────────────
interface ScriptsNormalize {
  normalizeLintText(s: string, mode: 'spaced' | 'stripped'): string;
  compileBannedWords(data: unknown): unknown;
  lintText(text: string, bw: unknown): Array<{ rule: string; term: string }>;
}
const ch = (cp: number): string => String.fromCodePoint(cp);
const pop = ['인', '기'];
const best = ['B', 'est'];

describe('D5 린트 정규화 — Default_Ignorable 전부 제거·영문 대소문자 무시', async () => {
  const mod = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'normalize.mjs')).href)) as ScriptsNormalize;
  const bw = mod.compileBannedWords(JSON.parse(readFileSync(join(ROOT, 'server', 'src', 'seed', 'banned-words.json'), 'utf8')));
  const DI = [0xfe0f, 0x3164, 0x034f, 0x2062, 0x2063, 0x2064, 0x115f, 0x1160, 0xffa0, 0x180e, 0x200d, 0x206a, 0xe0041, 0xfe00, 0x17b4];

  it.each(DI.map((cp) => [cp.toString(16)] as const))('U+%s 로 쪼갠 「인기」 → L01(server·scripts 같은 결과)', (hex) => {
    const s = `햄스터 ${pop[0]}${ch(parseInt(hex, 16))}${pop[1]} 쳇바퀴`;
    expect(lintText(s).map((h) => h.term), hex).toContain('인기');
    expect(mod.lintText(s, bw).map((h) => h.term), hex).toContain('인기');
    expect(mod.normalizeLintText(s, 'spaced')).toBe(normalizeLintText(s, 'spaced'));
  });

  // 기존 seed.lint 「소문자 best(코드 식별자)는 대상 아님」(353 §N2 결정) 단언을 약화하지 않으려 전부 소문자 ASCII 조각만 예외로 둔다.
  it('영문 금지어 대소문자 변형(Best·bEsT·BeSt·Ｂｅｓｔ) → BEST, 전부 소문자 best 만 예외 — 「확인기」 예외 유지', () => {
    for (const s of [best.join(''), 'bEsT 쳇바퀴', '햄스터BeSt', 'Ｂｅｓｔ 상품', `${best[0]}${ch(0x200b)}${best[1]}`]) {
      expect(lintText(s).map((h) => h.term), s).toContain('BEST');
      expect(mod.lintText(s, bw).map((h) => h.term), s).toContain('BEST');
    }
    expect(lintText('best')).toEqual([]);
    expect(mod.lintText('best', bw)).toEqual([]);
    expect(lintText('온도 확인기')).toEqual([]);
    expect(mod.lintText('온도 확인기', bw)).toEqual([]);
  });
});
