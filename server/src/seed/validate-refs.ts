// 참조 규칙 R01~R10 — 마스터 데이터 사슬(AnimalType→Taxon→CareProfile→SupplyRequirement→SupplyItem) 무결성.
import { ORDER_HINTS, PRIORITIES } from '../engine/domain.js';
import { exprRefs, parseExpr } from '../engine/expr.js';
import { asRec, has, isNonEmptyStr, isSlotRow, type Rec } from './common.js';
import type { Ctx } from './context.js';
import { checkRuleSet } from './validate-structure.js';
import { speciesOf } from './validate-gates.js';

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const OVERRIDE_KEYS: Record<string, 'priority' | 'orderHint' | 'text' | 'text?' | 'rules'> = {
  priority: 'priority',
  orderHint: 'orderHint',
  notNowReason: 'text?',
  why: 'text',
  // D9 ②: 비어 있지 않은 문자열만(null 불허). 길이·문장·숫자 가드는 validate-why-short.ts W01·W02 가 override 에도 본다.
  whyShort: 'text',
  caution: 'text?',
  avoid: 'text?',
  searchKeyword: 'text?',
  minSpec: 'rules',
  recommendedSpec: 'rules',
};

function checkAnimalTypes(ctx: Ctx): void {
  const { out } = ctx;
  // R02: 별칭 전역 유일(대소문자 무시), 다른 동물의 displayName 과 충돌 금지.
  const aliasOwner = new Map<string, string>();
  const displayOwner = new Map<string, string>();
  for (const { rec, id } of ctx.rows.animalTypes) {
    if (isNonEmptyStr(rec.displayName)) displayOwner.set(rec.displayName.trim().toLowerCase(), id);
  }
  for (const { rec, id } of ctx.rows.animalTypes) {
    // R01
    if (rec.taxonId !== null && rec.taxonId !== undefined && !ctx.byId.taxa.has(rec.taxonId as string)) {
      out.error('R01', 'animalTypes', id, 'taxonId', `Taxon "${String(rec.taxonId)}" 없음`);
    }
    if (rec.careProfileId !== null && rec.careProfileId !== undefined && !ctx.byId.careProfiles.has(rec.careProfileId as string)) {
      out.error('R01', 'animalTypes', id, 'careProfileId', `CareProfile "${String(rec.careProfileId)}" 없음`);
    }
    if (rec.status === 'ACTIVE' && (!isNonEmptyStr(rec.taxonId) || !isNonEmptyStr(rec.careProfileId))) {
      out.error('R01', 'animalTypes', id, 'status', 'ACTIVE 동물은 taxonId·careProfileId 둘 다 필요');
    }
    // R01b(K-1 안 A): ACTIVE 동물의 대표 종(taxonId)은 그 CareProfile.taxonIds 안이어야 한다(법·사육 사슬 일치).
    //   Taxon 없음(R01)·taxonIds 비었거나 전부 미존재(R04)는 그 규칙이 보고 — 연쇄 오류를 내지 않는다.
    if (rec.status === 'ACTIVE' && isNonEmptyStr(rec.taxonId) && isNonEmptyStr(rec.careProfileId) && ctx.byId.taxa.has(rec.taxonId)) {
      const profile = ctx.byId.careProfiles.get(rec.careProfileId);
      const taxonIds = profile ? strArr(profile.taxonIds).filter((t) => ctx.byId.taxa.has(t)) : [];
      if (taxonIds.length > 0 && !taxonIds.includes(rec.taxonId)) {
        out.error('R01b', 'animalTypes', id, 'taxonId', `Taxon "${rec.taxonId}" 가 ${rec.careProfileId}.taxonIds 에 없다(대표 종은 프로필의 종 중 하나)`);
      }
    }
    // R02
    if (!Array.isArray(rec.aliases) || rec.aliases.length === 0) {
      out.error('R02', 'animalTypes', id, 'aliases', '별칭은 비어 있지 않은 배열');
    } else {
      rec.aliases.forEach((a, i) => {
        if (!isNonEmptyStr(a)) return out.error('R02', 'animalTypes', id, `aliases[${i}]`, '빈 별칭');
        const k = a.trim().toLowerCase();
        const prev = aliasOwner.get(k);
        if (prev !== undefined) out.error('R02', 'animalTypes', id, `aliases[${i}]`, `별칭 "${a}" 중복(${prev})`);
        else aliasOwner.set(k, id);
        const d = displayOwner.get(k);
        if (d !== undefined && d !== id) out.error('R02', 'animalTypes', id, `aliases[${i}]`, `별칭 "${a}" 가 ${d} 의 displayName`);
      });
    }
    // R03
    checkOverrides(ctx, id, rec);
  }
}

