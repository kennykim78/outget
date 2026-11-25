// 362 N6·N7·N9 — 상품 피드 정적 산출물(C1: ws-data 밖). 노출 결정은 engine selectFeedRows 한 곳, 여기는 직렬화·변형만.
//   파일: {slug}/feed/{item}.json(full, 가격 있음) · {item}.noprice.json(가격 키 0) · feed-manifest.json(site.ts 가 pages 를 채워 쓴다).
//   단계(빌드 시각 기준): full → 두 변형 / noprice → noprice 만 / nofeed(168h 초과·generatedAt 없음) → 파일·manifest 0.
//   이미 지난 단계의 변형은 만들지 않는다. 빌드 시각은 어떤 파일에도 쓰지 않는다(manifest 는 generatedAt 파생값만).
//   홈 레일 모델(D-2): LISTED_PASS ∧ 비 GENERAL_INFO 블록의 첫 행만, 품목당 1장. N9: 단계별 ws-data data.feed(레일 카드 1.5KB 예산 안) + 마크업용 블록.
import { FEED_POPULAR_SORTS, FEED_SCREEN_ROWS, feedDeadlines, feedFreshAt, feedJsonFile, feedOldestFetchedMs, feedStage, parseFeedInstant, seoulDate, seoulIso, type FeedLiveStage, type FeedProvider, type FeedRowIn, type FeedSortAllow } from '../engine/feed-types.js';
import {
  createCatalog,
  isWsFeedData,
  selectFeedRows,
  type FeedManifest,
  type FeedSelection,
  type PublicFeedBlock,
  type PublicFeedRailCard,
  type PublicFeedRow,
  type SeedBundle,
  type WsFeedData,
} from '../engine/index.js';
import { jsonForScript } from './html.js';
import type { SiteModel } from './project.js';

export interface ProductFeedInput {
  rows: readonly FeedRowIn[];
  generatedAt: string | null;
  /** 빌드 시각(ms, cli 가 읽는다). 산출물에는 쓰지 않는다. */
  buildAtMs: number;
  /** seed/lint.ts lintText 적중 ≥1 → true(엔진이 seed 를 import 하지 않게 주입). */
  isTitleBanned: (title: string) => boolean;
  /** 380 S3: 공급자별 파일 api.sort. 없으면 인기순 아님. */
  sorts?: Partial<Record<FeedProvider, string | null>>;
  /** 시험 주입용 — 기본 FEED_POPULAR_SORTS(지금 빈 목록). cli 는 넘기지 않는다. */
  popularSorts?: FeedSortAllow;
}

/** 380 S3: 보이는 행이 1개 이상이고 모두 허용 목록의 sort 로 받은 공급자 행일 때만 true. */
function isPopular(rows: FeedSelection['rows'], input: ProductFeedInput): boolean {
  const allow = input.popularSorts ?? FEED_POPULAR_SORTS;
  return rows.length > 0 && rows.every((r) => {
    const sort = input.sorts?.[r.provider];
    return typeof sort === 'string' && allow[r.provider].includes(sort);
  });
}

/** 한 타입의 피드(단계별) — 마크업(pages/feed.ts)과 ws-data data.feed 가 같은 값을 쓴다. */
export interface FeedTypeOut {
  /** 품목 id → 단계 → 공개 블록(행 ≤ FEED_SCREEN_ROWS). 요구사항 순서. */
  blocks: Map<string, Partial<Record<FeedLiveStage, PublicFeedBlock>>>;
  /** 단계 → 타입 페이지 ws-data data.feed(레일은 FEED_WS_DATA_MAX_BYTES 예산 안으로 뒤에서 덜어 냄). */
  data: Partial<Record<FeedLiveStage, WsFeedData>>;
}

export interface FeedOutput {
  files: Map<string, string>;
  /** pages 는 빈 목록 — site.ts 가 HTML 변형을 만든 뒤 채워 FEED_MANIFEST_FILE 로 쓴다. */
  manifest: FeedManifest | null;
  rail: Map<string, PublicFeedRailCard[]>;
  /** 이번 빌드에서 살아 있는 단계(full 이면 ['full','noprice'], noprice 면 ['noprice'], 피드 없음 []). */
  stages: FeedLiveStage[];
  types: Map<string, FeedTypeOut>;
}

// N11: 런타임(spa.ts)도 읽는 이름이라 엔진 상수로 옮기고 여기선 다시 내보낸다(런타임이 prerender 모듈에 닿지 않게).
export { FEED_MANIFEST_FILE } from '../engine/feed-types.js';
/** C1 ③ — 피드 변형 페이지의 ws-data 증가 상한(바이트, `,"feed":` 포함). */
export const FEED_WS_DATA_MAX_BYTES = 1536;
const SAFE_SEG = /^[a-z0-9][a-z0-9-]*$/;

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function publicRow(r: FeedSelection['rows'][number], withPrice: boolean): PublicFeedRow {
  const base = { provider: r.provider, title: r.title, url: r.url, imageUrl: r.imageUrl };
  const tail = { verdict: r.verdict, specValues: r.specValues };
  return withPrice ? { ...base, price: r.price, ...tail } : { ...base, ...tail };
}

function block(typeId: string, itemId: string, s: FeedSelection, withPrice: boolean, checkedOn: string, input: ProductFeedInput): PublicFeedBlock {
  const shown = s.rows.slice(0, FEED_SCREEN_ROWS);
  return {
    v: 1,
    typeId,
    supplyItemId: itemId,
    badge: s.badge,
    generalInfo: s.generalInfo,
    ...(isPopular(shown, input) ? { popular: true as const } : {}),
    ...(withPrice ? { priceCheckedOn: checkedOn } : {}),
    rows: shown.map((r) => publicRow(r, withPrice)),
  };
}

