// 산출물 규칙(client/dist) — C3-OUT-ID, C3-OUT-ROUTE, C3-OUT-SRC, C3-OUT-TAXON, C3-OUT-DRAFTSRC, C3-OUT-REVIEWMETA, C4-BANNED(산출물), C6-IMG(산출물), C8-OUT-SAFE, C9-PRIVACY, C9-TIPS, C9-GENERAL, C6-IMG-SPECIES.
//   + 시드 노출 규칙 C3-TAXON(scanSeedExposure, 산출물 유무와 무관).
//   노출 판단은 seed-exposure.mjs(원시 시드 독립 재구현, D9)만 쓴다.
//   C9-GENERAL: 고정 6종 중 시드+asOf 로 노출된 타입의 타입·프로필·노출 요구사항·용품에 GENERAL_INFO 가 있으면 고지 1회, 없으면 0회.
//   고정 6종의 노출 판정 불가는 FAIL, 그 밖 타입은 고지 0회. 산출물 표지는 기대값 근거로 쓰지 않는다.
//
// prerender-manifest.json 계약(F3 가 쓴다):
//   { v: 1, seedDigest: "<sha256 hex — seed-exposure.mjs seedDigest()>", indexable: boolean(사이트 수준, WS_INDEXABLE),
//     mode: "production"|"development"(NODE_ENV=production 프리렌더만 production — C9-PRIVACY 자리표시 경고 문구, 누락은 production 취급),
//     privacyPage?: false(294 — 운영 빌드 ∧ 처리방침 자리표시 남음으로 /privacy 를 뺀 빌드만, C9-PRIVACY 비노출 규칙),
//     routes: [{ path: "/hamster/golden", file: "hamster/golden/index.html", kind: RouteKind, indexable: boolean,
//                typeId?, family?, itemId?, productId?, region?, layer?: { kind, typeId, itemId?|productId? } }] }
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { lineIndex, relPosix, stripBom, walk } from './files.mjs';
import { maskNonMarkup, scripts, tags, textNodes } from './html.mjs';
import { lintText } from './normalize.mjs';
import { jsonErrorWhere, safeLabel } from './rules-source.mjs';
import {
  GENERAL_INFO_TYPE_IDS,
  HOME_A_SCENE_PHOTOS,
  ITEM_SCENE_PHOTOS,
  PHOTO_WS_TYPE_KEYS,
  SEED_KEYS,
  TYPE_SCENE_PHOTOS,
  sceneAllowedForType,
  tipReferenceUrlAllowed,
} from './seed-exposure.mjs';

const ROUTE_KINDS = new Set(['HOME', 'FAMILY', 'TYPE', 'SETUP', 'TIPS', 'SUPPLIES', 'SUPPLY_ITEM', 'SUPPLY_ITEM_TYPE', 'VET', 'VET_REGION', 'CREDITS', 'PRIVACY', 'SAVE', 'PICK', 'NOT_FOUND']);
const TYPE_KINDS = new Set(['TYPE', 'SETUP', 'TIPS']);
const WS_DATA_KEYS = { types: 'animalTypes', products: 'curatedProducts', bundles: 'setupBundles', vets: 'vetClinics', testimonials: 'testimonials' };
const JSON_TEXT_SKIP = /^(id|slug|href|url|sourceUrl|path|catalogUrl|imageAsset|reviewerImage|seedDigest|file|item|@context|@type|@id|kind|provider|reviewerType|priority|orderHint|category|tier|verdict|reasonCodes|situation|linkedAction|group|imageLicense)$|Id$|Ids$|At$/;
const TEXT_ATTRS = ['title', 'alt', 'aria-label', 'aria-description', 'placeholder'];
const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('\\');
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
// 233(QA231): 진단 메시지에 넣는 산출물·manifest 값은 모두 safeLabel(비밀 형태면 ‹가림 N자›, 120자 초과면 ‹생략 N자›) — 파일·줄·규칙 id 는 그대로.
const L = safeLabel;
/** 잘라 보여 주는 값 — 판정은 자르기 전 전체 값으로(잘린 조각이 판정을 비켜 가지 않게), 통과한 값만 n 자로 자른다. */
function clip(v, n) {
  const s = String(v);
  const lab = safeLabel(s);
  return lab === s && s.length > n ? `${s.slice(0, n)}…` : lab;
}

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
    if (h.rule === 'L01') add('C4-BANNED', 'FAIL', rel, line, `${where}: 금지어 "${L(h.term)}"`);
    else if (h.rule === 'L06') add('C4-BANNED', 'WARN', rel, line, `${where}: 공백 제거 후 2자 금지어 "${L(h.term)}"`);
    // R6 B1(SEC-4 L-4): 산출물은 사용자에게 보이는 결과물 — 어간도 FAIL.
    else add('C4-STEM', 'FAIL', rel, line, `${where}: 금지어 어간 "${L(h.term)}"`);
  }
}

/** JSON 값 트리의 문자열(가장 가까운 키와 함께) — 239(Codex night-qa4 #7): 재귀 없는 명시적 스택(깊은 중첩에서 스택 넘침 없음), 방문 순서는 재귀판과 같다. */
function jsonStrings(root, key0, visit) {
  const stack = [[root, key0]];
  while (stack.length > 0) {
    const [v, key] = stack.pop();
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], key]);
    } else if (isObj(v)) {
      const es = Object.entries(v);
      for (let i = es.length - 1; i >= 0; i--) stack.push([es[i][1], es[i][0]]);
    } else if (typeof v === 'string') {
      if (JSON_TEXT_SKIP.test(key) || /^(https?:\/\/|\/)/i.test(v)) continue;
      visit(v, key);
    }
  }
}
/** requirement 쌍 표시 — 각 값을 safeLabel(객체 값도 예외 없이 타입 이름). */
const pairLabel = (a, b) => `${L(a)}|${L(b)}`;

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
  if (fk !== null) bad(`금지 키 ${L(fk)}(프로토타입 오염 경로, L-3)`);
  const reqs = isObj(d.data) && Array.isArray(d.data.requirements) ? d.data.requirements.filter(isObj) : [];
  if (d.v === 1) {
    if (d.sources !== undefined) bad('v1 인데 최상위 sources 있음(형식 혼합)');
    for (const q of reqs) if (q.sourceRefs !== undefined) bad(`v1 인데 requirement ${pairLabel(q.animalTypeId, q.supplyItemId)} 에 sourceRefs`);
    return;
  }
  // 260(258 단계 4): v3 = v2 와 같은 최상위·표 형식 + requirement 선택 aff(검사는 rules-affiliate.mjs C10-AFF-OUT — aff 0 인 v3·v2 의 aff 는 거기서 FAIL).
  if (d.v !== 2 && d.v !== 3) return bad(`알 수 없는 v=${L(JSON.stringify(d.v))}`);
  const own = Object.keys(d);
  if (own.length !== WS_V2_KEYS.length || !WS_V2_KEYS.every((k) => Object.hasOwn(d, k))) bad(`v${d.v} 최상위 키 집합 불일치(${L(own.join(','))})`);
  if (!Array.isArray(d.sources)) return bad('v2 sources 형식(최상위 sources 없음 또는 배열 아님)');
  const table = d.sources;
  const seen = new Set();
  table.forEach((e, i) => {
    if (!isObj(e)) return bad(`v2 sources[${i}] 형식`);
    for (const k of Object.keys(e)) if (!WS_SOURCE_KEYS.has(k)) bad(`v2 sources[${i}] 허용 밖 키 ${L(k)}`);
    if (typeof e.url !== 'string' || typeof e.title !== 'string') return bad(`v2 sources[${i}] url·title 문자열 아님`);
    if (!WS_SOURCE_URL_RE.test(e.url)) bad(`v2 sources[${i}] url 이 https:// 아님(L-2): ${clip(e.url, 40)}`);
    const key = JSON.stringify([e.url, e.title]);
    if (seen.has(key)) bad(`v2 sources[${i}] 중복 표 항목`);
    seen.add(key);
  });
  if (!isObj(d.data) || !Array.isArray(d.data.requirements)) bad('v2 data.requirements 배열 없음');
  else if (d.data.requirements.some((q) => !isObj(q))) bad('v2 requirement 형식(객체 아님)');
  const used = new Set();
  for (const q of reqs) {
    const at = `requirement ${pairLabel(q.animalTypeId, q.supplyItemId)}`;
    if (q.source !== undefined) bad(`v2 ${at} 에 source 잔존`);
    if (q.searchLinks !== undefined) bad(`v2 ${at} 에 searchLinks 잔존`);
    if (typeof q.searchKeyword !== 'string') bad(`v2 ${at} searchKeyword 문자열 아님·누락`);
    if (!Array.isArray(q.sourceRefs)) {
      bad(`v2 ${at} sourceRefs 형식(없음 또는 배열 아님)`);
      continue;
    }
    for (const r of q.sourceRefs) {
      if (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r >= table.length) bad(`v2 ${at} sourceRefs 범위 밖 인덱스 ${L(JSON.stringify(r))} (표 ${table.length}개)`);
      else used.add(r);
    }
  }
  for (let i = 0; i < table.length; i++) if (!used.has(i)) bad(`v2 sources[${i}] 미참조 표 항목`);
}

