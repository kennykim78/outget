// L5 판정 표시 — 순수 함수(스펙33 §3 표). 판정 계산은 @ws/engine specCheck 만(불변식 ⑥) — 여기는 엔진 결과를 글자로 옮길 뿐.
//   판정 = 정보, 추천 아님: 상품·상품명·"추천" 문구 0(D-43). 카피는 @ws/copy 단일 소스.
import { COPY, GLYPH } from '@ws/copy';
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

/** 제품 규격 단(§3): OK ✓ · BELOW_RECOMMENDED △ · BELOW_MIN ✕ · CHECK ?(D-42). 기준 없음 CHECK 는 ○ + 별도 라벨(arch-23). */
export function productMark(v: Verdict, noCriteria = false): VerdictMark {
  if (v === 'CHECK' && noCriteria) return { glyph: GLYPH.later, tone: 'none', label: COPY.verdict.productNoCriteria };
  switch (v) {
    case 'OK':
      return { glyph: GLYPH.ready, tone: 'ready', label: COPY.verdict.productOk };
    case 'BELOW_RECOMMENDED':
      return { glyph: GLYPH.check, tone: 'check', label: COPY.verdict.productBelowRecommended };
    case 'BELOW_MIN':
      return { glyph: GLYPH.fail, tone: 'fail', label: COPY.verdict.productBelowMin };
    case 'CHECK':
      return { glyph: GLYPH.unknown, tone: 'check', label: COPY.verdict.productCheck };
  }
}

/** 내 환경 호환 단(§3, PRD US-011 원문): OK ✓ · CHECK △ · BELOW_MIN ✕. NONE 은 단을 그리지 않는다(null). */
export function compatMark(v: CompatVerdict): VerdictMark | null {
  switch (v) {
    case 'OK':
      return { glyph: GLYPH.ready, tone: 'ready', label: COPY.verdict.compatOk };
    case 'CHECK':
      return { glyph: GLYPH.check, tone: 'check', label: COPY.verdict.compatCheck };
    case 'BELOW_MIN':
      return { glyph: GLYPH.fail, tone: 'fail', label: COPY.verdict.compatBelowMin };
    default:
      return null;
  }
}

/**
 * 종합 글리프. 종합 CHECK 가 제품 단의 값 누락(CHECK)에서 온 것이면 '?'(정보 부족),
 * 제품은 판정됐고 호환 단이 CHECK 면 △ + 호환 확인 문구(값은 다 있다 — '정보 부족'이 아니다).
 */
export function overallMark(result: SpecCheckResult): VerdictMark {
  if (result.verdict === 'CHECK' && result.product.verdict !== 'CHECK') {
    return compatMark('CHECK') as VerdictMark;
  }
  return productMark(result.verdict, result.verdict === 'CHECK' && isProductNoCriteria(result.product));
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

/**
 * 헤드라인(spec-lg): BELOW_MIN → "최소 {v}{u} · 입력 {a}{u}", BELOW_RECOMMENDED → "권장 {v}{u} · 입력 {a}{u}".
 *   단계 판정과 같은 등급의 숫자 Reason 중 첫 번째 하나. 숫자 규칙이 아니면(enum 등) null.
 */
export function productHeadline(schema: SpecSchema, product: SpecCheckResult['product']): string | null {
  const v = product.verdict;
  if (v !== 'BELOW_MIN' && v !== 'BELOW_RECOMMENDED') return null;
  const kind = v === 'BELOW_MIN' ? 'MIN' : 'RECOMMENDED';
  for (const r of product.reasons) {
    if (r.kind !== kind || typeof r.expected !== 'number' || typeof r.actual !== 'number') continue;
    const f = numberField(schema, r.key);
    if (!f) continue;
    const u = splitLabel(f.label).unit;
    const head = kind === 'MIN' ? COPY.verdict.min : COPY.verdict.recommended;
    return `${head} ${r.expected}${u} · ${COPY.verdict.input} ${r.actual}${u}`;
  }
  return null;
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
