// /vet 필터(스펙33 §5.8): 진료 동물(하나) · 야간 · 응급. 상태 + 쿼리(?treats=…&night=1&emergency=1), 저장 0(localStorage 키 없음).
//   필터는 거르기만 한다 — 순서는 ws-data(프리렌더 sortVets: 지역 → 이름 → id) 그대로(재정렬 0).
//   야간·응급은 값이 true 인 병원만(null = 확인 전 → 걸러짐, "가능" 추정 0).
import type { PublicVet } from '@ws/engine';

export interface VetFilter {
  treats: string | null;
  night: boolean;
  emergency: boolean;
}

export const NO_FILTER: VetFilter = Object.freeze({ treats: null, night: false, emergency: false });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isFiltered(f: VetFilter): boolean {
  return f.treats !== null || f.night || f.emergency;
}

export function applyVetFilter(vets: readonly PublicVet[], f: VetFilter): PublicVet[] {
  return vets.filter(
    (v) =>
      (f.treats === null || v.treats.includes(f.treats)) &&
      (!f.night || v.night === true) &&
      (!f.emergency || v.emergency === true),
  );
}

/** 쿼리 → 필터. treats 는 고를 수 있는 동물(choices) 안일 때만, 나머지 키는 무시. */
export function parseVetFilter(search: string, choices: readonly string[]): VetFilter {
  const q = new URLSearchParams(search);
  const t = q.get('treats');
  return {
    treats: t !== null && SLUG_RE.test(t) && choices.includes(t) ? t : null,
    night: q.get('night') === '1',
    emergency: q.get('emergency') === '1',
  };
}

/** 필터 → 쿼리('' 또는 '?…'). 다른 쿼리 키는 남기지 않는다(필터 외 상태 0). */
export function vetFilterSearch(f: VetFilter): string {
  const q = new URLSearchParams();
  if (f.treats !== null) q.set('treats', f.treats);
  if (f.night) q.set('night', '1');
  if (f.emergency) q.set('emergency', '1');
  const s = q.toString();
  return s === '' ? '' : `?${s}`;
}

/** 진료 동물 칩 = 노출 타입 중 목록 병원 하나 이상이 진료하는 타입(표시명만, data.types 순서). */
export function treatChoices<T extends { id: string; displayName: string }>(types: readonly T[], vets: readonly PublicVet[]): T[] {
  const used = new Set(vets.flatMap((v) => v.treats));
  return types.filter((t) => used.has(t.id));
}

/**
 * R4-6: 쿼리 ?treats= 가 노출 타입(ids) 중 하나면 그 id — 병원이 0이라 필터 칩이 없을 때 제목 「{동물} 진료하는 병원」에만 쓴다
 *   (거르기·저장 0). 병원이 있을 때는 parseVetFilter 결과만 쓴다(목록과 다른 동물 이름을 제목에 달지 않게).
 */
export function queryTreats(search: string, ids: readonly string[]): string | null {
  const t = new URLSearchParams(search).get('treats');
  return t !== null && SLUG_RE.test(t) && ids.includes(t) ? t : null;
}
