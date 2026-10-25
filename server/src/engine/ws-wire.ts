// ws-data 와이어 포맷(v2) — 프리렌더 HTML 의 <script id="ws-data"> 에 싣는 직렬화 형태. 순수·결정론(시계·난수·I/O 0).
//   메모리 계약(WsPageData, v:1)은 그대로다. 와이어만 줄인다(무손실):
//     (A) requirements[].searchLinks 제거 — 같은 엔진 buildSearchLinks(searchKeyword)로만 복원(링크 출처는 이 함수 하나).
//     (B) requirements[].source[] → 최상위 sources 표(첫 등장 순서) + requirements[].sourceRefs 인덱스.
//   decodeWsPage: v2 → v1 논리 객체 복원, v1 은 그대로 통과(배포 경계 — 구 HTML), 그 밖은 null.
//   v2 검사는 fail-closed: 범위 밖·정수 아닌 인덱스, 어느 요구사항도 참조하지 않는 표 항목, 표 중복 항목,
//   v2 요구사항에 남은 searchLinks/source, 표 항목에 {url,title} 외 키, 알 수 없는 최상위 키·v → null.
//   보안 79 L-2: 출처 url 은 ^https:// 만(encode throw · decode null — javascript:·http:·상대 경로 차단, 렌더 가드와 이중).
//   보안 79 L-3: 입력 어디든(v1·v2, 중첩 포함) 자체 키 __proto__·constructor·prototype 이 있으면 decode null(encode 는 throw).
//   그 밖의 형태 검사(route·layer·data 6키·verdict 허용목록, 불변식 ③)는 호출자(client pageData)가 디코드 뒤에 한다.
import type { PublicRequirement, WsPageData } from './public.js';
import { buildSearchLinks } from './search-links.js';

export const WS_WIRE_VERSION = 2 as const;

/** 출처 표 항목(PublicRequirement.source 원소와 같은 형태). */
export interface WsWireSource {
  url: string;
  title: string;
}

/** 와이어 요구사항 = 공개 요구사항 − searchLinks − source + sourceRefs(최상위 sources 인덱스, 원래 순서·중복 그대로). */
export type WsWireRequirement = Omit<PublicRequirement, 'searchLinks' | 'source'> & { sourceRefs: number[] };

export interface WsPageWire {
  v: typeof WS_WIRE_VERSION;
  route: WsPageData['route'];
  layer: WsPageData['layer'];
  catalogUrl: string;
  data: Omit<WsPageData['data'], 'requirements'> & { requirements: WsWireRequirement[] };
  sources: WsWireSource[];
}

const PAGE_KEYS = ['v', 'route', 'layer', 'catalogUrl', 'data'] as const;
const WIRE_KEYS = [...PAGE_KEYS, 'sources'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameKeySet(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/** L-2: 출처 url 허용 형식 — 소문자 https 스킴만. */
export const SOURCE_URL_RE = /^https:\/\//;

function isWireSource(v: unknown): v is WsWireSource {
  return (
    isRecord(v) &&
    sameKeySet(v, ['url', 'title']) &&
    typeof v.url === 'string' &&
    typeof v.title === 'string' &&
    SOURCE_URL_RE.test(v.url)
  );
}

/** L-3: 프로토타입 오염 경로 키. */
export const FORBIDDEN_KEYS: readonly string[] = Object.freeze(['__proto__', 'constructor', 'prototype']);

/** 값 트리(배열·객체, 반복 탐색 — 깊이 제한 없음·재귀 스택 0)에 FORBIDDEN_KEYS 자체 키가 있는가. */
export function hasForbiddenKey(root: unknown): boolean {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.includes(k)) return true;
      stack.push((v as Record<string, unknown>)[k]);
    }
  }
  return false;
}

const sourceKey = (s: WsWireSource): string => JSON.stringify([s.url, s.title]);

/**
 * 메모리 페이지(v1) → 와이어(v2). 프리렌더(site.ts) 전용. 무손실이 아닐 입력은 예외(빌드 실패):
 *   searchLinks ≠ buildSearchLinks(searchKeyword), source 원소가 {url,title} 문자열이 아님, 이미 sourceRefs 키가 있음, 최상위 키 이탈.
 */
