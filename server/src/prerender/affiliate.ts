// 제휴 링크 코드 맵 로더·게이트(258 단계 2) — 빌드 타임 전용(서버 런타임 0). 순수: 파일 읽기는 cli.ts, 여기는 값 검사만.
//   맵 = server/affiliate/coupang.json — 운영자가 공급자 웹 UI 에서 수동으로 만든 단축 코드(source MANUAL). 네트워크·크롤링 0(불변식 ①).
//   형식: {v:1, provider:"COUPANG", subId, source:"MANUAL", generatedAt, entries:[{keyword, landingUrl, code}]}
//     - 키 집합 엄격(초과·누락 → throw). 수수료율·가격·상품 필드는 들어올 자리가 없다(불변식 ④).
//     - landingUrl 은 buildSearchLinks(keyword) 의 쿠팡 SEARCH href 와 정확히 같아야 한다(같은 검색 결과 페이지만 — 106·258).
//     - code 는 레지스트리 codeRe(providers.ts) 통과만. __proto__·constructor·prototype 키 → throw(ws-wire FORBIDDEN_KEYS 재사용).
//     - 273(Codex ④): 원문 JSON 의 같은 객체 안 중복 키 → throw(parseAffiliateMapText). JSON.parse 는 마지막 값만 남겨 앞 값이 사라진다.
//   게이트: production ∧ WS_AFFILIATE_PROVIDERS ∋ COUPANG ∧ origin ∈ WS_AFFILIATE_ORIGINS. 하나라도 거짓 → 꺼짐(맵을 읽지도 않는다).
//     켜짐인데 맵이 없거나 무효 → cli 가 빌드 실패(exit 2).
//   제휴 맵은 링크 href 형식만 바꾼다. 노출·순서 계산(engine exposure·orderExposableProducts)에는 넘기지 않는다(불변식 ③).
import { PROVIDERS, affiliateCodeFromHref, buildSearchLinks, isAffiliateCode, type AffiliateCodes, type SearchLink } from '../engine/index.js';
import { FORBIDDEN_KEYS, hasForbiddenKey } from '../engine/ws-wire.js';

/** 키워드(buildSearchKeyword 결과) → 공급자별 제휴 코드. buildSite·projectSite 의 affiliate 옵션. */
export type AffiliateLinkMap = ReadonlyMap<string, AffiliateCodes>;

export interface AffiliateMapFile {
  v: 1;
  provider: 'COUPANG';
  subId: string;
  source: 'MANUAL';
  generatedAt: string;
  entries: Array<{ keyword: string; landingUrl: string; code: string }>;
}

const TOP_KEYS = ['v', 'provider', 'subId', 'source', 'generatedAt', 'entries'] as const;
const ENTRY_KEYS = ['keyword', 'landingUrl', 'code'] as const;
const SUB_ID_RE = /^[A-Za-z0-9_-]{0,32}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 재생성 권고 주기(109: 분기 재생성, 90일 경고). */
export const AFFILIATE_MAP_STALE_DAYS = 90;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

function dayNumber(iso: string): number | null {
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t / 86_400_000;
}

/** 맵 JSON(JSON.parse 결과) 검사 — 무효면 throw(메시지에 코드 값은 넣지 않는다). */
export function parseAffiliateMap(json: unknown): AffiliateMapFile {
  const fail = (why: string): never => {
    throw new Error(`affiliate: 맵 무효 — ${why}`);
  };
  if (hasForbiddenKey(json)) fail(`금지 키(${FORBIDDEN_KEYS.join('·')})`);
  if (!isRecord(json) || !exactKeys(json, TOP_KEYS)) fail(`최상위 키는 ${TOP_KEYS.join('·')} 만`);
  const o = json as Record<string, unknown>;
  if (o.v !== 1) fail('v 는 1');
  if (o.provider !== 'COUPANG') fail('provider 는 COUPANG 만');
  if (o.source !== 'MANUAL') fail('source 는 MANUAL 만(수동 모드)');
  if (typeof o.subId !== 'string' || !SUB_ID_RE.test(o.subId)) fail('subId 는 영숫자·_·- 0~32자');
  if (typeof o.generatedAt !== 'string' || dayNumber(o.generatedAt) === null) fail('generatedAt 은 YYYY-MM-DD');
  if (!Array.isArray(o.entries)) fail('entries 는 배열');
  const seenKw = new Set<string>();
  const seenCode = new Set<string>();
  (o.entries as unknown[]).forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!isRecord(e) || !exactKeys(e, ENTRY_KEYS)) fail(`${at} 키는 ${ENTRY_KEYS.join('·')} 만`);
    const r = e as Record<string, unknown>;
    if (typeof r.keyword !== 'string' || r.keyword === '' || r.keyword !== r.keyword.replace(/\s+/g, ' ').trim()) fail(`${at}.keyword 는 공백 정리된 비지 않은 문자열`);
    const kw = r.keyword as string;
    const search = buildSearchLinks(kw).find((l) => l.provider === 'COUPANG' && l.kind === 'SEARCH');
    if (!search || r.landingUrl !== search.href) fail(`${at}.landingUrl ≠ 쿠팡 검색 결과 링크(buildSearchLinks)`);
    if (!isAffiliateCode('COUPANG', r.code)) fail(`${at}.code 형식 위반`);
    if (seenKw.has(kw)) fail(`${at}.keyword 중복`);
    if (seenCode.has(r.code as string)) fail(`${at}.code 중복`);
    seenKw.add(kw);
    seenCode.add(r.code as string);
  });
  return o as unknown as AffiliateMapFile;
}

