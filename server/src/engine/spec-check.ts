// specCheck(+호환 판정)·checkProfileMinSpec·checkAnimalMinSpec·createEngine (제품기획 §7.2, PRD US-009/011, 부록 A).
//   제품 단계: resolveRequirement 결과(override 반영)의 min/recommended 규칙.
//   호환 단계: userContext.ownedItems 와 CompatibilityRule 양방향(A-10). UNKNOWN → CHECK(onFail 무관).
//   종합 verdict = worst(product, compat≠NONE). 대안은 verdict≠OK 일 때만.
import type { Verdict } from './domain.js';
import { ExprSyntaxError, evalExpr, parseExpr } from './expr.js';
import { evaluateProductStage, sanitizeSpecValues, worstVerdict } from './rules.js';
import { listResolvedRequirements, resolveRequirement } from './resolve.js';
import { buildSearchKeyword } from './search-keyword.js';
import type {
  Alternative,
  AnimalTypeRec,
  CompatVerdict,
  EngineCatalog,
  Reason,
  ResolvedRequirement,
  SpecCheckResult,
  SpecValues,
  UserContext,
} from './types.js';

export class EngineLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineLookupError';
  }
}

function owned(ctx: UserContext | undefined, itemId: string): SpecValues | undefined {
  const items = ctx?.ownedItems;
  if (!items || typeof items !== 'object' || !Object.prototype.hasOwnProperty.call(items, itemId)) return undefined;
  const v = items[itemId];
  return v !== null && typeof v === 'object' ? v : undefined;
}

function evaluateCompat(
  cat: EngineCatalog,
  careProfileId: string,
  supplyItemId: string,
  input: SpecValues,
  ctx: UserContext | undefined,
): SpecCheckResult['compat'] {
  const reasons: Reason[] = [];
  const checkedRuleIds: string[] = [];
  if (!ctx) return { verdict: 'NONE', reasons, checkedRuleIds };

  for (const rule of cat.compatibilityRules) {
    if (rule.careProfileId && rule.careProfileId !== careProfileId) continue;
    let aRaw: SpecValues | undefined;
    let bRaw: SpecValues | undefined;
    if (rule.a === supplyItemId && rule.b !== supplyItemId && owned(ctx, rule.b)) {
      aRaw = input;
      bRaw = owned(ctx, rule.b);
    } else if (rule.b === supplyItemId && rule.a !== supplyItemId && owned(ctx, rule.a)) {
      aRaw = owned(ctx, rule.a);
      bRaw = input;
    } else continue;

    const aSchema = cat.supplyItems.get(rule.a)?.specSchema ?? { fields: [] };
    const bSchema = cat.supplyItems.get(rule.b)?.specSchema ?? { fields: [] };
    const env = { a: sanitizeSpecValues(aSchema, aRaw ?? {}), b: sanitizeSpecValues(bSchema, bRaw ?? {}) };
    checkedRuleIds.push(rule.id);

    (Array.isArray(rule.rules) ? rule.rules : []).forEach((entry, i) => {
      let result: ReturnType<typeof evalExpr>;
      try {
        result = evalExpr(parseExpr(entry.expr), env);
      } catch (e) {
        if (!(e instanceof ExprSyntaxError)) throw e;
        result = 'UNKNOWN';
      }
      if (result === true) return;
      const verdict: Verdict = result === false && entry.onFail === 'BELOW_MIN' ? 'BELOW_MIN' : 'CHECK';
      reasons.push({ stage: 'COMPAT', kind: 'RULE', verdict, ruleId: `${rule.id}#${i}`, message: entry.message });
    });
  }

  if (checkedRuleIds.length === 0) return { verdict: 'NONE', reasons, checkedRuleIds };
  return { verdict: worstVerdict(reasons.map((r) => r.verdict)) as CompatVerdict, reasons, checkedRuleIds };
}

function alternativesFor(cat: EngineCatalog, r: ResolvedRequirement): Alternative[] {
  const out: Alternative[] = [];
  for (const id of r.item.compatibleAlternativeIds) {
    const it = cat.supplyItems.get(id);
    if (it && id !== r.supplyItemId) out.push({ supplyItemId: it.id, name: it.name });
  }
  return out;
}

