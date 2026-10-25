// 산출물 규칙(client/dist) — C3-OUT-ID, C3-OUT-ROUTE, C3-OUT-SRC, C3-OUT-TAXON, C3-OUT-DRAFTSRC, C3-OUT-REVIEWMETA, C4-BANNED(산출물), C6-IMG(산출물), C8-OUT-SAFE.
//   + 시드 노출 규칙 C3-TAXON(scanSeedExposure, 산출물 유무와 무관).
//   노출 판단은 seed-exposure.mjs(원시 시드 독립 재구현, D9)만 쓴다.
//
// prerender-manifest.json 계약(F3 가 쓴다):
//   { v: 1, seedDigest: "<sha256 hex — seed-exposure.mjs seedDigest()>", indexable: boolean(사이트 수준, WS_INDEXABLE),
//     routes: [{ path: "/hamster/golden", file: "hamster/golden/index.html", kind: RouteKind, indexable: boolean,
//                typeId?, family?, itemId?, productId?, region?, layer?: { kind, typeId, itemId?|productId? } }] }
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { lineIndex, relPosix, stripBom, walk } from './files.mjs';
import { scripts, tags, textNodes } from './html.mjs';
import { lintText } from './normalize.mjs';
import { SEED_KEYS } from './seed-exposure.mjs';

const ROUTE_KINDS = new Set(['HOME', 'FAMILY', 'TYPE', 'SETUP', 'SUPPLIES', 'SUPPLY_ITEM', 'SUPPLY_ITEM_TYPE', 'VET', 'VET_REGION', 'CREDITS', 'SAVE', 'PICK', 'NOT_FOUND']);
const TYPE_KINDS = new Set(['TYPE', 'SETUP']);
const WS_DATA_KEYS = { types: 'animalTypes', products: 'curatedProducts', bundles: 'setupBundles', vets: 'vetClinics', testimonials: 'testimonials' };
const JSON_TEXT_SKIP = /^(id|slug|href|url|sourceUrl|path|catalogUrl|imageAsset|reviewerImage|seedDigest|file|item|@context|@type|@id|kind|provider|reviewerType|priority|orderHint|category|tier|verdict|reasonCodes|situation|linkedAction|group|imageLicense)$|Id$|Ids$|At$/;
const TEXT_ATTRS = ['title', 'alt', 'aria-label', 'aria-description', 'placeholder'];
const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('\\');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function decodePath(p) {
  let s = String(p);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* 그대로 */
  }
  s = s.normalize('NFC');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
}

function bannedIn(text, rel, line, where, add, bw) {
  for (const h of lintText(text, bw)) {
    if (h.rule === 'L01') add('C4-BANNED', 'FAIL', rel, line, `${where}: 금지어 "${h.term}"`);
    else if (h.rule === 'L06') add('C4-BANNED', 'WARN', rel, line, `${where}: 공백 제거 후 2자 금지어 "${h.term}"`);
    // R6 B1(SEC-4 L-4): 산출물은 사용자에게 보이는 결과물 — 어간도 FAIL.
    else add('C4-STEM', 'FAIL', rel, line, `${where}: 금지어 어간 "${h.term}"`);
  }
}

function jsonStrings(v, key, visit) {
  if (Array.isArray(v)) v.forEach((x) => jsonStrings(x, key, visit));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) jsonStrings(x, k, visit);
  else if (typeof v === 'string') {
    if (JSON_TEXT_SKIP.test(key) || /^(https?:\/\/|\/)/i.test(v)) return;
    visit(v, key);
  }
}

/** ws-data v2(계획 73 S4) 출처 표 항목에 허용되는 키. */
const WS_SOURCE_KEYS = new Set(['url', 'title']);

/**
 * C3-OUT-SRC — ws-data 와이어 형식(계획 73 S4). v1·v2 둘 다 수용(배포 경계), 그 밖의 v 는 FAIL.
 *   v1: 최상위 sources 없음 · requirement 에 sourceRefs 없음(형식 혼합 금지).
 *   v2: 최상위 sources = [{url,title}] 표(키 초과·형식 오류 FAIL) · requirement 는 source·searchLinks 없음(잔존 FAIL)
 *       · sourceRefs = 정수 인덱스 배열(범위 밖 FAIL) · 어떤 requirement 도 참조하지 않는 표 항목 FAIL.
 *   디코더 server/src/engine/ws-wire.ts decodeWsPage 와 같은 fail-closed(S6 O-1·O-2): v2 최상위 키 집합 정확 일치(v·route·layer·catalogUrl·data·sources),
 *   sources 필수 배열 · 표 중복 {url,title} FAIL · data.requirements 배열 필수 · requirement 객체 + searchKeyword 문자열 + sourceRefs 필수 배열 · 인덱스는 number 정수.
 *   보안 79 L-2: v2 표 항목 url 은 ^https:// 만(디코더 SOURCE_URL_RE 와 같은 식). L-3: ws-data 어디든(v1·v2) 자체 키
 *   __proto__·constructor·prototype 이 있으면 FAIL(디코더 hasForbiddenKey 와 같은 조건 — 디코더는 null 로 거부).
 */
