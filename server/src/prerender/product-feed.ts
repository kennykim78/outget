// 362 N3 — 상품 피드 파일 로더·게이트(빌드 타임 전용, 서버 런타임 0). 순수: 파일 읽기는 호출부(cli.ts)가 readText 로 넘긴다.
//   파일 = server/product-feed/{coupang|aliexpress}.json — 공식 API 응답에서 약관 표시 필드만 남긴 것(scripts/dev/gen-product-feed.mjs).
//   시드가 아니다(seed:validate 대상 아님). 크롤링·런타임 외부 호출 0(불변식 ①). 수수료·판매량·평점·productId 자리 없음(불변식 ④).
//   형식(353 §2): {v:1, provider, source:"OFFICIAL_API", api{method,sort}, terms{checkedAt,displayFields}, generatedAt, rows[]}
//     - 키 집합 엄격(초과·누락 → throw), 원문 중복 키 → throw, __proto__·constructor·prototype → throw.
//     - url = 공급자별 링크 형태(providers.ts FEED_LINK_RE), imageUrl = FEED_IMAGE_HOSTS 정확 일치 https 또는 null.
//     - generatedAt 은 rows=[] 일 때만 null. 행이 있으면 terms.checkedAt 필수(약관 확인 전 노출 금지)·표시 필드 선언 필수.
//     - 공급자 × (타입·품목)당 FEED_ROW_CAP 행 이하, rank 는 그 안에서 1부터 중복 없음.
//   게이트: production ∧ WS_PRODUCT_FEED=public ∧ origin ∈ WS_AFFILIATE_ORIGINS. 하나라도 거짓 → 꺼짐(파일을 읽지도 않는다).
//   오류 메시지에 제목·URL 값은 넣지 않는다(위치·규칙만).
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEED_IMAGE_HOSTS, FEED_LINK_RE } from '../engine/providers.js';
import { FEED_CLOCK_SKEW_MS, FEED_PROVIDERS, FEED_ROW_CAP, parseFeedInstant, type FeedFile, type FeedProvider, type FeedRowIn } from '../engine/feed-types.js';
import { FORBIDDEN_KEYS, hasForbiddenKey } from '../engine/ws-wire.js';
import { hasDuplicateJsonKey } from './affiliate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/prerender 와 dist/prerender 모두 server/ 아래 두 단계. */
export const DEFAULT_PRODUCT_FEED_DIR = resolve(HERE, '..', '..', 'product-feed');
export const PRODUCT_FEED_FILES: Readonly<Record<FeedProvider, string>> = Object.freeze({
  COUPANG: 'coupang.json',
  ALIEXPRESS: 'aliexpress.json',
});

const TOP_KEYS = ['v', 'provider', 'source', 'api', 'terms', 'generatedAt', 'rows'] as const;
const API_KEYS = ['method', 'sort'] as const;
const TERMS_KEYS = ['checkedAt', 'displayFields'] as const;
const ROW_KEYS = ['animalTypeId', 'supplyItemId', 'keyword', 'rank', 'title', 'url', 'imageUrl', 'price', 'fetchedAt'] as const;
const PRICE_KEYS = ['amount', 'currency'] as const;
/** 표시 허용 필드 선언에 쓸 수 있는 이름(그 밖 값 → throw). */
export const FEED_DISPLAY_FIELDS = Object.freeze(['title', 'url', 'imageUrl', 'price'] as const);
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const API_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;
const TITLE_MAX = 300;
/** fetchedAt 은 generatedAt 이하(+1h 허용, 353 §2). */
const FETCH_SLACK_MS = 3_600_000;

