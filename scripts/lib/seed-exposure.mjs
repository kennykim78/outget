// 원시 시드 → 노출 집합 독립 재구현(D9). server/src/engine 을 import 하지 않는다.
//   의도: 엔진(exposure.ts)이 틀려도 산출물에 비노출 행이 섞이면 compliance 가 잡는다.
//   애매하면 비노출(fail-closed) — 엔진보다 넓게 허용하는 쪽으로 틀리면 안 된다.
//
//   verified(r)        = reviewStatus === 'VERIFIED' ∧ rank(reviewerType) ≥ rank(OPERATOR)   (AI_DRAFT·미지값 제외)
//   careProfile        = verified
//   animalType(base)   = status ACTIVE ∧ verified ∧ careProfile 존재·verified
//   requirement(t,r)   = base(t) ∧ r.careProfileId === t.careProfileId ∧ verified(r) ∧ item verified
//   animalType         = base ∧ 노출 requirement ≥ 1
//   supplyItem         = verified ∧ 어떤 노출 (type,item) 쌍의 item
//   curatedProduct     = status ACTIVE ∧ verified ∧ meetsMinSpec === true ∧ ∃ 노출 type t:
//                        t.careProfileId ∈ careProfileIds ∧ (t,item) 노출 ∧ minSpec(base ⊕ override, (key,op) 교체) 전부 충족
//                        (키 누락·미지 op·when 평가 불가 → 비노출)
//   setupBundle        = verified ∧ ∃ 노출 type t: careProfileId 일치 ∧ itemIds 비어있지 않고 전부 (t,item) 노출
//   compatibilityRule  = verified ∧ a·b 둘 다 노출 item
//   taxon              = verified ∧ 노출 type 이 참조
//   vetClinic          = verification.status === 'VERIFIED'
//   testimonial        = status === 'APPROVED' ∧ verifiedUsage === true
//   photo              = status ≠ SLOT ∧ license ∈ I01 ∧ source ∧ https sourceUrl ∧ downloadedAt ∧ (CC0 ∨ author)
//   같은 id 가 여러 행이면 전부 노출일 때만 노출.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEED_FILES = {
  animalTypes: 'animal-types.json',
  taxa: 'taxa.json',
  careProfiles: 'care-profiles.json',
  supplyItems: 'supply-items.json',
  supplyRequirements: 'supply-requirements.json',
  compatibilityRules: 'compatibility-rules.json',
  setupBundles: 'setup-bundles.json',
  curatedProducts: 'curated-products.json',
  testimonials: 'testimonials.json',
  vetClinics: 'vet-clinics.json',
  photos: 'photos.json',
};
export const SEED_KEYS = Object.keys(SEED_FILES);