function checkOverrides(ctx: Ctx, id: string, rec: Rec): void {
  const { out } = ctx;
  const co = asRec(rec.careOverrides);
  if (!co) return; // S03 이 보고.
  for (const k of Object.keys(co)) {
    if (k !== 'requirements') out.error('R03', 'animalTypes', id, `careOverrides.${k}`, 'careOverrides 는 { requirements } 만(A-11)');
  }
  if (!has(co, 'requirements')) return;
  const reqs = asRec(co.requirements);
  if (!reqs) {
    out.error('R03', 'animalTypes', id, 'careOverrides.requirements', '객체(supplyItemId → override)');
    return;
  }
  const profile = rec.careProfileId;
  for (const [itemId, v] of Object.entries(reqs)) {
    const p = `careOverrides.requirements.${itemId}`;
    if (!isNonEmptyStr(profile) || !ctx.reqPairs.has(`${profile}|${itemId}`)) {
      out.error('R03', 'animalTypes', id, p, `기본 요구사항(${String(profile)}, ${itemId}) 없음 — override 는 수정만(A-11)`);
    }
    const o = asRec(v);
    if (!o) {
      out.error('R03', 'animalTypes', id, p, 'override 는 객체');
      continue;
    }
    for (const [k, val] of Object.entries(o)) {
      const kind = OVERRIDE_KEYS[k];
      if (!kind) {
        out.error('R03', 'animalTypes', id, `${p}.${k}`, `override 불가 키(허용: ${Object.keys(OVERRIDE_KEYS).join(', ')})`);
        continue;
      }
      if (kind === 'priority' && !(PRIORITIES as readonly string[]).includes(val as string)) {
        out.error('R03', 'animalTypes', id, `${p}.${k}`, `priority "${String(val)}"`);
      } else if (kind === 'orderHint' && !(ORDER_HINTS as readonly string[]).includes(val as string)) {
        out.error('R03', 'animalTypes', id, `${p}.${k}`, `orderHint "${String(val)}"`);
      } else if (kind === 'text' && !isNonEmptyStr(val)) {
        out.error('R03', 'animalTypes', id, `${p}.${k}`, '비어 있지 않은 문자열');
      } else if (kind === 'text?' && val !== null && typeof val !== 'string') {
        out.error('R03', 'animalTypes', id, `${p}.${k}`, 'string|null');
      } else if (kind === 'rules') {
        checkRuleSet(ctx, 'animalTypes', id, `${p}.${k}`, val, itemId);
      }
    }
  }
}

