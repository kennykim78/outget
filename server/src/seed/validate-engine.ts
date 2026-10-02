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
  isTestimonialExposable,
  isVetListed,
  listResolvedRequirements,
  parseExpr,
  type SpecValues,
} from '../engine/index.js';
import { asRec, asSeedBundle, isNonEmptyStr, type RawSeed } from './common.js';
import type { Ctx } from './context.js';
import type { MeetsMinSpecFn } from './validate-products.js';

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
 * 노출 요약 + W-EXPOSURE-ZERO(A-13). 판정은 engine/exposure.ts 만(A-6).
 *   types = isAnimalTypeExposable, requirements = ACTIVE 타입별 노출 요구사항 합,
 *   products = 노출 타입 중 하나 이상에서 isProductExposable(cat, typeId, p)(M2·M3).
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
    const n = listResolvedRequirements(cat, at.id).filter((r) => isRequirementExposable(cat, r)).length;
    summary.requirements += n;
    if (isAnimalTypeExposable(cat, at.id)) exposedTypeIds.push(at.id);
    if (n === 0) {
      const msg = 'VERIFIED 0건 — 노출 0 (ACTIVE 동물의 노출 가능한 요구사항 없음)';
      if (ctx.strict) ctx.out.error('W-EXPOSURE-ZERO', 'animalTypes', at.id, '', msg);
      else ctx.out.warn('W-EXPOSURE-ZERO', 'animalTypes', at.id, '', msg);
    }
  }
  summary.types = exposedTypeIds.length;
  summary.products = bundle.curatedProducts.filter((p) =>
    exposedTypeIds.some((typeId) => isProductExposable(cat, typeId, p)),
  ).length;
  summary.testimonials = bundle.testimonials.filter((t) => isTestimonialExposable(t)).length;
  summary.vets = bundle.vetClinics.filter((v) => isVetListed(v)).length;
  return summary;
}
