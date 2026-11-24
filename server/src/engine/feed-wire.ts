// 362 N9 — ws-data data.feed 검증(서버 출력 단언 + 클라 pageData 하이드레이션 방어). 순수·결정론.
//   형식이 하나라도 어긋나면 false → 클라는 페이지 데이터 전체를 버린다(fail-closed, 불변식 ③ 방어 심화).
//   링크·이미지 규칙은 providers.ts FEED_LINK_RE·FEED_IMAGE_HOSTS 단일 소스. 이 파일은 노출 판정 모듈(exposure.ts)이 import 하지 않는다.
//   홈 B(HomeB.tsx) 는 이 파일을 import 하지 않는다 — 검증은 client/src/app/pageData.ts 한 곳(C10-AFF-IMPORT 감시 루트 밖).
import { FEED_PROVIDERS, feedCheckedParts, type FeedProvider } from './feed-types.js';
import { FEED_IMAGE_HOSTS, FEED_LINK_RE } from './providers.js';
import type { WsFeedData } from './public.js';

/** 품목 id 세그먼트(feed-out SAFE_SEG 와 같은 규칙). */
const SEG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** 한 페이지 레일 카드·품목 수 상한(방어 — 실제는 ws-data 1.5KB 예산이 먼저 막는다). */
const MAX_ITEMS = 64;
const RAIL_VERDICTS: readonly string[] = ['OK', 'BELOW_RECOMMENDED'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const ks = Object.keys(o);
  return ks.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/** 피드 이미지 URL: https · 자격 증명·포트 0 · 공급자 FEED_IMAGE_HOSTS 정확 일치(prerender/product-feed.ts 로더와 같은 규칙). */
export function isFeedImageUrl(provider: FeedProvider, url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    u.username === '' &&
    u.password === '' &&
    u.port === '' &&
    FEED_IMAGE_HOSTS[provider].includes(u.hostname) &&
    url.startsWith(`https://${u.hostname}/`)
  );
}

/** 피드 상품 링크: 공급자별 정확 패턴(FEED_LINK_RE). */
export function isFeedLink(provider: FeedProvider, url: unknown): boolean {
  return typeof url === 'string' && FEED_LINK_RE[provider].test(url);
}

function isProvider(v: unknown): v is FeedProvider {
  return typeof v === 'string' && (FEED_PROVIDERS as readonly string[]).includes(v);
}

function isPrice(v: unknown): boolean {
  if (v === null) return true;
  return isRecord(v) && exactKeys(v, ['amount', 'currency']) && Number.isSafeInteger(v.amount) && (v.amount as number) > 0 && v.currency === 'KRW';
}

function isSpecValues(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return Object.entries(v).every(
    ([k, x]) => /^[A-Za-z][A-Za-z0-9]*$/.test(k) && (typeof x === 'boolean' || typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))),
  );
}

const CARD_KEYS = ['supplyItemId', 'provider', 'title', 'url', 'imageUrl', 'verdict', 'specValues'] as const;
const CARD_KEYS_PRICE = ['supplyItemId', 'provider', 'title', 'url', 'imageUrl', 'price', 'verdict', 'specValues'] as const;

/** ws-data data.feed 형태 검사. stage=noprice 면 priceCheckedOn·price 키가 있으면 거부. */
export function isWsFeedData(v: unknown): v is WsFeedData {
  if (!isRecord(v) || v.v !== 1) return false;
  const full = v.stage === 'full';
  if (!full && v.stage !== 'noprice') return false;
  if (!exactKeys(v, full ? ['v', 'stage', 'priceCheckedOn', 'items', 'rail'] : ['v', 'stage', 'items', 'rail'])) return false;
  if (full && feedCheckedParts(v.priceCheckedOn) === null) return false;
  const items = v.items;
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return false;
  if (!items.every((x) => typeof x === 'string' && SEG_RE.test(x))) return false;
  if (new Set(items).size !== items.length) return false;
  const rail = v.rail;
  if (!Array.isArray(rail) || rail.length > items.length) return false;
  const seen = new Set<string>();
  for (const c of rail as unknown[]) {
    if (!isRecord(c) || !exactKeys(c, full ? CARD_KEYS_PRICE : CARD_KEYS)) return false;
    if (typeof c.supplyItemId !== 'string' || !items.includes(c.supplyItemId) || seen.has(c.supplyItemId)) return false;
    seen.add(c.supplyItemId);
    if (!isProvider(c.provider)) return false;
    if (typeof c.title !== 'string' || c.title.trim() === '') return false;
    if (!isFeedLink(c.provider, c.url)) return false;
    if (c.imageUrl !== null && !isFeedImageUrl(c.provider, c.imageUrl)) return false;
    if (full && !isPrice(c.price)) return false;
    if (!RAIL_VERDICTS.includes(c.verdict as string)) return false;
    if (!isSpecValues(c.specValues)) return false;
  }
  return true;
}
