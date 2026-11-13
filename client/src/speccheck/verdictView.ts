// L5 판정 표시 — 순수 함수(스펙33 §3 표). 판정 계산은 @ws/engine specCheck 만(불변식 ⑥) — 여기는 엔진 결과를 글자로 옮길 뿐.
//   판정 = 정보, 추천 아님: 상품·상품명·"추천" 문구 0(D-43). 카피는 @ws/copy 단일 소스.
import { COPY, VERDICT_GLYPH, formatCopy } from '@ws/copy';
import {
  findField,
  hasCompleteOptionLabels,
  isFieldOptionalForDisplay,
  optionLabel,
  splitLabel,
  isNoCriteria,
  worstVerdict,
  type CompatVerdict,
  type EngineCatalog,
  type Reason,
  type RuleSet,
  type SpecCheckResult,
  type SpecField,
  type SpecSchema,
  type SpecValue,
  type Verdict,
  visibleSpecFields,
} from '@ws/engine';
import type { CageV1 } from '../context/cageStore';
import { CAGE_ITEM_ID } from '../context/cageStore';

/** 'none' = 종별 규격 기준 없음(arch-23) — 기존 ink-muted·bg-100 토큰만, 새 색 없음. */
export type Tone = 'ready' | 'check' | 'fail' | 'none';

export interface VerdictMark {
  glyph: string;
  tone: Tone;
  label: string;
}

/** 제품 단이 「종별 규격 기준 없음」인가 — 판별은 엔진 isNoCriteria 하나(클라이언트 재계산 없음). */
export function isProductNoCriteria(product: SpecCheckResult['product']): boolean {
  return isNoCriteria(product);
}

/**
 * 제품 규격 단 — R4 fix 4상태 규칙표(286 U5b · D7 = △ 로 합침):
 *   OK ○ 기준 충족 · BELOW_RECOMMENDED △ 확인 필요(보조줄 「최소 기준 충족 · 권장 미만」) · BELOW_MIN ✕(숫자 최소에 작을 때만 「조금 작아요」,
 *   그 밖의 미달은 「최소 규격 미달」) · CHECK+NO_CRITERIA — 기준 없음(○ 와 다른 글리프) · 값 누락 CHECK ? 입력 필요.
 */
export function productMark(v: Verdict, noCriteria = false, small = false, reasons?: readonly Reason[]): VerdictMark {
  if (v === 'CHECK' && noCriteria) return { glyph: VERDICT_GLYPH.none, tone: 'none', label: COPY.verdict.markNone };
  switch (v) {
    case 'OK':
      return { glyph: VERDICT_GLYPH.ok, tone: 'ready', label: COPY.verdict.markOk };
    case 'BELOW_RECOMMENDED':
      return { glyph: VERDICT_GLYPH.check, tone: 'check', label: COPY.verdict.markCheck };
    case 'BELOW_MIN':
      return { glyph: VERDICT_GLYPH.fail, tone: 'fail', label: small ? COPY.verdict.markSmall : COPY.verdict.productBelowMin };
    case 'CHECK':
      // reasons 를 주면: INPUT(값 누락·잘못된 값) 사유가 있을 때만 「입력 필요」, 기준·규칙 쪽 사유뿐이면 「확인 필요」(△). 생략 시 기존 동작.
      if (reasons !== undefined && !reasons.some((r) => r.kind === 'INPUT')) {
        return { glyph: VERDICT_GLYPH.check, tone: 'check', label: COPY.verdict.markCheck };
      }
      return { glyph: VERDICT_GLYPH.input, tone: 'check', label: COPY.verdict.markInput };
  }
}

/** 내 환경 호환 단(§3, PRD US-011 원문 판정어): OK ○ · CHECK △ · BELOW_MIN ✕. NONE 은 단을 그리지 않는다(null). */
export function compatMark(v: CompatVerdict): VerdictMark | null {
  switch (v) {
    case 'OK':
      return { glyph: VERDICT_GLYPH.ok, tone: 'ready', label: COPY.verdict.compatOk };
    case 'CHECK':
      return { glyph: VERDICT_GLYPH.check, tone: 'check', label: COPY.verdict.compatCheck };
    case 'BELOW_MIN':
      return { glyph: VERDICT_GLYPH.fail, tone: 'fail', label: COPY.verdict.compatBelowMin };
    default:
      return null;
  }
}