function checkProfilesAndItems(ctx: Ctx): void {
  const { out } = ctx;
  // R11(271 보안 LOW #5): Taxon 학명 유일 — 종(앞 두 단어) 기준, 종 형식이 아니면 trim 한 원문 기준. 같은 종을 두 행에 두면
  //   CareProfile.taxonIds·AnimalType.taxonId 가 가리키는 종이 어느 행인지 모호해진다(데이터 무결성 — 법 게이트 아님, X02 는 280 에서 제거).
  //   revisionOf 개정 행은 같은 종일 수 있어 제외.
  const speciesSeen = new Map<string, string>();
  for (const { rec, id } of ctx.rows.taxa) {
    if (rec.revisionOf !== null && rec.revisionOf !== undefined && !ctx.byId.taxa.has(rec.revisionOf as string)) {
      out.error('R04', 'taxa', id, 'revisionOf', `Taxon "${String(rec.revisionOf)}" 없음`);
    }
    if (rec.revisionOf !== null && rec.revisionOf !== undefined) continue;
    if (typeof rec.scientificName !== 'string' || rec.scientificName.trim() === '') continue; // 형식은 S03·V06 이 본다.
    const key = speciesOf(rec.scientificName) ?? rec.scientificName.trim();
    const prev = speciesSeen.get(key);
    if (prev !== undefined) out.error('R11', 'taxa', id, 'scientificName', `학명 "${key}" 중복 — ${prev}`);
    else speciesSeen.set(key, id);
  }
  for (const { rec, id } of ctx.rows.careProfiles) {
    const ids = strArr(rec.taxonIds);
    // 283(K-47c): 대형 앵무처럼 종이 아직 없는 「빈 묶음 프로필」은 DRAFT 이고 어느 AnimalType 도 쓰지 않을 때만 빈 taxonIds 를 허용한다.
    //   「참조」 = AnimalType·SupplyRequirement·CompatibilityRule·SetupBundle 의 careProfileId, CuratedProduct 의 careProfileIds.
    const referenced =
      ctx.rows.animalTypes.some((a) => a.rec.careProfileId === id) ||
      ctx.rows.supplyRequirements.some((a) => a.rec.careProfileId === id) ||
      ctx.rows.compatibilityRules.some((a) => a.rec.careProfileId === id) ||
      ctx.rows.setupBundles.some((a) => a.rec.careProfileId === id) ||
      ctx.rows.curatedProducts.some((a) => strArr(a.rec.careProfileIds).includes(id));
    const unusedDraftShell = rec.reviewStatus === 'DRAFT' && !referenced;
    if (ids.length === 0 && !unusedDraftShell) out.error('R04', 'careProfiles', id, 'taxonIds', '비어 있지 않은 Taxon id 배열(DRAFT·미참조 빈 묶음 프로필만 예외)');
    ids.forEach((t, i) => {
      if (!ctx.byId.taxa.has(t)) out.error('R04', 'careProfiles', id, `taxonIds[${i}]`, `Taxon "${t}" 없음`);
    });
  }
  for (const { rec, id } of ctx.rows.supplyItems) {
    strArr(rec.compatibleAlternativeIds).forEach((a, i) => {
      if (a === id) out.error('R05', 'supplyItems', id, `compatibleAlternativeIds[${i}]`, '자기 자신을 대안으로 둘 수 없다');
      else if (!ctx.byId.supplyItems.has(a)) out.error('R05', 'supplyItems', id, `compatibleAlternativeIds[${i}]`, `SupplyItem "${a}" 없음`);
    });
  }
  const pairs = new Map<string, string>();
  for (const { rec, id } of ctx.rows.supplyRequirements) {
    if (!ctx.byId.careProfiles.has(rec.careProfileId as string)) {
      out.error('R06', 'supplyRequirements', id, 'careProfileId', `CareProfile "${String(rec.careProfileId)}" 없음`);
    }
    if (!ctx.byId.supplyItems.has(rec.supplyItemId as string)) {
      out.error('R06', 'supplyRequirements', id, 'supplyItemId', `SupplyItem "${String(rec.supplyItemId)}" 없음`);
    }
    const pair = `${String(rec.careProfileId)}|${String(rec.supplyItemId)}`;
    const prev = pairs.get(pair);
    if (prev !== undefined) out.error('R06', 'supplyRequirements', id, '', `(careProfileId, supplyItemId) 중복 — ${prev}`);
    else pairs.set(pair, id);
  }
}