const WS_V2_KEYS = ['v', 'route', 'layer', 'catalogUrl', 'data', 'sources'];
const WS_SOURCE_URL_RE = /^https:\/\//;
const WS_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** 값 트리(반복 탐색)에서 처음 만나는 금지 자체 키 — 없으면 null. */
function forbiddenKeyIn(root) {
  const stack = [root];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    for (const k of Object.keys(v)) {
      if (WS_FORBIDDEN_KEYS.has(k)) return k;
      stack.push(v[k]);
    }
  }
  return null;
}
function checkWsWire(d, rel, line, add) {
  const bad = (what) => add('C3-OUT-SRC', 'FAIL', rel, line, `ws-data ${what}`);
  const fk = forbiddenKeyIn(d);
  if (fk !== null) bad(`금지 키 ${fk}(프로토타입 오염 경로, L-3)`);
  const reqs = isObj(d.data) && Array.isArray(d.data.requirements) ? d.data.requirements.filter(isObj) : [];
  if (d.v === 1) {
    if (d.sources !== undefined) bad('v1 인데 최상위 sources 있음(형식 혼합)');
    for (const q of reqs) if (q.sourceRefs !== undefined) bad(`v1 인데 requirement ${q.animalTypeId}|${q.supplyItemId} 에 sourceRefs`);
    return;
  }
  if (d.v !== 2) return bad(`알 수 없는 v=${JSON.stringify(d.v)}`);
  const own = Object.keys(d);
  if (own.length !== WS_V2_KEYS.length || !WS_V2_KEYS.every((k) => Object.hasOwn(d, k))) bad(`v2 최상위 키 집합 불일치(${own.join(',')})`);
  if (!Array.isArray(d.sources)) return bad('v2 sources 형식(최상위 sources 없음 또는 배열 아님)');
  const table = d.sources;
  const seen = new Set();
  table.forEach((e, i) => {
    if (!isObj(e)) return bad(`v2 sources[${i}] 형식`);
    for (const k of Object.keys(e)) if (!WS_SOURCE_KEYS.has(k)) bad(`v2 sources[${i}] 허용 밖 키 ${k}`);
    if (typeof e.url !== 'string' || typeof e.title !== 'string') return bad(`v2 sources[${i}] url·title 문자열 아님`);
    if (!WS_SOURCE_URL_RE.test(e.url)) bad(`v2 sources[${i}] url 이 https:// 아님(L-2): ${e.url.slice(0, 40)}`);
    const key = JSON.stringify([e.url, e.title]);
    if (seen.has(key)) bad(`v2 sources[${i}] 중복 표 항목`);
    seen.add(key);
  });
  if (!isObj(d.data) || !Array.isArray(d.data.requirements)) bad('v2 data.requirements 배열 없음');
  else if (d.data.requirements.some((q) => !isObj(q))) bad('v2 requirement 형식(객체 아님)');
  const used = new Set();
  for (const q of reqs) {
    const at = `requirement ${q.animalTypeId}|${q.supplyItemId}`;
    if (q.source !== undefined) bad(`v2 ${at} 에 source 잔존`);
    if (q.searchLinks !== undefined) bad(`v2 ${at} 에 searchLinks 잔존`);
    if (typeof q.searchKeyword !== 'string') bad(`v2 ${at} searchKeyword 문자열 아님·누락`);
    if (!Array.isArray(q.sourceRefs)) {
      bad(`v2 ${at} sourceRefs 형식(없음 또는 배열 아님)`);
      continue;
    }
    for (const r of q.sourceRefs) {
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r >= table.length) bad(`v2 ${at} sourceRefs 범위 밖 인덱스 ${JSON.stringify(r)} (표 ${table.length}개)`);
      else used.add(r);
    }
  }
  for (let i = 0; i < table.length; i++) if (!used.has(i)) bad(`v2 sources[${i}] 미참조 표 항목`);
}

