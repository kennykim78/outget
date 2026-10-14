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
  unknown: 'CHECK' | 'SKIP' = 'CHECK',
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
    let decided = 0;
    const ruleReasons: Reason[] = [];

    (Array.isArray(rule.rules) ? rule.rules : []).forEach((entry, i) => {
      let result: ReturnType<typeof evalExpr>;
      try {
        result = evalExpr(parseExpr(entry.expr), env);
      } catch (e) {
        if (!(e instanceof ExprSyntaxError)) throw e;
        result = 'UNKNOWN';
      }
      if (result === 'UNKNOWN' && unknown === 'SKIP') return;
      decided++;
      if (result === true) return;
      const verdict: Verdict = result === false && entry.onFail === 'BELOW_MIN' ? 'BELOW_MIN' : 'CHECK';
      ruleReasons.push({ stage: 'COMPAT', kind: 'RULE', verdict, ruleId: `${rule.id}#${i}`, message: entry.message });
    });
    // SKIP 모드에서 판정된 항목이 하나도 없으면 그 규칙은 확인하지 않은 것으로 본다(근거 없는 OK 방지).
    if (unknown === 'SKIP' && decided === 0) continue;
    checkedRuleIds.push(rule.id);
    reasons.push(...ruleReasons);
  }

  if (checkedRuleIds.length === 0) return { verdict: 'NONE', reasons, checkedRuleIds };
  return { verdict: worstVerdict(reasons.map((r) => r.verdict)) as CompatVerdict, reasons, checkedRuleIds };
}

/**
 * 대안 = 항목의 compatibleAlternativeIds 중 이 동물의 CareProfile 요구사항에 있는 것만(감사 54 #6).
 *   SupplyItem 은 종 공용이라 다른 프로필 전용 항목을 가리킬 수 있다 — 그 프로필 기준을 이 동물에 권하지 않는다.
 */
function alternativesFor(cat: EngineCatalog, r: ResolvedRequirement): Alternative[] {
  const out: Alternative[] = [];
  const profileReqs = cat.requirementsByProfile.get(r.careProfileId);
  for (const id of r.item.compatibleAlternativeIds) {
    const it = cat.supplyItems.get(id);
    if (it && id !== r.supplyItemId && profileReqs?.has(id) === true) out.push({ supplyItemId: it.id, name: it.name });
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

/**
 * 최소 규격 제품 기준 호환(스펙33 G-2, K-4 가정): 이 동물의 요구사항 minSpec 에서 when 없는 gte·eq(단일 값) 기준값을
 *   가상의 "최소 규격 제품" 입력으로 삼아 호환 단계만 계산한다(L4 서브카드·L2 △·홈 칩). 순수·결정적.
 *   가상 입력에 없는 키 때문에 UNKNOWN 인 항목은 건너뛴다(최소 규격이 정하지 않은 속성은 판정 근거가 아님);
 *   판정된 항목이 없는 규칙은 checkedRuleIds 에서 빠지고, 남은 규칙이 없으면 NONE.
 *   상품 노출·순서에는 쓰지 않는다(불변식 ③). 요구사항 없음 → EngineLookupError.
 */
export function requirementCompat(
  cat: EngineCatalog,
  animalTypeId: string,
  supplyItemId: string,
  userContext?: UserContext,
): SpecCheckResult['compat'] {
  const r = resolveRequirement(cat, animalTypeId, supplyItemId);
  if (!r) throw new EngineLookupError(`no requirement for ${animalTypeId} × ${supplyItemId}`);
  return evaluateCompat(cat, r.careProfileId, supplyItemId, minSpecBaseline(r), userContext, 'SKIP');
}

/** minSpec 기준값 → 가상 입력. gte 는 같은 키 중 가장 큰 값(가장 엄격한 하한), eq 는 단일 값만. */
export function minSpecBaseline(r: Pick<ResolvedRequirement, 'minSpec'>): SpecValues {
  const out: Record<string, number | boolean | string> = {};
  for (const rule of Array.isArray(r.minSpec?.rules) ? r.minSpec.rules : []) {
    if (!rule || (Array.isArray(rule.when) && rule.when.length > 0) || Array.isArray(rule.value)) continue;
    if (rule.op === 'gte' && typeof rule.value === 'number' && Number.isFinite(rule.value)) {
      const prev = out[rule.key];
      out[rule.key] = typeof prev === 'number' ? Math.max(prev, rule.value) : rule.value;
    } else if (rule.op === 'eq' && !(rule.key in out)) {
      out[rule.key] = rule.value;
    }
  }
  return out;
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
  requirementCompat(animalTypeId: string, supplyItemId: string, userContext?: UserContext): SpecCheckResult['compat'];
  /** animalType: id 또는 { displayName }. 알 수 없는 id → EngineLookupError. */
  buildSearchKeyword(animalType: string | Pick<AnimalTypeRec, 'displayName'>, r: ResolvedRequirement): string;
}

/** 카탈로그를 묶은 §7.2 시그니처. */
export function createEngine(cat: EngineCatalog): Engine {
  return {
    resolveRequirement: (a, s) => resolveRequirement(cat, a, s),
    listResolvedRequirements: (a) => listResolvedRequirements(cat, a),
    specCheck: (a, s, input, ctx) => specCheck(cat, a, s, input, ctx),
    requirementCompat: (a, s, ctx) => requirementCompat(cat, a, s, ctx),
    buildSearchKeyword: (a, r) => {
      if (typeof a !== 'string') return buildSearchKeyword(a, r);
      const at = cat.animalTypes.get(a);
      if (!at) throw new EngineLookupError(`unknown animal type ${a}`);
      return buildSearchKeyword(at, r);
    },
  };
}