/** 362 N12 C2-PRICE: 가격류 키(price·amount·currency) 경로 — data.feed 하위는 제외. 반복 탐색. */
const PRICE_KEY_SET = new Set(['price', 'amount', 'currency']);
function priceKeysOutsideFeed(root, hit) {
  const stack = [[root, '']];
  while (stack.length > 0) {
    const [v, p] = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    if (p === 'data.feed') continue;
    if (Array.isArray(v)) {
      v.forEach((x, i) => stack.push([x, `${p}[${i}]`]));
      continue;
    }
    for (const k of Object.keys(v)) {
      const q = p ? `${p}.${k}` : k;
      if (PRICE_KEY_SET.has(k)) hit(q.slice(0, 60));
      stack.push([v[k], q]);
    }
  }
}

/** ws-data (§6-3 WsPageData) id 검사. */
function checkWsData(d, rel, line, ex, add) {
  const bad = (what) => add('C3-OUT-ID', 'FAIL', rel, line, `ws-data 비노출 ${what}`);
  // 239(Codex night-qa4 #6): 최상위가 객체가 아니면(배열·null·원시값) 디코더(ws-wire decodeWsPage)처럼 거부 — 형식 FAIL(+ 금지 키도 본다).
  if (!isObj(d)) {
    add('C3-OUT-SRC', 'FAIL', rel, line, `ws-data 최상위 형식(객체 아님: ${Array.isArray(d) ? 'array' : d === null ? 'null' : typeof d})`);
    const fk = forbiddenKeyIn(d);
    if (fk !== null) add('C3-OUT-SRC', 'FAIL', rel, line, `ws-data 금지 키 ${L(fk)}(프로토타입 오염 경로, L-3)`);
    return;
  }
  checkWsWire(d, rel, line, add);
  priceKeysOutsideFeed(d, (p) => add('C2-PRICE', 'FAIL', rel, line, `ws-data 가격류 키 ${L(p)} — 가격은 data.feed 에만(353 §4)`));
  const r = d.route;
  if (isObj(r) && r.typeId !== undefined && !ex.ids.animalTypes.has(r.typeId)) bad(`route.typeId ${L(r.typeId)}`);
  checkLayer(d.layer, ex, (w) => bad(`layer ${w}`));
  const data = d.data;
  if (data === undefined) return;
  if (!isObj(data)) return bad('data 형식');
  for (const [k, arr] of Object.entries(data)) {
    // 362 N12: data.feed(객체) — 품목 id·레일 카드 짝이 노출 집합 안인지만(형식·링크·가격은 서버 isWsFeedData + C11-FEED-OUT).
    if (k === 'feed') {
      if (!isObj(arr) || arr.v !== 1 || !Array.isArray(arr.items) || !Array.isArray(arr.rail)) {
        bad('data.feed 형식');
        continue;
      }
      // 362 N16: FOOD/HEALTH 품목 피드 0(불변식 ⑤ — 엔진 FEED_EXCLUDED_CATEGORIES). ex 에 집합이 없으면 fail-closed.
      const feedBad = (it) => !(ex.feedExcludedItems instanceof Set) || ex.feedExcludedItems.has(it);
      const foodHealth = (w) => add('C11-FEED-OUT', 'FAIL', rel, line, `ws-data ${w} — FOOD/HEALTH 품목 피드 0`);
      for (const it of arr.items) {
        if (!ex.ids.supplyItems.has(it)) bad(`data.feed.items ${L(it)}`);
        if (feedBad(it)) foodHealth(`data.feed.items ${L(it)}`);
      }
      for (const c of arr.rail) if (isObj(c) && feedBad(c.supplyItemId)) foodHealth(`data.feed.rail ${L(c.supplyItemId)}`);
      // 398 GI: 라우트 타입 문맥(route.typeId ∪ layer.typeId)의 품목·레일 쌍은 체인 전 행 VERIFIED ∧ 유효(ex.feedStrictPairs)만 — GENERAL_INFO 체인 피드 0.
      {
        const tids = [...new Set([isObj(r) ? r.typeId : undefined, isObj(d.layer) ? d.layer.typeId : undefined].filter((x) => typeof x === 'string'))];
        const strict = ex.feedStrictPairs instanceof Set ? ex.feedStrictPairs : new Set();
        const giBad = (it, w) => {
          if (tids.length === 0) add('C11-FEED-OUT', 'FAIL', rel, line, `ws-data ${w} ${L(it)} — 라우트 타입 문맥 없음(GENERAL_INFO 체인 판정 불가)`);
          else for (const tid of tids) if (!strict.has(`${tid}|${it}`)) add('C11-FEED-OUT', 'FAIL', rel, line, `ws-data ${w} ${pairLabel(tid, it)} — 체인이 전부 VERIFIED 가 아님(GENERAL_INFO 체인 피드 0)`);
        };
        for (const it of arr.items) giBad(it, 'data.feed.items');
        for (const c of arr.rail) giBad(isObj(c) ? c.supplyItemId : undefined, 'data.feed.rail');
      }
      for (const c of arr.rail) {
        const tid = isObj(r) ? r.typeId : undefined; // 레일 카드는 라우트 타입 문맥(카드에 타입 id 없음)
        if (!isObj(c) || !ex.pairs.has(`${tid}|${c.supplyItemId}`)) bad(`data.feed.rail ${pairLabel(tid, c?.supplyItemId)}`);
      }
      continue;
    }
    if (!Array.isArray(arr)) {
      bad(`data.${L(k)} 형식`);
      continue;
    }
    if (k === 'requirements') {
      for (const q of arr) {
        if (!isObj(q) || !ex.pairs.has(`${q.animalTypeId}|${q.supplyItemId}`)) bad(`requirement ${pairLabel(q?.animalTypeId, q?.supplyItemId)}`);
        const item = isObj(q) ? q.item : undefined;
        if (item !== undefined) {
          if (!isObj(item) || !ex.ids.supplyItems.has(item.id)) bad(`requirement.item ${L(item?.id)}`);
          for (const a of Array.isArray(item?.alternativeIds) ? item.alternativeIds : []) if (!ex.ids.supplyItems.has(a)) bad(`alternativeId ${L(a)}`);
        }
      }
      continue;
    }
    const key = Object.hasOwn(WS_DATA_KEYS, k) ? WS_DATA_KEYS[k] : undefined; // 프로토타입 이름(constructor 등) 키는 알 수 없는 컬렉션
    if (!key) {
      bad(`알 수 없는 컬렉션 data.${L(k)}`);
      continue;
    }
    for (const x of arr) if (!isObj(x) || !ex.ids[key].has(x.id)) bad(`${k} ${L(x?.id)}`);
  }
}

function checkLayer(layer, ex, bad) {
  if (layer === null || layer === undefined) return;
  if (!isObj(layer)) return bad('형식');
  if (!ex.ids.animalTypes.has(layer.typeId)) bad(`typeId ${L(layer.typeId)}`);
  if (layer.itemId !== undefined && !ex.pairs.has(`${layer.typeId}|${layer.itemId}`)) bad(`itemId ${L(layer.itemId)}`);
  if (layer.productId !== undefined && !ex.productTypes.has(`${layer.typeId}|${layer.productId}`)) bad(`productId ${L(layer.productId)}`);
}

/** 공개 카탈로그(dist/data/*.json) id 검사. */
/**
 * C3-OUT-REVIEWMETA(356 단계 10, 총괄 결정) — 공개 카탈로그 행 메타 형태(server/src/engine/public.ts PublicCatalogMeta):
 *   ① 어떤 행도 reviewerType "AI_DRAFT" 를 싣지 않는다(VERIFIED 는 AI_DRAFT 불가 — 불변식 7, GENERAL_INFO 는 키 자체 없음)
 *   ② reviewStatus GENERAL_INFO 행 = reviewerType 키 없음 ∧ generalInfo === true
 *   ③ generalInfo 키는 GENERAL_INFO 행에만.
 */
function checkCatalogMeta(x, at, rel, add) {
  if (x.reviewerType === 'AI_DRAFT') add('C3-OUT-REVIEWMETA', 'FAIL', rel, null, `카탈로그 ${at}: reviewerType AI_DRAFT 가 산출물에`);
  if (x.reviewStatus === 'GENERAL_INFO') {
    if ('reviewerType' in x) add('C3-OUT-REVIEWMETA', 'FAIL', rel, null, `카탈로그 ${at}: GENERAL_INFO 행에 reviewerType 키(generalInfo:true 표기만)`);
    if (x.generalInfo !== true) add('C3-OUT-REVIEWMETA', 'FAIL', rel, null, `카탈로그 ${at}: GENERAL_INFO 행에 generalInfo:true 없음`);
  } else if ('generalInfo' in x) {
    add('C3-OUT-REVIEWMETA', 'FAIL', rel, null, `카탈로그 ${at}: GENERAL_INFO 가 아닌 행(${L(x.reviewStatus)})에 generalInfo 키`);
  }
}