/** ws-data (§6-3 WsPageData) id 검사. */
function checkWsData(d, rel, line, ex, add) {
  const bad = (what) => add('C3-OUT-ID', 'FAIL', rel, line, `ws-data 비노출 ${what}`);
  if (!isObj(d)) return;
  checkWsWire(d, rel, line, add);
  const r = d.route;
  if (isObj(r) && r.typeId !== undefined && !ex.ids.animalTypes.has(r.typeId)) bad(`route.typeId ${r.typeId}`);
  checkLayer(d.layer, ex, (w) => bad(`layer ${w}`));
  const data = d.data;
  if (data === undefined) return;
  if (!isObj(data)) return bad('data 형식');
  for (const [k, arr] of Object.entries(data)) {
    if (!Array.isArray(arr)) {
      bad(`data.${k} 형식`);
      continue;
    }
    if (k === 'requirements') {
      for (const q of arr) {
        if (!isObj(q) || !ex.pairs.has(`${q.animalTypeId}|${q.supplyItemId}`)) bad(`requirement ${q?.animalTypeId}|${q?.supplyItemId}`);
        const item = isObj(q) ? q.item : undefined;
        if (item !== undefined) {
          if (!isObj(item) || !ex.ids.supplyItems.has(item.id)) bad(`requirement.item ${item?.id}`);
          for (const a of Array.isArray(item?.alternativeIds) ? item.alternativeIds : []) if (!ex.ids.supplyItems.has(a)) bad(`alternativeId ${a}`);
        }
      }
      continue;
    }
    const key = WS_DATA_KEYS[k];
    if (!key) {
      bad(`알 수 없는 컬렉션 data.${k}`);
      continue;
    }
    for (const x of arr) if (!isObj(x) || !ex.ids[key].has(x.id)) bad(`${k} ${x?.id}`);
  }
}

function checkLayer(layer, ex, bad) {
  if (layer === null || layer === undefined) return;
  if (!isObj(layer)) return bad('형식');
  if (!ex.ids.animalTypes.has(layer.typeId)) bad(`typeId ${layer.typeId}`);
  if (layer.itemId !== undefined && !ex.pairs.has(`${layer.typeId}|${layer.itemId}`)) bad(`itemId ${layer.itemId}`);
  if (layer.productId !== undefined && !ex.productTypes.has(`${layer.typeId}|${layer.productId}`)) bad(`productId ${layer.productId}`);
}

/** 공개 카탈로그(dist/data/*.json) id 검사. */
function checkCatalog(c, rel, ex, digest, add) {
  if (!isObj(c)) return add('C3-OUT-ID', 'FAIL', rel, null, '카탈로그 형식');
  if (c.seedDigest !== undefined && c.seedDigest !== digest) add('C3-OUT-ROUTE', 'FAIL', rel, null, `카탈로그 seedDigest 불일치 (${c.seedDigest})`);
  for (const [k, arr] of Object.entries(c)) {
    if (!Array.isArray(arr)) continue;
    if (!SEED_KEYS.includes(k)) {
      if (arr.some((x) => isObj(x) && 'id' in x)) add('C3-OUT-ID', 'FAIL', rel, null, `알 수 없는 컬렉션 ${k}`);
      continue;
    }
    for (const x of arr) if (!isObj(x) || !ex.ids[k].has(x.id)) add('C3-OUT-ID', 'FAIL', rel, null, `카탈로그 비노출 ${k}#${x?.id}`);
    // Taxon 참조는 검수 완료 Taxon 만(불변식 7) — 타입은 Taxon 미검수여도 노출(Kenny 2026-10-24 K-4 되돌림).
    const taxonRefs = (x) => (k === 'animalTypes' ? [x.taxonId] : k === 'careProfiles' && Array.isArray(x.taxonIds) ? x.taxonIds : []);
    for (const x of arr) {
      if (!isObj(x)) continue;
      for (const t of taxonRefs(x)) if (t !== null && t !== undefined && !ex.ids.taxa.has(t)) add('C3-OUT-ID', 'FAIL', rel, null, `카탈로그 비노출 Taxon 참조 ${k}#${x.id} → ${t}`);
    }
  }
}

