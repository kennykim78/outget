// specCheck(+호환 판정)·checkProfileMinSpec·checkAnimalMinSpec·createEngine (제품기획 §7.2, PRD US-009/011, 부록 A).
//   제품 단계: resolveRequirement 결과(override 반영)의 min/recommended 규칙.
//   호환 단계: userContext.ownedItems 와 CompatibilityRule 양방향(A-10). UNKNOWN → CHECK(onFail 무관).
//   종합 verdict = worst(product, compat≠NONE). 대안은 verdict≠OK 일 때만 — 단 제품 단계 「기준 없음」(isNoCriteria)이고
//   호환이 NONE·OK 면 대안 없음(arch-23 D-3: 기준 없음에 "이것 대신"을 붙이지 않는다). 호환 BELOW_MIN·CHECK 면 대안 유지.
//   기준 없음은 제품 단계 CHECK 라 minSpecResult meets=false → checkProfileMinSpec(P01)·checkAnimalMinSpec(노출) 모두 제외.
import type { Verdict } from './domain.js';
import { ExprSyntaxError, evalExpr, parseExpr } from './expr.js';
import { evaluateProductStage, isNoCriteria, sanitizeSpecValues, worstVerdict } from './rules.js';
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

/**
 * 가상 입력 판정 옵션(155 안 A, 182 의미 기반) — SKIP 모드(requirementCompat)에서만 읽는다. specCheck 실제 입력 경로는 옵션 없이 호출(불변).
 *   recommendedInput: 권장 채움 입력(requirementBaseline.input). 기본 input 은 minSpecBaseline(최소만).
 *   항목마다 ① 최소 입력으로 평가 → 확정이면 그대로(onFail 등급, 권장 근거 아님) ② ①이 UNKNOWN 일 때만 권장 채움 입력으로 평가 →
 *   확정이면 실패는 CHECK 상한 + usedRecommended ③ 통과(true)를 낸 입력에서 보유품 값을 비워도 true 면 보유품을 실제로 쓰지 않은
 *   통과 → 미판정(근거 없는 OK 방지 — 예: 드워프 tubes d6). 실패(false)는 보유품과 무관해도 판정 유지(187, fail-closed — 예:
 *   tubes d4 → CHECK, 혼합 규칙의 보유품 무관 BELOW_MIN 유지). 정적 참조(exprRefs)가 아니라 실제 평가 결과로 판정하므로 삼항식의 선택되지
 *   않은 분기는 근거·등급에 영향이 없다(181 ⓐⓑ). 평가기는 엄격 3값(UNKNOWN 피연산자 → UNKNOWN, false && UNKNOWN 도 UNKNOWN)이라
 *   보유품 값을 비웠을 때 결과가 같다 ⇔ 선택된 경로에 보유품 참조가 없다.
 */
interface BaselineCompatOptions {
  /** SKIP 모드(requirementCompat)에서만 읽는다. 있으면 ①②③ 전부. */
  recommendedInput?: SpecValues;
  /**
   * ③ 보유품 근거 단계만 켠다(작업 185, L7 productCageCompat). CHECK 모드에서도 읽는다: UNKNOWN 은 그대로 CHECK(제외하지 않음 —
   *   보유품을 비운 결과도 UNKNOWN 이라 근거 여부를 가릴 수 없으므로 판정 유지, fail-closed). 통과(true)만 보유품을 비워 다시
   *   평가해 그래도 true 면 미판정, 실패(false)는 판정 유지(187). 판정 항목 0 인 규칙은 확인하지 않은 것으로 본다(→ 전부 0 이면 NONE).
   */
  ownedEvidence?: true;
}

type EvalResult = ReturnType<typeof evalExpr>;

function safeEval(node: ReturnType<typeof parseExpr> | null, env: { a: SpecValues; b: SpecValues }): EvalResult {
  return node ? evalExpr(node, env) : 'UNKNOWN';
}