/** 호환 단 표시 여부: 제품이 최소 미달이면 숨긴다(제품 미달이 우선 — 사용 가능해 보이는 오독 방지). */
export function visibleCompatMark(result: SpecCheckResult): VerdictMark | null {
  if (result.product.verdict === 'BELOW_MIN') return null;
  return compatMark(result.compat.verdict);
}

function numberField(schema: SpecSchema, key: string | undefined) {
  if (key === undefined) return undefined;
  const f = findField(schema, key);
  return f?.type === 'number' ? f : undefined;
}

// ── 286 U5b 결과 상태 숫자 표시 — 계산 없음(불변식 ⑥): 값은 해석된 minSpec 규칙 값 · 엔진 Reason.expected/actual 뿐 ──

/** 큰 숫자 한 덩이: 「최소 지름」 + 「27」 + 「cm 이상」. value 는 여러 값이면 「100×50」. */
export interface SpecFigure {
  label: string;
  value: string;
  unit: string;
  /** 「이상」 — 최소 숫자는 gte 규칙만 고른다. */
  suffix: string;
  /** 이 숫자가 가리키는 필드 키(스키마 순서) — 「내 {용품}」 입력값을 같은 키로 보여 준다. */
  keys: string[];
}

const FIGURE_MAX_VALUES = 3;
const FIGURE_JOIN = '×';

function minReasons(product: SpecCheckResult['product']): Reason[] {
  return product.reasons.filter((r) => r.kind === 'MIN');
}

function numericReason(schema: SpecSchema, r: Reason): r is Reason & { key: string; expected: number; actual: number } {
  return typeof r.expected === 'number' && typeof r.actual === 'number' && numberField(schema, r.key) !== undefined;
}

/** 이 Reason 을 낸 minSpec 규칙의 연산자(같은 키·같은 값). 표시 접미사 선택용 — 판정은 이미 엔진이 했다. */
function opOf(minSpec: RuleSet | null | undefined, r: Reason): string | null {
  const rules = Array.isArray(minSpec?.rules) ? minSpec.rules : [];
  return rules.find((x) => x && x.key === r.key && x.value === r.expected)?.op ?? null;
}

/**
 * 「최소 {항목}」 큰 숫자.
 *   BELOW_MIN 이면 첫 숫자 MIN Reason 의 expected(엔진 출력 그대로).
 *   아니면 해석된 minSpec 의 when 없는 숫자 gte 규칙(chipSpecText 와 같은 선택: 스키마 순서, 같은 단위면 최대 3값 ×, 섞이면 첫 값).
 *   숫자 규칙이 없으면 null(섹션 생략 — 임의 값을 만들지 않는다).
 */
export function minFigure(schema: SpecSchema, product: SpecCheckResult['product'], minSpec: RuleSet | null | undefined): SpecFigure | null {
  if (isProductNoCriteria(product)) return null;
  if (product.verdict === 'BELOW_MIN') {
    // 「최소 … 이상」으로 읽히는 gte 규칙만(lte 미달은 아래 일반 선택으로 — 「최소 … 이하」 모순 문구 방지).
    const r = minReasons(product).find((x) => numericReason(schema, x) && opOf(minSpec, x) === 'gte');
    if (r && numericReason(schema, r)) {
      const { base, unit } = splitLabel(numberField(schema, r.key)?.label ?? '');
      return { label: formatCopy(COPY.verdict.minOf, { name: base }), value: String(r.expected), unit, suffix: COPY.spec.gte, keys: [r.key] };
    }
    // gte 미달이 없는 BELOW_MIN(lte·enum 등) — 엉뚱한 gte 묶음을 보이지 않도록 큰 숫자 영역 생략.
    return null;
  }
  const rules = Array.isArray(minSpec?.rules) ? minSpec.rules : [];
  const picked: Array<{ key: string; base: string; value: number; unit: string }> = [];
  for (const f of Array.isArray(schema?.fields) ? schema.fields : []) {
    if (f.type !== 'number') continue;
    const r = rules.find(
      (x) => x && x.key === f.key && x.op === 'gte' && typeof x.value === 'number' && Number.isFinite(x.value) && !(Array.isArray(x.when) && x.when.length > 0),
    );
    if (r) picked.push({ key: f.key, base: splitLabel(f.label).base, value: r.value as number, unit: splitLabel(f.label).unit });
  }
  if (picked.length === 0) return null;
  const sameUnit = picked.every((p) => p.unit === picked[0].unit);
  const shown = sameUnit ? picked.slice(0, FIGURE_MAX_VALUES) : picked.slice(0, 1);
  return {
    label: shown.length === 1 ? formatCopy(COPY.verdict.minOf, { name: shown[0].base }) : COPY.verdict.minSpecLabel,
    value: shown.map((p) => String(p.value)).join(FIGURE_JOIN),
    unit: shown[0].unit,
    suffix: COPY.spec.gte,
    keys: shown.map((p) => p.key),
  };
}