/** 규격 판정. 알 수 없는 id·프로필 없는 동물·요구사항 없는 항목 → EngineLookupError. */
export function specCheck(
  cat: EngineCatalog,
  animalTypeId: string,
  supplyItemId: string,
  input: SpecValues,
  userContext?: UserContext,
): SpecCheckResult {
  const r = resolveRequirement(cat, animalTypeId, supplyItemId);
  if (!r) throw new EngineLookupError(`no requirement for ${animalTypeId} × ${supplyItemId}`);
  const product = evaluateProductStage(r.item.specSchema, r.minSpec, r.recommendedSpec, input ?? {});
  const compat = evaluateCompat(cat, r.careProfileId, supplyItemId, input ?? {}, userContext);
  const verdict = worstVerdict(compat.verdict === 'NONE' ? [product.verdict] : [product.verdict, compat.verdict]);
  return {
    verdict,
    product,
    compat,
    reasons: [...product.reasons, ...compat.reasons],
    alternatives: verdict === 'OK' ? [] : alternativesFor(cat, r),
  };
}

export interface MinSpecResult {
  meets: boolean;
  verdict: Verdict;
  reasons: Reason[];
}

function noCriteria(): MinSpecResult {
  return {
    meets: false,
    verdict: 'CHECK',
    reasons: [
      { stage: 'PRODUCT', kind: 'RULE', verdict: 'CHECK', message: '이 용품의 규격 기준을 찾을 수 없어 확인이 필요해요.' },
    ],
  };
}

function minSpecResult({ verdict, reasons }: { verdict: Verdict; reasons: Reason[] }): MinSpecResult {
  return { meets: verdict === 'OK' || verdict === 'BELOW_RECOMMENDED', verdict, reasons };
}

/**
 * CuratedProduct.meetsMinSpec 의 단일 계산 지점(불변식 3, A-12). 프로필 기본 요구사항만(override 없음),
 * 제품 단계만. meets = verdict ∈ {OK, BELOW_RECOMMENDED}. 기준을 찾지 못하면 throw 대신 CHECK/false(fail-closed).
 */
export function checkProfileMinSpec(
  cat: EngineCatalog,
  careProfileId: string,
  supplyItemId: string,
  specValues: SpecValues,
): MinSpecResult {
  const item = cat.supplyItems.get(supplyItemId);
  const base = cat.careProfiles.has(careProfileId)
    ? cat.requirementsByProfile.get(careProfileId)?.get(supplyItemId)
    : undefined;
  if (!item || !base) return noCriteria();
  return minSpecResult(evaluateProductStage(item.specSchema, base.minSpec, base.recommendedSpec, specValues ?? {}));
}

/**
 * 동물별 최소 규격(M3) — resolveRequirement 결과(careOverrides 반영)의 제품 단계만. 노출 판정(isProductExposable)의
 * 규격 기준. meets = verdict ∈ {OK, BELOW_RECOMMENDED}. 기준을 찾지 못하면 throw 대신 CHECK/false(fail-closed).
 */
export function checkAnimalMinSpec(
  cat: EngineCatalog,
  animalTypeId: string,
  supplyItemId: string,
  specValues: SpecValues,
): MinSpecResult {
  const r = resolveRequirement(cat, animalTypeId, supplyItemId);
  if (!r) return noCriteria();
  return minSpecResult(evaluateProductStage(r.item.specSchema, r.minSpec, r.recommendedSpec, specValues ?? {}));
}

export interface Engine {
  resolveRequirement(animalTypeId: string, supplyItemId: string): ResolvedRequirement | null;
  listResolvedRequirements(animalTypeId: string): ResolvedRequirement[];
  specCheck(animalTypeId: string, supplyItemId: string, input: SpecValues, userContext?: UserContext): SpecCheckResult;
  /** animalType: id 또는 { displayName }. 알 수 없는 id → EngineLookupError. */
  buildSearchKeyword(animalType: string | Pick<AnimalTypeRec, 'displayName'>, r: ResolvedRequirement): string;
}

/** 카탈로그를 묶은 §7.2 시그니처. */
export function createEngine(cat: EngineCatalog): Engine {
  return {
    resolveRequirement: (a, s) => resolveRequirement(cat, a, s),
    listResolvedRequirements: (a) => listResolvedRequirements(cat, a),
    specCheck: (a, s, input, ctx) => specCheck(cat, a, s, input, ctx),
    buildSearchKeyword: (a, r) => {
      if (typeof a !== 'string') return buildSearchKeyword(a, r);
      const at = cat.animalTypes.get(a);
      if (!at) throw new EngineLookupError(`unknown animal type ${a}`);
      return buildSearchKeyword(at, r);
    },
  };
}
