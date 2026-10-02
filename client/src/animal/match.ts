// "잘 모르겠어요" 후보 찾기(PRD US-002) — displayName·aliases 부분 일치, 최대 5개, 입력은 sanitizeQuery 로 정제.
//   후보 안내일 뿐 종을 확정하지 않는다(고정 문구는 화면이 항상 보여 준다). 노출 타입(ws-data data.types)만 대상.
import { sanitizeQuery } from '@ws/events';
import type { PublicAnimalType } from '@ws/engine';

const MAX_CANDIDATES = 5;

const norm = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

export interface Candidate {
  type: PublicAnimalType;
  /** 입력과 맞은 별칭(이름으로 맞았으면 null). */
  matchedAlias: string | null;
}

/** 순서: 이름 일치 먼저, 그다음 별칭 일치 — 같은 묶음 안에서는 data.types 순서. */
export function findCandidates(types: readonly PublicAnimalType[], raw: string): Candidate[] {
  const q = norm(sanitizeQuery(raw));
  if (q === '') return [];
  const byName: Candidate[] = [];
  const byAlias: Candidate[] = [];
  for (const type of types) {
    if (norm(type.displayName).includes(q)) {
      byName.push({ type, matchedAlias: null });
      continue;
    }
    const alias = type.aliases.find((a) => norm(a).includes(q));
    if (alias !== undefined) byAlias.push({ type, matchedAlias: alias });
  }
  return [...byName, ...byAlias].slice(0, MAX_CANDIDATES);
}
