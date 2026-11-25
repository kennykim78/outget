// 콘텐츠 린트(불변식 5) — 금지어 정확 일치 = ERROR(L01), 어간 = WARN(L02),
//   문체(L03)·자리표시자(L04)·검색어 토큰(L05)·공백 제거 후에만 걸리는 짧은 금지어 = WARN(L06),
//   호환 숫자 표기(정규화 전 원문, compatDigits) = ERROR(L07, 후기 quote 는 WARN).
//   금지어 목록 단일 소스: banned-words.json (scripts/ compliance-scan 과 패리티 테스트로 묶임).
import { asRec, isSlotRow, type Collector, type Rec, type SeedKey } from './common.js';
import data from './banned-words.json' with { type: 'json' };

export interface BannedTerm {
  term: string;
  re: RegExp;
}

interface WordEntry {
  term: string;
  pattern: string;
}

const compile = (list: readonly WordEntry[]): readonly BannedTerm[] =>
  list.map((w) => ({ term: w.term, re: new RegExp(w.pattern, 'u') }));

/**
 * 373 D5: 영문 대소문자 변형(Best·bEsT·Krw…) 우회 차단. 판정 = 원래 'u' 일치 ∨ 'giu' 일치 중 「영문 소문자만이 아닌」 조각.
 *   전부 소문자 ASCII 조각(`best` — 코드 식별자, 353 §N2 결정·seed.lint 「소문자 best 대상 아님」)만 예외로 남긴다. 원래 'u' 일치는
 *   그대로 포함하므로 기존 판정이 약해지는 경우는 없다. scripts/lib/normalize.mjs termHit 과 같은 규칙(lint-parity).
 */
const CI_CACHE = new Map<string, RegExp>();
const ciOf = (re: RegExp): RegExp => {
  let r = CI_CACHE.get(re.source);
  if (!r) CI_CACHE.set(re.source, (r = new RegExp(re.source, 'giu')));
  return r;
};
const qualifies = (m: string): boolean => /[^a-z]/.test(m);
function termHit(re: RegExp, text: string): boolean {
  if (re.test(text)) return true;
  for (const m of text.matchAll(ciOf(re))) if (qualifies(m[0])) return true;
  return false;
}
function termStrip(re: RegExp, text: string): string {
  return text.replace(new RegExp(re.source, 'gu'), ' ').replace(ciOf(re), (m) => (qualifies(m) ? ' ' : m));
}

/** 373 D5: 기본 무시 문자(Default_Ignorable_Code_Point) 전부 — 한글 채움 문자·변형 선택자·CGJ·태그·몽골 FVS 등. */
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/** L01 — 정확 금지어(불변식 5). */
export const BANNED: readonly BannedTerm[] = compile(data.banned);

/** L02 — 금지어 어간(활용형 의심). 정확 금지어로 이미 잡힌 부분은 제외. */
export const STEMS: readonly BannedTerm[] = compile(data.stems);

export interface LintHit {
  rule: 'L01' | 'L02' | 'L06';
  term: string;
}

/**
 * 린트용 정규화. 기본 무시 문자(\p{Default_Ignorable_Code_Point}, 373 D5 — 이전엔 U+00AD·200B~200F·2060·FEFF 만) 제거 → NFKC → 다시 제거
 * → 공백 연속을 ' ' 하나로.
 * stripped 는 공백을 전부 제거한다.
 */
export function normalizeLintText(s: string, mode: 'spaced' | 'stripped'): string {
  // 373 D5: 기본 무시 문자 전부 제거 → NFKC → 다시 제거(NFKC 가 만드는 채움 문자) — scripts/lib/normalize.mjs 와 같은 순서.
  const spaced = s
    .replace(DEFAULT_IGNORABLE, '')
    .normalize('NFKC')
    .replace(/\p{M}/gu, '') // 374 N3: NFKC 뒤 남는 결합 부호(인́기) 제거
    .replace(DEFAULT_IGNORABLE, '')
    .replace(/\s+/g, ' ');
  return mode === 'spaced' ? spaced : spaced.replace(/ /g, '');
}