/**
 * 원문 JSON 에 같은 객체 안 중복 키가 있는가(273). 입력은 JSON.parse 를 통과한 텍스트여야 한다(문법 검사는 하지 않는다).
 *   키는 디코딩해 비교한다("a" 와 유니코드 이스케이프로 쓴 a 는 같은 키). 재귀 없음(명시적 스택).
 *   scripts/lib/rules-source.mjs parseJsonEntries 와 같은 목적 — 서버 TS 에서 scripts/ 를 import 하지 않으려고 따로 둔다.
 */
export function hasDuplicateJsonKey(text: string): boolean {
  const stack: Array<{ keys: Set<string> | null; expectKey: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top !== undefined && top.keys !== null && top.expectKey) {
        const key = JSON.parse(text.slice(i, j + 1)) as string;
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (c === '[') stack.push({ keys: null, expectKey: false });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top !== undefined && top.keys !== null) top.expectKey = true;
    }
    i++;
  }
  return false;
}

/** 맵 원문 텍스트 검사 — JSON 아님·중복 키·parseAffiliateMap 위반이면 throw(cli.ts 가 쓰는 입구). */
export function parseAffiliateMapText(text: string): AffiliateMapFile {
  let json: unknown;
  if (text.charCodeAt(0) === 0xfeff) throw new Error('affiliate: 맵 무효 — 파일 앞 BOM(U+FEFF), BOM 없는 UTF-8 로 저장'); // 276: 스캐너 mapProblems 와 같은 거부
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('affiliate: 맵 무효 — JSON 아님');
  }
  if (hasDuplicateJsonKey(text)) throw new Error('affiliate: 맵 무효 — 같은 객체 안 중복 키(JSON.parse 가 앞 값을 버린다)');
  return parseAffiliateMap(json);
}

/** 검사된 맵 → 빌드 옵션 맵(키워드 → {COUPANG: code}). */
export function toAffiliateLinkMap(file: AffiliateMapFile): AffiliateLinkMap {
  return new Map(file.entries.map((e) => [e.keyword, Object.freeze({ COUPANG: e.code })]));
}

/** 경고(빌드 실패 아님): 오래된 맵 1줄, 이번 빌드 키워드에 없는 항목 개수. 값(코드·키워드)은 출력하지 않는다. */
export function affiliateMapWarnings(file: AffiliateMapFile, buildKeywords: ReadonlySet<string>, asOf: string): string[] {
  const out: string[] = [];
  const g = dayNumber(file.generatedAt);
  const now = dayNumber(asOf);
  if (g !== null && now !== null && now - g > AFFILIATE_MAP_STALE_DAYS) {
    out.push(`affiliate: 경고 맵 generatedAt 이 ${AFFILIATE_MAP_STALE_DAYS}일 넘음 — 재생성 권고`);
  }
  const unmatched = file.entries.filter((e) => !buildKeywords.has(e.keyword)).length;
  if (unmatched > 0) out.push(`affiliate: 경고 이번 빌드 검색어에 없는 맵 항목 ${unmatched}개(일반 링크로 폴백)`);
  return out;
}

/**
 * 렌더 허용 필터(261 트리거) — SEARCH 는 레지스트리 검색 base?param= 로 시작할 때만, AFFILIATE 는 prefix + codeRe 일 때만 남긴다.
 *   순서는 입력 그대로(필터만, 재정렬 0). 엔진 출력은 늘 통과한다.
 */
export function renderableSearchLinks(links: readonly SearchLink[]): SearchLink[] {
  return links.filter((l) => {
    const p = Object.prototype.hasOwnProperty.call(PROVIDERS, l.provider) ? PROVIDERS[l.provider] : null;
    if (p === null || typeof l.href !== 'string') return false;
    if (l.kind === 'AFFILIATE') return affiliateCodeFromHref(l.provider, l.href) !== null;
    if (l.kind !== undefined && l.kind !== 'SEARCH') return false;
    return p.search !== null && l.href.startsWith(`${p.search.base}?${p.search.param}=`);
  });
}

/** 고지 A·B 공통 판정 — 렌더 필터를 통과한 AFFILIATE 링크가 1개 이상인가. */
export function affiliateDisclosureOn(links: readonly SearchLink[]): boolean {
  return renderableSearchLinks(links).some((l) => l.kind === 'AFFILIATE');
}

export type AffiliateGateReason = 'NOT_PRODUCTION' | 'PROVIDER_OFF' | 'ORIGIN_NOT_ALLOWED' | 'ON';

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
const stripSlash = (s: string): string => s.replace(/\/+$/, '');

/** 빌드 타임 게이트(맵 유효성은 별도 — 켜짐일 때만 cli 가 맵을 읽고 검사). 기본 꺼짐. */
export function affiliateGate(
  env: Readonly<Record<string, string | undefined>>,
  origin: string,
  production: boolean,
): { on: boolean; reason: AffiliateGateReason } {
  if (!production) return { on: false, reason: 'NOT_PRODUCTION' };
  if (!list(env.WS_AFFILIATE_PROVIDERS).includes('COUPANG')) return { on: false, reason: 'PROVIDER_OFF' };
  const allowed = list(env.WS_AFFILIATE_ORIGINS).map(stripSlash);
  if (!allowed.includes(stripSlash(origin.trim()))) return { on: false, reason: 'ORIGIN_NOT_ALLOWED' };
  return { on: true, reason: 'ON' };
}