function checkCatalog(c, rel, ex, digest, add) {
  if (!isObj(c)) return add('C3-OUT-ID', 'FAIL', rel, null, '카탈로그 형식');
  if (c.seedDigest !== undefined && c.seedDigest !== digest) add('C3-OUT-ROUTE', 'FAIL', rel, null, `카탈로그 seedDigest 불일치 (${L(c.seedDigest)})`);
  for (const [k, arr] of Object.entries(c)) {
    if (!Array.isArray(arr)) continue;
    if (!SEED_KEYS.includes(k)) {
      if (arr.some((x) => isObj(x) && 'id' in x)) add('C3-OUT-ID', 'FAIL', rel, null, `알 수 없는 컬렉션 ${L(k)}`);
      continue;
    }
    for (const x of arr) if (!isObj(x) || !ex.ids[k].has(x.id)) add('C3-OUT-ID', 'FAIL', rel, null, `카탈로그 비노출 ${k}#${L(x?.id)}`);
    for (const x of arr) if (isObj(x)) checkCatalogMeta(x, `${k}#${L(x.id)}`, rel, add);
    // Taxon 참조는 검수 완료 Taxon 만(불변식 7) — 타입은 Taxon 미검수여도 노출(Kenny 2026-10-24 K-4 되돌림).
    const taxonRefs = (x) => (k === 'animalTypes' ? [x.taxonId] : k === 'careProfiles' && Array.isArray(x.taxonIds) ? x.taxonIds : []);
    for (const x of arr) {
      if (!isObj(x)) continue;
      for (const t of taxonRefs(x)) if (t !== null && t !== undefined && !ex.ids.taxa.has(t)) add('C3-OUT-ID', 'FAIL', rel, null, `카탈로그 비노출 Taxon 참조 ${k}#${L(x.id)} → ${L(t)}`);
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
      add('C3-OUT-ROUTE', 'FAIL', R, null, `route 형식 오류: ${L(JSON.stringify(r))}`);
      continue;
    }
    const at = `route ${L(r.path)}`;
    if (!ROUTE_KINDS.has(r.kind)) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 알 수 없는 kind ${L(r.kind)}`);
    if (r.file.split(/[\\/]/).includes('..') || /^([a-z]:|\/)/i.test(r.file) || !existsSync(join(dist, r.file))) {
      add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 파일 없음·경로 이탈 ${L(r.file)}`);
    }
    if (TYPE_KINDS.has(r.kind) && r.typeId === undefined) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: ${r.kind} 에 typeId 없음`);
    if (r.typeId !== undefined) {
      const t = ex.types.get(r.typeId);
      if (!t) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 타입 ${L(r.typeId)}`);
      else if (TYPE_KINDS.has(r.kind) || r.kind === 'SUPPLY_ITEM') {
        const p = decodePath(r.path);
        const base = `/${t.slug}`;
        if (typeof t.slug !== 'string' || (p !== base && !p.startsWith(`${base}/`))) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 타입 slug(${L(t.slug)}) 불일치`);
      }
    }
    if (r.kind === 'FAMILY') {
      const fam = r.family;
      if (typeof fam !== 'string' || ![...ex.types.values()].some((t) => typeof t.slug === 'string' && t.slug.startsWith(`${fam}/`))) {
        add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 노출 타입 없는 family ${L(fam)}`);
      }
    }
    if (r.itemId !== undefined) {
      const ok = r.typeId !== undefined ? ex.pairs.has(`${r.typeId}|${r.itemId}`) : ex.ids.supplyItems.has(r.itemId);
      if (!ok) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 item ${L(r.itemId)}`);
    }
    if (r.productId !== undefined) {
      const ok = r.typeId !== undefined ? ex.productTypes.has(`${r.typeId}|${r.productId}`) : ex.ids.curatedProducts.has(r.productId);
      if (!ok) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 비노출 product ${L(r.productId)}`);
    }
    if (r.region !== undefined && !ex.vetRegions.has(r.region)) add('C3-OUT-ROUTE', 'FAIL', R, null, `${at}: 노출 병원 없는 지역 ${L(r.region)}`);
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
/** C3-OUT-REVIEWMETA 데이터 산출물 바늘(356 단계 10) — 검수자 유형 AI_DRAFT(카탈로그 GENERAL_INFO 행 누출 점검). 코드 번들 제외. */
export const AI_DRAFT_NEEDLES = Object.freeze(['AI_DRAFT']);
const AI_DRAFT_DATA_EXT = /\.(?:html?|json|xml|txt|webmanifest)$/i;
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
    if (typeof t.taxonId !== 'string' || t.taxonId.trim() === '') add('C3-TAXON', 'FAIL', 'server/seed/animal-types.json', null, `노출 타입 ${L(id)} 의 taxonId 가 비어 있다(법 사슬 AnimalType→Taxon 필수)`);
  }
}

/**
 * C9-PRIVACY(계획 86 P11, Kenny K-1·K-2 2026-10-25) — 개인정보 처리방침 산출물.
 *   ① manifest 에 path /privacy · kind PRIVACY 라우트 + 파일 존재(누락 FAIL)
 *   ② manifest 라우트 HTML(404 포함, 비라우트 셸 제외)마다 <a href="/privacy">(없으면 FAIL)
 *   ③ 산출물 텍스트 어디든 "{{KENNY:" 자리표시 — 항상 WARN. 운영 빌드(mode ≠ development)면 메시지에 "운영 기동 차단됨"
 *      (차단 자체는 server/src/config/env.ts 운영 기동 검사 — /privacy/index.html 에 자리표시면 exit 1)
 *   ④ /privacy 의 span[data-ws-policy=NAME] 값 = server/src/privacy/policy.ts 의 `export const NAME = <정수식>` 값.
 *      이름 미존재·불일치 FAIL, span 0 FAIL, policy.ts 의 *_RETENTION_DAYS export 가 페이지에 하나도 없으면 FAIL, policy.ts 없음·해석 불가 FAIL.
 *   한계: span 밖에 직접 쓴 숫자는 대조하지 못한다(본문은 privacy-content.ts {policy:NAME} 토큰으로만 기간을 싣는다).
 *   294(Kenny 2026-11-16) 비노출 빌드 — manifest.privacyPage === false(운영 빌드 ∧ 자리표시 남음 → 빌드가 /privacy 를 일부러 뺌)면 ①~④ 대신:
 *   ⑤ manifest 에 /privacy·PRIVACY 라우트 0 · dist/privacy/ 0(옛 사본·압축본 포함) — 있으면 FAIL
 *   ⑥ manifest 라우트 HTML 에 <a href="/privacy"> 0(죽은 링크 — 있으면 FAIL), sitemap 은 기존 ⊆ indexable 규칙
 *   ⑦ 산출물 텍스트 어디든 "{{KENNY:" — FAIL(비노출인데 자리표시가 샜다)
 *   ⑧ manifest.indexable === true(공개 빌드)면 FAIL — 처리방침 없이 공개 금지(기동 검사 139 MED-2 와 같은 선)
 */
export const PRIVACY_POLICY_FILE = 'server/src/privacy/policy.ts';
export const KENNY_NEEDLE = '{{KENNY:';
const POLICY_CONST_RE = /^export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*([^;\n]+);/gm;

/** policy.ts 원문 → 정수 상수 표(정수 리터럴·`_` 구분·`*` 곱만 해석, 그 밖의 식·문자열은 건너뛴다). */
export function parsePolicyConstants(src) {
  const out = new Map();
  for (const m of src.matchAll(POLICY_CONST_RE)) {
    const expr = m[2].trim();
    if (!/^\d[\d_]*(?:\s*\*\s*\d[\d_]*)*$/.test(expr)) continue;
    const v = expr.split('*').reduce((acc, f) => acc * Number(f.trim().replace(/_/g, '')), 1);
    if (Number.isSafeInteger(v)) out.set(m[1], v);
  }
  return out;
}

function checkPrivacyOff({ root, dist, m, routes, routeFiles, all, add }) {
  const R = 'prerender-manifest.json';
  // ⑤
  if (routes.some((r) => r.kind === 'PRIVACY' || (typeof r.path === 'string' && decodePath(r.path) === '/privacy'))) {
    add('C9-PRIVACY', 'FAIL', R, null, 'privacyPage:false 인데 manifest 에 /privacy 라우트가 있다');
  }
  const privacyDir = resolve(dist, 'privacy') + sep;
  for (const f of all.filter((x) => resolve(x).startsWith(privacyDir))) {
    add('C9-PRIVACY', 'FAIL', relPosix(root, f), null, 'privacyPage:false 인데 privacy/ 산출물이 남아 있다(옛 페이지·압축본 포함)');
  }
  // ⑥
  for (const f of all.filter((x) => x.endsWith('.html') && routeFiles.has(resolve(x)))) {
    const html = readFileSync(f, 'utf8');
    if (tags(html).some((t) => t.name === 'a' && typeof t.attrs.href === 'string' && t.attrs.href.trim() === '/privacy')) {
      add('C9-PRIVACY', 'FAIL', relPosix(root, f), null, 'privacyPage:false 인데 처리방침 링크(href="/privacy")가 있다(없는 페이지로 가는 링크)');
    }
  }
  // ⑦
  for (const f of all.filter((x) => OUT_TEXT_EXT.test(x))) {
    const text = readFileSync(f, 'utf8');
    const at = text.indexOf(KENNY_NEEDLE);
    if (at >= 0) add('C9-PRIVACY', 'FAIL', relPosix(root, f), lineIndex(text)(at), `privacyPage:false 인데 Kenny 미정 자리표시 ${KENNY_NEEDLE}…}} 가 산출물에 있다`);
  }
  // ⑧
  if (m.indexable === true) add('C9-PRIVACY', 'FAIL', R, null, 'privacyPage:false(처리방침 비노출) 빌드는 공개(indexable:true)할 수 없다 — 6값을 채워 다시 빌드');
}