/** 금지어·어간 검사(순수). 정규화 후 정확 금지어 부분을 지운 뒤 어간을 찾는다. */
export function lintText(text: string): LintHit[] {
  const hits: LintHit[] = [];
  const spaced = normalizeLintText(text, 'spaced');
  const stripped = normalizeLintText(text, 'stripped');
  let rest = spaced;
  for (const b of BANNED) {
    if (termHit(b.re, spaced)) {
      hits.push({ rule: 'L01', term: b.term });
      rest = termStrip(b.re, rest);
    } else if (termHit(b.re, stripped)) {
      // 공백 제거 후에만 걸림 — 긴 금지어는 우회로 보고 ERROR, 짧은 것(단어 경계 걸침 가능)은 WARN.
      const len = b.term.replace(/[\sN]/g, '').length;
      hits.push({ rule: len >= 3 ? 'L01' : 'L06', term: b.term });
    }
  }
  for (const s of STEMS) {
    if (termHit(s.re, rest)) hits.push({ rule: 'L02', term: s.term });
  }
  return hits;
}

/** 문장 수 — 마침표/물음표/느낌표 뒤 공백·끝을 경계로(소수점 1.5 는 경계 아님). */
export function sentenceCount(text: string): number {
  return text
    .split(/[.!?。](?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

/**
 * 이유 한 줄(whyShort, D9 ②) 전용 엄격 문장 수 — sentenceCount(why·caution 규칙, 결과 불변)와 따로 둔다.
 *   NFKC(전각 마침표 ．→ . , ｡→ 。) 뒤, 마침표 뒤 공백이 없어도 경계("요.먹이도" = 2문장). 단 숫자 사이 마침표(1.5)는 경계 아님.
 */
export function strictSentenceCount(text: string): number {
  return text
    .normalize('NFKC')
    .split(/[!?。]|(?<!\d)\.|\.(?!\d)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

// 숫자 뒤에 와야 하는 단위·수량사. 긴 것 먼저.
const UNIT_RE =
  /^\s?(?:cm|mm|km|kg|ml|mL|kcal|cc|m|g|L|l|%|℃|°C|°|원|만|천|개월|개|마리|회|번|년|일|주|시간|분|초|층|종|가지|단계|세|살|배|명|월|호|차|박|칸|장|쌍|곳)/;
// 숫자 묶음: 18~26, 60×40, 1.5, 15-20
const NUMBER_GROUP_RE = /\d+(?:\.\d+)?(?:\s*[~×xX\-–\u301C\u2212\u2014]\s*\d+(?:\.\d+)?)*/g;

/** 단위 없는 숫자 묶음 목록(순수). 예: "80×50 케이지" → ["80×50"]. */
export function numbersWithoutUnit(text: string): string[] {
  return numberTokens(text)
    .filter((t) => t.unit === null)
    .map((t) => t.group);
}

/**
 * 숫자 묶음 + 뒤따르는 단위(없으면 null) 목록(순수, D9 ② W02 와 공용). 영문에 붙은 숫자(모델명 등)는 건너뛴다.
 *   예: "가로 60×40cm 이상, 2 개" → [{group:'60×40', unit:'cm'}, {group:'2', unit:'개'}].
 */
export function numberTokens(raw: string): Array<{ group: string; unit: string | null }> {
  // NFKC 먼저: 전각 ９９·수학 굵은 𝟗𝟗·원문자 ⑨·㎝ 등을 ASCII 숫자·단위로 펴서 ASCII \d 규칙이 우회되지 않게.
  //   NFKC 로도 ASCII 가 안 되는 숫자(아라비아-인도 ٩·❾ 등)·한글 수사+단위는 disguisedNumbers 가 따로 잡는다.
  const text = raw.normalize('NFKC');
  const out: Array<{ group: string; unit: string | null }> = [];
  const re = new RegExp(NUMBER_GROUP_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    if (/[A-Za-z_]$/.test(before)) continue;
    const u = UNIT_RE.exec(text.slice(m.index + m[0].length));
    out.push({ group: m[0], unit: u ? u[0].trim() : null });
  }
  return out;
}

// NFKC 뒤에도 남는 비ASCII 숫자(\p{N}: 아라비아-인도 ٩·데바나가리 ९·❾·〇 등).
const NON_ASCII_NUMBER_RE = /[^\P{N}0-9]+/gu;
// 한글 수사(고유어·한자어) 바로 뒤(공백 1개 허용) 측정 단위. 앞은 한글이 아닐 때만("높이 cm" 의 "이" 는 수사 아님).
//   고유어 수 세기(한 번·두 개·세 마리)는 자연어라 대상 아님 — 측정 단위(cm·g·%·℃ 및 센티·그램 등 한글 단위)만.
const HANGUL_NUMERAL =
  '(?:(?:스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔|열)(?:하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉)?|하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|[일이삼사오육칠팔구십백천영공]+)';
const MEASURE_UNIT = '(?:cm|mm|km|kg|ml|mL|kcal|cc|m|g|L|l|%|°C|°|센티미터|센티|밀리미터|밀리|킬로그램|킬로미터|킬로|미터|그램|리터|퍼센트)';
const HANGUL_NUMERAL_UNIT_RE = new RegExp(`(?<![가-힣])${HANGUL_NUMERAL}\\s?${MEASURE_UNIT}(?![A-Za-z])`, 'gu');

/**
 * 숫자 표기 우회 목록(순수, L03·W02 공용) — NFKC 뒤에도 남는 비ASCII 숫자, 한글 수사+측정 단위("아흔cm").
 *   숫자는 ASCII 로 쓴다(단위·원문 대조 규칙이 ASCII 기준).
 */
export function disguisedNumbers(raw: string): string[] {
  const text = raw.normalize('NFKC');
  return [...(text.match(NON_ASCII_NUMBER_RE) ?? []), ...(text.match(HANGUL_NUMERAL_UNIT_RE) ?? [])];
}

/** 호환 숫자 한 글자(정규화 전 원문 기준) — NFKC 로 ASCII 숫자가 생기거나(전각 ０·①·⑴·⒈·㉑·⓪·𝟎·²·½·㎡ 등), 그 자체가 비ASCII 숫자(\p{N}: ❶·⓵·٩·〇 등). */
function isCompatDigit(ch: string): boolean {
  if (/[0-9]/.test(ch)) return false;
  const n = ch.normalize('NFKC');
  if (n !== ch && /[0-9]/.test(n)) return true;
  return /\p{N}/u.test(ch);
}

/**
 * 호환 숫자 표기 목록(순수, L07·W02 공용) — **정규화 전 원문**에서 이어진 호환 숫자 글자 묶음.
 *   numberTokens·disguisedNumbers 는 NFKC 뒤 값 대조라 전각 ６０ 을 60 으로 펴 통과시킨다. 이 함수는 표기 자체를 막는다.
 *   NFKC 로 바뀌어도 숫자가 안 생기는 문자(℃·ㆍ·…·한글 음절·호환 자모·㈀·㉠)는 대상 아님. normalizeLintText 와 무관(lint-parity 불변).
 *   한글 채움 문자(U+3164 등)로 금지어를 쪼개는 우회는 normalizeLintText(373 D5 — Default_Ignorable 전부 제거)가 막는다.
 */
export function compatDigits(raw: string): string[] {
  const out: string[] = [];
  let run = '';
  for (const ch of raw) {
    if (isCompatDigit(ch)) run += ch;
    else if (run !== '') {
      out.push(run);
      run = '';
    }
  }
  if (run !== '') out.push(run);
  return out;
}

const PLACEHOLDERS = new Set(['', '—', '–', '-', 'TODO', 'TBD', 'N/A']);

export function isPlaceholder(text: string): boolean {
  const t = text.trim();
  return PLACEHOLDERS.has(t.toUpperCase()) || PLACEHOLDERS.has(t) || /^TODO\b/i.test(t) || isBracketPlaceholder(t);
}

// 문자열 전체가 대괄호 표시(짧은 1쌍) 또는 대괄호가 검수/TBD/TODO/? 로 시작하는 문자열. 문장 속 대괄호는 통과.
function isBracketPlaceholder(t: string): boolean {
  if (/^\[\s*(검수|TBD|TODO|\?)/i.test(t)) return true;
  return /^\[[^[\]]{0,30}\]$/.test(t);
}

// ── 파일별 텍스트 필드(계획 §F "Lint text fields") ─────────────
export type TextRole = 'name' | 'prose' | 'why' | 'caution' | 'keyword' | 'range' | 'quote';

export interface TextField {
  path: string;
  text: string;
  role: TextRole;
}

function push(out: TextField[], path: string, v: unknown, role: TextRole): void {
  if (typeof v === 'string') out.push({ path, text: v, role });
}

function ruleReasons(out: TextField[], base: string, rs: unknown): void {
  const rules = asRec(rs)?.rules;
  if (!Array.isArray(rules)) return;
  rules.forEach((r, i) => push(out, `${base}.rules[${i}].reason`, asRec(r)?.reason, 'prose'));
}

function requirementTexts(out: TextField[], base: string, r: Rec): void {
  const p = base ? `${base}.` : '';
  push(out, `${p}why`, r.why, 'why');
  // D9 ②: 이유 한 줄도 why 와 같은 린트(금지어 L01·어간 L02·자리표시자 L04·단위 없는 숫자 L03). 길이·문장·숫자 출처는 W01·W02.
  push(out, `${p}whyShort`, r.whyShort, 'why');
  push(out, `${p}caution`, r.caution, 'caution');
  push(out, `${p}avoid`, r.avoid, 'prose');
  push(out, `${p}notNowReason`, r.notNowReason, 'prose');
  push(out, `${p}searchKeyword`, r.searchKeyword, 'keyword');
  ruleReasons(out, `${p}minSpec`, r.minSpec);
  ruleReasons(out, `${p}recommendedSpec`, r.recommendedSpec);
}

export function textFieldsOf(key: SeedKey, r: Rec): TextField[] {
  const out: TextField[] = [];
  switch (key) {
    case 'animalTypes': {
      push(out, 'displayName', r.displayName, 'name');
      push(out, 'oneLiner', r.oneLiner, 'prose');
      push(out, 'seoTitle', r.seoTitle, 'name');
      push(out, 'seoDescription', r.seoDescription, 'prose');
      if (Array.isArray(r.aliases)) r.aliases.forEach((a, i) => push(out, `aliases[${i}]`, a, 'name'));
      const reqs = asRec(asRec(r.careOverrides)?.requirements);
      if (reqs) {
        for (const [itemId, ov] of Object.entries(reqs)) {
          const o = asRec(ov);
          if (o) requirementTexts(out, `careOverrides.requirements.${itemId}`, o);
        }
      }
      break;
    }
    case 'taxa':
      push(out, 'koreanName', r.koreanName, 'name');
      push(out, 'legal.note', asRec(r.legal)?.note, 'prose');
      break;
    case 'careProfiles':
      push(out, 'name', r.name, 'name');
      if (Array.isArray(r.careNotes)) r.careNotes.forEach((n, i) => push(out, `careNotes[${i}]`, n, 'prose'));
      break;
    case 'supplyItems': {
      push(out, 'name', r.name, 'name');
      push(out, 'description', r.description, 'prose');
      const fields = asRec(r.specSchema)?.fields;
      if (Array.isArray(fields)) {
        fields.forEach((f, i) => {
          const fr = asRec(f);
          if (!fr) return;
          push(out, `specSchema.fields[${i}].label`, fr.label, 'name');
          const ol = asRec(fr.optionLabels);
          if (ol) for (const [k, v] of Object.entries(ol)) push(out, `specSchema.fields[${i}].optionLabels.${k}`, v, 'name');
        });
      }
      break;
    }
    case 'supplyRequirements':
      requirementTexts(out, '', r);
      break;
    case 'compatibilityRules':
      if (Array.isArray(r.rules)) r.rules.forEach((x, i) => push(out, `rules[${i}].message`, asRec(x)?.message, 'prose'));
      break;
    case 'setupBundles':
      push(out, 'name', r.name, 'name');
      push(out, 'purpose', r.purpose, 'prose');
      push(out, 'note', r.note, 'prose');
      push(out, 'estimatedRangeText', r.estimatedRangeText, 'range');
      break;
    case 'curatedProducts':
      push(out, 'title', r.title, 'name');
      break;
    case 'testimonials':
      if (r.status === 'APPROVED') push(out, 'quote', r.quote, 'quote');
      break;
    case 'vetClinics':
      push(out, 'name', r.name, 'name');
      break;
    case 'photos':
      break;
    case 'budgetTips': {
      // 팁 본문 전부(Kenny 2026-11-22: 사람 검수 없이 노출되는 REFERENCE 행 — 불변식 5 위험을 린트로 막는다).
      push(out, 'substitute', r.substitute, 'name');
      for (const f of ['materials', 'steps', 'dimensions', 'cautions', 'mustCheck'] as const) {
        const arr = r[f];
        if (Array.isArray(arr)) arr.forEach((x, i) => push(out, `${f}[${i}]`, x, 'prose'));
      }
      if (Array.isArray(r.references)) {
        r.references.forEach((x, i) => {
          const ref = asRec(x);
          push(out, `references[${i}].title`, ref?.title, 'name');
          push(out, `references[${i}].siteName`, ref?.siteName, 'name');
        });
      }
      break;
    }
  }
  return out;
}

/** 한 레코드 린트 → Collector 에 L01~L05 기록. SLOT 행은 면제. */
export function lintRecord(key: SeedKey, id: string, r: Rec, out: Collector): void {
  if (isSlotRow(key, r)) return;
  for (const f of textFieldsOf(key, r)) {
    for (const h of lintText(f.text)) {
      if (h.rule === 'L01') out.error('L01', key, id, f.path, `금지어 "${h.term}" (불변식 5)`);
      else if (h.rule === 'L06') out.warn('L06', key, id, f.path, `공백 제거 시 금지어 "${h.term}" 와 일치 — 단어 경계 확인`);
      else out.warn('L02', key, id, f.path, `금지어 어간 "${h.term}" — 문구 확인 필요`);
    }
    if (isPlaceholder(f.text)) out.error('L04', key, id, f.path, `자리표시자 값 "${f.text}" — null 로 두거나 채운다`);
    if (f.role === 'why' && sentenceCount(f.text) > 2) out.warn('L03', key, id, f.path, `why 는 2문장 이하 (현재 ${sentenceCount(f.text)})`);
    if (f.role === 'caution' && sentenceCount(f.text) > 1) out.warn('L03', key, id, f.path, `caution 은 1문장 (현재 ${sentenceCount(f.text)})`);
    if (f.role === 'prose' || f.role === 'why' || f.role === 'caution') {
      const bare = numbersWithoutUnit(f.text);
      if (bare.length > 0) out.warn('L03', key, id, f.path, `단위 없는 숫자: ${bare.join(', ')}`);
      const odd = disguisedNumbers(f.text);
      if (odd.length > 0) out.warn('L03', key, id, f.path, `숫자 표기 우회(비ASCII 숫자·한글 수사+단위): ${odd.join(', ')} — ASCII 숫자로`);
    }
    const compat = compatDigits(f.text);
    if (compat.length > 0) {
      // 후기 원문(quote)은 원문 보존 원칙이라 WARN, 나머지 역할은 ERROR(불변식 5·7 — 숫자 표기 우회로 값 대조를 비켜 가지 않게).
      const msg = `호환 숫자 표기: ${compat.join(', ')} — ASCII 숫자로`;
      if (f.role === 'quote') out.warn('L07', key, id, f.path, msg);
      else out.error('L07', key, id, f.path, msg);
    }
    if (f.role === 'keyword' && f.text.trim() !== '' && !f.text.includes('{animal}')) {
      out.warn('L05', key, id, f.path, 'searchKeyword override 에 {animal} 토큰 없음 — 동물명이 붙지 않는다');
    }
  }
}