function checkRoutes(m, dist, ex, add) {
  const R = 'prerender-manifest.json';
  if (!Array.isArray(m.routes)) {
    add('C3-OUT-ROUTE', 'FAIL', R, null, 'routes 배열 없음');
    return [];
  }
  for (const r of m.routes) {
    if (!isObj(r) || typeof r.path !== 'string' || typeof r.file !== 'string') {
      add('C3-OUT-ROUTE', 'FAIL', R, null, `route 형식 오류: ${JSON.stringify(r)}`);
      continue;
    }
    const at = `route ${r.path}`;
    if (!ROUTE_KINDS.has(r.kind)) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 알 수 없는 kind ${r.kind}`);
    if (r.file.split(/[\\/]/).includes('..') || /^([a-z]:|\/)/i.test(r.file) || !existsSync(join(dist, r.file))) {
      add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 파일 없음·경로 이탈 ${r.file}`);
    }
    if (TYPE_KINDS.has(r.kind) && r.typeId === undefined) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: ${r.kind} 에 typeId 없음`);
    if (r.typeId !== undefined) {
      const t = ex.types.get(r.typeId);
      if (!t) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 타입 ${r.typeId}`);
      else if (TYPE_KINDS.has(r.kind) || r.kind === 'SUPPLY_ITEM') {
        const p = decodePath(r.path);
        const base = `/${t.slug}`;
        if (typeof t.slug !== 'string' || (p !== base && !p.startsWith(`${base}/`))) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 타입 slug(${t.slug}) 불일치`);
      }
    }
    if (r.kind === 'FAMILY') {
      const fam = r.family;
      if (typeof fam !== 'string' || ![...ex.types.values()].some((t) => typeof t.slug === 'string' && t.slug.startsWith(`${fam}/`))) {
        add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 노출 타입 없는 family ${fam}`);
      }
    }
    if (r.itemId !== undefined) {
      const ok = r.typeId !== undefined ? ex.pairs.has(`${r.typeId}|${r.itemId}`) : ex.ids.supplyItems.has(r.itemId);
      if (!ok) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 item ${r.itemId}`);
    }
    if (r.productId !== undefined) {
      const ok = r.typeId !== undefined ? ex.productTypes.has(`${r.typeId}|${r.productId}`) : ex.ids.curatedProducts.has(r.productId);
      if (!ok) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 product ${r.productId}`);
    }
    if (r.region !== undefined && !ex.vetRegions.has(r.region)) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 노출 병원 없는 지역 ${r.region}`);
    if (r.kind === 'VET_REGION' && r.region === undefined) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: VET_REGION 에 region 없음`);
    // R4 D6: /credits 는 항상 생성(사진 0이면 빈 상태) — 존재 자체는 위반이 아니다. 내용은 아래 C6 가 본다.
    if (r.kind === 'CREDITS' && r.indexable === true) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: /credits 는 noindex 여야 한다`);
    checkLayer(r.layer, ex, (w) => add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: layer ${w}`));
  }
  return m.routes.filter(isObj);
}

const OUT_TEXT_EXT = /\.(?:html?|m?js|cjs|json|xml|txt|css|webmanifest|svg|map)$/i;
/** C3-OUT-REVIEWMETA 바늘 — 시드 공통 필드 reviewBasis 와 그 값, 서명 매니페스트 키·파일명. */
export const REVIEW_META_NEEDLES = Object.freeze(['reviewBasis', 'ROW_CHECKED', 'AI_RESEARCH_BULK', 'factHash', 'review-signatures']);
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const BS = String.fromCharCode(0x5c); // 역슬래시 — server/src/prerender/html.ts jsonForScript JSON_ESC 와 같은 표기
const JSON_SCRIPT_ESC = { '<': `${BS}u003c`, '>': `${BS}u003e`, '&': `${BS}u0026` };