function checkPrivacy({ root, dist, m, routes, routeFiles, all, add }) {
  const R = 'prerender-manifest.json';
  if (isObj(m) && m.privacyPage === false) {
    checkPrivacyOff({ root, dist, m, routes, routeFiles, all, add });
    return;
  }
  if (isObj(m) && 'privacyPage' in m) add('C9-PRIVACY', 'FAIL', R, null, `manifest.privacyPage 는 false 만 허용(없으면 노출) — 실제 ${L(JSON.stringify(m.privacyPage))}`);
  const route = routes.find((r) => r.kind === 'PRIVACY' && typeof r.file === 'string' && decodePath(r.path) === '/privacy');
  const abs = route ? join(dist, route.file) : null;
  if (!abs || !existsSync(abs)) {
    add('C9-PRIVACY', 'FAIL', R, null, '개인정보 처리방침 페이지 없음(/privacy · kind PRIVACY 라우트와 파일 필요)');
  }

  // ② 모든 라우트 페이지에 /privacy 링크
  for (const f of all.filter((x) => x.endsWith('.html') && routeFiles.has(resolve(x)))) {
    const html = readFileSync(f, 'utf8');
    const ok = tags(html).some((t) => t.name === 'a' && typeof t.attrs.href === 'string' && t.attrs.href.trim() === '/privacy');
    if (!ok) add('C9-PRIVACY', 'FAIL', relPosix(root, f), null, '처리방침 링크(href="/privacy") 없음');
  }

  // ③ 자리표시 — 빌드에서는 항상 WARN(CI 도커 빌드가 NODE_ENV=production 이라 FAIL 이면 모든 PR 이 빨강, 오케스트레이터 2026-10-25).
  //   공개 차단은 운영 기동 검사(server/src/config/env.ts privacyPlaceholderProblem — docker-entrypoint 의 env 검사 단계)가 맡는다.
  const dev = isObj(m) && m.mode === 'development';
  for (const f of all.filter((x) => OUT_TEXT_EXT.test(x))) {
    const text = readFileSync(f, 'utf8');
    const at = text.indexOf(KENNY_NEEDLE);
    if (at < 0) continue;
    const keys = [...new Set([...text.matchAll(/\{\{KENNY:([A-Za-z0-9]*)\}\}/g)].map((x) => x[1]))].join(', ');
    add('C9-PRIVACY', 'WARN', relPosix(root, f), lineIndex(text)(at), `Kenny 미정 자리표시 ${KENNY_NEEDLE}…}}(${keys ? L(keys) : '?'}) — ${dev ? '개발 빌드' : `운영 빌드(manifest.mode=${L(JSON.stringify(isObj(m) ? m.mode : undefined))}): 운영 기동 차단됨(WS_ALLOW_PRIVACY_PLACEHOLDER=1 일 때만 기동)`}`);
  }

  // ④ 기간 숫자 = policy.ts
  if (!abs || !existsSync(abs)) return;
  const rel = relPosix(root, abs);
  const policyAbs = join(root, ...PRIVACY_POLICY_FILE.split('/'));
  if (!existsSync(policyAbs)) {
    add('C9-PRIVACY', 'FAIL', PRIVACY_POLICY_FILE, null, '보존 기간 단일 출처(policy.ts) 없음 — /privacy 기간 숫자를 대조할 수 없다');
    return;
  }
  const consts = parsePolicyConstants(stripBom(readFileSync(policyAbs, 'utf8')));
  const html = readFileSync(abs, 'utf8');
  const lineOf = lineIndex(html);
  const re = /<span\b[^>]*\bdata-ws-policy="([^"]*)"[^>]*>([^<]*)<\/span>/g;
  const seen = new Set();
  let n = 0;
  for (const mm of html.matchAll(re)) {
    n++;
    const [, name, value] = mm;
    seen.add(name);
    if (!consts.has(name)) add('C9-PRIVACY', 'FAIL', rel, lineOf(mm.index), `기간 ${L(name)} 이 policy.ts 에 없음`);
    else if (value.trim() !== String(consts.get(name))) add('C9-PRIVACY', 'FAIL', rel, lineOf(mm.index), `기간 ${L(name)}: 페이지 ${JSON.stringify(L(value))} ≠ policy.ts ${consts.get(name)}`);
  }
  const attrCount = (html.match(/\bdata-ws-policy=/g) ?? []).length;
  if (attrCount !== n) add('C9-PRIVACY', 'FAIL', rel, null, `data-ws-policy 표기 ${attrCount}개 중 ${attrCount - n}개가 span 숫자 형식이 아님`);
  if (n === 0) add('C9-PRIVACY', 'FAIL', rel, null, '보존 기간 표기(span[data-ws-policy]) 0개');
  for (const name of consts.keys()) {
    if (name.endsWith('_RETENTION_DAYS') && !seen.has(name)) add('C9-PRIVACY', 'FAIL', rel, null, `policy.ts ${L(name)} 기간이 처리방침에 없음`);
  }
}

/**
 * @returns {'RUN'|'NOT RUN'}
 */
/** 301 /tips 상단 고정 고지(Kenny 2026-11-22 원문 — server/src/prerender/copy.ts COPY.tips.disclaimer 와 같아야 한다). */
export const TIPS_DISCLAIMER = '외부 글을 모아 안내해요. 내용은 글쓴이 책임이며, 우리 사육 기준(규격 판정)과 다를 수 있어요';
/** /tips 화면에 두지 않는 표시(302 r2: 검수 라벨·날짜 0 — REFERENCE 는 검수 없이 노출). */
const TIPS_FORBIDDEN_LABELS = ['검수됨', '확인됨', '검수 완료', '마지막 검수'];
/** 총괄 ②(c) 위험 태그 팁 라벨·(a) 태그별 고정 한 줄 — COPY.tips.hazardLabel·hazardNotes 와 같아야 한다(compliance.tips-output 시험). */
export const TIPS_HAZARD_LABEL = '수의사가 확인하지 않은 참고 정보';
export const TIPS_HAZARD_NOTES = Object.freeze({
  TOXIC_MATERIAL: '몸에 해로울 수 있는 재료가 들어가요. 갉거나 핥은 뒤 평소와 다르면 병원에 문의하세요.',
  INGESTION: '갉아 삼킬 수 있는 재료가 들어가요. 삼킨 것 같거나 평소와 다르면 병원에 문의하세요.',
  ENTRAPMENT: '틈이나 구멍에 몸이나 발이 끼일 수 있어요. 끼일 만한 곳을 확인하고, 다친 것 같으면 병원에 문의하세요.',
  ESCAPE: '틈이나 뚜껑으로 빠져나갈 수 있어요. 닫힘과 틈을 자주 확인하고, 빠져나갔다가 다친 것 같으면 병원에 문의하세요.',
  VENTILATION: '공기가 잘 통하지 않으면 열과 습기가 찰 수 있어요. 통기 구멍을 확인하고, 숨쉬기가 평소와 다르면 병원에 문의하세요.',
  HEAT: '뜨거워지는 곳 가까이 두면 열이 찰 수 있어요. 놓는 자리를 확인하고, 기운이 없어 보이면 병원에 문의하세요.',
  TIP_OVER: '쓰러지거나 뒤집혀 다칠 수 있어요. 흔들리지 않게 두고, 다친 것 같으면 병원에 문의하세요.',
});

/**
 * C9-TIPS(301, Kenny 2026-11-22) — 저렴 대체 팁(REFERENCE) 산출물.
 *   ① TIPS 라우트는 노출 팁(ex.tipTypes, seed-exposure 독립 재구현)이 있는 타입만 ② 고지 원문 ③ 외부 <a> 는 target=_blank ∧ rel ⊇ {noopener, noreferrer, nofollow, ugc}
 *   ④ 검수 라벨 0 ⑤ data-ws-id budgetTips#id 는 TIPS 페이지에만, 그 타입에 노출되는 팁만 ⑥ 노출 팁 있는 타입엔 TIPS 라우트가 있어야 한다.
 *   ⑦ 총괄 ②: 시드 hazards ≥ 1 인 팁 article 은 라벨 「수의사가 확인하지 않은 참고 정보」 + 태그마다 고정 한 줄(data-ws-hazard)을 담는다.
 *   ⑧ 312(310 MED-2): TIPS 페이지 외부 <a> href 는 글 사이트 허용 목록 규칙(seed-exposure tipReferenceUrlAllowed) 통과분만.
 */