const REVIEWER_RANK = ['AI_DRAFT', 'OPERATOR', 'EXPERIENCED_KEEPER', 'VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET'];
export const PHOTO_LICENSES = new Set(['CC0', 'CC_BY', 'CC_BY_SA', 'SITE_LICENSE', 'PERMISSION']);
export const PRODUCT_IMAGE_LICENSES = new Set(['OWN_PHOTO', 'SELLER_PERMISSION', 'AFFILIATE_API']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

export function isVerifiedRow(r) {
  return isObj(r) && r.reviewStatus === 'VERIFIED' && REVIEWER_RANK.indexOf(r.reviewerType) >= REVIEWER_RANK.indexOf('OPERATOR');
}

export function isPhotoUsableRow(p) {
  if (!isObj(p) || p.status === 'SLOT') return false;
  if (!PHOTO_LICENSES.has(p.license)) return false;
  if (!nonEmpty(p.source) || !nonEmpty(p.downloadedAt)) return false;
  if (typeof p.sourceUrl !== 'string' || !/^https:\/\/[^\s/]+/i.test(p.sourceUrl)) return false;
  return p.license === 'CC0' || nonEmpty(p.author);
}

/**
 * seedDigest — manifest.seedDigest 결속 값(F3 prerender 와 같은 알고리즘이어야 한다).
 *   seedDir 의 *.json 파일명을 코드 유닛 순 정렬, 각 파일마다 `${name}\n` + 본문(UTF-8, BOM 제거, CRLF→LF) + `\n` 을
 *   sha256 에 순서대로 넣는다. 결과 = 소문자 hex 64자(접두사 없음).
 */
export function seedDigest(seedDir) {
  const names = readdirSync(seedDir).filter((f) => f.endsWith('.json')).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = createHash('sha256');
  for (const name of names) {
    let text = readFileSync(join(seedDir, name), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n/g, '\n');
    h.update(`${name}\n`, 'utf8');
    h.update(text, 'utf8');
    h.update('\n', 'utf8');
  }
  return h.digest('hex');
}

/** @returns {{ seed: Record<string, unknown[]>, errors: {file:string, message:string}[] }} */
export function readSeed(seedDir) {
  const seed = {};
  const errors = [];
  for (const key of SEED_KEYS) {
    const file = SEED_FILES[key];
    let text;
    try {
      text = readFileSync(join(seedDir, file), 'utf8');
    } catch {
      seed[key] = [];
      continue; // 누락 파일은 seed:validate(S01) 몫 — 노출 0 으로 취급(fail-closed)
    }
    try {
      const parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
      seed[key] = Array.isArray(parsed) ? parsed : [];
      if (!Array.isArray(parsed)) errors.push({ file, message: '최상위가 배열이 아니다' });
    } catch (e) {
      seed[key] = [];
      errors.push({ file, message: `JSON 파싱 실패: ${e.message}` });
    }
  }
  return { seed, errors };
}

function condOk(c, sv) {
  if (!isObj(c) || typeof c.key !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(sv, c.key)) return null;
  const v = sv[c.key];
  if (v === null || v === undefined) return null;
  switch (c.op) {
    case 'gte':
      return typeof v === 'number' && typeof c.value === 'number' ? v >= c.value : null;
    case 'lte':
      return typeof v === 'number' && typeof c.value === 'number' ? v <= c.value : null;
    case 'eq':
      return typeof c.value === 'object' && c.value !== null ? null : v === c.value;
    case 'in':
      return Array.isArray(c.value) ? c.value.includes(v) : null;
    case 'not_in':
      return Array.isArray(c.value) ? !c.value.includes(v) : null;
    default:
      return null;
  }
}

function rulesOf(set) {
  return isObj(set) && Array.isArray(set.rules) ? set.rules : [];
}

/** base minSpec ⊕ AnimalType.careOverrides.requirements[item].minSpec — (key, op) 같으면 교체. */
export function resolvedMinRules(req, type, itemId) {
  const rules = [...rulesOf(req.minSpec)];
  const ov = isObj(type.careOverrides) && isObj(type.careOverrides.requirements) ? type.careOverrides.requirements[itemId] : undefined;
  if (ov !== undefined && !isObj(ov)) return null;
  if (isObj(ov) && ov.minSpec !== undefined) {
    if (!isObj(ov.minSpec)) return null;
    for (const r of rulesOf(ov.minSpec)) {
      if (!isObj(r)) return null;
      const i = rules.findIndex((x) => isObj(x) && x.key === r.key && x.op === r.op);
      if (i >= 0) rules[i] = r;
      else rules.push(r);
    }
  }
  return rules;
}

export function meetsMinRules(rules, specValues) {
  if (!Array.isArray(rules) || !isObj(specValues)) return false;
  for (const r of rules) {
    if (!isObj(r)) return false;
    const when = r.when === undefined ? [] : Array.isArray(r.when) ? r.when : [r.when];
    const ws = when.map((c) => condOk(c, specValues));
    if (ws.some((w) => w === null)) return false;
    if (ws.some((w) => w === false)) continue;
    if (condOk(r, specValues) !== true) return false;
  }
  return true;
}

function groupById(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!isObj(r) || typeof r.id !== 'string') continue;
    if (!m.has(r.id)) m.set(r.id, []);
    m.get(r.id).push(r);
  }
  return m;
}

/** 모든 행이 pred 를 만족하는 id 만. */
function idsWhere(rows, pred) {
  const out = new Set();
  for (const [id, rs] of groupById(rows)) if (rs.every(pred)) out.add(id);
  return out;
}

/**
 * @returns {{
 *   ids: Record<string, Set<string>>,      // seedKey → 노출 id
 *   types: Map<string, object>,            // 노출 animalType id → 행
 *   pairs: Set<string>,                    // `${typeId}|${itemId}` 노출 요구사항
 *   productTypes: Set<string>,             // `${typeId}|${productId}`
 *   vetRegions: Set<string>,
 *   ccByPhotos: string[],                  // 사용 가능 CC_BY·CC_BY_SA 사진 id
 * }}
 */