/** 문자열이 산출물에 실릴 수 있는 표기: 원문 · HTML 이스케이프 · JSON 문자열 본문 · <script> JSON 이스케이프. */
function encodings(s) {
  const json = JSON.stringify(s).slice(1, -1);
  return [...new Set([s, s.replace(/[&<>"']/g, (c) => HTML_ESC[c]), json, json.replace(/[<>&]/g, (c) => JSON_SCRIPT_ESC[c])])];
}

/**
 * C3-OUT-TAXON(보안 71 L-2): 비노출 Taxon 의 id·legal.note 문자열이 어떤 산출물 텍스트(HTML·ws-data·카탈로그·JS·JSON 등)에도 없어야 한다.
 *   비노출 = 시드 taxa 중 ex.ids.taxa(seed-exposure 독립 재구현) 밖. 압축 사본(.br/.gz)은 원본 동일성 검사(C8)가 대신한다.
 *   한계: 문장을 태그로 쪼개 렌더하거나 다른 문장으로 바꿔 쓴 경우는 못 잡는다(정확 일치 + 4가지 이스케이프 표기만).
 */
function hiddenTaxonNeedles(seed, ex) {
  const needles = [];
  for (const t of Array.isArray(seed?.taxa) ? seed.taxa : []) {
    if (!isObj(t) || typeof t.id !== 'string' || t.id === '' || ex.ids.taxa.has(t.id)) continue;
    for (const v of encodings(t.id)) needles.push({ taxonId: t.id, what: 'id', v });
    const note = isObj(t.legal) ? t.legal.note : null;
    if (typeof note === 'string' && note.trim() !== '') for (const v of encodings(note)) needles.push({ taxonId: t.id, what: 'legal.note', v });
  }
  return needles;
}

/**
 * C3-OUT-DRAFTSRC(보안 79 L-7): 비노출 행(DRAFT·AI_DRAFT·만료·비노출 체인 — seed-exposure 미러 ex.ids 밖)에만 등장하는
 *   출처 url·title 문자열이 어떤 산출물 텍스트에도 없어야 한다. DRAFT 전용 출처를 포함한다(그보다 넓다: VERIFIED 지만 비노출인
 *   PLANNED 타입 체인의 출처도 대상). 허용 = 노출 행(어느 시드 키든)의 모든 문자열 값(깊이 무관) — 같은 url·title 이 노출 행에도
 *   있으면 대상 아님(오탐 0). 표기 = C3-OUT-TAXON 과 같은 4가지(원문·HTML·JSON·<script> JSON 이스케이프).
 *   한계: 6자 미만 title 은 우연 일치가 많아 제외. 압축 사본은 C8 원본 동일성으로 대신.
 */
const DRAFTSRC_MIN_LEN = 6;
function collectStrings(v, out) {
  const stack = [v];
  while (stack.length > 0) {
    const x = stack.pop();
    if (typeof x === 'string') out.add(x);
    else if (Array.isArray(x)) for (const y of x) stack.push(y);
    else if (isObj(x)) for (const y of Object.values(x)) stack.push(y);
  }
}
function hiddenSourceNeedles(seed, ex) {
  const allowed = new Set();
  const candidates = new Map(); // 문자열 → { key, id, what }
  for (const key of SEED_KEYS) {
    const rows = Array.isArray(seed?.[key]) ? seed[key] : [];
    const shown = ex.ids[key] ?? new Set();
    for (const r of rows) {
      if (!isObj(r)) continue;
      if (typeof r.id === 'string' && shown.has(r.id)) {
        collectStrings(r, allowed);
        continue;
      }
      if (!Array.isArray(r.source)) continue;
      for (const s of r.source) {
        if (!isObj(s)) continue;
        for (const what of ['url', 'title']) {
          const v = s[what];
          if (typeof v === 'string' && v.trim().length >= DRAFTSRC_MIN_LEN && !candidates.has(v)) candidates.set(v, { key, id: r.id, what });
        }
      }
    }
  }
  const needles = [];
  for (const [v, at] of candidates) {
    if (allowed.has(v)) continue;
    for (const e of encodings(v)) needles.push({ ...at, raw: v, v: e });
  }
  return needles;
}

/**
 * 시드 노출 규칙(산출물 유무와 무관) — C3-TAXON(보안 71 L-1): 노출 타입(ex.types)은 taxonId 가 비어 있지 않은 문자열이어야 한다.
 *   타입 노출 자체는 Taxon 검수를 보지 않는다(Kenny 2026-10-24 K-4 되돌림) — 이 규칙은 "법 사슬이 끊긴 타입 공개"만 막는다.
 *   validate R01(ACTIVE ⇒ taxonId 필수)의 독립 재확인.
 */
export function scanSeedExposure({ ex, add }) {
  for (const [id, t] of ex.types) {
    if (typeof t.taxonId !== 'string' || t.taxonId.trim() === '') add('C3-TAXON', 'FAIL', 'server/seed/animal-types.json', null, `노출 타입 ${id} 의 taxonId 가 비어 있다(법 사슬 AnimalType→Taxon 필수)`);
  }
}

/**
 * @returns {'RUN'|'NOT RUN'}
 */
export function scanOutputs({ root, dist, ex, digest, bw, add, requireOutput, seed }) {
  const manPath = join(dist, 'prerender-manifest.json');
  if (!existsSync(manPath)) {
    if (requireOutput) add('C0-OUTPUT', 'FAIL', relPosix(root, manPath), null, 'NOT RUN — prerender-manifest.json 없음(--require-output)');
    return 'NOT RUN';
  }
  let m;
  try {
    m = JSON.parse(stripBom(readFileSync(manPath, 'utf8')));
  } catch (e) {
    add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, `manifest 파싱 실패: ${e.message}`);
    return 'RUN';
  }
  if (!isObj(m) || m.v !== 1) add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, 'manifest v≠1');
  if (m.seedDigest !== digest) add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, `seedDigest 불일치: manifest ${m.seedDigest} ≠ server/seed ${digest}`);
  const routes = checkRoutes(isObj(m) ? m : {}, dist, ex, add);
  const indexablePaths = new Set(routes.filter((r) => r.indexable === true && typeof r.path === 'string').map((r) => decodePath(r.path)));

  // sitemap ⊆ manifest indexable
  const smPath = join(dist, 'sitemap.xml');
  if (existsSync(smPath)) {
    const sm = readFileSync(smPath, 'utf8');
    const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
    let mm;
    while ((mm = re.exec(sm)) !== null) {
      let p;
      try {
        p = new URL(mm[1].replace(/&amp;/g, '&')).pathname;
      } catch {
        p = mm[1];
      }
      if (!indexablePaths.has(decodePath(p))) add('C3-OUT-ROUTE', 'FAIL', 'sitemap.xml', null, `manifest indexable 밖 URL: ${mm[1]}`);
    }
  }

  // robots: 사이트 비공개면 Disallow: /
  const rbPath = join(dist, 'robots.txt');
  const robots = existsSync(rbPath) ? readFileSync(rbPath, 'utf8') : null;
  if (m.indexable !== true) {
    if (robots === null || !/^\s*Disallow:\s*\/\s*$/im.test(robots)) add('C8-OUT-SAFE', 'FAIL', 'robots.txt', null, 'manifest.indexable≠true 인데 robots 에 "Disallow: /" 없음');
  }

  // credits(C6 산출물)
  const needCredits = ex.ccByPhotos.length > 0;
  if (needCredits && !routes.some((r) => decodePath(r.path) === '/credits' && existsSync(join(dist, r.file)))) {
    add('C6-IMG', 'FAIL', 'prerender-manifest.json', null, `CC BY 계열 사진(${ex.ccByPhotos.join(', ')})이 있는데 /credits 페이지 없음`);
  }

  // C6(S1 M-3): /credits 에 CC BY 사진마다 항목 + 같은 종류의 creativecommons.org 증서 링크.
  const creditsRoute = routes.find((r) => r.kind === 'CREDITS' && typeof r.file === 'string');
  const creditsAbs = creditsRoute ? join(dist, creditsRoute.file) : null;
  if (needCredits && creditsAbs && existsSync(creditsAbs)) {
    const html = readFileSync(creditsAbs, 'utf8');
    const rel = relPosix(root, creditsAbs);
    for (const id of ex.ccByPhotos) {
      const at = html.indexOf(`data-ws-id="photos#${id}"`);
      if (at < 0) {
        add('C6-IMG', 'FAIL', rel, null, `CC BY 사진 ${id} 의 저작자 표시 항목 없음`);
        continue;
      }
      const end = html.indexOf('</li>', at);
      const item = html.slice(at, end < 0 ? undefined : end);
      const url = ex.licenseUrls?.get(id);
      if (typeof url !== 'string' || !item.includes(`href="${url}"`)) add('C6-IMG', 'FAIL', rel, null, `CC BY 사진 ${id} 에 라이선스 증서 링크 없음`);
    }
  }

  // HTML — credits 링크 규칙은 manifest 라우트 파일(404 포함)에만(SPA 셸 shell.html 등 비라우트 HTML 제외)
  const routeFiles = new Set(routes.filter((r) => typeof r.file === 'string').map((r) => resolve(dist, r.file)));
  const all = walk(dist);
  for (const abs of all.filter((f) => f.endsWith('.html'))) {
    const rel = relPosix(root, abs);
    const html = readFileSync(abs, 'utf8');
    const lineOf = lineIndex(html);

    // C8 — script
    const blocks = scripts(html);
    const opens = (html.match(/<script\b/gi) ?? []).length;
    if (opens !== blocks.length) add('C8-OUT-SAFE', 'FAIL', rel, null, '닫히지 않은 <script>');
    for (const s of blocks) {
      const line = lineOf(s.index);
      const type = (s.attrs.type ?? '').trim().toLowerCase();
      if (s.attrs.src !== undefined) {
        const src = s.attrs.src.trim();
        if (!src.startsWith('/') || src.startsWith('//') || src.includes('\\')) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부·비정상 script src: ${src}`);
        if (s.body.trim() !== '') add('C8-OUT-SAFE', 'FAIL', rel, line, 'src 와 인라인 본문 동시');
        continue;
      }
      if (type !== 'application/json' && type !== 'application/ld+json') {
        add('C8-OUT-SAFE', 'FAIL', rel, line, `인라인 스크립트 금지(type=${type || '없음'})`);
        continue;
      }
      if (s.body.includes('</')) add('C8-OUT-SAFE', 'FAIL', rel, line, 'JSON 블록 원문에 "</"');
      let data;
      try {
        data = JSON.parse(s.body);
      } catch {
        add('C8-OUT-SAFE', 'FAIL', rel, line, 'JSON 블록 파싱 실패');
        continue;
      }
      jsonStrings(data, '', (t, k) => bannedIn(t, rel, line, `JSON ${k}`, add, bw));
      if (s.attrs.id === 'ws-data') checkWsData(data, rel, line, ex, add);
    }

    // C8 — 태그, C3 — data-ws-*, C4 — 속성 텍스트
    let hasCreditsLink = false;
    for (const t of tags(html)) {
      const line = lineOf(t.index);
      const a = t.attrs;
      if (['iframe', 'frame', 'frameset', 'object', 'embed'].includes(t.name)) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${t.name}> 금지`);
      // B3-4(SEC L4): 인라인 이벤트 핸들러 속성(on*=)·모든 속성의 javascript:/vbscript: 값 0 — CSP 'unsafe-inline' 없이 동작해야 한다.
      for (const [k, v] of Object.entries(a)) {
        if (/^on/i.test(k)) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${t.name} ${k}=> 인라인 핸들러`);
        else if (typeof v === 'string' && /^(?:javascript|vbscript):/i.test(v.replace(/[\u0000-\u0020]/g, ''))) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${t.name} ${k}> 위험 URL: ${v.slice(0, 40)}`);
      }
      if (t.name === 'link' && a.href !== undefined && isExternal(a.href.trim()) && (a.rel ?? '').toLowerCase().trim() !== 'canonical') {
        add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 <link href>: ${a.href}`);
      }
      if (t.name === 'a' && a.href !== undefined) {
        const href = a.href.trim();
        if (/^\s*(javascript|data|vbscript):/i.test(href)) add('C8-OUT-SAFE', 'FAIL', rel, line, `위험 href: ${href.slice(0, 40)}`);
        else if (isExternal(href) && !/^(mailto|tel):/i.test(href)) {
          const rels = (a.rel ?? '').toLowerCase().split(/\s+/);
          if (!rels.includes('noopener')) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 <a> rel noopener 없음: ${href}`);
        }
        if (href === '/credits') hasCreditsLink = true;
      }
      if (t.name !== 'script' && t.name !== 'a' && t.name !== 'link') {
        for (const k of ['src', 'srcset', 'poster', 'data']) {
          if (a[k] !== undefined && a[k].split(',').some((u) => isExternal(u.trim().split(/\s+/)[0] ?? ''))) {
            add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 리소스 ${t.name}[${k}]: ${a[k]}`);
          }
        }
      }
      if (t.name === 'form' && a.action !== undefined && isExternal(a.action.trim())) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 form action: ${a.action}`);
      if (a['data-ws-id'] !== undefined) {
        const [key, id, extra] = a['data-ws-id'].split('#');
        if (extra !== undefined || !SEED_KEYS.includes(key) || !ex.ids[key].has(id)) add('C3-OUT-ID', 'FAIL', rel, line, `비노출 data-ws-id: ${a['data-ws-id']}`);
      }
      if (a['data-ws-type'] !== undefined && !ex.ids.animalTypes.has(a['data-ws-type'])) add('C3-OUT-ROUTE', 'FAIL', rel, line, `비노출 타입 페이지: ${a['data-ws-type']}`);
      for (const k of TEXT_ATTRS) if (a[k] !== undefined) bannedIn(a[k], rel, line, `@${k}`, add, bw);
      if (t.name === 'meta' && a.content !== undefined) bannedIn(a.content, rel, line, '@meta content', add, bw);
    }
    if (needCredits && routeFiles.has(resolve(abs)) && !hasCreditsLink) add('C6-IMG', 'FAIL', rel, null, 'CC BY 계열 사진이 있는데 href="/credits" 링크 없음');

    // C4 — 가시 텍스트 + 태그 경계 걸침
    const nodes = textNodes(html);
    const nodeTerms = new Set();
    for (const n of nodes) {
      bannedIn(n.text, rel, lineOf(n.index), 'text', add, bw);
      for (const h of lintText(n.text, bw)) nodeTerms.add(h.term);
    }
    for (const h of lintText(nodes.map((n) => n.text).join(''), bw)) {
      if (h.rule === 'L01' && !nodeTerms.has(h.term)) add('C4-BANNED', 'FAIL', rel, null, `태그 경계에 걸친 금지어 "${h.term}"`);
    }
  }

  // 공개 카탈로그·기타 JSON(dist/data)
  for (const abs of all.filter((f) => f.endsWith('.json') && relPosix(dist, f).startsWith('data/'))) {
    const rel = relPosix(root, abs);
    let c;
    try {
      c = JSON.parse(stripBom(readFileSync(abs, 'utf8')));
    } catch {
      add('C3-OUT-ID', 'FAIL', rel, null, 'JSON 파싱 실패');
      continue;
    }
    checkCatalog(c, rel, ex, digest, add);
    jsonStrings(c, '', (t, k) => bannedIn(t, rel, null, `JSON ${k}`, add, bw));
  }

  // C3-OUT-TAXON(L-2) — 비노출 Taxon id·legal.note 텍스트 0.
  const needles = hiddenTaxonNeedles(seed, ex);
  if (needles.length > 0) {
    for (const abs of all.filter((f) => OUT_TEXT_EXT.test(f))) {
      const text = readFileSync(abs, 'utf8');
      const seen = new Set();
      for (const n of needles) {
        const key = `${n.taxonId}|${n.what}`;
        if (seen.has(key) || !text.includes(n.v)) continue;
        seen.add(key);
        add('C3-OUT-TAXON', 'FAIL', relPosix(root, abs), lineIndex(text)(text.indexOf(n.v)), `비노출 Taxon ${n.taxonId} 의 ${n.what} 문자열이 산출물에`);
      }
    }
  }

  // C3-OUT-DRAFTSRC(L-7) — 비노출 행 전용 출처 url·title 0.
  const srcNeedles = hiddenSourceNeedles(seed, ex);
  if (srcNeedles.length > 0) {
    for (const abs of all.filter((f) => OUT_TEXT_EXT.test(f))) {
      const text = readFileSync(abs, 'utf8');
      const seen = new Set();
      for (const n of srcNeedles) {
        if (seen.has(n.raw) || !text.includes(n.v)) continue;
        seen.add(n.raw);
        add('C3-OUT-DRAFTSRC', 'FAIL', relPosix(root, abs), lineIndex(text)(text.indexOf(n.v)), `비노출 행 전용 출처 ${n.what}(${n.key}#${n.id}) 가 산출물에: ${n.raw.slice(0, 60)}`);
      }
    }
  }

  // C3-OUT-REVIEWMETA(보안 79 H-1, Kenny 2026-10-25) — 검수 방식(reviewBasis)·서명 매니페스트 메타는 시드 전용, 산출물 0(불변식 7).
  for (const abs of all.filter((f) => OUT_TEXT_EXT.test(f))) {
    const text = readFileSync(abs, 'utf8');
    for (const n of REVIEW_META_NEEDLES) {
      if (!text.includes(n)) continue;
      add('C3-OUT-REVIEWMETA', 'FAIL', relPosix(root, abs), lineIndex(text)(text.indexOf(n)), `검수 방식·서명 메타 "${n}" 가 산출물에(시드 전용)`);
    }
  }

  // R6 F2a: 사전 압축본(.br/.gz)은 위 텍스트 스캔 대상이 아니다(확장자 필터) — 대신 같은 이름 원본의 무손실 사본인지만 본다
  //   (해제 = 원본 바이트). 서빙되는 바이트가 스캔한 원본과 다를 수 없게.
  for (const abs of all.filter((f) => f.endsWith('.br') || f.endsWith('.gz'))) {
    const rel = relPosix(root, abs);
    const orig = abs.slice(0, -3);
    if (!existsSync(orig)) {
      add('C8-OUT-SAFE', 'FAIL', rel, null, '원본 없는 압축 사본');
      continue;
    }
    let same = false;
    try {
      const buf = readFileSync(abs);
      same = (abs.endsWith('.br') ? brotliDecompressSync(buf) : gunzipSync(buf)).equals(readFileSync(orig));
    } catch {
      same = false;
    }
    if (!same) add('C8-OUT-SAFE', 'FAIL', rel, null, '압축 사본 ≠ 원본 — node scripts/precompress.mjs 재실행');
  }
  return 'RUN';
}