function checkTips({ root, dist, routes, all, ex, add, seed }) {
  const hazardsOf = new Map();
  for (const x of Array.isArray(seed?.budgetTips) ? seed.budgetTips : []) {
    if (isObj(x) && typeof x.id === 'string' && Array.isArray(x.hazards)) hazardsOf.set(x.id, x.hazards.filter((z) => typeof z === 'string'));
  }
  const tipTypes = ex.tipTypes instanceof Set ? ex.tipTypes : new Set();
  const withTips = new Set([...tipTypes].map((k) => k.split('|')[0]));
  const tipsRoutes = routes.filter((r) => r.kind === 'TIPS' && typeof r.file === 'string');
  const R = 'prerender-manifest.json';
  for (const tid of withTips) {
    if (!tipsRoutes.some((r) => r.typeId === tid)) add('C9-TIPS', 'FAIL', R, null, `노출 팁이 있는 타입 ${L(tid)} 에 /tips 라우트 없음`);
  }
  const tipsFiles = new Map();
  for (const r of tipsRoutes) {
    if (!withTips.has(r.typeId)) add('C9-TIPS', 'FAIL', R, null, `route ${L(r.path)}: 노출 팁 없는 타입 ${L(r.typeId)} 의 /tips`);
    tipsFiles.set(resolve(dist, r.file), r);
  }
  for (const abs of all.filter((f) => f.endsWith('.html'))) {
    const rel = relPosix(root, abs);
    const html = readFileSync(abs, 'utf8');
    const lineOf = lineIndex(html);
    const route = tipsFiles.get(resolve(abs));
    for (const t of tags(html)) {
      const v = t.attrs['data-ws-id'];
      if (typeof v !== 'string' || !v.startsWith('budgetTips#')) continue;
      const id = v.slice('budgetTips#'.length);
      if (!route) add('C9-TIPS', 'FAIL', rel, lineOf(t.index), `팁 ${L(id)} 이 /tips 밖 페이지에 있다`);
      else if (!tipTypes.has(`${route.typeId}|${id}`)) add('C9-TIPS', 'FAIL', rel, lineOf(t.index), `팁 ${L(id)} 은 ${L(route.typeId)} 에 노출되지 않는다`);
    }
    if (!route) continue;
    if (!textNodes(html).some((n) => n.text.trim() === TIPS_DISCLAIMER)) add('C9-TIPS', 'FAIL', rel, null, '상단 고정 고지 원문 없음');
    for (const w of TIPS_FORBIDDEN_LABELS) if (html.includes(w)) add('C9-TIPS', 'FAIL', rel, null, `검수 라벨 ${L(w)} 금지(REFERENCE 는 검수 표시 없음)`);
    // ⑦ 위험 태그 팁 고정 주의 상자
    const artRe = /<article\s[^>]*\bdata-ws-id="budgetTips#([^"]*)"[^>]*>([\s\S]*?)<\/article>/g;
    let am;
    while ((am = artRe.exec(html)) !== null) {
      const hz = hazardsOf.get(am[1]) ?? [];
      if (hz.length === 0) continue;
      const texts = textNodes(am[2]).map((n) => n.text.trim());
      if (!texts.includes(TIPS_HAZARD_LABEL)) add('C9-TIPS', 'FAIL', rel, lineOf(am.index), `위험 태그 팁 ${L(am[1])}: 라벨 ${L(TIPS_HAZARD_LABEL)} 없음`);
      for (const z of hz) {
        const note = TIPS_HAZARD_NOTES[z];
        if (typeof note !== 'string' || !am[2].includes(`data-ws-hazard="${z}"`) || !texts.includes(note)) add('C9-TIPS', 'FAIL', rel, lineOf(am.index), `위험 태그 팁 ${L(am[1])}: ${L(z)} 고정 주의 문구 없음`);
      }
    }
    for (const t of tags(html)) {
      if (t.name !== 'a' || t.attrs.href === undefined) continue;
      const href = t.attrs.href.trim();
      if (!isExternal(href) || /^(mailto|tel):/i.test(href)) continue;
      const rels = (t.attrs.rel ?? '').toLowerCase().split(/\s+/);
      const miss = ['noopener', 'noreferrer', 'nofollow', 'ugc'].filter((x) => !rels.includes(x));
      if (miss.length || (t.attrs.target ?? '') !== '_blank') add('C9-TIPS', 'FAIL', rel, lineOf(t.index), `외부 <a> rel/target 부족(${miss.join(',') || 'target'}): ${L(href)}`);
      if (!tipReferenceUrlAllowed(href)) add('C9-TIPS', 'FAIL', rel, lineOf(t.index), `외부 <a> 가 글 사이트 허용 목록·글 페이지 규칙 밖: ${L(href)}`);
    }
  }
}

/** 356 종 페이지 고지 원문(총괄 고정 — server/src/prerender/copy.ts·client copy COPY.generalInfo.notice 와 같아야 한다). */
export const GENERAL_INFO_NOTICE = '일반 참고 정보예요 · 개체·환경에 따라 다를 수 있어요';

/**
 * 가시 텍스트(태그 경계 무시, 공백 정규화)에서 고지 원문이 나온 횟수.
 *   textNodes 는 script·style 본문 위치의 원문도 돌려주므로(C4 는 ws-data 문자열까지 보려고 그대로 쓴다) 여기선 먼저 가린 HTML 을 넘긴다 —
 *   ws-data JSON·주석 속 문자열은 화면 고지가 아니다.
 */
export function generalInfoNoticeCount(html) {
  const norm = (s) => s.replace(/\s+/g, ' ');
  const text = norm(textNodes(maskNonMarkup(html)).map((n) => n.text).join(''));
  const needle = norm(GENERAL_INFO_NOTICE);
  let n = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) n += 1;
  return n;
}

/**
 * C9-GENERAL(356 단계 10, Kenny 11/23 예외 2) — 일반 참고 정보 고지.
 *   typeId 가 있는 라우트 페이지(TYPE·SETUP·TIPS·SUPPLY_ITEM_TYPE 및 L4·L5·L7 레이어 경로)의 렌더 HTML 가시 텍스트에서
 *   ① 고정 6종 ∧ seed-exposure(시드+asOf)가 노출 판정 ∧ 타입·프로필·노출 요구사항 체인(요구사항·용품)에 GENERAL_INFO 행 있음 → 정확히 1회
 *   ② 노출된 6종의 체인에 GENERAL_INFO 없음 또는 6종 밖 타입 → 0회. 비노출 요구사항 체인의 GI 는 세지 않는다.
 *   ③ 6종 타입의 노출 판정 불가(시드 누락·읽기 실패 포함) → FAIL. typeId 없는 라우트는 이 규칙 밖.
 *   기대값은 ex.types·ex.pairs 와 원시 시드만 사용하며 렌더러·ws-data·산출물 표지는 참조하지 않는다.
 */
function checkGeneralInfo({ root, dist, routes, ex, seed, add }) {
  const gi = new Set(GENERAL_INFO_TYPE_IDS);
  const rows = (key) => Array.isArray(seed?.[key]) ? seed[key] : [];
  const isGi = (row) => row?.reviewStatus === 'GENERAL_INFO';
  for (const r of routes) {
    if (typeof r.typeId !== 'string' || typeof r.file !== 'string') continue;
    const abs = join(dist, r.file);
    let want = 0;
    if (gi.has(r.typeId)) {
      const type = ex.types.get(r.typeId);
      if (!type) {
        add('C9-GENERAL', 'FAIL', relPosix(root, abs), null, `${L(r.typeId)} 라우트 ${L(r.path)}: 시드에서 타입 노출 판정 불가`);
        continue;
      }
      const hasGi = isGi(type)
        || rows('careProfiles').some((p) => p?.id === type.careProfileId && isGi(p))
        || rows('supplyRequirements').some((req) => req?.careProfileId === type.careProfileId
          && ex.pairs.has(`${r.typeId}|${req.supplyItemId}`)
          && (isGi(req) || rows('supplyItems').some((item) => item?.id === req.supplyItemId && isGi(item))));
      want = hasGi ? 1 : 0;
    }
    if (!existsSync(abs)) continue; // 파일 없음은 C3-OUT-ROUTE 가 FAIL
    const n = generalInfoNoticeCount(readFileSync(abs, 'utf8'));
    if (n !== want) {
      add('C9-GENERAL', 'FAIL', relPosix(root, abs), null, `${L(r.typeId)} 라우트 ${L(r.path)}: 일반 참고 정보 고지 ${n}회(기대 ${want}회)`);
    }
  }
}

/**
 * C6-IMG-SPECIES(359 단계 6, D-1 A) — 사진 id 가 라우트 종·프로필·품목 범위와 맞는지(「앵무 라우트 햄스터 사진 id 0」).
 *   manifest 라우트 HTML 마다
 *   ① 수집: 마크업 data-ws-photo · img src(시드 행 asset 역매핑) · ws-data types[i].photos/homeScenes · requirements[i].photo · 그 밖 photoId.
 *   ② 판정(사진 하나 × 문맥 타입 전부):
 *      시드에 없음·사용 불가(isPhotoUsableRow 아님) → FAIL. 문맥 타입 없음(타입 없는 라우트) → FAIL.
 *      장면 행(scope 없음) → 타입이 장면 허용 종(sceneAllowedForType — 엔진 SCENE_PHOTO_GROUPS ∧ SCENE_PHOTO_TYPE_IDS 미러)이어야 한다.
 *      범위 행 → scope.animalTypeId = 타입 · scope.careProfileId = 타입 프로필 · scope.supplyItemId 는 (타입,품목) 노출 쌍.
 *      자리: 종 자리(photos.habitat|nowLead|spec) 장면은 TYPE_SCENE_PHOTOS[use] 만, 범위 행은 scope.use 일치.
 *            품목 자리(requirement.photo) 장면은 ITEM_SCENE_PHOTOS[item] 만, 범위 행은 use=item ∧ 같은 supplyItemId.
 *            homeScenes[key] 는 HOME_A_SCENE_PHOTOS[key] 장면만. ws-data asset·img src 는 행 asset 과 같아야 한다.
 *   ③ 문맥: 라우트 타입 = typeId ∪ layer.typeId · FAMILY 는 slug 가 family/ 로 시작하는 노출 타입 · HOME·PICK·SAVE 는 대표 타입(시드 순 첫 노출).
 *      data-ws-id="animalTypes#X" 요소 안의 사진은 X(홈류는 X 만, 그 밖은 X ∪ 라우트 타입). ws-data types[i] 는 같은 식으로 t.id.
 *   ④ 보조 잠금: HTML 원문 문자열에 사용 불가 id 가 있거나, 라우트 문맥이 장면 비허용인데 장면 id 가 있으면 FAIL(①에서 이미 판정한 id 는 건너뜀).
 *   소스 쪽 짝(C6-IMG-SPECIES-SRC)은 클라이언트 단계 5 뒤 다음 라운드.
 */