export function computeExposure(seed) {
  const rows = (k) => (Array.isArray(seed[k]) ? seed[k] : []);
  const profiles = groupById(rows('careProfiles'));
  const items = groupById(rows('supplyItems'));
  const verifiedProfile = (id) => typeof id === 'string' && profiles.has(id) && profiles.get(id).every(isVerifiedRow);
  const verifiedItem = (id) => typeof id === 'string' && items.has(id) && items.get(id).every(isVerifiedRow);

  const typeRows = groupById(rows('animalTypes'));
  const baseType = (t) => isObj(t) && t.status === 'ACTIVE' && isVerifiedRow(t) && verifiedProfile(t.careProfileId);

  const reqs = rows('supplyRequirements').filter(isObj);
  const reqIdGroups = groupById(reqs);
  const reqExposedForType = (t, r) =>
    baseType(t) && r.careProfileId === t.careProfileId && isVerifiedRow(r) && verifiedItem(r.supplyItemId) && reqIdGroups.get(r.id)?.every(isVerifiedRow) !== false;

  const pairs = new Set();
  const pairReq = new Map(); // typeId|itemId → req rows (같은 프로필·아이템 중복이면 전부 노출일 때만)
  const exposedReqIds = new Set();
  const types = new Map();
  for (const [id, ts] of typeRows) {
    if (ts.length !== 1 || !baseType(ts[0])) continue;
    const t = ts[0];
    const byItem = new Map();
    for (const r of reqs) if (r.careProfileId === t.careProfileId && typeof r.supplyItemId === 'string') {
      if (!byItem.has(r.supplyItemId)) byItem.set(r.supplyItemId, []);
      byItem.get(r.supplyItemId).push(r);
    }
    let any = false;
    for (const [itemId, rs] of byItem) {
      if (rs.length === 1 && reqExposedForType(t, rs[0])) {
        pairs.add(`${id}|${itemId}`);
        pairReq.set(`${id}|${itemId}`, rs[0]);
        exposedReqIds.add(rs[0].id);
        any = true;
      }
    }
    if (any) types.set(id, t);
  }
  // 노출 타입이 없는 쌍은 제거(base 만 통과하고 requirement 0 인 타입은 위에서 이미 제외).
  const exposedItemIds = new Set();
  for (const p of pairs) exposedItemIds.add(p.split('|')[1]);

  const productTypes = new Set();
  const productIds = idsWhere(rows('curatedProducts'), (p) => {
    if (!(p.status === 'ACTIVE' && isVerifiedRow(p) && p.meetsMinSpec === true && Array.isArray(p.careProfileIds))) return false;
    let any = false;
    for (const [tid, t] of types) {
      if (!p.careProfileIds.includes(t.careProfileId)) continue;
      const req = pairReq.get(`${tid}|${p.supplyItemId}`);
      if (!req) continue;
      const rules = resolvedMinRules(req, t, p.supplyItemId);
      if (rules && meetsMinRules(rules, p.specValues)) {
        productTypes.add(`${tid}|${p.id}`);
        any = true;
      }
    }
    return any;
  });

  const bundleIds = idsWhere(rows('setupBundles'), (b) => {
    if (!isVerifiedRow(b) || !Array.isArray(b.itemIds) || b.itemIds.length === 0) return false;
    for (const [tid, t] of types) {
      if (b.careProfileId === t.careProfileId && b.itemIds.every((i) => pairs.has(`${tid}|${i}`))) return true;
    }
    return false;
  });

  const typeProfiles = new Set([...types.values()].map((t) => t.careProfileId));
  const typeTaxa = new Set([...types.values()].map((t) => t.taxonId).filter((x) => typeof x === 'string'));

  const vetIds = idsWhere(rows('vetClinics'), (v) => isObj(v.verification) && v.verification.status === 'VERIFIED');
  const vetRegions = new Set();
  for (const v of rows('vetClinics')) if (isObj(v) && vetIds.has(v.id) && typeof v.region === 'string') vetRegions.add(v.region);

  const photoIds = idsWhere(rows('photos'), isPhotoUsableRow);
  const ccByPhotos = rows('photos')
    .filter((p) => isObj(p) && photoIds.has(p.id) && (p.license === 'CC_BY' || p.license === 'CC_BY_SA'))
    .map((p) => p.id);

  const ids = {
    animalTypes: new Set(types.keys()),
    taxa: idsWhere(rows('taxa'), (x) => isVerifiedRow(x) && typeTaxa.has(x.id)),
    careProfiles: idsWhere(rows('careProfiles'), (x) => isVerifiedRow(x) && typeProfiles.has(x.id)),
    supplyItems: idsWhere(rows('supplyItems'), (x) => isVerifiedRow(x) && exposedItemIds.has(x.id)),
    supplyRequirements: exposedReqIds,
    compatibilityRules: idsWhere(rows('compatibilityRules'), (x) => isVerifiedRow(x) && exposedItemIds.has(x.a) && exposedItemIds.has(x.b)),
    setupBundles: bundleIds,
    curatedProducts: productIds,
    testimonials: idsWhere(rows('testimonials'), (x) => x.status === 'APPROVED' && x.verifiedUsage === true),
    vetClinics: vetIds,
    photos: photoIds,
  };
  return { ids, types, pairs, productTypes, vetRegions, ccByPhotos };
}