/** 제어 문자(U+0000~U+001F)·꺾쇠 포함 여부(정규식 제어 문자 클래스 대신 — no-control-regex). */
function hasControlOrAngle(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x3c || c === 0x3e) return true;
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/** https ∧ 호스트 정확 일치 ∧ 자격증명·포트 없음. */
function isAllowedImage(provider: FeedProvider, url: unknown): boolean {
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

/** 피드 JSON(JSON.parse 결과) 검사 — 무효면 throw. expected = 파일명이 가리키는 공급자. */
export function parseProductFeed(json: unknown, expected: FeedProvider, opts: { nowMs?: number } = {}): FeedFile {
  // 373 D3: nowMs 를 주면 generatedAt·fetchedAt 이 nowMs + FEED_CLOCK_SKEW_MS 넘게 뒤(미래)면 throw. 빌드 로더는 항상 준다.
  const futureLimit = opts.nowMs === undefined ? null : opts.nowMs + FEED_CLOCK_SKEW_MS;
  const fail = (why: string): never => {
    throw new Error(`product-feed: ${PRODUCT_FEED_FILES[expected]} 무효 — ${why}`);
  };
  if (hasForbiddenKey(json)) fail(`금지 키(${FORBIDDEN_KEYS.join('·')})`);
  if (!isRecord(json) || !exactKeys(json, TOP_KEYS)) fail(`최상위 키는 ${TOP_KEYS.join('·')} 만`);
  const o = json as Record<string, unknown>;
  if (o.v !== 1) fail('v 는 1');
  if (o.provider !== expected) fail(`provider 는 파일명과 같은 ${expected}`);
  if (o.source !== 'OFFICIAL_API') fail('source 는 OFFICIAL_API 만');
  if (!isRecord(o.api) || !exactKeys(o.api, API_KEYS)) fail(`api 키는 ${API_KEYS.join('·')} 만`);
  const api = o.api as Record<string, unknown>;
  for (const k of API_KEYS) if (api[k] !== null && !(typeof api[k] === 'string' && API_ID_RE.test(api[k] as string))) fail(`api.${k} 는 null 또는 식별자`);
  if (!isRecord(o.terms) || !exactKeys(o.terms, TERMS_KEYS)) fail(`terms 키는 ${TERMS_KEYS.join('·')} 만`);
  const terms = o.terms as Record<string, unknown>;
  if (terms.checkedAt !== null && !(typeof terms.checkedAt === 'string' && DATE_RE.test(terms.checkedAt))) fail('terms.checkedAt 은 null 또는 YYYY-MM-DD');
  if (!Array.isArray(terms.displayFields)) fail('terms.displayFields 는 배열');
  const display = terms.displayFields as unknown[];
  if (display.some((f) => !(FEED_DISPLAY_FIELDS as readonly unknown[]).includes(f)) || new Set(display).size !== display.length) {
    fail(`terms.displayFields 는 ${FEED_DISPLAY_FIELDS.join('·')} 중 중복 없이`);
  }
  if (!Array.isArray(o.rows)) fail('rows 는 배열');
  const rows = o.rows as unknown[];
  const gen = o.generatedAt === null ? null : parseFeedInstant(o.generatedAt);
  if (o.generatedAt === null) {
    if (rows.length > 0) fail('rows 가 있으면 generatedAt 필수');
  } else if (gen === null) fail('generatedAt 은 ISO 시각(초·오프셋 포함)');
  if (gen !== null && futureLimit !== null && gen > futureLimit) fail('generatedAt 이 빌드 시각보다 미래(시계 오차 5분 초과)');
  if (rows.length > 0) {
    if (terms.checkedAt === null) fail('rows 가 있으면 terms.checkedAt 필수(약관 확인 전 노출 금지)');
    for (const f of ['title', 'url']) if (!display.includes(f)) fail(`rows 가 있으면 terms.displayFields 에 ${f}`);
  }

  const perGroup = new Map<string, Set<number>>();
  rows.forEach((row, i) => {
    const at = `rows[${i}]`;
    if (!isRecord(row) || !exactKeys(row, ROW_KEYS)) fail(`${at} 키는 ${ROW_KEYS.join('·')} 만`);
    const r = row as Record<string, unknown>;
    if (typeof r.animalTypeId !== 'string' || !ID_RE.test(r.animalTypeId)) fail(`${at}.animalTypeId 형식`);
    if (typeof r.supplyItemId !== 'string' || !ID_RE.test(r.supplyItemId)) fail(`${at}.supplyItemId 형식`);
    if (typeof r.keyword !== 'string' || r.keyword === '' || r.keyword !== r.keyword.replace(/\s+/g, ' ').trim()) fail(`${at}.keyword 는 공백 정리된 비지 않은 문자열`);
    if (typeof r.rank !== 'number' || !Number.isInteger(r.rank) || r.rank < 1 || r.rank > FEED_ROW_CAP) fail(`${at}.rank 는 1~${FEED_ROW_CAP} 정수`);
    if (typeof r.title !== 'string' || r.title.trim() === '' || r.title.length > TITLE_MAX || hasControlOrAngle(r.title)) fail(`${at}.title 형식`);
    if (typeof r.url !== 'string' || !FEED_LINK_RE[expected].test(r.url)) fail(`${at}.url 은 ${expected} 상품 링크 형태(https)만`);
    if (r.imageUrl !== null) {
      if (!display.includes('imageUrl')) fail(`${at}.imageUrl 은 displayFields 에 imageUrl 이 있을 때만`);
      if (!isAllowedImage(expected, r.imageUrl)) fail(`${at}.imageUrl 은 FEED_IMAGE_HOSTS 정확 일치 https 만`);
    }
    if (r.price !== null) {
      if (!display.includes('price')) fail(`${at}.price 는 displayFields 에 price 가 있을 때만`);
      if (!isRecord(r.price) || !exactKeys(r.price, PRICE_KEYS)) fail(`${at}.price 키는 ${PRICE_KEYS.join('·')} 만`);
      const p = r.price as Record<string, unknown>;
      if (p.currency !== 'KRW') fail(`${at}.price.currency 는 KRW 만`);
      if (typeof p.amount !== 'number' || !Number.isSafeInteger(p.amount) || p.amount <= 0) fail(`${at}.price.amount 는 양의 정수`);
    }
    const f = parseFeedInstant(r.fetchedAt);
    if (f === null) fail(`${at}.fetchedAt 은 ISO 시각(초·오프셋 포함)`);
    if (gen !== null && (f as number) > gen + FETCH_SLACK_MS) fail(`${at}.fetchedAt 이 generatedAt 보다 1시간 넘게 뒤`);
    if (futureLimit !== null && (f as number) > futureLimit) fail(`${at}.fetchedAt 이 빌드 시각보다 미래(시계 오차 5분 초과)`);
    const g = `${r.animalTypeId}\u0000${r.supplyItemId}`;
    const ranks = perGroup.get(g) ?? new Set<number>();
    if (ranks.has(r.rank as number)) fail(`${at}.rank 중복(같은 타입·품목)`);
    ranks.add(r.rank as number);
    if (ranks.size > FEED_ROW_CAP) fail(`${at} 타입·품목당 ${FEED_ROW_CAP}행 초과`);
    perGroup.set(g, ranks);
  });
  return o as unknown as FeedFile;
}

/** 원문 텍스트 검사 — BOM·JSON 아님·중복 키·parseProductFeed 위반 → throw. */
export function parseProductFeedText(text: string, expected: FeedProvider, opts: { nowMs?: number } = {}): FeedFile {
  const name = PRODUCT_FEED_FILES[expected];
  if (text.charCodeAt(0) === 0xfeff) throw new Error(`product-feed: ${name} 무효 — 파일 앞 BOM(U+FEFF)`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`product-feed: ${name} 무효 — JSON 아님`);
  }
  if (hasDuplicateJsonKey(text)) throw new Error(`product-feed: ${name} 무효 — 같은 객체 안 중복 키`);
  return parseProductFeed(json, expected, opts);
}

