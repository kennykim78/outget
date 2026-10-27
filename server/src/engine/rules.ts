// 규칙 집합 판정(PRD 부록 A minSpec/recommendedSpec, R2 계획 A-9).
//   MIN 실패 → BELOW_MIN, RECOMMENDED 실패 → BELOW_RECOMMENDED, 입력 누락·형식/범위 밖·해석 불가 규칙 → CHECK.
//   빈 규칙 집합 → OK + NO_CRITERIA. 우선순위 BELOW_MIN > CHECK > BELOW_RECOMMENDED > OK.
import type { Verdict } from './domain.js';
import { isSpecOp } from './domain.js';
import type { Reason, RuleCond, RuleSet, SpecField, SpecRule, SpecSchema, SpecValue, SpecValues } from './types.js';

export const VERDICT_SEVERITY: Readonly<Record<Verdict, number>> = Object.freeze({
  OK: 0,
  BELOW_RECOMMENDED: 1,
  CHECK: 2,
  BELOW_MIN: 3,
});

export function worstVerdict(verdicts: Iterable<Verdict>): Verdict {
  let worst: Verdict = 'OK';
  for (const v of verdicts) if (VERDICT_SEVERITY[v] > VERDICT_SEVERITY[worst]) worst = v;
  return worst;
}

export type RuleKind = 'MIN' | 'RECOMMENDED';

// ── 입력 읽기 ────────────────────────────────────────────────
export type SpecRead =
  | { ok: true; value: SpecValue }
  | { ok: false; why: 'NO_FIELD' | 'MISSING' | 'INVALID' };

export function findField(schema: SpecSchema, key: string): SpecField | undefined {
  return schema.fields.find((f) => f.key === key);
}

/** 스키마 기준으로 입력 값 하나를 읽는다. 타입 불일치·범위 밖·선택지 밖 → INVALID. */
export function readSpecValue(schema: SpecSchema, input: SpecValues, key: string): SpecRead {
  const field = findField(schema, key);
  if (!field) return { ok: false, why: 'NO_FIELD' };
  if (!input || !Object.prototype.hasOwnProperty.call(input, key)) return { ok: false, why: 'MISSING' };
  const v: unknown = input[key];
  if (v === undefined || v === null) return { ok: false, why: 'MISSING' };
  switch (field.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= field.min && v <= field.max
        ? { ok: true, value: v }
        : { ok: false, why: 'INVALID' };
    case 'boolean':
      return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, why: 'INVALID' };
    case 'enum':
      return typeof v === 'string' && field.options.includes(v) ? { ok: true, value: v } : { ok: false, why: 'INVALID' };
  }
}

/** 스키마 기준으로 유효한 값만 남긴다(호환 규칙 평가용 — 무효 값은 UNKNOWN 이 된다). */
export function sanitizeSpecValues(schema: SpecSchema, input: SpecValues): Record<string, SpecValue> {
  const out: Record<string, SpecValue> = {};
  for (const f of schema.fields) {
    const r = readSpecValue(schema, input, f.key);
    if (r.ok) out[f.key] = r.value;
  }
  return out;
}

// ── 표시 문자열 ──────────────────────────────────────────────
/** "지름(cm)" → { base: "지름", unit: "cm" } */
export function splitLabel(label: string): { base: string; unit: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
  return m ? { base: m[1], unit: m[2] } : { base: label, unit: '' };
}

/**
 * enum 값의 표시 라벨(단일 헬퍼 — 프리렌더 specLine·ruleText·L5 폼, 클라이언트 공용, 스펙22 §4-3).
 *   enum 필드 ∧ options 에 있는 값 ∧ optionLabels 에 비어 있지 않은 자기 속성 라벨일 때만 라벨, 아니면 null.
 *   null 이면 호출부는 원시 코드를 보여 주지 않는다(규격 한 줄 생략·조건 행 숨김·폼 필드 미렌더).
 */