function evaluateCompat(
  cat: EngineCatalog,
  careProfileId: string,
  supplyItemId: string,
  input: SpecValues,
  ctx: UserContext | undefined,
  unknown: 'CHECK' | 'SKIP' = 'CHECK',
  options?: BaselineCompatOptions,
): SpecCheckResult['compat'] {
  const reasons: Reason[] = [];
  const checkedRuleIds: string[] = [];
  if (!ctx) return { verdict: 'NONE', reasons, checkedRuleIds };
  const recommendedInput = unknown === 'SKIP' ? options?.recommendedInput : undefined;
  const ownedEvidence = recommendedInput !== undefined || options?.ownedEvidence === true;
  let usedRecommended = false;

  for (const rule of cat.compatibilityRules) {
    if (rule.careProfileId && rule.careProfileId !== careProfileId) continue;
    let ownedRaw: SpecValues | undefined;
    let inputSide: 'a' | 'b';
    if (rule.a === supplyItemId && rule.b !== supplyItemId && owned(ctx, rule.b)) {
      ownedRaw = owned(ctx, rule.b);
      inputSide = 'a';
    } else if (rule.b === supplyItemId && rule.a !== supplyItemId && owned(ctx, rule.a)) {
      ownedRaw = owned(ctx, rule.a);
      inputSide = 'b';
    } else continue;

    const aSchema = cat.supplyItems.get(rule.a)?.specSchema ?? { fields: [] };
    const bSchema = cat.supplyItems.get(rule.b)?.specSchema ?? { fields: [] };
    const envFor = (inputRaw: SpecValues, ownedValues: SpecValues) => {
      const aRaw = inputSide === 'a' ? inputRaw : ownedValues;
      const bRaw = inputSide === 'a' ? ownedValues : inputRaw;
      return { a: sanitizeSpecValues(aSchema, aRaw ?? {}), b: sanitizeSpecValues(bSchema, bRaw ?? {}) };
    };
    const env = envFor(input, ownedRaw ?? {});
    const recEnv = recommendedInput !== undefined ? envFor(recommendedInput, ownedRaw ?? {}) : null;
    let decided = 0;
    let ruleUsedRecommended = false;
    const ruleReasons: Reason[] = [];

    (Array.isArray(rule.rules) ? rule.rules : []).forEach((entry, i) => {
      let node: ReturnType<typeof parseExpr> | null = null;
      try {
        node = parseExpr(entry.expr);
      } catch (e) {
        if (!(e instanceof ExprSyntaxError)) throw e;
      }
      let result: EvalResult = safeEval(node, env);
      let usesRecommended = false;
      let usedInput = input;
      if (recommendedInput !== undefined && recEnv && result === 'UNKNOWN') {
        // ① 최소 우선 → ② 최소로 확정되지 않을 때만 권장 보충.
        result = safeEval(node, recEnv);
        usedInput = recommendedInput;
        usesRecommended = result !== 'UNKNOWN';
      }
      if (result === 'UNKNOWN' && unknown === 'SKIP') return;
      // ③ 보유품 근거(187): 통과(true)가 보유품 값을 비워도 true 면 보유품을 쓰지 않은 통과 → 미판정(근거 없는 OK 방지).
      //   실패(false)는 보유품과 무관해도 사실이므로 판정 유지(fail-closed — 등급·SKIP 경로의 권장 CHECK 상한 그대로).
      //   CHECK 모드의 UNKNOWN(→ CHECK)도 빼지 않는다(비운 결과도 UNKNOWN — 근거 판별 불가, 판정 유지).
      if (ownedEvidence && result === true && safeEval(node, envFor(usedInput, {})) === true) return;
      decided++;
      if (usesRecommended) ruleUsedRecommended = true;
      if (result === true) return;
      const verdict: Verdict =
        result === false && entry.onFail === 'BELOW_MIN' && !usesRecommended ? 'BELOW_MIN' : 'CHECK';
      ruleReasons.push({ stage: 'COMPAT', kind: 'RULE', verdict, ruleId: `${rule.id}#${i}`, message: entry.message });
    });
    // SKIP 모드·보유품 근거 모드에서 판정된 항목이 하나도 없으면 그 규칙은 확인하지 않은 것으로 본다(근거 없는 OK 방지).
    if ((unknown === 'SKIP' || ownedEvidence) && decided === 0) continue;
    checkedRuleIds.push(rule.id);
    reasons.push(...ruleReasons);
    if (ruleUsedRecommended) usedRecommended = true;
  }

  if (checkedRuleIds.length === 0) return { verdict: 'NONE', reasons, checkedRuleIds };
  const verdict = worstVerdict(reasons.map((r) => r.verdict)) as CompatVerdict;
  return usedRecommended ? { verdict, reasons, checkedRuleIds, usedRecommended: true } : { verdict, reasons, checkedRuleIds };
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
  // D-3: 기준 없음 + 호환 NONE·OK → 대안 비움. 호환이 BELOW_MIN·CHECK 면 그 사유로 대안을 보인다.
  const noCriteriaOnly = isNoCriteria(product) && (compat.verdict === 'NONE' || compat.verdict === 'OK');
  return {
    verdict,
    product,
    compat,
    reasons: [...product.reasons, ...compat.reasons],
    alternatives: verdict === 'OK' || noCriteriaOnly ? [] : alternativesFor(cat, r),
  };
}