/**
 * 공급자 파일 전부를 읽어 검사(켜짐일 때만 호출). readText(파일명) 는 호출부가 준다(테스트 주입·디렉터리 고정).
 *   공급자 순서 = FEED_PROVIDERS. 파일이 없거나 무효면 throw(cli exit 2).
 *   373 D3: nowMs(빌드 시각) 필수 — 미래 generatedAt·fetchedAt(오차 5분 초과) → throw.
 */
export function loadProductFeeds(readText: (fileName: string) => string, nowMs: number): FeedFile[] {
  return FEED_PROVIDERS.map((p) => parseProductFeedText(readText(PRODUCT_FEED_FILES[p]), p, { nowMs }));
}

/** 피드 파일들 → selectFeedRows 입력 행(공급자 붙임). */
export function feedRowsOf(files: readonly FeedFile[]): FeedRowIn[] {
  return files.flatMap((f) => f.rows.map((r) => ({ ...r, provider: f.provider })));
}

/**
 * 여러 공급자 파일의 generatedAt 중 가장 이른 값(만료 기준 — 오래된 쪽에 맞춘다). 행 있는 파일만, 없으면 null.
 */
export function feedGeneratedAt(files: readonly FeedFile[]): string | null {
  let best: { s: string; ms: number } | null = null;
  for (const f of files) {
    if (f.rows.length === 0 || f.generatedAt === null) continue;
    const ms = parseFeedInstant(f.generatedAt) as number;
    if (best === null || ms < best.ms) best = { s: f.generatedAt, ms };
  }
  return best === null ? null : best.s;
}

export type ProductFeedGateReason = 'NOT_PRODUCTION' | 'FEED_OFF' | 'ORIGIN_NOT_ALLOWED' | 'ON';

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
const stripSlash = (s: string): string => s.replace(/\/+$/, '');

/** 빌드 타임 게이트(기본 꺼짐): production ∧ WS_PRODUCT_FEED=public ∧ origin ∈ WS_AFFILIATE_ORIGINS. */
export function productFeedGate(
  env: Readonly<Record<string, string | undefined>>,
  origin: string,
  production: boolean,
): { on: boolean; reason: ProductFeedGateReason } {
  if (!production) return { on: false, reason: 'NOT_PRODUCTION' };
  if ((env.WS_PRODUCT_FEED ?? '').trim() !== 'public') return { on: false, reason: 'FEED_OFF' };
  const allowed = list(env.WS_AFFILIATE_ORIGINS).map(stripSlash);
  if (!allowed.includes(stripSlash(origin.trim()))) return { on: false, reason: 'ORIGIN_NOT_ALLOWED' };
  return { on: true, reason: 'ON' };
}