export function optionLabel(field: SpecField | undefined, value: unknown): string | null {
  if (!field || field.type !== 'enum' || typeof value !== 'string' || !field.options.includes(value)) return null;
  const labels = field.optionLabels;
  if (!labels || typeof labels !== 'object' || !Object.prototype.hasOwnProperty.call(labels, value)) return null;
  const l = labels[value];
  return typeof l === 'string' && l.trim() !== '' ? l : null;
}

/** enum 필드의 모든 option 에 라벨이 있는가(L5 폼 렌더 조건 · seed:validate W-OPTLABEL). enum 이 아니면 true. */
export function hasCompleteOptionLabels(field: SpecField): boolean {
  return field.type !== 'enum' || field.options.every((o) => optionLabel(field, o) !== null);
}

/** 규칙 집합이 참조하는 필드 키(규칙 key + when key). 형태가 깨진 규칙 집합·조건은 건너뛴다(참조 0). */
export function referencedSpecKeys(...ruleSets: readonly (RuleSet | null | undefined)[]): Set<string> {
  const keys = new Set<string>();
  for (const rs of ruleSets) {
    const rules: unknown = rs && typeof rs === 'object' ? (rs as { rules?: unknown }).rules : undefined;
    if (!Array.isArray(rules)) continue;
    for (const rule of rules as unknown[]) {
      if (!rule || typeof rule !== 'object') continue;
      const { key, when } = rule as { key?: unknown; when?: unknown };
      if (typeof key === 'string') keys.add(key);
      if (!Array.isArray(when)) continue;
      for (const c of when as unknown[]) {
        const k = c && typeof c === 'object' ? (c as { key?: unknown }).key : undefined;
        if (typeof k === 'string') keys.add(k);
      }
    }
  }
  return keys;
}

/**
 * L5 폼에 보일 필드(기니피그 S5, 계획 107 — client·prerender 공용 단일 헬퍼). 순수·결정론, 스키마 순서 유지.
 *   ruleScoped !== true 필드는 그대로, ruleScoped === true 필드는 해석된 minSpec·recommendedSpec 의 규칙 key 또는
 *   when key 가 참조할 때만 남긴다. optionLabels 완전성(hasCompleteOptionLabels)은 호출부가 따로 거른다.
 *   스키마가 깨졌으면 빈 배열.
 */
export function visibleSpecFields(schema: SpecSchema, minSpec: RuleSet, recommendedSpec: RuleSet): SpecField[] {
  const fields: unknown = schema && typeof schema === 'object' ? (schema as { fields?: unknown }).fields : undefined;
  if (!Array.isArray(fields)) return [];
  const refs = referencedSpecKeys(minSpec, recommendedSpec);
  return (fields as SpecField[]).filter((f) => f.ruleScoped !== true || refs.has(f.key));
}

/**
 * 라벨 뒤 " · 선택" 표시 여부(오케스트레이터 결정 2026-10-27 be-gp-schema(113) 행 — client SpecForm·prerender L5 공용 단일 판정).
 *   field.optional === true 이고, 해석된 minSpec 의 규칙 key·when key 어디에도 참조되지 않을 때만 true.
 *   minSpec 이 참조하면 판정에 필요한 값이라 '선택'으로 보이지 않게 한다(recommendedSpec 참조는 판정 필수 아님 — 영향 없음).
 */
export function isFieldOptionalForDisplay(field: SpecField, minSpec: RuleSet | null | undefined): boolean {
  if (!field || field.optional !== true) return false;
  return !referencedSpecKeys(minSpec).has(field.key);
}

function showValue(field: SpecField | undefined, v: SpecValue): string {
  if (field?.type === 'number' && typeof v === 'number') return `${v}${splitLabel(field.label).unit}`;
  if (field?.type === 'enum' && typeof v === 'string') return optionLabel(field, v) ?? v;
  if (typeof v === 'boolean') return v ? '있음' : '없음';
  return String(v);
}

