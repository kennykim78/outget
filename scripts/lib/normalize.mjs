// 금지어 정규화·판정 — R3 계획 §6-1 절차. server/src/seed/lint.ts(normalizeLintText·lintText)와 동일 결과여야 한다
//   (E3 lint-parity.test.ts 가 같은 코퍼스로 묶는다). 의존성 0, 순수.
//   spaced   = NFKC → 소프트하이픈·제로폭·방향표식·워드조이너·BOM 제거 → 공백 연속을 ' ' 하나로
//   stripped = spaced 에서 공백 전부 제거
//   판정: spaced 매칭 → L01 / spaced 아님·stripped 매칭 → term(공백·N 제외) 길이 ≥3 이면 L01, 아니면 L06
//         어간(stems)은 정확 금지어 부분을 지운 나머지(spaced)에서 → L02
import { readFileSync } from 'node:fs';
// 233: 설정 오류 메시지에 파일 내용(정규식 원문·JSON 조각)을 넣지 않는다 — 위치 숫자·고정 사유만. 순환 import(rules-source → normalize)는
//   함수 선언만 호출 시점에 쓰므로 평가 순서와 무관하다(최상위에서 서로의 값을 쓰지 않음).
import { jsonErrorWhere } from './rules-source.mjs';

export class ConfigError extends Error {}

/** RegExp 생성 오류 → V8 고정 사유('Unterminated group' 등)만. 메시지 앞부분 '/<패턴>/u' 는 버린다. 사유가 고정 어휘 모양이 아니면 '사유 미상'. */
function regexErrorReason(e) {
  const m = /: ([^:]*)$/.exec(String(e?.message ?? ''));
  const r = m ? m[1].trim() : '';
  return /^[A-Za-z][A-Za-z ,'()-]{0,79}$/.test(r) ? r : '사유 미상';
}

// 373 D5: 기본 무시 문자(Default_Ignorable_Code_Point) 전부 — NFKC 앞뒤 두 번(server/src/seed/lint.ts 와 같은 순서).
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/** @param {string} s @param {'spaced'|'stripped'} mode */
export function normalizeLintText(s, mode) {
  // 374 N3: NFKC 뒤 결합 부호(\p{M}) 제거 — lint.ts 와 같은 순서.
  const spaced = String(s).replace(INVISIBLE, '').normalize('NFKC').replace(/\p{M}/gu, '').replace(INVISIBLE, '').replace(/\s+/g, ' ');
  return mode === 'spaced' ? spaced : spaced.replace(/ /g, '');
}

function compileList(list, name) {
  if (!Array.isArray(list)) throw new ConfigError(`banned-words.json: "${name}" 배열이 아니다`);
  return list.map((w, i) => {
    if (!w || typeof w.term !== 'string' || typeof w.pattern !== 'string' || w.term === '' || w.pattern === '') {
      throw new ConfigError(`banned-words.json: ${name}[${i}] 에 term·pattern 문자열이 없다`);
    }
    try {
      return { term: w.term, re: new RegExp(w.pattern, 'u'), ci: new RegExp(w.pattern, 'giu') };
    } catch (e) {
      throw new ConfigError(`banned-words.json: ${name}[${i}] 정규식 오류(${regexErrorReason(e)})`);
    }
  });
}

/** §6-1 형식 객체 → 컴파일. 형식이 다르면 ConfigError. */
export function compileBannedWords(data) {
  if (!data || typeof data !== 'object' || data.v !== 1) throw new ConfigError('banned-words.json: v 가 1 이 아니다');
  const banned = compileList(data.banned, 'banned');
  if (banned.length === 0) throw new ConfigError('banned-words.json: banned 가 비었다');
  return { banned, stems: compileList(data.stems ?? [], 'stems') };
}

/** 파일 읽기 + 컴파일. 없음·파싱 실패·형식 오류 = ConfigError(exit 2). */
export function loadBannedWords(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError('금지어 단일 소스 없음(server/src/seed/banned-words.json — 경로 생략)'); // 239(Codex night-qa4 #1): --root 경로 값 생략
  }
  let data;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ConfigError(`banned-words.json 파싱 실패(JSON 문법 오류 ${jsonErrorWhere(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)})`);
  }
  return compileBannedWords(data);
}

// 373 D5: 영문 대소문자 변형(Best·bEsT) 우회 차단 — 원래 'u' 일치 ∨ 'giu' 일치 중 영문 소문자만이 아닌 조각.
//   전부 소문자 ASCII(`best` 코드 식별자, 353 §N2)만 예외. server/src/seed/lint.ts termHit·termStrip 과 같은 규칙.
const qualifies = (m) => /[^a-z]/.test(m);
const ciOf = (b) => b.ci ?? new RegExp(b.re.source, 'giu');
function termHit(b, text) {
  if (b.re.test(text)) return true;
  for (const m of text.matchAll(ciOf(b))) if (qualifies(m[0])) return true;
  return false;
}
function termStrip(b, text) {
  return text.replace(new RegExp(b.re.source, 'gu'), ' ').replace(ciOf(b), (m) => (qualifies(m) ? ' ' : m));
}

/** lint.ts lintText 와 같은 판정. @returns {{rule:'L01'|'L02'|'L06', term:string}[]} */
export function lintText(text, bw) {
  const hits = [];
  const spaced = normalizeLintText(text, 'spaced');
  const stripped = normalizeLintText(text, 'stripped');
  let rest = spaced;
  for (const b of bw.banned) {
    if (termHit(b, spaced)) {
      hits.push({ rule: 'L01', term: b.term });
      rest = termStrip(b, rest);
    } else if (termHit(b, stripped)) {
      const len = b.term.replace(/[\sN]/g, '').length;
      hits.push({ rule: len >= 3 ? 'L01' : 'L06', term: b.term });
    }
  }
  for (const s of bw.stems) {
    if (termHit(s, rest)) hits.push({ rule: 'L02', term: s.term });
  }
  return hits;
}
