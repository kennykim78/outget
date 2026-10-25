// AI 핸들 판정(QA 82 D2, 불변식 7 — AI 는 검수자가 될 수 없다). 정의 단일 출처: ./ai-handle.json.
//   scripts/lib/ai-handle.mjs 와 같은 알고리즘의 독립 구현 — 패리티 테스트 __tests__/seed.ai-handle.test.ts.
//   정규화: NFKC → 서식 문자(\p{Cf}) 제거 → 소문자. substrings 부분 문자열 포함 또는
//   boundedTokens(ai)가 영문 소문자가 아닌 경계(문자열 끝·_·-·숫자·공백 등) 사이에 있으면 AI 핸들.
//   순수 모듈.
import def from './ai-handle.json' with { type: 'json' };

export interface AiHandleDef {
  v: number;
  substrings: readonly string[];
  boundedTokens: readonly string[];
}

export const AI_HANDLE_DEF: Readonly<AiHandleDef> = Object.freeze(def as AiHandleDef);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function buildAiHandleRe(d: AiHandleDef): RegExp {
  if (!d || d.v !== 1 || !Array.isArray(d.substrings) || !Array.isArray(d.boundedTokens)) throw new Error('ai-handle.json: 형식 오류(v 1, substrings[], boundedTokens[])');
  const parts = [...d.substrings.map(esc), ...d.boundedTokens.map((t) => `(?:^|[^a-z])${esc(t)}(?:[^a-z]|$)`)];
  if (parts.length === 0) throw new Error('ai-handle.json: 항목이 비었다');
  return new RegExp(parts.join('|'));
}

export const AI_HANDLE_RE: RegExp = buildAiHandleRe(AI_HANDLE_DEF);

export const normalizeHandle = (s: string): string => s.normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase();

/** 문자열이면 정규화 후 판정, 아니면 false(형식 검사는 호출자 몫). */
export function isAiHandle(v: unknown): boolean {
  return typeof v === 'string' && AI_HANDLE_RE.test(normalizeHandle(v));
}