function fieldName(field: SpecField | undefined, key: string): string {
  return field ? splitLabel(field.label).base : key;
}

function expectedText(field: SpecField | undefined, cond: RuleCond): string {
  const list = (Array.isArray(cond.value) ? cond.value : [cond.value]).map((x) => showValue(field, x)).join('·');
  switch (cond.op) {
    case 'gte':
      return `${list} 이상`;
    case 'lte':
      return `${list} 이하`;
    case 'eq':
      return list;
    case 'in':
      return `${list} 중 하나`;
    case 'not_in':
      return `${list} 제외`;
  }
}

function inputReason(field: SpecField | undefined, key: string, why: 'NO_FIELD' | 'MISSING' | 'INVALID'): Reason {
  const name = fieldName(field, key);
  let message: string;
  if (why === 'NO_FIELD') message = `규격 항목(${key})이 정의되지 않아 확인이 필요해요.`;
  else if (why === 'MISSING') message = `${name} 값이 없어 판정할 수 없어요. 값을 확인해 주세요.`;
  else if (field?.type === 'number')
    message = `${name} 값이 입력 범위(${showValue(field, field.min)}~${showValue(field, field.max)}) 밖이거나 숫자가 아니에요. 값을 확인해 주세요.`;
  else message = `${name} 값의 형식이 맞지 않아 판정할 수 없어요. 값을 확인해 주세요.`;
  return { stage: 'PRODUCT', kind: why === 'NO_FIELD' ? 'RULE' : 'INPUT', verdict: 'CHECK', key, message };
}

function badRuleReason(field: SpecField | undefined, cond: RuleCond): Reason {
  return {
    stage: 'PRODUCT',
    kind: 'RULE',
    verdict: 'CHECK',
    key: cond.key,
    message: `${fieldName(field, cond.key)} 기준을 해석할 수 없어 확인이 필요해요.`,
  };
}

// ── 조건 판정 ────────────────────────────────────────────────
type CondOutcome = { t: 'pass' } | { t: 'fail'; actual: SpecValue } | { t: 'check'; reason: Reason };

function isScalar(v: unknown): v is SpecValue {
  return typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
}

function testCond(schema: SpecSchema, cond: RuleCond, input: SpecValues): CondOutcome {
  const field = findField(schema, cond.key);
  if (!field) return { t: 'check', reason: inputReason(undefined, cond.key, 'NO_FIELD') };
  if (!isSpecOp(cond.op)) return { t: 'check', reason: badRuleReason(field, cond) };

  // 규칙 자체의 형태 검사(validate S06 이 막지만 엔진도 fail-closed).
  const { op, value } = cond;
  if (op === 'gte' || op === 'lte') {
    if (field.type !== 'number' || typeof value !== 'number' || !Number.isFinite(value))
      return { t: 'check', reason: badRuleReason(field, cond) };
  } else if (op === 'eq') {
    if (!isScalar(value)) return { t: 'check', reason: badRuleReason(field, cond) };
  } else if (!Array.isArray(value) || value.length === 0 || !value.every(isScalar)) {
    return { t: 'check', reason: badRuleReason(field, cond) };
  }

  const read = readSpecValue(schema, input, cond.key);
  if (!read.ok) return { t: 'check', reason: inputReason(field, cond.key, read.why) };
  const actual = read.value;

  let pass: boolean;
  switch (op) {
    case 'gte':
      pass = (actual as number) >= (value as number);
      break;
    case 'lte':
      pass = (actual as number) <= (value as number);
      break;
    case 'eq':
      pass = actual === value;
      break;
    case 'in':
      pass = (value as SpecValue[]).includes(actual);
      break;
    case 'not_in':
      pass = !(value as SpecValue[]).includes(actual);
      break;
  }
  return pass ? { t: 'pass' } : { t: 'fail', actual };
}