/** ws-data 에 붙는 바이트 수(`,"feed":` + jsonForScript 값). */
export function feedWsDataBytes(f: WsFeedData): number {
  return Buffer.byteLength(`,"feed":${jsonForScript(f)}`, 'utf8');
}

/** data.feed 조립 + 예산 맞추기(레일 카드를 뒤에서부터 뺀다 — 요구사항 순서 앞 카드 우선, 결정론). 형식 위반·품목만으로 초과면 throw. */
export function fitWsFeed(stage: FeedLiveStage, freshMs: number, checkedOn: string, items: string[], rail: readonly PublicFeedRailCard[]): WsFeedData {
  const cards = [...rail];
  const make = (): WsFeedData => ({ v: 1, stage, freshMs, ...(stage === 'full' ? { priceCheckedOn: checkedOn } : {}), items: [...items], rail: [...cards] });
  let f = make();
  while (feedWsDataBytes(f) > FEED_WS_DATA_MAX_BYTES && cards.length > 0) {
    cards.pop();
    f = make();
  }
  if (feedWsDataBytes(f) > FEED_WS_DATA_MAX_BYTES) throw new Error(`feed-out: data.feed 품목 목록만으로 ${FEED_WS_DATA_MAX_BYTES}B 초과`);
  if (!isWsFeedData(f)) throw new Error('feed-out: data.feed 형식 위반(isWsFeedData)');
  return f;
}

export function buildFeedOutputs(seed: SeedBundle, model: SiteModel, asOf: string, input: ProductFeedInput): FeedOutput {
  const out: FeedOutput = { files: new Map(), manifest: null, rail: new Map(), stages: [], types: new Map() };
  // 373 D4: 기한 기준 = generatedAt·행 fetchedAt 중 가장 오래된 값(selectFeedRows 와 같은 feedFreshAt) — 오래된 fetchedAt 이
  //   가격·블록 기한을 늘리지 못한다. manifest.generatedAt 도 이 값(런타임 spa 단계 계산의 원천). D3: 미래 → nofeed.
  const freshAt = feedFreshAt(input.generatedAt, input.rows);
  const stage = feedStage(input.buildAtMs, freshAt);
  const genMs = parseFeedInstant(freshAt);
  const oldestFetch = feedOldestFetchedMs(input.rows);
  if (stage === 'nofeed' || genMs === null || freshAt === null || oldestFetch === null) return out;
  const stages: FeedLiveStage[] = stage === 'full' ? ['full', 'noprice'] : ['noprice'];
  const cat = createCatalog(seed);
  const d = seoulDate(oldestFetch); // 353 §2: 「M월 D일 확인」 = 가장 오래된 fetchedAt 의 Asia/Seoul 날짜
  const checkedOn = `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
  const full: string[] = [];
  const noprice: string[] = [];
  for (const t of model.types) {
    const segs = t.slug.split('/');
    if (!segs.every((s) => SAFE_SEG.test(s))) throw new Error(`feed-out: slug 형식 밖 ${t.id}`);
    const cards: PublicFeedRailCard[] = [];
    const blocks: FeedTypeOut['blocks'] = new Map();
    for (const r of t.requirements) {
      const itemId = r.item.id;
      if (!SAFE_SEG.test(itemId)) throw new Error(`feed-out: 품목 id 형식 밖 ${t.id}/${itemId}`);
      const s = selectFeedRows(cat, t.id, itemId, input.rows, {
        asOf,
        buildAtMs: input.buildAtMs,
        generatedAt: input.generatedAt,
        isTitleBanned: input.isTitleBanned,
      });
      if (s === null || s.rows.length === 0) continue;
      const per: Partial<Record<FeedLiveStage, PublicFeedBlock>> = {};
      for (const st of stages) {
        const b = block(t.id, itemId, s, st === 'full', checkedOn, input);
        per[st] = b;
        const file = feedJsonFile(t.slug, itemId, st);
        out.files.set(file, `${JSON.stringify(b)}\n`);
        (st === 'full' ? full : noprice).push(file);
      }
      blocks.set(itemId, per);
      const f = s.rows[0];
      if (s.badge === 'LISTED_PASS' && !s.generalInfo && f.verdict !== null && f.specValues !== null) {
        const card: PublicFeedRailCard = { supplyItemId: itemId, provider: f.provider, title: f.title, url: f.url, imageUrl: f.imageUrl, verdict: f.verdict, specValues: f.specValues };
        cards.push(s.showPrice ? { ...card, price: f.price } : card);
      }
    }
    if (cards.length > 0) out.rail.set(t.id, cards);
    if (blocks.size === 0) continue;
    const items = [...blocks.keys()];
    const data: FeedTypeOut['data'] = {};
    for (const st of stages) {
      const stCards = cards.map((c): PublicFeedRailCard =>
        st === 'full'
          ? c
          : { supplyItemId: c.supplyItemId, provider: c.provider, title: c.title, url: c.url, imageUrl: c.imageUrl, verdict: c.verdict, specValues: c.specValues },
      );
      data[st] = fitWsFeed(st, genMs, checkedOn, items, stCards);
    }
    out.types.set(t.id, { blocks, data });
  }
  if (noprice.length === 0) return out;
  out.stages = stages;
  const { priceUntil, blockUntil } = feedDeadlines(genMs);
  out.manifest = {
    v: 1,
    generatedAt: freshAt,
    priceUntil: seoulIso(priceUntil),
    blockUntil: seoulIso(blockUntil),
    variants: { full: [...full].sort(), noprice: [...noprice].sort() },
    pages: { full: [], noprice: [] },
  };
  return out;
}
