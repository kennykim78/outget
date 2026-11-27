// 362 N9 — 피드 HTML 변형(index.feed.html · index.feed-noprice.html) 마크업 + ws-data data.feed.
//   기본 파일은 피드 꺼짐 빌드와 바이트 동일(변형은 새 파일만). GENERAL_INFO 종은 △만·홈 피드 카드 0. ws-data 증가 ≤ 1.5KB·전체 ≤ 32KB.
import { describe, expect, it } from 'vitest';
import { buildSearchKeyword, createCatalog, decodeWsPage, FEED_EXCLUDED_CATEGORIES, feedJsonFile, isWsFeedData, resolveRequirement, type AnimalTypeRec } from '../engine/index.js';
import { FEED_POPULAR_SORTS, type FeedRowIn } from '../engine/feed-types.js';
import { feedSortsOf } from '../prerender/product-feed.js';
import type { ProductFeedInput } from '../prerender/feed-out.js';
import { COPY } from '../prerender/copy.js';
import { lintText } from '../seed/lint.js';
import { buildSite, type BuildSiteOptions } from '../prerender/site.js';
import { WS_DATA_MAX_BYTES } from '../prerender/cli.js';
import { FEED_WS_DATA_MAX_BYTES, feedWsDataBytes } from '../prerender/feed-out.js';
import { FIXTURE_AS_OF, promoted, realSeed } from './fixtures/prerender-seed.js';
import { REAL_AS_OF, baseOptions } from './fixtures/affiliate/baseline.js';

const seed = realSeed();
const cat = createCatalog(seed);
const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;
const G = 'hamster-golden';
const J = 'hamster-robo';

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
    url: `https://link.coupang.com/a/Mk${seq}x`,
    imageUrl: null,
    price: { amount: 12900, currency: 'KRW' },
    fetchedAt: GEN,
    ...over,
  };
}

const ROWS: FeedRowIn[] = [
  ...Array.from({ length: 8 }, (_, n) => row(G, 'wheel', `햄스터 쳇바퀴 30cm 통면 HW-${n + 1}`)),
  row(G, 'hideout', '햄스터 나무 은신처'),
  row(J, 'wheel', '쳇바퀴 30cm 통면'),
];

const opts = (buildAtMs: number, rows: FeedRowIn[] = ROWS): BuildSiteOptions => ({
  ...baseOptions(REAL_AS_OF),
  productFeed: { rows, generatedAt: GEN, buildAtMs, isTitleBanned: (t) => lintText(t).length > 0 },
});

const off = buildSite(seed, baseOptions(REAL_AS_OF));
const on = buildSite(seed, opts(GEN_MS + H));
const late = buildSite(seed, opts(GEN_MS + 80 * H));
// 로보(GENERAL_INFO) 는 draftedAt 2026-11-23 — 노출 기준일을 그날로 둔 빌드에서만 노출된다
const giAsOf = '2026-11-23';
const gi = buildSite(seed, { ...opts(GEN_MS + H), ...baseOptions(giAsOf), productFeed: opts(GEN_MS + H).productFeed });

const feedSection = (html: string): string => {
  const m = /<section class="ws-supply-part ws-feed"[\s\S]*?<\/section>/.exec(html);
  return m ? m[0] : '';
};
const homeSection = (html: string, id: string): string => {
  const m = new RegExp(`<section[^>]*data-ws-section="${id}"[\\s\\S]*?</section>`).exec(html);
  return m ? m[0] : '';
};
const wsData = (html: string): unknown => {
  const m = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('ws-data 없음');
  return JSON.parse(m[1]);
};
const count = (s: string, needle: string | RegExp): number => (typeof needle === 'string' ? s.split(needle).length - 1 : (s.match(needle) ?? []).length);