/** 「내 {용품}」 숫자: minFigure 와 같은 키의 입력값(전부 있을 때만). 없으면 null. */
export function mineValue(figure: SpecFigure | null, input: Readonly<Record<string, SpecValue>>): string | null {
  if (!figure) return null;
  const vals = figure.keys.map((k) => input[k]);
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  return vals.map((v) => String(v)).join(FIGURE_JOIN);
}

/** 최소보다 작은 숫자 항목 — {name: 필드명, n: expected − actual(표시용 뺄셈만), unit}. gte 규칙의 MIN Reason 만. */
export function shortfalls(schema: SpecSchema, product: SpecCheckResult['product'], minSpec: RuleSet | null | undefined): Array<{ name: string; n: number; unit: string }> {
  const out: Array<{ name: string; n: number; unit: string }> = [];
  for (const r of minReasons(product)) {
    if (!numericReason(schema, r) || r.actual >= r.expected || opOf(minSpec, r) !== 'gte') continue;
    const { base, unit } = splitLabel(numberField(schema, r.key)?.label ?? '');
    out.push({ name: base, n: Math.round((r.expected - r.actual) * 1000) / 1000, unit });
  }
  return out;
}

/** BELOW_MIN 이 전부 「숫자가 최소보다 작음」인가 — ✕ 단어를 「조금 작아요」로 쓸 수 있는 경우. */
export function isSmallOnly(schema: SpecSchema, product: SpecCheckResult['product'], minSpec: RuleSet | null | undefined): boolean {
  if (product.verdict !== 'BELOW_MIN') return false;
  const mins = minReasons(product).filter((r) => r.verdict === 'BELOW_MIN');
  return mins.length > 0 && shortfalls(schema, product, minSpec).length === mins.length;
}

/** 판정 제목 문장(제품 단 기준). 제품 충족·권장 미만인데 호환(compatVerdict)이 CHECK·BELOW_MIN 이면 호환을 반영한 문장 — 성공 문장 금지. */
export function verdictTitle(
  schema: SpecSchema,
  product: SpecCheckResult['product'],
  minSpec: RuleSet | null | undefined,
  names: { item: string; animal: string },
  compatVerdict?: CompatVerdict,
): string {
  if (isProductNoCriteria(product)) return formatCopy(COPY.verdict.titleNoCriteria, { animal: names.animal });
  switch (product.verdict) {
    case 'OK':
      if (compatVerdict === 'CHECK') return formatCopy(COPY.verdict.titleOkCompatCheck, { name: names.item });
      if (compatVerdict === 'BELOW_MIN') return formatCopy(COPY.verdict.titleOkCompatBelowMin, { name: names.item });
      return formatCopy(COPY.verdict.titleOk, { name: names.item });
    case 'BELOW_RECOMMENDED':
      if (compatVerdict === 'CHECK') return COPY.verdict.titleBelowRecommendedCompatCheck;
      if (compatVerdict === 'BELOW_MIN') return COPY.verdict.titleBelowRecommendedCompatBelowMin;
      return COPY.verdict.titleBelowRecommended;
    case 'BELOW_MIN':
      return formatCopy(isSmallOnly(schema, product, minSpec) ? COPY.verdict.titleSmall : COPY.verdict.titleBelowMin, { name: names.item });
    case 'CHECK':
      return COPY.verdict.productCheck;
  }
}

/** 이유 문장(엔진 Reason.message 그대로). NO_CRITERIA 포함 — 기준이 없다는 사실도 정보다. */
export function reasonMessages(reasons: readonly Reason[]): string[] {
  const out: string[] = [];
  for (const r of reasons) if (typeof r.message === 'string' && r.message !== '' && !out.includes(r.message)) out.push(r.message);
  return out;
}

