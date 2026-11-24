// 362 N6·N7 — 상품 피드 정적 산출물(C1: ws-data 밖). 노출 결정은 engine selectFeedRows 한 곳, 여기는 직렬화·변형만.
//   파일: {slug}/feed/{item}.json(full, 가격 있음) · {item}.noprice.json(가격 키 0) · feed-manifest.json.
//   단계(빌드 시각 기준): full → 두 변형 / noprice → noprice 만 / nofeed(168h 초과·generatedAt 없음) → 파일·manifest 0.
//   이미 지난 단계의 변형은 만들지 않는다. 빌드 시각은 어떤 파일에도 쓰지 않는다(manifest 는 generatedAt 파생값만).
//   홈 레일 모델(D-2): LISTED_PASS ∧ 비 GENERAL_INFO 블록의 첫 행만, 품목당 1장. 마크업·ws-data 연결은 N9/N10.
import { feedDeadlines, feedStage, parseFeedInstant, seoulDate, seoulIso, type FeedRowIn } from '../engine/feed-types.js';
import {
  createCatalog,
  selectFeedRows,
  type FeedManifest,
  type FeedSelection,
  type PublicFeedBlock,
  type PublicFeedRailCard,
  type PublicFeedRow,
  type SeedBundle,
} from '../engine/index.js';
import type { SiteModel } from './project.js';

export interface ProductFeedInput {
  rows: readonly FeedRowIn[];
  generatedAt: string | null;
  /** 빌드 시각(ms, cli 가 읽는다). 산출물에는 쓰지 않는다. */
  buildAtMs: number;
  /** seed/lint.ts lintText 적중 ≥1 → true(엔진이 seed 를 import 하지 않게 주입). */
  isTitleBanned: (title: string) => boolean;
}

export interface FeedOutput {
  files: Map<string, string>;
  manifest: FeedManifest | null;
  rail: Map<string, PublicFeedRailCard[]>;
}

export const FEED_MANIFEST_FILE = 'feed-manifest.json';
const SAFE_SEG = /^[a-z0-9][a-z0-9-]*$/;

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function publicRow(r: FeedSelection['rows'][number], withPrice: boolean): PublicFeedRow {
  const base = { provider: r.provider, title: r.title, url: r.url, imageUrl: r.imageUrl };
  const tail = { verdict: r.verdict, specValues: r.specValues };
  return withPrice ? { ...base, price: r.price, ...tail } : { ...base, ...tail };
}

function block(typeId: string, itemId: string, s: FeedSelection, withPrice: boolean, checkedOn: string): PublicFeedBlock {
  return {
    v: 1,
    typeId,
    supplyItemId: itemId,
    badge: s.badge,
    generalInfo: s.generalInfo,
    ...(withPrice ? { priceCheckedOn: checkedOn } : {}),
    rows: s.rows.map((r) => publicRow(r, withPrice)),
  };
}

export function buildFeedOutputs(seed: SeedBundle, model: SiteModel, asOf: string, input: ProductFeedInput): FeedOutput {
  const out: FeedOutput = { files: new Map(), manifest: null, rail: new Map() };
  const stage = feedStage(input.buildAtMs, input.generatedAt);
  const genMs = parseFeedInstant(input.generatedAt);
  if (stage === 'nofeed' || genMs === null || input.generatedAt === null) return out;
  const cat = createCatalog(seed);
  const d = seoulDate(genMs);
  const checkedOn = `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`;
  const full: string[] = [];
  const noprice: string[] = [];
  for (const t of model.types) {
    const segs = t.slug.split('/');
    if (!segs.every((s) => SAFE_SEG.test(s))) throw new Error(`feed-out: slug 형식 밖 ${t.id}`);
    const cards: PublicFeedRailCard[] = [];
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
      const base = `${t.slug}/feed/${itemId}`;
      if (s.showPrice) {
        out.files.set(`${base}.json`, `${JSON.stringify(block(t.id, itemId, s, true, checkedOn))}\n`);
        full.push(`${base}.json`);
      }
      out.files.set(`${base}.noprice.json`, `${JSON.stringify(block(t.id, itemId, s, false, checkedOn))}\n`);
      noprice.push(`${base}.noprice.json`);
      if (s.badge === 'LISTED_PASS' && !s.generalInfo) {
        const f = s.rows[0];
        const card: PublicFeedRailCard = { supplyItemId: itemId, provider: f.provider, title: f.title, url: f.url, imageUrl: f.imageUrl };
        cards.push(s.showPrice ? { ...card, price: f.price } : card);
      }
    }
    if (cards.length > 0) out.rail.set(t.id, cards);
  }
  if (noprice.length === 0) return out;
  const { priceUntil, blockUntil } = feedDeadlines(genMs);
  out.manifest = {
    v: 1,
    generatedAt: input.generatedAt,
    priceUntil: seoulIso(priceUntil),
    blockUntil: seoulIso(blockUntil),
    variants: { full: [...full].sort(), noprice: [...noprice].sort() },
  };
  out.files.set(FEED_MANIFEST_FILE, `${JSON.stringify(out.manifest, null, 2)}\n`);
  return out;
}