export function encodeWsPage(page: WsPageData): WsPageWire {
  if (!isRecord(page) || page.v !== 1 || !sameKeySet(page as unknown as Record<string, unknown>, PAGE_KEYS)) {
    throw new Error('ws-wire: encode 입력은 v:1 WsPageData(최상위 키 v·route·layer·catalogUrl·data)');
  }
  if (hasForbiddenKey(page)) throw new Error(`ws-wire: encode 입력에 금지 키(${FORBIDDEN_KEYS.join('·')})가 있다(L-3)`);
  const sources: WsWireSource[] = [];
  const index = new Map<string, number>();
  const requirements = page.data.requirements.map((r, i): WsWireRequirement => {
    const at = `requirements[${i}](${String(r.requirementId)})`;
    if (Object.prototype.hasOwnProperty.call(r, 'sourceRefs')) throw new Error(`ws-wire: ${at} 에 sourceRefs 키가 이미 있다`);
    if (JSON.stringify(r.searchLinks) !== JSON.stringify(buildSearchLinks(r.searchKeyword))) {
      throw new Error(`ws-wire: ${at}.searchLinks ≠ buildSearchLinks(searchKeyword) — 와이어에서 복원할 수 없다`);
    }
    if (!Array.isArray(r.source)) throw new Error(`ws-wire: ${at}.source 가 배열이 아니다`);
    const refs = r.source.map((s, j) => {
      if (!isWireSource(s)) throw new Error(`ws-wire: ${at}.source[${j}] 는 {url,title} 문자열만, url 은 https:// 만(L-2)`);
      const k = sourceKey(s);
      let n = index.get(k);
      if (n === undefined) {
        n = sources.length;
        index.set(k, n);
        sources.push({ url: s.url, title: s.title });
      }
      return n;
    });
    // 키 순서 보존: searchLinks 는 빼고, source 자리에 sourceRefs.
    const entries: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(r)) {
      if (k === 'searchLinks') continue;
      entries.push(k === 'source' ? ['sourceRefs', refs] : [k, v]);
    }
    return Object.fromEntries(entries) as WsWireRequirement;
  });
  const data = Object.fromEntries(
    Object.entries(page.data).map(([k, v]) => [k, k === 'requirements' ? requirements : v]),
  ) as WsPageWire['data'];
  return { v: WS_WIRE_VERSION, route: page.route, layer: page.layer, catalogUrl: page.catalogUrl, data, sources };
}

/**
 * 와이어(JSON.parse 결과) → 메모리 페이지(v1). v1 은 그대로(형태 검사는 호출자), v2 는 복원, 그 밖·v2 위반은 null(fail-closed).
 *   복원 링크는 buildSearchLinks(searchKeyword)만 — 와이어에 실린 href 는 받지 않는다.
 */
export function decodeWsPage(input: unknown): WsPageData | null {
  if (!isRecord(input)) return null;
  if (hasForbiddenKey(input)) return null; // L-3 — v1 통과 경로 포함.
  if (input.v === 1) return input as unknown as WsPageData;
  if (input.v !== WS_WIRE_VERSION) return null;
  if (!sameKeySet(input, WIRE_KEYS)) return null;

  const table = input.sources;
  if (!Array.isArray(table) || !table.every(isWireSource)) return null;
  const seen = new Set<string>();
  for (const s of table) {
    const k = sourceKey(s);
    if (seen.has(k)) return null;
    seen.add(k);
  }

  const data = input.data;
  if (!isRecord(data) || !Array.isArray(data.requirements)) return null;
  const used = new Set<number>();
  const requirements: unknown[] = [];
  for (const r of data.requirements as unknown[]) {
    if (!isRecord(r)) return null;
    if (Object.prototype.hasOwnProperty.call(r, 'searchLinks') || Object.prototype.hasOwnProperty.call(r, 'source')) return null;
    if (!Object.prototype.hasOwnProperty.call(r, 'searchKeyword') || typeof r.searchKeyword !== 'string') return null;
    const refs = r.sourceRefs;
    if (!Array.isArray(refs)) return null;
    for (const n of refs) {
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= table.length) return null;
      used.add(n);
    }
    const entries: Array<[string, unknown]> = [];
    for (const [k, v] of Object.entries(r)) {
      if (k === 'sourceRefs') {
        entries.push(['source', (refs as number[]).map((n) => ({ url: table[n].url, title: table[n].title }))]);
      } else {
        entries.push([k, v]);
        if (k === 'searchKeyword') entries.push(['searchLinks', buildSearchLinks(v as string)]);
      }
    }
    requirements.push(Object.fromEntries(entries));
  }
  if (used.size !== table.length) return null;

  const outData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, k === 'requirements' ? requirements : v]));
  return { v: 1, route: input.route, layer: input.layer, catalogUrl: input.catalogUrl, data: outData } as unknown as WsPageData;
}
