// 병원 노출 순서 — 클라이언트 단일 출처(R6 G1). 홈 B ④ 레일과 /vet 목록이 같은 규칙을 쓴다.
//   규칙 = 프리렌더 server/src/prerender/pages/common.ts sortVets 와 동일: 지역 → 이름 → id(코드 포인트 비교, 결정론).
//   ws-data 가 이미 이 순서여도 안정 정렬이라 결과 불변(멱등). 필터는 이 순서를 거르기만 한다.
import type { PublicVet } from '@ws/engine';

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

export function sortVets<T extends Pick<PublicVet, 'region' | 'name' | 'id'>>(vs: readonly T[]): T[] {
  return [...vs].sort((p, q) => cmp(p.region, q.region) || cmp(p.name, q.name) || cmp(p.id, q.id));
}
