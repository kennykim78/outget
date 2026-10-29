// 엔진 연결(R2-6) — R07 expr 검사, P01 meetsMinSpec 재계산기, 노출 요약 + W-EXPOSURE-ZERO.
//   판정 로직은 engine/ 에만 있다. 여기선 호출·보고만.
import {
  checkProfileMinSpec,
  createCatalog,
  exprComparedLiterals,
  exprRefs,
  isAnimalTypeExposable,
  isProductExposable,
  isRequirementExposable,
  isTestimonialPublic,
  isVetListed,
  listResolvedRequirements,
  optionLabel,
  parseExpr,
  referencedSpecKeys,
  resolveRequirement,
  type SpecValues,
} from '../engine/index.js';
import { asRec, asSeedBundle, isNonEmptyStr, type RawSeed } from './common.js';
import type { Ctx } from './context.js';
import type { MeetsMinSpecFn, SpecRefersFn } from './validate-products.js';

export interface ExposureSummary {
  types: number;
  requirements: number;
  products: number;
  testimonials: number;
  vets: number;
}

/** R07 — expr 파싱(화이트리스트), a.k/b.k 가 각 용품 스키마에 있는지, enum 비교 리터럴이 options 안인지. */
export function checkExprs(ctx: Ctx): void {
  for (const { rec, id } of ctx.rows.compatibilityRules) {
    if (!Array.isArray(rec.rules)) continue;
    const schemas = { a: ctx.schemas.get(rec.a as string), b: ctx.schemas.get(rec.b as string) };
    rec.rules.forEach((x, i) => {
      const r = asRec(x);
      if (!r || !isNonEmptyStr(r.expr)) return;
      const p = `rules[${i}].expr`;
      let node;
      try {
        node = parseExpr(r.expr);
      } catch (e) {
        ctx.out.error('R07', 'compatibilityRules', id, p, `expr 문법 오류: ${(e as Error).message}`);
        return;
      }
      const refs = exprRefs(node);
      for (const side of ['a', 'b'] as const) {
        const schema = schemas[side];
        if (!schema) continue; // 용품 없음은 R07 구조 검사가 보고.
        for (const k of refs[side]) {
          if (!schema.has(k)) ctx.out.error('R07', 'compatibilityRules', id, p, `${side}.${k} 는 ${String(rec[side])} specSchema 에 없다`);
        }
      }
      for (const { side, key, literal } of exprComparedLiterals(node)) {
        const f = schemas[side]?.get(key);
        if (f?.type === 'enum' && !(f.options as string[]).includes(literal)) {
          ctx.out.error('R07', 'compatibilityRules', id, p, `${side}.${key} 와 비교하는 '${literal}' 는 options(${(f.options as string[]).join('/')}) 밖`);
        }
      }
    });
  }
}

/** P01 재계산기 — engine.checkProfileMinSpec(프로필별, override 없음, A-12). 구조 오류가 없을 때만 호출된다. */
export function meetsMinSpecFn(raw: RawSeed): MeetsMinSpecFn {
  const cat = createCatalog(asSeedBundle(raw));
  return (careProfileId, supplyItemId, specValues) =>
    checkProfileMinSpec(cat, careProfileId, supplyItemId, specValues as SpecValues).meets;
}

/**
 * P06 참조 판정기(154 B안 · 173 확장) — 프로필 careProfileId 의 (supplyItemId) 규칙이 필드 key 를 규칙 key 또는
 *   when key 로 참조하는지, minSpec·recommendedSpec 따로. 참조 집합 = 합집합(보수):
 *     ① 프로필 기본 요구사항(override 없음 — P01 재계산 checkProfileMinSpec 과 같은 단위)
 *     ② 그 프로필을 쓰는 모든 AnimalType(상태 무관)의 resolveRequirement 결과(careOverrides 반영 — 노출 판정 단위)
 *   최종값은 engine.resolveRequirement 한 곳(불변식 6), key 수집은 engine.referencedSpecKeys(L5 표시와 같은 헬퍼).
 */