describe('N9 기본 파일 불변', () => {
  it('off 빌드 파일은 모두 바이트 동일, 변형은 새 경로만', () => {
    for (const [k, v] of off.files) expect(on.files.get(k), k).toBe(v);
    const added = [...on.files.keys()].filter((k) => !off.files.has(k));
    for (const k of added) expect(k, k).toMatch(/(^|\/)feed\/[^/]+\.json$|^feed-manifest\.json$|\/index\.feed(-noprice)?\.html$/);
  });

  it('변형 대상: 블록 있는 타입의 TYPE 라우트 + 문서 요구사항 중 블록 있는 SIT만(SETUP·TIPS·홈 0)', () => {
    for (const p of on.feedPages) {
      expect(['TYPE', 'SUPPLY_ITEM_TYPE']).toContain(p.route.kind);
      expect(p.file).toBe(p.route.file.replace(/index\.html$/, p.stage === 'full' ? 'index.feed.html' : 'index.feed-noprice.html'));
    }
    expect(on.feedPages.some((p) => p.file === 'index.feed.html')).toBe(false);
    // 387: food 자체는 제외지만 이 문서에서 열 수 있는 wheel 블록이 있어 변형은 존재한다.
    const food = on.feedPages.find((p) => p.file === 'supplies/food/hamster-golden/index.feed.html');
    expect(food?.data.data.feed?.items).toEqual(['wheel']);
    expect(feedSection(food?.html ?? '')).toBe('');
    expect(count(food?.html ?? '', 'data-ws-aff="note-f"')).toBe(0);
  });
});

describe('N9 L4 블록(full)', () => {
  const html = on.files.get('hamster/golden/supplies/wheel/index.feed.html') as string;
  const sec = feedSection(html);

  it('products 뒤, 행 ≤ 6, 고지 1회, ○·ws-badge·ws-product 0', () => {
    expect(sec).not.toBe('');
    const aside = html.slice(html.indexOf('<aside'));
    const prod = aside.indexOf('data-ws-part="products"');
    if (prod >= 0) expect(prod).toBeLessThan(aside.indexOf('data-ws-part="feed"'));
    expect(count(sec, '<li class="ws-feed-row"')).toBe(6);
    // 고지는 블록 안 1회(같은 페이지 main 의 홈 레일 고지는 별도 id 1회)
    expect(count(sec, 'data-ws-aff="note-feed"')).toBe(1);
    expect(count(html, 'id="ws-aff-feed-wheel"')).toBe(1);
    expect(count(html, 'id="ws-aff-feed-home"')).toBe(1);
    expect(sec).not.toContain('○');
    expect(sec).not.toContain('ws-badge');
    expect(sec).not.toContain('ws-product');
    expect(sec).toContain('ws-feed-badge--listed');
    expect(sec).toContain('표기 · ');
  });

  it('가격 줄 = 금액 · 확인일 · 몰 안내, 링크 rel sponsored·새 창·고지 참조', () => {
    expect(sec).toContain('12,900원');
    expect(sec).toContain('11월 23일 확인');
    expect(count(sec, 'class="ws-t-meta ws-feed-price"')).toBe(6);
    for (const a of sec.match(/<a [^>]*>/g) ?? []) {
      expect(a).toContain('rel="sponsored nofollow noopener noreferrer"');
      expect(a).toContain('target="_blank"');
      expect(a).toContain('aria-describedby="ws-aff-feed-wheel"');
      expect(a).toMatch(/href="https:\/\/link\.coupang\.com\/a\/[A-Za-z0-9]+"/);
    }
  });

  it('ws-data data.feed: 형식·예산, 전체 ≤ 32KB', () => {
    const p = on.feedPages.find((x) => x.file === 'hamster/golden/supplies/wheel/index.feed.html');
    expect(p).toBeDefined();
    const feed = p?.data.data.feed;
    expect(isWsFeedData(feed)).toBe(true);
    expect(feed?.stage).toBe('full');
    expect(feed?.priceCheckedOn).toBe('2026-11-23');
    expect(feed?.items).toEqual(['wheel', 'hideout'].filter((i) => feed?.items.includes(i)));
    if (feed) expect(feedWsDataBytes(feed)).toBeLessThanOrEqual(FEED_WS_DATA_MAX_BYTES);
    const base = off.pages.find((x) => x.route.path === p?.route.path);
    expect((p?.wsDataBytes ?? 0) - (base?.wsDataBytes ?? 0)).toBeLessThanOrEqual(FEED_WS_DATA_MAX_BYTES);
    for (const q of on.feedPages) expect(q.wsDataBytes, q.file).toBeLessThanOrEqual(WS_DATA_MAX_BYTES);
    // HTML 의 와이어 ws-data 도 같은 data.feed(디코드 후)
    const wire = decodeWsPage(wsData(html));
    expect(wire?.data.feed).toEqual(feed);
  });

  it('규칙 0 품목(은신처)은 △ 배지만·규격 줄 0', () => {
    const h2 = on.files.get('hamster/golden/supplies/hideout/index.feed.html') as string;
    const s2 = feedSection(h2);
    expect(s2).toContain('ws-feed-badge--check');
    expect(s2).not.toContain('ws-feed-badge--listed');
    expect(s2).not.toContain('ws-feed-spec');
  });

  it('/supplies/wheel/hamster-golden 변형: 같은 블록, 문서 요구사항 중 피드 있는 items·rail 0', () => {
    const p = on.feedPages.find((x) => x.file === 'supplies/wheel/hamster-golden/index.feed.html');
    const typeFeed = on.feedPages.find((x) => x.route.path === '/hamster/golden' && x.stage === 'full')!.data.data.feed!;
    const items = typeFeed.items.filter((id) => p?.data.data.requirements.some((r) => r.supplyItemId === id));
    expect(p?.data.data.feed).toEqual({ v: 1, stage: 'full', freshMs: Date.UTC(2026, 10, 23, 0, 12, 0), priceCheckedOn: '2026-11-23', items, rail: [] });
    expect(feedSection(p?.html ?? '')).toContain('<li class="ws-feed-row"');
  });
});