/** R07 구조 부분. expr 파싱·참조·enum 리터럴 오류는 validate-engine.ts checkExprs(R2-6). R07b 는 순수 파서(engine/expr.ts)만 쓴다. */
function checkCompat(ctx: Ctx): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.compatibilityRules) {
    for (const side of ['a', 'b'] as const) {
      if (!ctx.byId.supplyItems.has(rec[side] as string)) out.error('R07', 'compatibilityRules', id, side, `SupplyItem "${String(rec[side])}" 없음`);
    }
    if (rec.a === rec.b) out.error('R07', 'compatibilityRules', id, 'b', 'a 와 b 가 같다');
    if (rec.careProfileId !== null && rec.careProfileId !== undefined && !ctx.byId.careProfiles.has(rec.careProfileId as string)) {
      out.error('R07', 'compatibilityRules', id, 'careProfileId', `CareProfile "${String(rec.careProfileId)}" 없음`);
    }
    if (!Array.isArray(rec.rules) || rec.rules.length === 0) {
      out.error('R07', 'compatibilityRules', id, 'rules', '비어 있지 않은 배열');
      continue;
    }
    rec.rules.forEach((x, i) => {
      const r = asRec(x);
      const p = `rules[${i}]`;
      if (!r) return out.error('R07', 'compatibilityRules', id, p, '객체');
      if (!isNonEmptyStr(r.expr)) out.error('R07', 'compatibilityRules', id, `${p}.expr`, 'expr 이 비었다');
      if (r.onFail !== 'BELOW_MIN' && r.onFail !== 'CHECK') out.error('S03', 'compatibilityRules', id, `${p}.onFail`, 'BELOW_MIN/CHECK 중 하나');
      if (!isNonEmptyStr(r.message)) out.error('R07', 'compatibilityRules', id, `${p}.message`, 'message 가 비었다');
      for (const k of Object.keys(r)) if (!['expr', 'onFail', 'message'].includes(k)) out.warn('S09', 'compatibilityRules', id, `${p}.${k}`, '알 수 없는 키');
    });
    if (!isNonEmptyStr(rec.careProfileId)) checkUnscopedCompat(ctx, id, rec.rules);
  }
}

/**
 * R07b(감사 54 #4): careProfileId 없는 호환 규칙은 모든 프로필에 적용된다 —
 *   (1) message 에 특정 동물 표시명·별칭이 있으면 ERROR(다른 동물에게 그 동물 문구가 노출된다),
 *   (2) 모든 expr 이 a.* 또는 b.* 한쪽만 참조하면 WARN(쌍 규칙이 아니라 단일 용품 기준 — 최소 규격으로 옮길 것).
 *   expr 문법 오류는 checkExprs(R07)가 보고하므로 여기선 건너뛴다.
 */
function checkUnscopedCompat(ctx: Ctx, id: string, rules: unknown[]): void {
  const { out } = ctx;
  const names: Array<{ name: string; owner: string }> = [];
  for (const { rec: t, id: owner } of ctx.rows.animalTypes) {
    for (const n of [t.displayName, ...(Array.isArray(t.aliases) ? t.aliases : [])]) {
      if (isNonEmptyStr(n)) names.push({ name: n.trim().toLowerCase(), owner });
    }
  }
  const sides = new Set<'a' | 'b'>();
  let parsedAll = true;
  rules.forEach((x, i) => {
    const r = asRec(x);
    if (!r) return;
    if (isNonEmptyStr(r.message)) {
      const msg = r.message.toLowerCase();
      const hit = names.find((n) => msg.includes(n.name));
      if (hit) {
        out.error('R07b', 'compatibilityRules', id, `rules[${i}].message`, `프로필 범위 없는 규칙의 문구에 동물명 "${hit.name}"(${hit.owner}) — careProfileId 로 범위를 지정할 것`);
      }
    }
    if (!isNonEmptyStr(r.expr)) {
      parsedAll = false;
      return;
    }
    try {
      const refs = exprRefs(parseExpr(r.expr));
      if (refs.a.length > 0) sides.add('a');
      if (refs.b.length > 0) sides.add('b');
    } catch {
      parsedAll = false;
    }
  });
  if (parsedAll && sides.size === 1) {
    const only = [...sides][0];
    out.warn('R07b', 'compatibilityRules', id, 'rules', `모든 expr 이 ${only}.* 만 참조 — 쌍 규칙이 아니라 단일 용품 기준이다(최소 규격으로 옮길 것)`);
  }
}

function checkBundles(ctx: Ctx): void {
  const { out } = ctx;
  const tiers = new Map<string, string>();
  for (const { rec, id } of ctx.rows.setupBundles) {
    const profile = rec.careProfileId as string;
    if (!ctx.byId.careProfiles.has(profile)) out.error('R08', 'setupBundles', id, 'careProfileId', `CareProfile "${String(profile)}" 없음`);
    const t = `${String(profile)}|${String(rec.tier)}`;
    const prev = tiers.get(t);
    if (prev !== undefined) out.error('R08', 'setupBundles', id, 'tier', `(careProfileId, tier) 중복 — ${prev}`);
    else tiers.set(t, id);
    const items = strArr(rec.itemIds);
    if (items.length === 0) out.error('R08', 'setupBundles', id, 'itemIds', '비어 있지 않은 배열');
    const seen = new Set<string>();
    items.forEach((it, i) => {
      const p = `itemIds[${i}]`;
      if (seen.has(it)) out.error('R08', 'setupBundles', id, p, `"${it}" 중복`);
      seen.add(it);
      if (!ctx.byId.supplyItems.has(it)) out.error('R08', 'setupBundles', id, p, `SupplyItem "${it}" 없음`);
      else if (!ctx.reqPairs.has(`${profile}|${it}`)) out.error('R08', 'setupBundles', id, p, `"${it}" 에 대한 ${profile} 요구사항 없음`);
    });
  }
}