export function specRefersFn(raw: RawSeed): SpecRefersFn {
  const cat = createCatalog(asSeedBundle(raw));
  return (careProfileId, supplyItemId, key) => {
    const base = cat.requirementsByProfile.get(careProfileId)?.get(supplyItemId);
    const min = [base?.minSpec];
    const rec = [base?.recommendedSpec];
    for (const at of cat.animalTypes.values()) {
      if (at.careProfileId !== careProfileId) continue;
      const r = resolveRequirement(cat, at.id, supplyItemId);
      if (r) {
        min.push(r.minSpec);
        rec.push(r.recommendedSpec);
      }
    }
    return { minSpec: referencedSpecKeys(...min).has(key), recommendedSpec: referencedSpecKeys(...rec).has(key) };
  };
}

/**
 * 노출 요약 + W-EXPOSURE-ZERO(A-13). 판정은 engine/exposure.ts 만(A-6).
 *   types = isAnimalTypeExposable, requirements = ACTIVE 타입별 노출 요구사항 합,
 *   products = 노출 타입 중 하나 이상에서 isProductExposable(cat, typeId, p)(M2·M3).
 * 기준일 = ctx.now(--now) — 검수 나이(M-1) 반영, 프리렌더와 같은 기준.
 * 구조·참조 오류가 있으면 엔진을 돌리지 않고 0 을 보고한다(어차피 exit 1).
 */
export function checkExposure(ctx: Ctx, raw: RawSeed, sound: boolean): ExposureSummary {
  const summary: ExposureSummary = { types: 0, requirements: 0, products: 0, testimonials: 0, vets: 0 };
  if (!sound) return summary;
  const bundle = asSeedBundle(raw);
  const cat = createCatalog(bundle);
  const exposedTypeIds: string[] = [];
  for (const at of bundle.animalTypes) {
    if (at.status !== 'ACTIVE') continue;
    const n = listResolvedRequirements(cat, at.id).filter((r) => isRequirementExposable(cat, r, ctx.now)).length;
    summary.requirements += n;
    if (isAnimalTypeExposable(cat, at.id, ctx.now)) exposedTypeIds.push(at.id);
    if (n === 0) {
      const msg = 'VERIFIED 0건 — 노출 0 (ACTIVE 동물의 노출 가능한 요구사항 없음)';
      if (ctx.strict) ctx.out.error('W-EXPOSURE-ZERO', 'animalTypes', at.id, '', msg);
      else ctx.out.warn('W-EXPOSURE-ZERO', 'animalTypes', at.id, '', msg);
    }
  }
  summary.types = exposedTypeIds.length;
  summary.products = bundle.curatedProducts.filter((p) =>
    exposedTypeIds.some((typeId) => isProductExposable(cat, typeId, p, ctx.now)),
  ).length;
  summary.testimonials = bundle.testimonials.filter((t) => isTestimonialPublic(cat, t, ctx.now)).length;
  summary.vets = bundle.vetClinics.filter((v) => isVetListed(v)).length;
  return summary;
}

/**
 * W-OPTLABEL(스펙22 §4-3 G7) — enum 표시 라벨 게이트. 원시 코드는 화면에 나가지 않으므로(optionLabel 단일 헬퍼),
 *   라벨이 빠지면 노출 화면에서 조건 행·규격 항목·L5 필드가 사라진다.
 *   ERROR: 노출 요구사항(해석 후 minSpec·recommendedSpec, when 포함)이 조건으로 쓰는 enum 필드의 option 중 라벨 없는 것
 *          (L5 가 그 필드를 렌더하지 못해 판정이 CHECK 로 막힌다) · 노출 상품 specValues 의 enum 값에 라벨 없음.
 *   WARN : 그 밖의 라벨 없는 option(필드당 1건).
 */
