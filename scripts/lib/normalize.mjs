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

const INVISIBLE = /[­​-‏⁠﻿]/g;

/** @param {string} s @param {'spaced'|'stripped'} mode */
export function normalizeLintText(s, mode) {
  const spaced = String(s).normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ');
  return mode === 'spaced' ? spaced : spaced.replace(/ /g, '');
}

function compileList(list, name) {
  if (!Array.isArray(list)) throw new ConfigError(`banned-words.json: "${name}" 배열이 아니다`);
  return list.map((w, i) => {
    if (!w || typeof w.term !== 'string' || typeof w.pattern !== 'string' || w.term === '' || w.pattern === '') {
      throw new ConfigError(`banned-words.json: ${name}[${i}] 에 term·pattern 문자열이 없다`);
    }
    try {
      return { term: w.term, re: new RegExp(w.pattern, 'u') };
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
    throw new ConfigError(`금지어 단일 소스 없음: ${path}`);
  }
  let data;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new ConfigError(`banned-words.json 파싱 실패(JSON 문법 오류 ${jsonErrorWhere(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)})`);
  }
  return compileBannedWords(data);
}

/** lint.ts lintText 와 같은 판정. @returns {{rule:'L01'|'L02'|'L06', term:string}[]} */
export function lintText(text, bw) {
  const hits = [];
  const spaced = normalizeLintText(text, 'spaced');
  const stripped = normalizeLintText(text, 'stripped');
  let rest = spaced;
  for (const b of bw.banned) {
    if (b.re.test(spaced)) {
      hits.push({ rule: 'L01', term: b.term });
      rest = rest.replace(new RegExp(b.re.source, 'gu'), ' ');
    } else if (b.re.test(stripped)) {
      const len = b.term.replace(/[\sN]/g, '').length;
      hits.push({ rule: len >= 3 ? 'L01' : 'L06', term: b.term });
    }
  }
  for (const s of bw.stems) {
    if (s.re.test(rest)) hits.push({ rule: 'L02', term: s.term });
  }
  return hits;
}
