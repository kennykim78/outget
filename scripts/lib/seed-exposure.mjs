// 원시 시드 → 노출 집합 독립 재구현(D9). server/src/engine 을 import 하지 않는다.
//   의도: 엔진(exposure.ts)이 틀려도 산출물에 비노출 행이 섞이면 compliance 가 잡는다.
//   애매하면 비노출(fail-closed) — 엔진보다 넓게 허용하는 쪽으로 틀리면 안 된다.
//
//   verified(r)        = reviewStatus === 'VERIFIED' ∧ rank(reviewerType) ≥ rank(OPERATOR)   (AI_DRAFT·미지값 제외)
//                        ∧ fresh(r, asOf): verifiedAt 달력 날짜 ∧ 0 ≤ (asOf − verifiedAt) ≤ STALE_DAYS(180)   (M-1, R4 D5)
//                        computeExposure(seed, asOf) — asOf 필수(YYYY-MM-DD 아니면 RangeError). 아래 "verified" 는 전부 이 뜻.
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
//   testimonial        = status === 'APPROVED' ∧ verifiedUsage === true ∧ animalTypeId ∈ 노출 animalType(F5)
//   photo              = status ∈ {READY} ∧ license ∈ I01 ∧ source ∧ https sourceUrl ∧ downloadedAt ∧ (CC0 ∨ author)
//                        ∧ 출처별 호스트 허용목록·userinfo 거부(M-1) ∧ CC_BY_SA 원본·카드 슬롯(L8)
//                        ∧ (CC_BY·CC_BY_SA → licenseUrl 이 같은 종류의 creativecommons.org 증서, M-3)
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

/** 검수 유효 일수 — server/src/engine/domain.ts STALE_DAYS 와 같아야 한다(패리티 테스트 engine.exposure.parity). */
export const STALE_DAYS = 180;

/** YYYY-MM-DD(달력상 존재) → 정수 일 번호, 아니면 null. 엔진과 독립 구현(Date 왕복 검사). */
export function dayNumber(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1000) return null;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return t / 86_400_000;
}

/** verifiedAt 이 asOfDay 기준 0~STALE_DAYS 일 전. 누락·형식 오류·미래는 false(fail-closed). */
export function isFreshRow(r, asOfDay) {
  if (!isObj(r)) return false;
  const v = dayNumber(r.verifiedAt);
  if (v === null) return false;
  const age = asOfDay - v;
  return age >= 0 && age <= STALE_DAYS;
}

/**
 * CC 증서 URL(독립 구현, S1 M-3): https://creativecommons.org/licenses/(by|by-sa)/(2.0|2.5|3.0|4.0)/[deed.xx] → 'CC_BY'|'CC_BY_SA',
 *   /publicdomain/zero/1.0/ → 'CC0', 그 밖(다른 호스트·http·쿼리·userinfo·NC 등) → null.
 */
export function ccLicenseOfUrl(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'creativecommons.org' || u.port !== '' || u.username !== '' || u.password !== '') return null;
  if (u.search !== '' || u.hash !== '' || url !== u.href) return null;
  const m = /^\/(?:licenses\/(by|by-sa)\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/(?:deed\.[a-z]{2}(?:-[a-z]{2,4})?)?$/.exec(u.pathname);
  if (!m) return null;
  return m[1] === undefined ? 'CC0' : m[1] === 'by' ? 'CC_BY' : 'CC_BY_SA';
}

/** 사용 가능 사진 상태(S-R4 L-E) — engine PHOTO_USABLE_STATUSES 와 같다(패리티 테스트). SLOT·미지값 불가. */
export const PHOTO_USABLE_STATUSES = new Set(['READY']);

/** https + 점 있는 호스트(engine HTTPS_URL 과 같은 엄격도, S-R4 L-D). */
const HTTPS_DOTTED_URL = /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/;

/**
 * 출처 코드 → 원본 호스트 허용목록(SEC-2 M-1, 독립 구현) — engine PHOTO_SOURCE_HOSTS 와 같다(패리티 테스트).
 *   OWN·SELLER·AFFILIATE 는 사진 증빙 필드 규칙이 문서에 없어 사용 불가(fail-closed).
 */
export const PHOTO_SOURCE_HOSTS = Object.freeze({
  WIKIMEDIA: Object.freeze(['commons.wikimedia.org', 'upload.wikimedia.org']),
  UNSPLASH: Object.freeze(['unsplash.com', 'images.unsplash.com']),
  PEXELS: Object.freeze(['www.pexels.com', 'pexels.com', 'images.pexels.com']),
  PIXABAY: Object.freeze(['pixabay.com', 'cdn.pixabay.com']),
});

/**
 * 원본 URL 이 출처의 허용 호스트인가(M-1, 독립 구현 — WHATWG URL 파싱 + 원문 대조).
 *   https ∧ userinfo·포트 없음 ∧ hostname 허용목록 ∧ 원문 authority 가 hostname 과 글자 그대로 같다(대소문자·끝 점·인코딩 정규화로 통과 금지).
 */