function checkPhotoSpecies({ root, dist, routes, ex, add, seed }) {
  const RULE = 'C6-IMG-SPECIES';
  const rowsById = new Map();
  const idsByAsset = new Map();
  for (const p of Array.isArray(seed?.photos) ? seed.photos : []) {
    if (!isObj(p) || typeof p.id !== 'string') continue;
    if (!rowsById.has(p.id)) rowsById.set(p.id, p);
    if (typeof p.asset === 'string') idsByAsset.set(p.asset, [...(idsByAsset.get(p.asset) ?? []), p.id]);
  }
  const usable = ex.ids?.photos instanceof Set ? ex.ids.photos : new Set();
  const exTypes = ex.types instanceof Map ? ex.types : new Map();
  const repType = exTypes.keys().next().value;
  const HOME_LIKE = new Set(['HOME', 'PICK', 'SAVE']);
  const sceneIds = [...rowsById.values()].filter((p) => !isObj(p.scope)).map((p) => p.id);
  const allIds = [...rowsById.keys()];
  const reId = (id) => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);

  function routeTypes(r) {
    const s = new Set();
    if (typeof r.typeId === 'string') s.add(r.typeId);
    if (isObj(r.layer) && typeof r.layer.typeId === 'string') s.add(r.layer.typeId);
    if (r.kind === 'FAMILY' && typeof r.family === 'string') {
      for (const [id, t] of exTypes) if (typeof t.slug === 'string' && t.slug.startsWith(`${r.family}/`)) s.add(id);
    }
    if (HOME_LIKE.has(r.kind) && typeof repType === 'string') s.add(repType);
    return [...s];
  }

  for (const r of routes) {
    if (typeof r.file !== 'string') continue;
    const abs = join(dist, r.file);
    if (!existsSync(abs)) continue; // 파일 없음은 C3-OUT-ROUTE
    const rel = relPosix(root, abs);
    const html = readFileSync(abs, 'utf8');
    const lineOf = lineIndex(html);
    const homeLike = HOME_LIKE.has(r.kind);
    const rTypes = routeTypes(r);
    const judged = new Set();
    const seen = new Set();
    const fail = (line, msg) => {
      const k = `${line}|${msg}`;
      if (seen.has(k)) return;
      seen.add(k);
      add(RULE, 'FAIL', rel, line, msg);
    };
    const ctxOf = (own) => (own === null ? rTypes : homeLike ? [own] : [...new Set([own, ...rTypes])]);

    /** slot: { kind:'type', use } | { kind:'item', item } | { kind:'home', key } | null */
    function judge(id, types, slot, asset, line, where) {
      judged.add(id);
      const p = rowsById.get(id);
      if (!p) return fail(line, `${where}: 시드에 없는 사진 id ${L(id)}`);
      if (!usable.has(id)) return fail(line, `${where}: 사용 불가 사진 ${L(id)}(SLOT·사용권 미충족 — 노출 금지)`);
      if (asset !== undefined && asset !== p.asset) fail(line, `${where}: 사진 ${L(id)} asset ${L(asset)} ≠ 시드 행 asset ${L(p.asset)}`);
      if (types.length === 0) return fail(line, `${where}: 타입 문맥 없는 라우트 ${L(r.path)} 에 사진 ${L(id)}`);
      const scene = !isObj(p.scope);
      const s = scene ? null : p.scope;
      for (const tid of types) {
        const t = exTypes.get(tid);
        if (!t) {
          fail(line, `${where}: ${L(tid)}(비노출 타입) 문맥에 사진 ${L(id)}`);
          continue;
        }
        if (scene) {
          if (!sceneAllowedForType(t)) fail(line, `${where}: ${L(tid)} 는 장면 허용 종이 아닌데 장면 사진 ${L(id)}`);
          continue;
        }
        if (typeof s.animalTypeId === 'string' && s.animalTypeId !== tid) fail(line, `${where}: ${L(tid)} 에 사진 ${L(id)} — 범위 animalTypeId=${L(s.animalTypeId)} 밖`);
        if (typeof s.careProfileId === 'string' && s.careProfileId !== t.careProfileId) fail(line, `${where}: ${L(tid)} 에 사진 ${L(id)} — 범위 careProfileId=${L(s.careProfileId)} 밖`);
        if (typeof s.supplyItemId === 'string' && !ex.pairs?.has(`${tid}|${s.supplyItemId}`)) fail(line, `${where}: ${L(tid)} 에 사진 ${L(id)} — 품목 ${L(s.supplyItemId)} 이 그 타입에 노출되지 않는다`);
      }
      if (slot === null) return;
      if (slot.kind === 'type') {
        const ok = scene ? TYPE_SCENE_PHOTOS[slot.use] === id : s.use === slot.use;
        if (!ok) fail(line, `${where}: 사진 ${L(id)} 이 종 ${L(slot.use)} 자리와 맞지 않음`);
      } else if (slot.kind === 'item') {
        const ok = scene ? ITEM_SCENE_PHOTOS[slot.item] === id : s.use === 'item' && s.supplyItemId === slot.item;
        if (!ok) fail(line, `${where}: 사진 ${L(id)} 이 품목 ${L(slot.item)} 자리와 맞지 않음`);
      } else if (slot.kind === 'home') {
        if (!(scene && HOME_A_SCENE_PHOTOS[slot.key] === id)) fail(line, `${where}: 사진 ${L(id)} 이 홈 장면 ${L(slot.key)} 자리와 맞지 않음`);
      }
    }

    // ① 마크업 — animalTypes#X 요소 범위(같은 이름 열고 닫기 짝 세기)
    const masked = maskNonMarkup(html);
    const all = tags(html);
    const typeRanges = [];
    for (const t of all) {
      const v = t.attrs['data-ws-id'];
      if (typeof v !== 'string' || !v.startsWith('animalTypes#')) continue;
      const re = new RegExp(`<(/?)${t.name}\\b[^>]*>`, 'gi');
      re.lastIndex = t.index + 1;
      let depth = 1;
      let end = masked.length;
      let mm;
      while ((mm = re.exec(masked)) !== null) {
        depth += mm[1] ? -1 : 1;
        if (depth === 0) {
          end = mm.index;
          break;
        }
      }
      typeRanges.push({ start: t.index, end, typeId: v.slice('animalTypes#'.length) });
    }
    const ownAt = (i) => {
      let best = null;
      for (const g of typeRanges) if (g.start < i && i < g.end && (best === null || g.start > best.start)) best = g;
      return best ? best.typeId : null;
    };
    for (const t of all) {
      const id = t.attrs['data-ws-photo'];
      const src = typeof t.attrs.src === 'string' ? t.attrs.src.trim() : undefined;
      const line = lineOf(t.index);
      const types = ctxOf(ownAt(t.index));
      if (typeof id === 'string') {
        judge(id, types, null, src, line, `<${L(t.name)} data-ws-photo>`);
        continue;
      }
      if (src === undefined) continue;
      const ids = idsByAsset.get(src);
      if (ids) for (const x of ids) judge(x, types, null, undefined, line, `<${L(t.name)} src>`);
      else if (src.startsWith('/assets/photos/')) fail(line, `<${L(t.name)} src>: 시드에 없는 사진 파일 ${L(src)}`);
    }

    // ① ws-data
    for (const sc of scripts(html)) {
      if (sc.attrs.id !== 'ws-data') continue;
      let d;
      try {
        d = JSON.parse(sc.body);
      } catch {
        continue; // 파싱 실패는 C8-OUT-SAFE
      }
      const line = lineOf(sc.index);
      const data = isObj(d) && isObj(d.data) ? d.data : {};
      const done = new Set();
      const ref = (o, types, slot, where) => {
        if (!isObj(o)) return;
        done.add(o);
        if (typeof o.photoId === 'string') judge(o.photoId, types, slot, o.asset, line, where);
      };
      for (const [i, t] of (Array.isArray(data.types) ? data.types : []).entries()) {
        if (!isObj(t)) continue;
        const types = ctxOf(typeof t.id === 'string' ? t.id : null);
        if (isObj(t.photos)) for (const [k, v] of Object.entries(t.photos)) ref(v, types, { kind: 'type', use: PHOTO_WS_TYPE_KEYS[k] ?? k }, `ws-data types[${i}].photos.${L(k)}`);
        if (isObj(t.homeScenes)) for (const [k, v] of Object.entries(t.homeScenes)) ref(v, types, { kind: 'home', key: k }, `ws-data types[${i}].homeScenes.${L(k)}`);
      }
      for (const [i, q] of (Array.isArray(data.requirements) ? data.requirements : []).entries()) {
        if (!isObj(q) || !isObj(q.photo)) continue;
        ref(q.photo, ctxOf(typeof q.animalTypeId === 'string' ? q.animalTypeId : null), { kind: 'item', item: q.supplyItemId }, `ws-data requirements[${i}].photo`);
      }
      // 그 밖 위치의 photoId(라우트 문맥)
      const walkJ = (v, depth) => {
        if (depth > 40) return;
        if (Array.isArray(v)) for (const x of v) walkJ(x, depth + 1);
        else if (isObj(v)) {
          if (!done.has(v) && typeof v.photoId === 'string') judge(v.photoId, rTypes, null, v.asset, line, 'ws-data photoId');
          for (const x of Object.values(v)) walkJ(x, depth + 1);
        }
      };
      walkJ(d, 0);
    }

    // ④ 보조 잠금 — 원문 문자열. /credits 는 저작자 표시 목록(data-ws-id="photos#id")이라 제외 — 그 목록은 C6-IMG 가 본다.
    if (r.kind === 'CREDITS') continue;
    const sceneOkHere = rTypes.length > 0 && rTypes.every((tid) => exTypes.has(tid) && sceneAllowedForType(exTypes.get(tid)));
    for (const id of allIds) {
      if (judged.has(id)) continue;
      const m = reId(id).exec(html);
      if (!m) continue;
      const line = lineOf(m.index);
      if (!usable.has(id)) fail(line, `원문 문자열: 사용 불가 사진 ${L(id)}(SLOT·사용권 미충족 — 노출 금지)`);
      else if (sceneIds.includes(id) && !sceneOkHere) fail(line, `원문 문자열: ${L(rTypes.join(',') || r.path)} 는 장면 허용 종이 아닌데 장면 사진 ${L(id)}`);
    }
  }
}