/** compatibility_checked 용: 확인한 규칙마다 그 규칙 이유들의 최악(이유 없음 = OK). 순서 = 엔진 checkedRuleIds. */
export function perRuleVerdicts(compat: SpecCheckResult['compat']): Array<{ ruleId: string; verdict: Verdict }> {
  return compat.checkedRuleIds.map((ruleId) => {
    const mine = compat.reasons.filter((r) => typeof r.ruleId === 'string' && r.ruleId.startsWith(`${ruleId}#`));
    return { ruleId, verdict: worstVerdict(mine.map((r) => r.verdict)) };
  });
}

/** 이 동물(careProfile)에서 이 용품과 케이지를 잇는 호환 규칙이 카탈로그에 있는가(CageRow 표시 조건). 케이지 자신은 false. */
export function hasCageRule(catalog: EngineCatalog, careProfileId: string, itemId: string): boolean {
  if (itemId === CAGE_ITEM_ID) return false;
  return catalog.compatibilityRules.some(
    (r) =>
      (!r.careProfileId || r.careProfileId === careProfileId) &&
      ((r.a === itemId && r.b === CAGE_ITEM_ID) || (r.b === itemId && r.a === CAGE_ITEM_ID)),
  );
}

/** 케이지 한 줄: "60×40×35cm · 리빙박스"(단위 = 스키마 라벨, 형태 = optionLabel; 라벨 없으면 형태 생략). */
export function cageSummary(cage: CageV1, schema: SpecSchema | null): string {
  const unitOf = (key: string): string => {
    const f = schema ? numberField(schema, key) : undefined;
    return f ? splitLabel(f.label).unit : '';
  };
  const u = unitOf('floorWcm');
  const dims = `${cage.floorWcm}×${cage.floorDcm}×${cage.heightCm}${u}`;
  const typeLabel = schema ? optionLabel(findField(schema, 'type'), cage.type) : null;
  return typeLabel ? `${dims} · ${typeLabel}` : dims;
}

/** 폼이 기준으로 삼는 해석된 규칙(ws-data 요구사항의 minSpec·recommendedSpec). 없으면 규칙 0 — ruleScoped 필드는 전부 숨는다(fail-closed). */
export interface FormRules {
  minSpec?: RuleSet | null;
  recommendedSpec?: RuleSet | null;
}

const NO_RULES: RuleSet = { rules: [] };

/**
 * 폼에 그릴 필드 — 프리렌더 L5(server prerender/pages/type.ts layerL5)와 같은 목록:
 *   visibleSpecFields(ruleScoped 는 해석된 min·rec 규칙이 참조할 때만) → 라벨이 불완전한 enum 제외(스펙22 §4-3 — 엔진은 값 없음 → CHECK).
 */
export function formFields(schema: SpecSchema, rules: FormRules = {}): SpecField[] {
  return visibleSpecFields(schema, rules.minSpec ?? NO_RULES, rules.recommendedSpec ?? NO_RULES).filter(hasCompleteOptionLabels);
}

/** 라벨 뒤 " · 선택" 표시 여부 — 엔진 단일 판정(isFieldOptionalForDisplay, 프리렌더와 같음). minSpec 이 참조하면 표시 안 함. */
export function showOptionalMark(field: SpecField, rules: FormRules = {}): boolean {
  return isFieldOptionalForDisplay(field, rules.minSpec ?? NO_RULES);
}

/** 폼 문자열 → 엔진 입력. 빈 값은 넣지 않는다(엔진 MISSING → CHECK). 범위 검증은 엔진만(D-44). 폼에 없는 필드 값은 버린다. */
export function toSpecInput(schema: SpecSchema, raw: Readonly<Record<string, string>>, rules: FormRules = {}): Record<string, SpecValue> {
  const out: Record<string, SpecValue> = {};
  for (const f of formFields(schema, rules)) {
    const s = (raw[f.key] ?? '').trim();
    if (s === '') continue;
    if (f.type === 'number') {
      const n = Number(s.replace(',', '.'));
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === 'boolean') {
      if (s === 'true') out[f.key] = true;
      else if (s === 'false') out[f.key] = false;
    } else if (f.options.includes(s)) {
      out[f.key] = s;
    }
  }
  return out;
}

/** "YYYY-MM-DD…" → "YYYY.MM"(형식이 아니면 null). */
export function yearMonth(iso: string | null | undefined): string | null {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})/.exec(iso) : null;
  return m ? `${m[1]}.${m[2]}` : null;
}