export function checkOptionLabels(ctx: Ctx, raw: RawSeed): void {
  const bundle = asSeedBundle(raw);
  const cat = createCatalog(bundle);
  const exposedTypeIds = bundle.animalTypes.filter((at) => isAnimalTypeExposable(cat, at.id, ctx.now)).map((at) => at.id);
  /** itemId → 조건으로 쓰인 필드 키. */
  const condKeys = new Map<string, Set<string>>();
  /** itemId|key → 노출 상품이 쓰는 값. */
  const productValues = new Map<string, Set<string>>();
  for (const typeId of exposedTypeIds) {
    for (const r of listResolvedRequirements(cat, typeId)) {
      if (!isRequirementExposable(cat, r, ctx.now)) continue;
      const keys = condKeys.get(r.supplyItemId) ?? new Set<string>();
      for (const rule of [...r.minSpec.rules, ...r.recommendedSpec.rules]) {
        keys.add(rule.key);
        for (const w of Array.isArray(rule.when) ? rule.when : []) keys.add(w.key);
      }
      condKeys.set(r.supplyItemId, keys);
    }
  }
  for (const p of bundle.curatedProducts) {
    if (!exposedTypeIds.some((typeId) => isProductExposable(cat, typeId, p, ctx.now))) continue;
    for (const [k, v] of Object.entries(asRec(p.specValues) ?? {})) {
      if (typeof v !== 'string') continue;
      const key = `${p.supplyItemId}|${k}`;
      productValues.set(key, (productValues.get(key) ?? new Set<string>()).add(v));
    }
  }
  for (const item of bundle.supplyItems) {
    const fields = Array.isArray(item.specSchema?.fields) ? item.specSchema.fields : [];
    for (const f of fields) {
      if (f.type !== 'enum' || !Array.isArray(f.options)) continue;
      const missing = f.options.filter((o) => optionLabel(f, o) === null);
      if (missing.length === 0) continue;
      const path = `specSchema.${f.key}.optionLabels`;
      if (condKeys.get(item.id)?.has(f.key)) {
        ctx.out.error('W-OPTLABEL', 'supplyItems', item.id, path, `노출 요구사항 조건이 쓰는 enum 필드 — 라벨 없는 값: ${missing.join(', ')}`);
        continue;
      }
      const used = [...(productValues.get(`${item.id}|${f.key}`) ?? [])].filter((v) => missing.includes(v));
      if (used.length > 0) {
        ctx.out.error('W-OPTLABEL', 'supplyItems', item.id, path, `노출 상품이 쓰는 enum 값에 라벨 없음: ${used.join(', ')}`);
        continue;
      }
      ctx.out.warn('W-OPTLABEL', 'supplyItems', item.id, path, `라벨 없는 enum 값(화면에 표시되지 않는다): ${missing.join(', ')}`);
    }
  }
}

/**
 * W-RULESCOPED(기니피그 S5, 계획 107) — ruleScoped 필드는 요구사항 규칙이 참조할 때만 L5 에 보인다(visibleSpecFields).
 *   어떤 요구사항도(시드 행 minSpec·recommendedSpec + 모든 AnimalType 의 해석 후 규칙 — careOverrides 포함, 노출 여부 무관,
 *   key·when key) 참조하지 않는 ruleScoped 필드는 어디에도 보이지 않는다 → WARN(필드당 1건). 게이트가 아니라 정리 신호.
 */
export function checkRuleScoped(ctx: Ctx, raw: RawSeed): void {
  const bundle = asSeedBundle(raw);
  const cat = createCatalog(bundle);
  /** itemId → 참조된 필드 키. */
  const refs = new Map<string, Set<string>>();
  const add = (itemId: string, keys: Set<string>): void => {
    const cur = refs.get(itemId) ?? new Set<string>();
    for (const k of keys) cur.add(k);
    refs.set(itemId, cur);
  };
  for (const r of bundle.supplyRequirements) add(r.supplyItemId, referencedSpecKeys(r.minSpec, r.recommendedSpec));
  for (const at of bundle.animalTypes) {
    for (const r of listResolvedRequirements(cat, at.id)) add(r.supplyItemId, referencedSpecKeys(r.minSpec, r.recommendedSpec));
  }
  for (const item of bundle.supplyItems) {
    const fields = Array.isArray(item.specSchema?.fields) ? item.specSchema.fields : [];
    for (const f of fields) {
      if (f.ruleScoped !== true || refs.get(item.id)?.has(f.key)) continue;
      ctx.out.warn('W-RULESCOPED', 'supplyItems', item.id, `specSchema.${f.key}`, 'ruleScoped 필드를 참조하는 요구사항 규칙이 없다(L5 어디에도 표시되지 않는다)');
    }
  }
}