function evaluateRule(schema: SpecSchema, rule: SpecRule, input: SpecValues, kind: RuleKind): Reason[] {
  if (rule.when !== undefined) {
    if (!Array.isArray(rule.when)) return [badRuleReason(findField(schema, rule.key), rule)];
    const outcomes = rule.when.map((c) => testCond(schema, c, input));
    if (outcomes.some((o) => o.t === 'fail')) return []; // 적용 대상 아님
    const checks = outcomes.flatMap((o) => (o.t === 'check' ? [o.reason] : []));
    if (checks.length > 0) return checks;
  }
  const o = testCond(schema, rule, input);
  if (o.t === 'pass') return [];
  if (o.t === 'check') return [o.reason];
  const field = findField(schema, rule.key);
  const verdict: Verdict = kind === 'MIN' ? 'BELOW_MIN' : 'BELOW_RECOMMENDED';
  const head = kind === 'MIN' ? '최소 기준 미달' : '권장 기준 미달';
  const why = typeof rule.reason === 'string' && rule.reason.trim() ? ` — ${rule.reason.trim()}` : '';
  return [
    {
      stage: 'PRODUCT',
      kind,
      verdict,
      key: rule.key,
      expected: rule.value,
      actual: o.actual,
      message: `${head}: ${fieldName(field, rule.key)} ${expectedText(field, rule)} 필요${why}`,
    },
  ];
}

export function noCriteriaReason(): Reason {
  return { stage: 'PRODUCT', kind: 'NO_CRITERIA', verdict: 'OK', message: '등록된 규격 기준이 없는 용품이에요.' };
}

/** 규칙 집합 하나를 판정한다. kind=MIN 실패 → BELOW_MIN, RECOMMENDED 실패 → BELOW_RECOMMENDED. */
export function evaluateRuleSet(
  schema: SpecSchema,
  ruleSet: RuleSet,
  input: SpecValues,
  kind: RuleKind,
): { verdict: Verdict; reasons: Reason[] } {
  const rules = ruleSet && Array.isArray(ruleSet.rules) ? ruleSet.rules : null;
  if (rules === null) {
    return {
      verdict: 'CHECK',
      reasons: [{ stage: 'PRODUCT', kind: 'RULE', verdict: 'CHECK', message: '규격 기준을 해석할 수 없어 확인이 필요해요.' }],
    };
  }
  if (rules.length === 0) return { verdict: 'OK', reasons: [noCriteriaReason()] };
  const reasons = rules.flatMap((rule) => evaluateRule(schema, rule, input, kind));
  return { verdict: worstVerdict(reasons.map((x) => x.verdict)), reasons };
}

/** 제품 단계(최소 + 권장) 판정. NO_CRITERIA 는 둘 다 비었을 때만 1건, 같은 키 INPUT 사유는 1건으로. */
export function evaluateProductStage(
  schema: SpecSchema,
  minSpec: RuleSet,
  recommendedSpec: RuleSet,
  input: SpecValues,
): { verdict: Verdict; reasons: Reason[] } {
  const min = evaluateRuleSet(schema, minSpec, input, 'MIN');
  const rec = evaluateRuleSet(schema, recommendedSpec, input, 'RECOMMENDED');
  const isEmpty = (r: { reasons: Reason[] }) => r.reasons.length === 1 && r.reasons[0].kind === 'NO_CRITERIA';
  if (isEmpty(min) && isEmpty(rec)) return { verdict: 'OK', reasons: [noCriteriaReason()] };
  const all = [...min.reasons, ...rec.reasons];
  const seenInput = new Set<string>();
  const reasons: Reason[] = [];
  for (const x of all) {
    if (x.kind === 'NO_CRITERIA') continue;
    if (x.kind === 'INPUT' && x.key !== undefined) {
      if (seenInput.has(x.key)) continue;
      seenInput.add(x.key);
    }
    reasons.push(x);
  }
  return { verdict: worstVerdict(reasons.map((x) => x.verdict)), reasons };
}