/** 398 C2: 피드 변형 파일 이름(server engine FEED_PAGE_VARIANT 미러) — 기본 파일 …/index.html 옆. */
const FEED_PAGE_VARIANTS = Object.freeze({ full: 'index.feed.html', noprice: 'index.feed-noprice.html' });
const FEED_VARIANT_RE = /(?:^|\/)index\.feed(?:-noprice)?\.html$/;
const feedVariantBase = (rel) => rel.replace(/index\.feed(?:-noprice)?\.html$/, 'index.html');

/**
 * 398 C2 — 피드 변형 HTML 을 기본 라우트 문맥(typeId·layer·kind)으로 되돌린 라우트 목록(file 만 변형 파일).
 *   대상 = dist 의 index.feed[-noprice].html 전부 ∪ feed-manifest.json pages.{full,noprice}(산출물 표지에 기대지 않고 디스크도 본다).
 *   ① 디스크 변형 파일의 기본 파일(…/index.html)이 manifest 라우트가 아니면 FAIL(문맥 없는 변형 = 판정 불가, fail-closed).
 *   ② pages 항목이 단계 변형 이름이 아니거나·경로 이탈·파일 없음·기본 라우트 없음이면 FAIL.
 */
function feedVariantRoutes({ root, dist, routes, all, add }) {
  const R = 'feed-manifest.json';
  const byFile = new Map();
  for (const r of routes) if (typeof r.file === 'string' && !byFile.has(r.file)) byFile.set(r.file, r);
  const files = new Set();
  for (const abs of all) {
    const rel = relPosix(dist, abs);
    if (FEED_VARIANT_RE.test(rel)) files.add(rel);
  }
  const fmPath = join(dist, R);
  if (existsSync(fmPath)) {
    let fm = null;
    try {
      fm = JSON.parse(stripBom(readFileSync(fmPath, 'utf8')));
    } catch {
      // 파싱 실패는 C11-FEED-OUT(rules-affiliate scanAffiliateOutputs)이 FAIL — 디스크 변형 파일은 그대로 본다.
    }
    const pages = isObj(fm) ? fm.pages : undefined;
    if (isObj(fm) && pages !== undefined && !isObj(pages)) add('C3-OUT-ROUTE', 'FAIL', R, null, '피드 변형 pages 형식(객체 아님)');
    for (const [stage, name] of Object.entries(FEED_PAGE_VARIANTS)) {
      const list = isObj(pages) ? pages[stage] : undefined;
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        add('C3-OUT-ROUTE', 'FAIL', R, null, `피드 변형 pages.${stage} 형식(배열 아님)`);
        continue;
      }
      for (const f of list) {
        const ok = typeof f === 'string' && (f === name || f.endsWith(`/${name}`)) && !f.split(/[\\/]/).includes('..') && !/^([a-z]:|\/)/i.test(f);
        if (!ok) {
          add('C3-OUT-ROUTE', 'FAIL', R, null, `피드 변형 pages.${stage} 항목이 ${name} 변형 이름 아님·경로 이탈: ${L(String(f))}`);
          continue;
        }
        if (!existsSync(join(dist, f))) add('C3-OUT-ROUTE', 'FAIL', R, null, `피드 변형 pages.${stage} 파일 없음: ${L(f)}`);
        else files.add(f);
      }
    }
  }
  const out = [];
  for (const f of [...files].sort()) {
    const base = byFile.get(feedVariantBase(f));
    if (!base) {
      add('C3-OUT-ROUTE', 'FAIL', relPosix(root, join(dist, f)), null, `피드 변형 파일의 기본 라우트(${L(feedVariantBase(f))})가 manifest 에 없음 — 문맥 판정 불가`);
      continue;
    }
    out.push({ ...base, file: f });
  }
  return out;
}

