// 콘텐츠 린트(불변식 5) — 금지어 정확 일치 = ERROR(L01), 어간 = WARN(L02),
//   문체(L03)·자리표시자(L04)·검색어 토큰(L05)·공백 제거 후에만 걸리는 짧은 금지어 = WARN(L06).
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

/** L01 — 정확 금지어(불변식 5). */
export const BANNED: readonly BannedTerm[] = compile(data.banned);

/** L02 — 금지어 어간(활용형 의심). 정확 금지어로 이미 잡힌 부분은 제외. */
export const STEMS: readonly BannedTerm[] = compile(data.stems);

export interface LintHit {
  rule: 'L01' | 'L02' | 'L06';
  term: string;
}

/**
 * 린트용 정규화. NFKC → 소프트하이픈·제로폭·방향 표식 제거 → 공백 연속을 ' ' 하나로.
 * stripped 는 공백을 전부 제거한다.
 */
export function normalizeLintText(s: string, mode: 'spaced' | 'stripped'): string {
  const spaced = s
    .normalize('NFKC')
    .replace(/[\u00AD\u200B-\u200F\u2060\uFEFF]/g, '')
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
    if (b.re.test(spaced)) {
      hits.push({ rule: 'L01', term: b.term });
      rest = rest.replace(new RegExp(b.re.source, 'gu'), ' ');
    } else if (b.re.test(stripped)) {
      // 공백 제거 후에만 걸림 — 긴 금지어는 우회로 보고 ERROR, 짧은 것(단어 경계 걸침 가능)은 WARN.
      const len = b.term.replace(/[\sN]/g, '').length;
      hits.push({ rule: len >= 3 ? 'L01' : 'L06', term: b.term });
    }
  }
  for (const s of STEMS) {
    if (s.re.test(rest)) hits.push({ rule: 'L02', term: s.term });
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

// 숫자 뒤에 와야 하는 단위·수량사. 긴 것 먼저.
const UNIT_RE =
  /^\s?(?:cm|mm|km|kg|ml|mL|kcal|cc|m|g|L|l|%|℃|°C|°|원|만|천|개월|개|마리|회|번|년|일|주|시간|분|초|층|종|가지|단계|세|살|배|명|월|호|차|박|칸|장|쌍)/;
// 숫자 묶음: 18~26, 60×40, 1.5, 15-20
const NUMBER_GROUP_RE = /\d+(?:\.\d+)?(?:\s*[~×xX\-–]\s*\d+(?:\.\d+)?)*/g;

/** 단위 없는 숫자 묶음 목록(순수). 예: "80×50 케이지" → ["80×50"]. */
export function numbersWithoutUnit(text: string): string[] {
  const out: string[] = [];
  NUMBER_GROUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_GROUP_RE.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    // 영문·숫자에 붙은 숫자(모델명 등)는 건너뛴다.
    if (/[A-Za-z_]$/.test(before)) continue;
    const after = text.slice(m.index + m[0].length);
    if (!UNIT_RE.test(after)) out.push(m[0]);
  }
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
    }
    if (f.role === 'keyword' && f.text.trim() !== '' && !f.text.includes('{animal}')) {
      out.warn('L05', key, id, f.path, 'searchKeyword override 에 {animal} 토큰 없음 — 동물명이 붙지 않는다');
    }
  }
}
