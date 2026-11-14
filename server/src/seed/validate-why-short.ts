// 이유 한 줄(whyShort, D9 ②) 규칙 W01~W04 — SupplyRequirement 행과 AnimalType.careOverrides.requirements[*] 의 whyShort.
//   W01 ERROR: 6~30자(grapheme, K2 2026-11-14)·정확히 한 문장·개행 없음·앞뒤 공백 없음.
//   W02 ERROR: 같은 행 원문(why·caution·notNowReason — override 는 resolve 후 값)에 없는 숫자·단위 도입, 단위 없는 숫자.
//   W03 WARN : whyShort 가 firstSentence(why) 와 같다(폴백과 중복 — 쓸 이유가 없다).
//   W04 ERROR: FOOD/HEALTH 행 whyShort — 첫 라운드 제외(K3 2026-11-14, 의료 인접 불변식 5). 해제는 Kenny 결정 뒤 이 상수만.
//   금지어·의료 표현 린트(L01~L04)는 lint.ts 가 why 와 같은 역할로 본다. 타입(string, null 불허)은 S03·R03.
//   표시 전용 값이다 — 노출·순서·규격 판정에 쓰지 않는다(불변식 3). 검수 메타는 같은 행 것을 따른다(V01: AI_DRAFT 는 VERIFIED 불가).
import { firstSentence } from '../engine/spec-text.js';
import { asRec, has, isNonEmptyStr, type Rec } from './common.js';
import type { Ctx } from './context.js';
import { numberTokens, sentenceCount } from './lint.js';

export const WHY_SHORT_MIN = 6;
export const WHY_SHORT_MAX = 30;
/** K3(2026-11-14): 첫 라운드 whyShort 제외 contentKind. */
export const WHY_SHORT_EXCLUDED_KINDS: readonly string[] = ['FOOD', 'HEALTH'];

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

export function graphemeLength(s: string): number {
  return [...segmenter.segment(s)].length;
}

/** W01 형식 문제(없으면 null). */
export function whyShortFormProblem(v: string): string | null {
  if (/[\r\n]/.test(v)) return '개행 없이 한 줄';
  if (v !== v.trim()) return '앞뒤 공백 없이';
  const n = graphemeLength(v);
  if (n < WHY_SHORT_MIN || n > WHY_SHORT_MAX) return `${WHY_SHORT_MIN}~${WHY_SHORT_MAX}자 (현재 ${n}자)`;
  const sc = sentenceCount(v);
  if (sc !== 1) return `정확히 한 문장 (현재 ${sc})`;
  return null;
}

const squash = (s: string): string => s.normalize('NFKC').replace(/\s+/g, '');

/** 숫자 묶음의 구성 숫자("60 × 40" → ['60','40']). */
const partsOf = (group: string): string[] => group.split(/[^\d.]+/).filter((x) => x !== '');

/**
 * W02 — 원문(같은 행 텍스트들)에 없는 숫자·단위·단위 없는 숫자 목록(없으면 []).
 *   비교는 토큰 단위(부분 문자열 아님 — "2.5배" 원문이 "5배" 를 허용하지 않는다): 원문 숫자 묶음+단위와 같거나,
 *   단일 숫자면 같은 단위의 원문 묶음 구성 숫자 중 하나("60×40cm" 원문 → "60cm" 허용).
 */
export function whyShortNumberProblems(v: string, sourceTexts: ReadonlyArray<string | null | undefined>): string[] {
  const src = numberTokens(sourceTexts.filter((t): t is string => typeof t === 'string').join('\n'))
    .filter((t) => t.unit !== null)
    .map((t) => ({ whole: squash(`${t.group}${t.unit}`), unit: t.unit as string, parts: partsOf(t.group) }));
  const out: string[] = [];
  for (const t of numberTokens(v)) {
    if (t.unit === null) {
      out.push(`단위 없는 숫자 "${t.group}"`);
      continue;
    }
    const whole = squash(`${t.group}${t.unit}`);
    const parts = partsOf(t.group);
    const ok = src.some((s) => s.whole === whole || (parts.length === 1 && s.unit === t.unit && s.parts.includes(parts[0])));
    if (!ok) out.push(`원문에 없는 숫자·단위 "${t.group}${t.unit}"`);
  }
  return out;
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function checkOne(
  ctx: Ctx,
  key: 'supplyRequirements' | 'animalTypes',
  id: string,
  path: string,
  whyShort: unknown,
  texts: { why: string | null; caution: string | null; notNowReason: string | null },
  contentKind: unknown,
): void {
  const { out } = ctx;
  if (typeof whyShort !== 'string') return; // 타입은 S03·R03.
  const form = whyShortFormProblem(whyShort);
  if (form) out.error('W01', key, id, path, `이유 한 줄은 ${form}(D9 ②, K2)`);
  for (const p of whyShortNumberProblems(whyShort, [texts.why, texts.caution, texts.notNowReason])) {
    out.error('W02', key, id, path, `${p} — 같은 행 why·caution·notNowReason 에 있는 숫자·단위만(사실 창작 금지, 불변식 7)`);
  }
  if (typeof contentKind === 'string' && WHY_SHORT_EXCLUDED_KINDS.includes(contentKind)) {
    out.error('W04', key, id, path, `${contentKind} 행은 첫 라운드 whyShort 제외(K3, 의료 인접 — 불변식 5). 폴백 firstSentence(why) 유지`);
  }
  if (texts.why !== null && firstSentence(texts.why) === whyShort.trim()) {
    out.warn('W03', key, id, path, 'whyShort 가 why 첫 문장과 같다 — 폴백과 중복이니 키를 빼도 된다');
  }
}

export function checkWhyShort(ctx: Ctx): void {
  const baseByPair = new Map<string, Rec>();
  for (const { rec, id } of ctx.rows.supplyRequirements) {
    if (isNonEmptyStr(rec.careProfileId) && isNonEmptyStr(rec.supplyItemId)) {
      const k = `${rec.careProfileId}|${rec.supplyItemId}`;
      if (!baseByPair.has(k)) baseByPair.set(k, rec);
    }
    if (!has(rec, 'whyShort')) continue;
    checkOne(
      ctx,
      'supplyRequirements',
      id,
      'whyShort',
      rec.whyShort,
      { why: strOrNull(rec.why), caution: strOrNull(rec.caution), notNowReason: strOrNull(rec.notNowReason) },
      rec.contentKind,
    );
  }
  for (const { rec, id } of ctx.rows.animalTypes) {
    const reqs = asRec(asRec(rec.careOverrides)?.requirements);
    if (!reqs || !isNonEmptyStr(rec.careProfileId)) continue;
    for (const [itemId, v] of Object.entries(reqs)) {
      const o = asRec(v);
      if (!o || !has(o, 'whyShort')) continue;
      const base = baseByPair.get(`${rec.careProfileId}|${itemId}`);
      if (!base) continue; // R03 이 보고.
      // resolveRequirement 와 같은 우선순위: override 값이 있으면 그것, 없으면 기본 행.
      const pick = (k: 'why' | 'caution' | 'notNowReason'): string | null =>
        has(o, k) && o[k] !== undefined ? strOrNull(o[k]) : strOrNull(base[k]);
      checkOne(
        ctx,
        'animalTypes',
        id,
        `careOverrides.requirements.${itemId}.whyShort`,
        o.whyShort,
        { why: pick('why'), caution: pick('caution'), notNowReason: pick('notNowReason') },
        base.contentKind,
      );
    }
  }
}