/**
 * 최소 규격 제품 기준 호환(스펙33 G-2, K-4 가정): 이 동물의 요구사항 minSpec 에서 when 없는 gte·eq(단일 값) 기준값을
 *   가상의 "최소 규격 제품" 입력으로 삼아 호환 단계만 계산한다(L4 서브카드·L2 △·홈 칩). 순수·결정적.
 *   가상 입력에 없는 키 때문에 UNKNOWN 인 항목은 건너뛴다(최소 규격이 정하지 않은 속성은 판정 근거가 아님);
 *   판정된 항목이 없는 규칙은 checkedRuleIds 에서 빠지고, 남은 규칙이 없으면 NONE.
 *   155 안 A(Kenny 확정, 작업 178): 가상 입력 = requirementBaseline(최소 우선 + 최소가 정하지 않은 키만 권장 기준값).
 *   182: 항목마다 최소 기준값만으로 먼저 평가(확정이면 onFail 등급 그대로), UNKNOWN 일 때만 권장 채움 입력으로 평가해
 *   확정되면 실패는 CHECK 상한 + usedRecommended: true. 보유품 값을 비워도 통과인 항목은 판정하지 않는다(근거 없는 OK 방지);
 *   보유품 무관 실패는 판정 유지(187).
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
  return evaluateCompat(cat, r.careProfileId, supplyItemId, minSpecBaseline(r), userContext, 'SKIP', {
    recommendedInput: requirementBaseline(r).input,
  });
}

/**
 * L7 상품 상세 호환(작업 185, QA184 MEDIUM-1): 상품의 실제 규격값 × 보유품(내 케이지 등). specCheck 의 호환 단계와 같은 CHECK 모드
 *   (UNKNOWN → CHECK, onFail 등급 그대로, 제품 단계 무관) + 보유품 근거 단계(③): 통과가 보유품 값을 비워도 통과면 그 항목은
 *   보유품과 무관 → 미판정, 판정 항목 0 → NONE(예: 드워프 tubes `a.innerDiameterCm >= 5` 는 d6 이면 케이지가 있어도 NONE).
 *   보유품 무관 실패는 판정 유지(187: tubes d4 → CHECK, HEAD specCheck.compat 와 같음).
 *   L5 specCheck 는 바꾸지 않는다. 표시 전용 — 상품 노출·정렬·meetsMinSpec 에는 쓰지 않는다(불변식 ③). 요구사항 없음 → EngineLookupError.
 */
export function productCageCompat(
  cat: EngineCatalog,
  animalTypeId: string,
  supplyItemId: string,
  specValues: SpecValues,
  userContext?: UserContext,
): SpecCheckResult['compat'] {
  const r = resolveRequirement(cat, animalTypeId, supplyItemId);
  if (!r) throw new EngineLookupError(`no requirement for ${animalTypeId} × ${supplyItemId}`);
  return evaluateCompat(cat, r.careProfileId, supplyItemId, specValues ?? {}, userContext, 'CHECK', { ownedEvidence: true });
}