/** specValues 를 스키마에 대조(R09). 문제 목록. */
export function specValueProblems(schema: Map<string, Rec>, values: Rec): string[] {
  const probs: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    const f = schema.get(k);
    if (!f) {
      probs.push(`"${k}" 는 specSchema 에 없다`);
      continue;
    }
    if (f.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) probs.push(`"${k}" 는 숫자: ${JSON.stringify(v)}`);
      else if (v < (f.min as number) || v > (f.max as number)) probs.push(`"${k}"=${v} 는 범위 ${String(f.min)}~${String(f.max)} 밖`);
    } else if (f.type === 'boolean') {
      if (typeof v !== 'boolean') probs.push(`"${k}" 는 boolean: ${JSON.stringify(v)}`);
    } else if (f.type === 'enum') {
      if (typeof v !== 'string' || !(f.options as string[]).includes(v)) probs.push(`"${k}" 는 options 중 하나: ${JSON.stringify(v)}`);
    }
  }
  return probs;
}

function checkProducts(ctx: Ctx): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.curatedProducts) {
    const itemId = rec.supplyItemId as string;
    const itemOk = ctx.byId.supplyItems.has(itemId);
    if (!itemOk) out.error('R09', 'curatedProducts', id, 'supplyItemId', `SupplyItem "${String(itemId)}" 없음`);
    const profiles = strArr(rec.careProfileIds);
    if (profiles.length === 0) out.error('R09', 'curatedProducts', id, 'careProfileIds', '비어 있지 않은 배열');
    profiles.forEach((p, i) => {
      if (!ctx.byId.careProfiles.has(p)) out.error('R09', 'curatedProducts', id, `careProfileIds[${i}]`, `CareProfile "${p}" 없음`);
      else if (itemOk && !ctx.reqPairs.has(`${p}|${itemId}`)) out.error('R09', 'curatedProducts', id, `careProfileIds[${i}]`, `${p} 에 "${itemId}" 요구사항 없음`);
    });
    if (isSlotRow('curatedProducts', rec)) continue;
    const schema = ctx.schemas.get(itemId);
    const values = asRec(rec.specValues);
    if (schema && values) {
      for (const m of specValueProblems(schema, values)) out.error('R09', 'curatedProducts', id, 'specValues', m);
    }
  }
}

function checkPeopleRefs(ctx: Ctx): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.testimonials) {
    if (!ctx.byId.animalTypes.has(rec.animalTypeId as string)) out.error('R10', 'testimonials', id, 'animalTypeId', `AnimalType "${String(rec.animalTypeId)}" 없음`);
  }
  for (const { rec, id } of ctx.rows.vetClinics) {
    strArr(rec.treats).forEach((t, i) => {
      if (!ctx.byId.animalTypes.has(t)) out.error('R10', 'vetClinics', id, `treats[${i}]`, `AnimalType "${t}" 없음`);
    });
  }
  const slots = new Map<string, string>();
  for (const { rec, id } of ctx.rows.photos) {
    if (!isNonEmptyStr(rec.slot)) continue;
    const prev = slots.get(rec.slot);
    if (prev !== undefined) out.error('R10', 'photos', id, 'slot', `slot "${rec.slot}" 중복 — ${prev}`);
    else slots.set(rec.slot, id);
  }
}

export function checkRefs(ctx: Ctx): void {
  checkAnimalTypes(ctx);
  checkProfilesAndItems(ctx);
  checkCompat(ctx);
  checkBundles(ctx);
  checkProducts(ctx);
  checkPeopleRefs(ctx);
}