describe('387 SIT 피드: 문서에 실린 요구사항과 이동 대상 일치', () => {
  it.each([
    ['full', true], ['full', false], ['noprice', true], ['noprice', false],
  ] as const)('%s · 원래 품목 블록 %s: 요구사항 교집합·순서·정적 본문·고지·JSON·예산', (stage, original) => {
    const rows = [
      ...(original ? [row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면')] : []),
      row(G, 'saucer', '햄스터 플라잉 소서'),
      row(G, 'cage', '햄스터 케이지 120x60x60cm'),
      row(G, 'hideout', '햄스터 나무 은신처'),
      row(G, 'food', '햄스터 사료'),
      row(G, 'scale', '햄스터 체중계'),
    ];
    // 합성 케이지 기준: 실제 골든 기준은 cm·mm 혼재가 필요해 제목 파서가 블록을 만들지 않는다.
    // 이 시험의 메모리 시드만 단일 cm 규칙으로 구성해 케이지 피드가 있는 입력을 만든다(실시드·선택기 변경 0).
    const synthetic = structuredClone(seed);
    synthetic.supplyRequirements.find((r) => r.id === 'req-syrian-cage')!.minSpec = {
      rules: [{ key: 'floorWcm', op: 'gte', value: 100, reason: '시험 케이지 기준' }],
    };
    const b = buildSite(synthetic, opts(GEN_MS + (stage === 'full' ? 1 : 80) * H, rows));
    const type = b.feedPages.find((p) => p.route.path === '/hamster/golden' && p.stage === stage)!;
    const p = b.feedPages.find((p) => p.route.path === '/supplies/wheel/hamster-golden' && p.stage === stage);
    expect(p, '원래 품목 블록이 없어도 대안·케이지 블록으로 변형 생성').toBeDefined();
    const reqs = off.pages.find((p) => p.route.path === '/supplies/wheel/hamster-golden')!.data.data.requirements;
    const expected = type.data.data.feed!.items.filter((id) => reqs.some((r) => r.supplyItemId === id));
    expect(expected).toContain('saucer');
    expect(expected).toContain('cage');
    expect(type.data.data.feed!.items).toContain('hideout'); // 타입에는 있지만 SIT 요구사항 밖
    expect(expected).not.toContain('hideout');
    const f = p!.data.data.feed!;
    expect(f.items).toEqual(expected);
    expect(f.rail).toEqual([]);
    expect(isWsFeedData(f)).toBe(true);
    expect(Object.hasOwn(f, 'priceCheckedOn')).toBe(stage === 'full');
    if (stage === 'full') expect(f.priceCheckedOn).toBe('2026-11-23');
    expect(decodeWsPage(wsData(p!.html))?.data.feed).toEqual(f);
    const sec = feedSection(p!.html);
    expect(count(sec, '<li class="ws-feed-row"')).toBe(original ? 1 : 0);
    if (original) expect(sec).toContain('id="ws-aff-feed-wheel"');
    expect(sec).not.toContain('플라잉 소서');
    expect(sec).not.toContain('120x60x60');
    expect(count(p!.html, 'data-ws-aff="note-f"')).toBe(original ? 1 : 0);
    const manifest = JSON.parse(b.files.get('feed-manifest.json')!) as { variants: Record<string, string[]>; pages: Record<string, string[]> };
    expect(manifest.pages[stage]).toContain(p!.file);
    for (const q of b.feedPages.filter((q) => q.route.kind === 'SUPPLY_ITEM_TYPE')) {
      const feed = q.data.data.feed!;
      expect(feed.items, q.file).toEqual(type.data.data.feed!.items.filter((id) => q.data.data.requirements.some((r) => r.supplyItemId === id)));
      expect(feed.rail, q.file).toEqual([]);
      const originalOn = feed.items.includes(q.route.itemId!);
      expect(count(feedSection(q.html), '<li class="ws-feed-row"'), q.file).toBe(originalOn ? 1 : 0);
      expect(count(q.html, 'data-ws-aff="note-f"'), q.file).toBe(originalOn ? 1 : 0);
      expect(feedWsDataBytes(feed), q.file).toBeLessThanOrEqual(FEED_WS_DATA_MAX_BYTES);
      expect(q.wsDataBytes, q.file).toBeLessThanOrEqual(WS_DATA_MAX_BYTES);
      for (const id of feed.items) {
        const r = q.data.data.requirements.find((r) => r.supplyItemId === id)!;
        expect(FEED_EXCLUDED_CATEGORIES).not.toContain(r.item.category);
        const file = feedJsonFile('hamster/golden', id, q.stage);
        expect(manifest.variants[q.stage]).toContain(file);
        const block = JSON.parse(b.files.get(file)!);
        expect(block.supplyItemId).toBe(id);
        expect(block.rows.length).toBeGreaterThan(0);
        expect(Object.hasOwn(block, 'priceCheckedOn')).toBe(q.stage === 'full');
        for (const row of block.rows) expect(Object.hasOwn(row, 'price')).toBe(q.stage === 'full');
      }
    }
    for (const id of ['food', 'scale']) {
      expect(type.data.data.feed!.items).not.toContain(id);
      expect([...b.files.keys()].some((k) => k.includes(`/feed/${id}.`))).toBe(false);
    }
    const baseline = buildSite(synthetic, baseOptions(REAL_AS_OF));
    for (const [file, content] of baseline.files) expect(b.files.get(file), file).toBe(content);
  });
});

describe('N9 noprice 변형', () => {
  it('full 변형 0, 가격 줄·금액·확인일 0, data.feed 에 price 키 0', () => {
    expect(late.feedPages.every((p) => p.stage === 'noprice')).toBe(true);
    expect(late.files.has('hamster/golden/supplies/wheel/index.feed.html')).toBe(false);
    const html = late.files.get('hamster/golden/supplies/wheel/index.feed-noprice.html') as string;
    const sec = feedSection(html);
    expect(count(sec, '<li class="ws-feed-row"')).toBe(6);
    expect(sec).not.toContain('ws-feed-price');
    expect(sec).not.toMatch(/[0-9,]+원/);
    expect(sec).not.toMatch(/\d+월 \d+일 확인/);
    for (const p of late.feedPages) expect(JSON.stringify(p.data.data.feed)).not.toMatch(/"price"|priceCheckedOn/);
  });
});

describe('380 S3 블록 제목 — 인기순 확인 sort 허용 목록', () => {
  const L4 = (s: 'index.feed.html' | 'index.feed-noprice.html') => `hamster/golden/supplies/wheel/${s}`;
  const title = (html: string | undefined) => /<h3 id="ws-feed-title"[^>]*>([^<]*)<\/h3>/.exec(html ?? '')?.[1];
  const withSorts = (over: Partial<ProductFeedInput>, at = GEN_MS + H) => buildSite(seed, { ...opts(at), productFeed: { ...(opts(at).productFeed as ProductFeedInput), ...over } });
  const json = (b: ReturnType<typeof buildSite>, f: string) => JSON.parse(b.files.get(`hamster/golden/feed/${f}`) as string) as Record<string, unknown>;

  it('허용 목록은 비어 있고 문구는 고정', () => {
    expect(FEED_POPULAR_SORTS).toEqual({ COUPANG: [], ALIEXPRESS: [] });
    expect(COPY.feed.title).toBe('많이 찾는 상품');
    expect(COPY.feed.titleFallback).toBe('몰 검색 결과');
  });

  it('기본(허용 목록 빔): 어떤 sort 값이어도 「몰 검색 결과」, popular 키 0', () => {
    const b = withSorts({ sorts: { COUPANG: 'S' } });
    expect(title(b.files.get(L4('index.feed.html')))).toBe('몰 검색 결과');
    expect(json(b, 'wheel.json')).not.toHaveProperty('popular');
    for (const [k, v] of b.files) if (k.endsWith('.html')) expect(v, k).not.toContain(`>${COPY.feed.title}</h3>`);
  });

  it('허용 목록에 있는 값(시험 주입): 「많이 찾는 상품」 — full·noprice 마크업과 JSON popular:true', () => {
    const over: Partial<ProductFeedInput> = { sorts: { COUPANG: 'S' }, popularSorts: { COUPANG: ['S'], ALIEXPRESS: [] } };
    const b = withSorts(over);
    expect(title(b.files.get(L4('index.feed.html')))).toBe('많이 찾는 상품');
    expect(json(b, 'wheel.json').popular).toBe(true);
    expect(json(b, 'wheel.noprice.json').popular).toBe(true);
    expect(title(withSorts(over, GEN_MS + 80 * H).files.get(L4('index.feed-noprice.html')))).toBe('많이 찾는 상품');
  });

  it.each<[string, Partial<ProductFeedInput>]>([
    ['목록 밖 값', { sorts: { COUPANG: 'S' }, popularSorts: { COUPANG: ['T'], ALIEXPRESS: [] } }],
    ['다른 공급자 목록에만', { sorts: { COUPANG: 'S' }, popularSorts: { COUPANG: [], ALIEXPRESS: ['S'] } }],
    ['sort 모름', { popularSorts: { COUPANG: ['S'], ALIEXPRESS: [] } }],
    ['sort null', { sorts: { COUPANG: null }, popularSorts: { COUPANG: ['S'], ALIEXPRESS: [] } }],
  ])('%s → 「몰 검색 결과」', (_n, over) => {
    const b = withSorts(over);
    expect(title(b.files.get(L4('index.feed.html')))).toBe('몰 검색 결과');
    expect(json(b, 'wheel.json')).not.toHaveProperty('popular');
  });

  it('cli 가 넘기는 sort = 파일 api.sort(공급자별)', () => {
    const file = (provider: 'COUPANG' | 'ALIEXPRESS', sort: string | null) => ({ provider, api: { method: 'search', sort } });
    expect(feedSortsOf([file('COUPANG', 'S'), file('ALIEXPRESS', null)] as never)).toEqual({ COUPANG: 'S', ALIEXPRESS: null });
  });
});

describe('N9 홈 B 레일', () => {
  // 실시드엔 노출 운영자 상품이 없다(cp-001 DRAFT) — 순서 검사는 승격 픽스처(cp-001 VERIFIED)로.
  const withOps = buildSite(promoted(), { ...opts(GEN_MS + H), ...baseOptions(FIXTURE_AS_OF), productFeed: opts(GEN_MS + H).productFeed });

  it('실시드(운영자 상품 0): 「기준에 맞는 준비물」 레일 없이 몰 레일만', () => {
    const html = on.files.get('hamster/golden/index.feed.html') as string;
    expect(homeSection(html, 'products')).toBe('');
    expect(homeSection(html, 'mall')).toContain('<li class="ws-feed-card"');
  });

  it('골든: 운영자 레일 바로 뒤 「몰에 올라온 상품」 레일에 피드 카드(LISTED_PASS 품목당 1장), 안내 1줄·고지 1회', () => {
    const html = withOps.files.get('hamster/golden/index.feed.html') as string;
    const ops = homeSection(html, 'products');
    const mall = homeSection(html, 'mall');
    expect(ops).not.toBe('');
    expect(ops).not.toContain('ws-feed');
    expect(ops).not.toContain('ws-aff');
    expect(ops).not.toContain(COPY.feed.homeLead);
    expect(mall).toContain('>몰에 올라온 상품</h2>');
    expect(html.slice(html.indexOf(ops) + ops.length).trimStart().startsWith(mall)).toBe(true);
    expect(count(mall, '<li class="ws-feed-card"')).toBe(1);
    expect(mall).toContain('data-ws-item="wheel"');
    expect(mall).toContain(COPY.feed.homeLead);
    expect(count(mall, 'id="ws-aff-feed-home"')).toBe(1);
    expect(count(html, 'id="ws-aff-feed-home"')).toBe(1);
    expect(mall).not.toContain('○');
    expect(mall).not.toContain('<li class="ws-product');
    const p = withOps.feedPages.find((x) => x.file === 'hamster/golden/index.feed.html');
    expect(p?.data.data.feed?.rail.map((c) => c.supplyItemId)).toEqual(['wheel']);
  });

  it('noprice 홈: 카드에 가격·확인일 줄 0, 안내 문장 0(고지만)', () => {
    const html = late.files.get('hamster/golden/index.feed-noprice.html') as string;
    const mall = homeSection(html, 'mall');
    expect(count(mall, '<li class="ws-feed-card"')).toBe(1);
    expect(mall).not.toContain('ws-feed-price');
    expect(mall).not.toContain('ws-feed-checked');
    expect(mall).not.toContain(COPY.feed.homeLead);
    expect(count(html, 'id="ws-aff-feed-home"')).toBe(1);
  });

  it('피드 카드 0(hideout △ 만): 몰 레일 없음', () => {
    const only = buildSite(seed, opts(GEN_MS + H, [row(G, 'hideout', '햄스터 나무 은신처')]));
    const html = only.files.get('hamster/golden/index.feed.html') as string;
    expect(html).toBeDefined();
    expect(homeSection(html, 'mall')).toBe('');
    expect(html).not.toContain(COPY.homeB.mallTitle);
    expect(off.files.get('hamster/golden/index.html')).not.toContain('data-ws-section="mall"');
  });

  // 398(불변식 7 — 362 D-7 「△만」 폐기): GENERAL_INFO 체인은 피드 블록 자체가 없다.
  it('GENERAL_INFO(로보): 피드 행이 입력돼도 변형 문서 0·홈 피드 카드 0', () => {
    expect(gi.model.types.some((t) => t.id === J)).toBe(true);
    expect(gi.feedPages.filter((p) => p.route.typeId === J)).toEqual([]);
    expect([...gi.files.keys()].filter((k) => /^hamster\/robo\/.*feed/.test(k))).toEqual([]);
    expect(gi.feedPages.some((p) => p.route.typeId === G)).toBe(true); // 같은 빌드의 VERIFIED 종은 피드 있음
    expect(gi.feedRail.has(J)).toBe(false);
  });
});

describe('N9 푸터 고지 F(D-5) — 피드 몰 링크가 그려진 문서만', () => {
  const noteF = (html: string) => count(html, 'data-ws-aff="note-f"');
  it('골든 TYPE(레일 있음) 1, SIT 는 그려진 피드 링크가 있을 때만 1, 기본 파일은 off 그대로', () => {
    for (const p of on.feedPages.filter((x) => x.route.typeId === G)) {
      // 387: items에 다른 품목만 있는 SIT 변형은 정적 링크 0·고지 0. TYPE의 레일 계약은 그대로.
      const expected = p.route.kind === 'TYPE' || p.data.data.feed!.items.includes(p.route.itemId!) ? 1 : 0;
      expect(noteF(p.html), p.file).toBe(expected);
      expect(count(p.html, 'class="ws-btn ws-btn--outline ws-feed-go') > 0, p.file).toBe(expected === 1);
    }
    expect(gi.feedPages.some((p) => p.route.typeId === J)).toBe(false); // 398: GENERAL_INFO 종은 변형 문서 0
  });
});

describe('N9 알리 행(고지 문안 Kenny 결정 전)', () => {
  it('ALIEXPRESS 행이 선택되면 빌드가 멈춘다', () => {
    const ali = row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면 AL-1', { provider: 'ALIEXPRESS', url: 'https://s.click.aliexpress.com/e/_Abcd1234' });
    expect(() => buildSite(seed, opts(GEN_MS + H, [ali]))).toThrow(/알리 고지/);
  });
});
