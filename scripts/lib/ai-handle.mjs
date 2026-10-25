// AI 핸들 판정(QA 82 D2, 불변식 7 — AI 는 검수자가 될 수 없다). 정의 단일 출처: server/src/seed/ai-handle.json.
//   server/src/seed/ai-handle.ts 와 같은 알고리즘의 독립 구현 — 패리티 테스트 server/src/__tests__/seed.ai-handle.test.ts.
//   정규화: NFKC → 서식 문자(\p{Cf}, 폭 0 공백 등) 제거 → 소문자. 그 뒤
//     substrings 중 하나라도 부분 문자열로 포함 → AI 핸들(예 chatgpt·claude3·ai_kenny).
//     boundedTokens(ai)는 앞뒤가 영문 소문자가 아닐 때만(문자열 경계·_·-·숫자·공백 등) → 'daisy'·'maia'·'kenny' 는 통과.
//   의존성 0, 네트워크 0.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const AI_HANDLE_DEF = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'server', 'src', 'seed', 'ai-handle.json'), 'utf8')));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 정의 → 정규식(정규화된 문자열에 적용). */
export function buildAiHandleRe(def) {
  if (!def || def.v !== 1 || !Array.isArray(def.substrings) || !Array.isArray(def.boundedTokens)) throw new Error('ai-handle.json: 형식 오류(v 1, substrings[], boundedTokens[])');
  const parts = [
    ...def.substrings.map(esc),
    ...def.boundedTokens.map((t) => `(?:^|[^a-z])${esc(t)}(?:[^a-z]|$)`),
  ];
  if (parts.length === 0) throw new Error('ai-handle.json: 항목이 비었다');
  return new RegExp(parts.join('|'));
}

export const AI_HANDLE_RE = buildAiHandleRe(AI_HANDLE_DEF);

export function normalizeHandle(s) {
  return s.normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase();
}

/** 문자열이면 정규화 후 판정, 문자열이 아니면 false(형식 검사는 호출자 몫). */
export function isAiHandle(v) {
  return typeof v === 'string' && AI_HANDLE_RE.test(normalizeHandle(v));
}