export function photoSourceUrlAllowed(source, sourceUrl) {
  if (typeof source !== 'string' || typeof sourceUrl !== 'string') return false;
  if (!Object.hasOwn(PHOTO_SOURCE_HOSTS, source)) return false;
  if (!HTTPS_DOTTED_URL.test(sourceUrl)) return false;
  let u;
  try {
    u = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return false;
  if (!PHOTO_SOURCE_HOSTS[source].includes(u.hostname)) return false;
  const rest = sourceUrl.slice('https://'.length);
  if (!rest.startsWith(u.hostname)) return false;
  const next = rest.charAt(u.hostname.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

/** CC BY-SA 카드 슬롯 허용목록(L8, 독립 구현) — engine CC_BY_SA_CARD_SLOT_RE 와 같은 집합(패리티 테스트). */
const CC_BY_SA_SLOT_EXACT = new Set(['review-side', 'vet-empty', 'done']);
const CC_BY_SA_SLOT_PREFIX = /^(?:intro-[1-9]|(?:group|l4)-[a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** CC BY-SA 는 원본 그대로(modified === false) ∧ 카드 슬롯만(히어로·합성 금지). 다른 라이선스는 true. */
export function ccBySaPlacementOk(p) {
  if (!isObj(p) || p.license !== 'CC_BY_SA') return true;
  if (p.modified !== false || typeof p.slot !== 'string') return false;
  return CC_BY_SA_SLOT_EXACT.has(p.slot) || CC_BY_SA_SLOT_PREFIX.test(p.slot);
}

/** engine isPhotoUsable 과 정확히 같은 판정(S-R4 L-D, 패리티 테스트) — 이보다 넓으면 안 된다. */
export function isPhotoUsableRow(p) {
  if (!isObj(p) || !PHOTO_USABLE_STATUSES.has(p.status)) return false;
  if ((p.license === 'CC_BY' || p.license === 'CC_BY_SA') && ccLicenseOfUrl(p.licenseUrl) !== p.license) return false;
  if (!PHOTO_LICENSES.has(p.license)) return false;
  if (!nonEmpty(p.source)) return false;
  if (dayNumber(p.downloadedAt) === null) return false;
  if (typeof p.sourceUrl !== 'string' || !HTTPS_DOTTED_URL.test(p.sourceUrl)) return false;
  if (!photoSourceUrlAllowed(p.source, p.sourceUrl)) return false;
  if (!ccBySaPlacementOk(p)) return false;
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
 *   licenseUrls: Map<string, string>,      // ccByPhotos id → licenseUrl(C6 /credits 링크 대조)
 * }}
 * @param {Record<string, unknown[]>} seed
 * @param {string} asOf 노출 기준일 YYYY-MM-DD(필수, M-1)
 */
export function computeExposure(seed, asOf) {
  const asOfDay = dayNumber(asOf);
  if (asOfDay === null) throw new RangeError(`computeExposure: asOf 는 YYYY-MM-DD 여야 한다 (${String(asOf)})`);
  const ok = (r) => isVerifiedRow(r) && isFreshRow(r, asOfDay);
  const rows = (k) => (Array.isArray(seed[k]) ? seed[k] : []);
  const profiles = groupById(rows('careProfiles'));
  const items = groupById(rows('supplyItems'));
  const verifiedProfile = (id) => typeof id === 'string' && profiles.has(id) && profiles.get(id).every(ok);
  const verifiedItem = (id) => typeof id === 'string' && items.has(id) && items.get(id).every(ok);

  const typeRows = groupById(rows('animalTypes'));
  const baseType = (t) => isObj(t) && t.status === 'ACTIVE' && ok(t) && verifiedProfile(t.careProfileId);

  const reqs = rows('supplyRequirements').filter(isObj);
  const reqIdGroups = groupById(reqs);
  const reqExposedForType = (t, r) =>
    baseType(t) && r.careProfileId === t.careProfileId && ok(r) && verifiedItem(r.supplyItemId) && reqIdGroups.get(r.id)?.every(ok) !== false;

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
    if (!(p.status === 'ACTIVE' && ok(p) && p.meetsMinSpec === true && Array.isArray(p.careProfileIds))) return false;
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
    if (!ok(b) || !Array.isArray(b.itemIds) || b.itemIds.length === 0) return false;
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
    taxa: idsWhere(rows('taxa'), (x) => ok(x) && typeTaxa.has(x.id)),
    careProfiles: idsWhere(rows('careProfiles'), (x) => ok(x) && typeProfiles.has(x.id)),
    supplyItems: idsWhere(rows('supplyItems'), (x) => ok(x) && exposedItemIds.has(x.id)),
    supplyRequirements: exposedReqIds,
    compatibilityRules: idsWhere(rows('compatibilityRules'), (x) => ok(x) && exposedItemIds.has(x.a) && exposedItemIds.has(x.b)),
    setupBundles: bundleIds,
    curatedProducts: productIds,
    // F5: 노출 타입(types)의 후기만 — 비노출 동물 후기는 산출물에 있으면 C3-OUT-ID.
    testimonials: idsWhere(rows('testimonials'), (x) => x.status === 'APPROVED' && x.verifiedUsage === true && typeof x.animalTypeId === 'string' && types.has(x.animalTypeId)),
    vetClinics: vetIds,
    photos: photoIds,
  };
  const licenseUrls = new Map();
  for (const p of rows('photos')) if (isObj(p) && ccByPhotos.includes(p.id)) licenseUrls.set(p.id, p.licenseUrl);
  return { ids, types, pairs, productTypes, vetRegions, ccByPhotos, licenseUrls };
}
