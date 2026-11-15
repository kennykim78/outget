// 이유 한 줄(whyShort, D9 ②) 규칙 W01~W04 — SupplyRequirement 행과 AnimalType.careOverrides.requirements[*] 의 whyShort.
//   W01 ERROR: 6~30자(grapheme, K2 2026-11-14)·정확히 한 문장(strictSentenceCount — 마침표 뒤 공백 없음·전각 ．도 경계)·
//              개행 없음(CR·LF·VT·FF·NEL·U+2028·U+2029)·제로폭·방향 제어 문자 없음(이모지 ZWJ 결합만 허용)·앞뒤 공백 없음.
//   W02 ERROR: 같은 행 원문(why·caution·notNowReason — override 는 resolve 후 값)에 없는 숫자·단위 도입, 단위 없는 숫자,
//              숫자 표기 우회(정규화 전 원문의 호환 숫자 — lint.compatDigits, NFKC 뒤 한글 수사+측정 단위 — lint.disguisedNumbers).
//   W03 WARN : whyShort 가 firstSentence(why) 와 같다(폴백과 중복 — 쓸 이유가 없다).
//   W04 ERROR: FOOD/HEALTH 행 whyShort — 첫 라운드 제외(K3 2026-11-14, 의료 인접 불변식 5). 해제는 Kenny 결정 뒤 이 상수만.
//   금지어·의료 표현 린트(L01~L04)는 lint.ts 가 why 와 같은 역할로 본다. 타입(string, null 불허)은 S03·R03.
//   표시 전용 값이다 — 노출·순서·규격 판정에 쓰지 않는다(불변식 3). 검수 메타는 같은 행 것을 따른다(V01: AI_DRAFT 는 VERIFIED 불가).
import { firstSentence } from '../engine/spec-text.js';
import { asRec, has, isNonEmptyStr, type Rec } from './common.js';
import type { Ctx } from './context.js';
import { compatDigits, disguisedNumbers, numberTokens, strictSentenceCount } from './lint.js';

export const WHY_SHORT_MIN = 6;
export const WHY_SHORT_MAX = 30;
/** K3(2026-11-14): 첫 라운드 whyShort 제외 contentKind. */
export const WHY_SHORT_EXCLUDED_KINDS: readonly string[] = ['FOOD', 'HEALTH'];

const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });

export function graphemeLength(s: string): number {
  return [...segmenter.segment(s)].length;
}

// 줄바꿈으로 보는 문자: CR·LF·VT·FF·NEL·LINE SEPARATOR·PARAGRAPH SEPARATOR.
// eslint-disable-next-line no-control-regex -- VT·FF 는 일부러 줄바꿈으로 잡는다.
const LINE_BREAK_RE = /[\r\n\u000B\u000C\u0085\u2028\u2029]/;
// 제로폭·방향 제어(보이지 않게 글자·숫자·금지어를 쪼개거나 순서를 뒤집는 문자). ZWJ 는 이모지 결합 사이만 허용.
const INVISIBLE_RE = /[\u00AD\u061C\u180E\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|\u200D/u;
const EMOJI_ZWJ_RE = /(?<=\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F)?)\u200D(?=\p{Extended_Pictographic})/gu;

/** W01 형식 문제(없으면 null). */
export function whyShortFormProblem(v: string): string | null {
  if (LINE_BREAK_RE.test(v)) return '개행 없이 한 줄';
  if (INVISIBLE_RE.test(v.replace(EMOJI_ZWJ_RE, ''))) return '제로폭·방향 제어 문자 없이';
  if (v !== v.trim()) return '앞뒤 공백 없이';
  const n = graphemeLength(v);
  if (n < WHY_SHORT_MIN || n > WHY_SHORT_MAX) return `${WHY_SHORT_MIN}~${WHY_SHORT_MAX}자 (현재 ${n}자)`;
  const sc = strictSentenceCount(v);
  if (sc !== 1) return `정확히 한 문장 (현재 ${sc})`;
  return null;
}

const squash = (s: string): string => s.normalize('NFKC').replace(/\s+/g, '');

/** 숫자 묶음의 구성 숫자("60 × 40" → ['60','40']). */
const partsOf = (group: string): string[] => group.split(/[^\d.]+/).filter((x) => x !== '');
/** 범위 구분자(물결·하이픈·en dash·파동 대시 〜 U+301C·수학 빼기 − U+2212·em dash — U+2014) — NUMBER_GROUP_RE 의 묶음 구분자 중 곱(× x X)을 뺀 것. */
const RANGE_SEP_RE = /[~\-–\u301C\u2212\u2014]/;

/**
 * W02 — 원문(같은 행 텍스트들)에 없는 숫자·단위·단위 없는 숫자 목록(없으면 []).
 *   비교는 토큰 단위(부분 문자열 아님 — "2.5배" 원문이 "5배" 를 허용하지 않는다): 원문 숫자 묶음+단위와 같거나,
 *   단일 숫자면 같은 단위의 원문 곱 묶음 구성 숫자 중 하나("60×40cm" 원문 → "60cm" 허용). 범위 묶음("18~26℃")은 전체 일치만.
 */
export function whyShortNumberProblems(v: string, sourceTexts: ReadonlyArray<string | null | undefined>): string[] {
  const src = numberTokens(sourceTexts.filter((t): t is string => typeof t === 'string').join('\n'))
    .filter((t) => t.unit !== null)
    .map((t) => ({
      whole: squash(`${t.group}${t.unit}`),
      unit: t.unit as string,
      parts: partsOf(t.group),
      // 결정 6(Kenny 2026-11-16): 범위 묶음(~ - – , numberTokens 가 NFKC 라 전각 물결 ～ 도 ~)은 단일 숫자 부분 일치 금지 —
      //   「18~26℃」 원문으로 「18℃ 이상」을 만들면 사실 축약(불변식 7). 곱(× x X) 묶음 부분 일치(「60×40cm」→「60cm」)는 유지.
      isRange: RANGE_SEP_RE.test(t.group),
    }));
  // 정규화 전 원문의 호환 숫자(전각 ６０·𝟔𝟎·①·٩ 등) — 값이 원문과 같아도 표기 자체가 W02(lint.compatDigits, L07 과 같은 판정).
  //   disguisedNumbers 의 비ASCII 숫자 묶음은 compatDigits 에 포함되므로 중복 보고하지 않고, 한글 수사+단위만 남긴다.
  const out: string[] = [
    ...compatDigits(v).map((d) => `숫자 표기 우회(호환 숫자) "${d}" — ASCII 숫자로`),
    ...disguisedNumbers(v)
      .filter((d) => compatDigits(d).length === 0)
      .map((d) => `숫자 표기 우회 "${d}" — ASCII 숫자로`),
  ];
  for (const t of numberTokens(v)) {
    if (t.unit === null) {
      out.push(`단위 없는 숫자 "${t.group}"`);
      continue;
    }
    const whole = squash(`${t.group}${t.unit}`);
    const parts = partsOf(t.group);
    const ok = src.some(
      (s) => s.whole === whole || (parts.length === 1 && !s.isRange && s.unit === t.unit && s.parts.includes(parts[0])),
    );
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
