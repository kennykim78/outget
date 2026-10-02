// seed:validate 코어 — validateSeed(raw, {now, strict}) → { errors, warnings, summary }. 순수(fs·시계 없음).
//   규칙 표: _workspace/04_architect_r2_plan.md §F. 출력 형식은 cli-validate.ts.
import { Collector, type Issue, type RawSeed } from './common.js';
import { buildCtx, type ValidateOptions } from './context.js';
import { lintRecord } from './lint.js';
import { checkExposure, checkExprs, meetsMinSpecFn, type ExposureSummary } from './validate-engine.js';
import { checkPeople } from './validate-people.js';
import { checkProducts } from './validate-products.js';
import { checkRefs } from './validate-refs.js';
import { checkReview } from './validate-review.js';
import { checkSlugs } from './validate-slug.js';
import { checkStructure } from './validate-structure.js';
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
  checkReview(ctx);
  checkSlugs(ctx);
  // P01 재계산은 구조·참조 오류가 없을 때만 엔진에 맡긴다(깨진 입력으로 엔진을 돌리지 않는다).
  const structurallySound = !out.issues.some((i) => i.severity === 'ERROR');
  checkProducts(ctx, structurallySound ? meetsMinSpecFn(raw) : null);
  checkPeople(ctx);
  for (const key of SEED_KEYS) {
    for (const { rec, id } of ctx.rows[key]) lintRecord(key, id, rec, out);
  }
  const summary = checkExposure(ctx, raw, !out.issues.some((i) => i.severity === 'ERROR'));

  return {
    errors: out.issues.filter((i) => i.severity === 'ERROR'),
    warnings: out.issues.filter((i) => i.severity === 'WARN'),
    summary,
  };
}
