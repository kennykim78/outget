// L5 판정 표시 — 순수 함수(스펙33 §3 표). 판정 계산은 @ws/engine specCheck 만(불변식 ⑥) — 여기는 엔진 결과를 글자로 옮길 뿐.
//   판정 = 정보, 추천 아님: 상품·상품명·"추천" 문구 0(D-43). 카피는 @ws/copy 단일 소스.
import { COPY, GLYPH } from '@ws/copy';
import {
  findField,
  hasCompleteOptionLabels,
  optionLabel,
  splitLabel,
  worstVerdict,
  type CompatVerdict,
  type EngineCatalog,
  type Reason,
  type SpecCheckResult,
  type SpecSchema,
  type SpecValue,
  type Verdict,
} from '@ws/engine';
import type { CageV1 } from '../context/cageStore';
import { CAGE_ITEM_ID } from '../context/cageStore';

export type Tone = 'ready' | 'check' | 'fail';

export interface VerdictMark {
  glyph: string;
  tone: Tone;
  label: string;
}

/** 제품 규격 단(§3): OK ✓ · BELOW_RECOMMENDED △ · BELOW_MIN ✕ · CHECK ?(D-42). */
export function productMark(v: Verdict): VerdictMark {
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
  return productMark(result.verdict);
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

/** 폼에 그릴 필드: 라벨이 불완전한 enum 은 그리지 않는다(스펙22 §4-3 — 엔진은 값 없음 → CHECK). */
export function formFields(schema: SpecSchema) {
  return (Array.isArray(schema?.fields) ? schema.fields : []).filter(hasCompleteOptionLabels);
}

/** 폼 문자열 → 엔진 입력. 빈 값은 넣지 않는다(엔진 MISSING → CHECK). 범위 검증은 엔진만(D-44). */
export function toSpecInput(schema: SpecSchema, raw: Readonly<Record<string, string>>): Record<string, SpecValue> {
  const out: Record<string, SpecValue> = {};
  for (const f of formFields(schema)) {
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