/** minSpec 기준값 → 가상 입력. gte 는 같은 키 중 가장 큰 값(가장 엄격한 하한), eq 는 단일 값만. */
export function minSpecBaseline(r: Pick<ResolvedRequirement, 'minSpec'>): SpecValues {
  return ruleSetBaseline(r.minSpec);
}

export interface RequirementBaseline {
  /** 가상 "기준 제품" 입력 = minSpecBaseline ∪ (최소가 정하지 않은 키의 권장 기준값). */
  input: SpecValues;
  /** input 중 권장 규격에서 채운 키(정렬). */
  recommendedKeys: string[];
}

/**
 * requirementCompat 가상 입력(155 안 A, Kenny 확정): 최소 규격 기준값 우선, 최소가 정하지 않은 키만 recommendedSpec 의
 *   when 없는 gte(같은 키 최댓값)·단일 eq 로 채운다. 채울 값이 같은 키의 minSpec 규칙(when 유무 무관)과 모순되면 채우지 않는다.
 *   r 은 resolveRequirement 결과(careOverrides 반영)여야 한다(불변식 6). 노출·meetsMinSpec 에는 쓰지 않는다(불변식 3).
 */
export function requirementBaseline(r: Pick<ResolvedRequirement, 'minSpec' | 'recommendedSpec'>): RequirementBaseline {
  const out: Record<string, number | boolean | string> = { ...(minSpecBaseline(r) as Record<string, number | boolean | string>) };
  const rec = ruleSetBaseline(r.recommendedSpec);
  const minRules = Array.isArray(r.minSpec?.rules) ? r.minSpec.rules : [];
  const recommendedKeys: string[] = [];
  for (const key of Object.keys(rec).sort()) {
    if (key in out) continue;
    const v = rec[key] as number | boolean | string;
    if (minRules.some((m) => m && m.key === key && !condAccepts(m, v))) continue;
    out[key] = v;
    recommendedKeys.push(key);
  }
  return { input: out, recommendedKeys };
}

/** 단일 조건이 값 v 를 받아들이는가(모양이 이상한 규칙은 거부 = 채우지 않음, fail-closed). */
function condAccepts(cond: { op: unknown; value: unknown }, v: number | boolean | string): boolean {
  const { op, value } = cond;
  switch (op) {
    case 'gte':
      return typeof value === 'number' && typeof v === 'number' && v >= value;
    case 'lte':
      return typeof value === 'number' && typeof v === 'number' && v <= value;
    case 'eq':
      return !Array.isArray(value) && v === value;
    case 'in':
      return Array.isArray(value) && value.includes(v);
    case 'not_in':
      return Array.isArray(value) && !value.includes(v);
    default:
      return false;
  }
}

function ruleSetBaseline(ruleSet: ResolvedRequirement['minSpec'] | undefined): SpecValues {
  const out: Record<string, number | boolean | string> = {};
  for (const rule of Array.isArray(ruleSet?.rules) ? ruleSet.rules : []) {
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
 * 최소·권장 규칙이 모두 빈 품목(「기준 없음」, arch-23)도 CHECK/false.
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
 * 최소·권장 규칙이 모두 빈 품목(「기준 없음」, arch-23)도 CHECK/false → 추천 영역 제외(불변식 ③).
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
  productCageCompat(animalTypeId: string, supplyItemId: string, specValues: SpecValues, userContext?: UserContext): SpecCheckResult['compat'];
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
    productCageCompat: (a, s, v, ctx) => productCageCompat(cat, a, s, v, ctx),
    buildSearchKeyword: (a, r) => {
      if (typeof a !== 'string') return buildSearchKeyword(a, r);
      const at = cat.animalTypes.get(a);
      if (!at) throw new EngineLookupError(`unknown animal type ${a}`);
      return buildSearchKeyword(at, r);
    },
  };
}