export function scanOutputs({ root, dist, ex, digest, bw, add, requireOutput, seed }) {
  const manPath = join(dist, 'prerender-manifest.json');
  if (!existsSync(manPath)) {
    if (requireOutput) add('C0-OUTPUT', 'FAIL', relPosix(root, manPath), null, 'NOT RUN — prerender-manifest.json 없음(--require-output)');
    return 'NOT RUN';
  }
  let m;
  const manText = stripBom(readFileSync(manPath, 'utf8'));
  try {
    m = JSON.parse(manText);
  } catch {
    // 233: JSON.parse 메시지는 원문 조각을 품는다 — 위치 숫자만.
    add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, `manifest 파싱 실패(JSON 문법 오류 ${jsonErrorWhere(manText)})`);
    return 'RUN';
  }
  if (!isObj(m) || m.v !== 1) add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, 'manifest v≠1');
  // 239: 서버 digest 는 앞 12자만(64자 hex 는 출력부 독립 토큰 가림에 걸린다 — 진단 문구 전체가 가려지지 않게). manifest 가 객체가 아니어도 예외 없이.
  const mDigest = isObj(m) ? m.seedDigest : undefined;
  if (mDigest !== digest) add('C3-OUT-ROUTE', 'FAIL', 'prerender-manifest.json', null, `seedDigest 불일치: manifest ${L(mDigest)} ≠ server/seed ${typeof digest === 'string' ? `${digest.slice(0, 12)}…` : '없음'}`);
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
      if (!indexablePaths.has(decodePath(p))) add('C3-OUT-ROUTE', 'FAIL', 'sitemap.xml', null, `manifest indexable 밖 URL: ${L(mm[1])}`);
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
    add('C6-IMG', 'FAIL', 'prerender-manifest.json', null, `CC BY 계열 사진(${ex.ccByPhotos.map(L).join(', ')})이 있는데 /credits 페이지 없음`);
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
        add('C6-IMG', 'FAIL', rel, null, `CC BY 사진 ${L(id)} 의 저작자 표시 항목 없음`);
        continue;
      }
      const end = html.indexOf('</li>', at);
      const item = html.slice(at, end < 0 ? undefined : end);
      const url = ex.licenseUrls?.get(id);
      if (typeof url !== 'string' || !item.includes(`href="${url}"`)) add('C6-IMG', 'FAIL', rel, null, `CC BY 사진 ${L(id)} 에 라이선스 증서 링크 없음`);
    }
  }

  // HTML — credits 링크 규칙은 manifest 라우트 파일(404 포함)에만(SPA 셸 shell.html 등 비라우트 HTML 제외)
  const routeFiles = new Set(routes.filter((r) => typeof r.file === 'string').map((r) => resolve(dist, r.file)));
  const all = walk(dist);
  checkPrivacy({ root, dist, m, routes, routeFiles, all, add });
  checkTips({ root, dist, routes, all, ex, add, seed });
  // 398 C2: 피드 변형 HTML(index.feed[-noprice].html)도 실제 제공 파일 — 기본 라우트와 같은 문맥으로 고지·종별 사진을 본다.
  const pageRoutes = [...routes, ...feedVariantRoutes({ root, dist, routes, all, add })];
  checkGeneralInfo({ root, dist, routes: pageRoutes, ex, seed, add });
  checkPhotoSpecies({ root, dist, routes: pageRoutes, ex, add, seed });
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
        if (!src.startsWith('/') || src.startsWith('//') || src.includes('\\')) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부·비정상 script src: ${L(src)}`);
        if (s.body.trim() !== '') add('C8-OUT-SAFE', 'FAIL', rel, line, 'src 와 인라인 본문 동시');
        continue;
      }
      if (type !== 'application/json' && type !== 'application/ld+json') {
        add('C8-OUT-SAFE', 'FAIL', rel, line, `인라인 스크립트 금지(type=${type ? L(type) : '없음'})`);
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
      // 239(Codex night-qa4 #7): 블록별 검사 중 예외(비정상 구조 등)는 스캐너를 죽이지 않고 고정 문구 FAIL 로 모은다(예외 메시지·값은 넣지 않는다).
      try {
        jsonStrings(data, '', (t, k) => bannedIn(t, rel, line, `JSON ${L(k)}`, add, bw));
        if (s.attrs.id === 'ws-data') checkWsData(data, rel, line, ex, add);
      } catch {
        add('C8-OUT-SAFE', 'FAIL', rel, line, 'JSON 블록 검사 중 예외(비정상 구조 — 원문 확인)');
      }
    }

    // C8 — 태그, C3 — data-ws-*, C4 — 속성 텍스트
    let hasCreditsLink = false;
    for (const t of tags(html)) {
      const line = lineOf(t.index);
      const a = t.attrs;
      if (['iframe', 'frame', 'frameset', 'object', 'embed'].includes(t.name)) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${L(t.name)}> 금지`);
      // B3-4(SEC L4): 인라인 이벤트 핸들러 속성(on*=)·모든 속성의 javascript:/vbscript: 값 0 — CSP 'unsafe-inline' 없이 동작해야 한다.
      for (const [k, v] of Object.entries(a)) {
        if (/^on/i.test(k)) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${L(t.name)} ${L(k)}=> 인라인 핸들러`);
        else if (typeof v === 'string' && /^(?:javascript|vbscript):/i.test(v.replace(/[\u0000-\u0020]/g, ''))) add('C8-OUT-SAFE', 'FAIL', rel, line, `<${L(t.name)} ${L(k)}> 위험 URL: ${clip(v, 40)}`);
      }
      if (t.name === 'link' && a.href !== undefined && isExternal(a.href.trim()) && (a.rel ?? '').toLowerCase().trim() !== 'canonical') {
        add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 <link href>: ${L(a.href)}`);
      }
      if (t.name === 'a' && a.href !== undefined) {
        const href = a.href.trim();
        if (/^\s*(javascript|data|vbscript):/i.test(href)) add('C8-OUT-SAFE', 'FAIL', rel, line, `위험 href: ${clip(href, 40)}`);
        else if (isExternal(href) && !/^(mailto|tel):/i.test(href)) {
          const rels = (a.rel ?? '').toLowerCase().split(/\s+/);
          if (!rels.includes('noopener')) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 <a> rel noopener 없음: ${L(href)}`);
        }
        if (href === '/credits') hasCreditsLink = true;
      }
      // 362 N12: 피드 썸네일(img.ws-feed-thumb, no-referrer) 의 외부 src 는 C11-FEED-OUT(rules-affiliate.mjs)이 피드 블록 안·FEED_IMAGE_HOSTS 정확 일치로 따로 잠근다.
      const feedThumb = t.name === 'img' && /(?:^|\s)ws-feed-thumb(?:\s|$)/.test(a.class ?? '') && (a.referrerpolicy ?? '').trim().toLowerCase() === 'no-referrer' && a.srcset === undefined;
      if (t.name !== 'script' && t.name !== 'a' && t.name !== 'link' && !feedThumb) {
        for (const k of ['src', 'srcset', 'poster', 'data']) {
          if (a[k] !== undefined && a[k].split(',').some((u) => isExternal(u.trim().split(/\s+/)[0] ?? ''))) {
            add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 리소스 ${L(t.name)}[${k}]: ${L(a[k])}`);
          }
        }
      }
      if (t.name === 'form' && a.action !== undefined && isExternal(a.action.trim())) add('C8-OUT-SAFE', 'FAIL', rel, line, `외부 form action: ${L(a.action)}`);
      if (a['data-ws-id'] !== undefined) {
        const [key, id, extra] = a['data-ws-id'].split('#');
        if (extra !== undefined || !SEED_KEYS.includes(key) || !ex.ids[key].has(id)) add('C3-OUT-ID', 'FAIL', rel, line, `비노출 data-ws-id: ${L(a['data-ws-id'])}`);
      }
      if (a['data-ws-type'] !== undefined && !ex.ids.animalTypes.has(a['data-ws-type'])) add('C3-OUT-ROUTE', 'FAIL', rel, line, `비노출 타입 페이지: ${L(a['data-ws-type'])}`);
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
      if (h.rule === 'L01' && !nodeTerms.has(h.term)) add('C4-BANNED', 'FAIL', rel, null, `태그 경계에 걸친 금지어 "${L(h.term)}"`);
    }
  }

  // 362 N16: 피드 JSON({slug}/feed/{item}[.noprice].json) — 경로 품목·본문 supplyItemId 가 FOOD/HEALTH 면 FAIL(피드 0, 불변식 ⑤).
  for (const abs of all.filter((f) => /\/feed\/[^/]+\.json$/.test(relPosix(dist, f)))) {
    const rel = relPosix(root, abs);
    const m = /\/feed\/([^/]+?)(?:\.noprice)?\.json$/.exec(relPosix(dist, abs));
    const ids = new Set([m?.[1]]);
    let d;
    try {
      d = JSON.parse(stripBom(readFileSync(abs, 'utf8')));
      if (isObj(d) && d.supplyItemId !== undefined) ids.add(d.supplyItemId);
    } catch {
      // 파싱 실패는 C11-FEED-OUT(rules-affiliate checkFeedJsonOut)이 FAIL — 여기선 경로 품목만 본다.
    }
    if (d !== undefined) {
      try {
        // 398 C3: L4 가 읽는 피드 JSON 의 글자(제목 등) 금지어 — data/ 밖이라 아래 카탈로그 JSON 검사에 안 걸린다.
        jsonStrings(d, '', (t, k) => bannedIn(t, rel, null, `피드 JSON ${L(k)}`, add, bw));
        // 398 GI(불변식 ⑦ 예외 2 — GENERAL_INFO 체인에 연결된 상품은 노출하지 않는다): 피드 블록의 (typeId, 품목) 체인 전 행 VERIFIED ∧ 유효만.
        //   블록 generalInfo 가 false 가 아니면(키 없음 포함) FAIL — 산출물 표지만 믿지 않고 시드 체인으로도 따로 본다.
        if (isObj(d)) {
          if (d.generalInfo !== false) add('C11-FEED-OUT', 'FAIL', rel, null, `피드 JSON generalInfo=${L(String(d.generalInfo))}(false 만) — GENERAL_INFO 체인 피드 0`);
          const pair = `${d.typeId}|${d.supplyItemId}`;
          if (!(ex.feedStrictPairs instanceof Set) || !ex.feedStrictPairs.has(pair)) {
            add('C11-FEED-OUT', 'FAIL', rel, null, `피드 JSON ${pairLabel(d.typeId, d.supplyItemId)} — 체인이 전부 VERIFIED 가 아님(GENERAL_INFO·비노출 체인 피드 0)`);
          }
        }
      } catch {
        add('C11-FEED-OUT', 'FAIL', rel, null, '피드 JSON 검사 중 예외(비정상 구조 — 원문 확인)');
      }
    }
    for (const it of ids) {
      if (!(ex.feedExcludedItems instanceof Set) || ex.feedExcludedItems.has(it)) add('C11-FEED-OUT', 'FAIL', rel, null, `피드 JSON 품목 ${L(it)} — FOOD/HEALTH 품목 피드 0`);
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
    try {
      checkCatalog(c, rel, ex, digest, add);
      jsonStrings(c, '', (t, k) => bannedIn(t, rel, null, `JSON ${L(k)}`, add, bw));
    } catch {
      add('C3-OUT-ID', 'FAIL', rel, null, 'JSON 검사 중 예외(비정상 구조 — 원문 확인)'); // 239 #7: 블록 예외 고정 FAIL
    }
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
        add('C3-OUT-TAXON', 'FAIL', relPosix(root, abs), lineIndex(text)(text.indexOf(n.v)), `비노출 Taxon ${L(n.taxonId)} 의 ${n.what} 문자열이 산출물에`);
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
        add('C3-OUT-DRAFTSRC', 'FAIL', relPosix(root, abs), lineIndex(text)(text.indexOf(n.v)), `비노출 행 전용 출처 ${n.what}(${n.key}#${L(n.id)}) 가 산출물에: ${clip(n.raw, 60)}`);
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
    // 356 단계 10: 검수자 유형 AI_DRAFT 는 데이터 산출물(HTML·ws-data·카탈로그·sitemap 등)에 0 — 카탈로그 GENERAL_INFO 행 누출 포함.
    //   코드 번들(.js·.map·.css)은 제외: 엔진 열거형(domain.ts REVIEWER_TYPES)이 문자열 상수로 들어 있다(데이터 아님).
    if (AI_DRAFT_DATA_EXT.test(abs)) {
      for (const n of AI_DRAFT_NEEDLES) {
        if (!text.includes(n)) continue;
        add('C3-OUT-REVIEWMETA', 'FAIL', relPosix(root, abs), lineIndex(text)(text.indexOf(n)), `검수자 유형 "${n}" 가 데이터 산출물에(GENERAL_INFO 는 generalInfo:true 표기만)`);
        break;
      }
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
