// seed:validate 코어 — validateSeed(raw, {now, strict}) → { errors, warnings, summary }. 순수(fs·시계 없음).
//   규칙 표: _workspace/04_architect_r2_plan.md §F. 출력 형식은 cli-validate.ts.
import { Collector, type Issue, type RawSeed } from './common.js';
import { buildCtx, type ValidateOptions } from './context.js';
import { checkCompatMinRecMix, checkCompatOr, checkCompatOwnedProbe } from './validate-compat-quality.js';
import { lintRecord } from './lint.js';
import { checkExposure, checkExprs, checkOptionLabels, checkRuleScoped, meetsMinSpecFn, specRefersFn, type ExposureSummary } from './validate-engine.js';
import { checkPublishGates } from './validate-gates.js';
import { checkPeople } from './validate-people.js';
import { checkProducts } from './validate-products.js';
import { checkPromotion } from './validate-promotion.js';
import { checkRefs } from './validate-refs.js';
import { checkReview } from './validate-review.js';
import { checkSlugs } from './validate-slug.js';
import { checkSignatures } from './signatures.js';
import { checkStructure } from './validate-structure.js';
import { checkTips } from './validate-tips.js';
import { checkWhyShort } from './validate-why-short.js';
import { SEED_KEYS } from './common.js';

export type { ValidateOptions } from './context.js';
export type { ExposureSummary } from './validate-engine.js';

export interface ValidateResult {
  errors: Issue[];
  warnings: Issue[];
  summary: ExposureSummary;
}

export function validateSeed(raw: RawSeed, opts: ValidateOptions): ValidateResult {
  const out = new Collector();
  const ctx = buildCtx(raw, opts, out);

  checkStructure(ctx);
  checkRefs(ctx);
  checkExprs(ctx);
  checkCompatOr(ctx);
  checkReview(ctx);
  checkWhyShort(ctx);
  checkSignatures(ctx, opts.signatures);
  checkPromotion(ctx);
  checkSlugs(ctx);
  // P01 재계산은 구조·참조 오류가 없을 때만 엔진에 맡긴다(깨진 입력으로 엔진을 돌리지 않는다).
  const structurallySound = !out.issues.some((i) => i.severity === 'ERROR');
  checkProducts(ctx, structurallySound ? meetsMinSpecFn(raw) : null, structurallySound ? specRefersFn(raw) : null);
  checkPeople(ctx);
  // V-TIP-0~5·K(저렴 대체 팁, Kenny 2026-11-22). V-TIP-3 엔진 판정은 구조·참조가 온전할 때만.
  checkTips(ctx, raw, structurallySound);
  for (const key of SEED_KEYS) {
    for (const { rec, id } of ctx.rows[key]) lintRecord(key, id, rec, out);
  }
  const summary = checkExposure(ctx, raw, !out.issues.some((i) => i.severity === 'ERROR'));
  if (!out.issues.some((i) => i.severity === 'ERROR')) checkOptionLabels(ctx, raw);
  if (!out.issues.some((i) => i.severity === 'ERROR')) checkRuleScoped(ctx, raw);
  // R07c(작업 192) — 보유품 의존성 탐침. 엔진 평가기로만, 구조·참조가 온전할 때만.
  if (!out.issues.some((i) => i.severity === 'ERROR')) checkCompatOwnedProbe(ctx, raw);
  // R07e(작업 219) — 최소·권장 키 혼합 `&&`·`||`. 엔진 키 판별로만, 구조·참조가 온전할 때만.
  if (!out.issues.some((i) => i.severity === 'ERROR')) checkCompatMinRecMix(ctx, raw);
  // X01(공개 게이트, X02 법 게이트는 280 에서 제거) — 구조·참조가 온전할 때만 엔진 노출 판정으로.
  if (structurallySound) checkPublishGates(ctx, raw);

  return {
    errors: out.issues.filter((i) => i.severity === 'ERROR'),
    warnings: out.issues.filter((i) => i.severity === 'WARN'),
    summary,
  };
}
