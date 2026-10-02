// 셸(헤더 칩·탭 홈)이 가리킬 동물 — route.typeId 우선, 없으면 저장된 ws.animalType. 둘 다 data.types(노출분) 안에 있을 때만.
//   data.types 에 없는 id 는 무시(계약 C-1). 저장값 읽기는 animal/selection(FE2) 몫 — 여기는 순수 선택만.
import type { PublicAnimalType, RouteKind } from '@ws/engine';

export function pickShellType(
  types: readonly PublicAnimalType[],
  routeTypeId: string | null | undefined,
  storedTypeId: string | null | undefined,
): PublicAnimalType | null {
  const find = (id: string | null | undefined) => (typeof id === 'string' ? types.find((t) => t.id === id) ?? null : null);
  return find(routeTypeId) ?? find(storedTypeId);
}

/** 동물 홈 경로(/{slug}). slug 는 시드 값 — 경로 문자만 인코딩. */
export function typeHomeHref(type: Pick<PublicAnimalType, 'slug'>): string {
  return encodeURI(`/${type.slug}`);
}

export type NavCurrent = 'home' | 'supplies' | 'vet' | null;

/** 현재 메뉴(프리렌더 navCurrent 와 같은 표). */
export function navCurrentFor(kind: RouteKind): NavCurrent {
  switch (kind) {
    case 'HOME':
    case 'FAMILY':
    case 'TYPE':
    case 'SETUP':
      return 'home';
    case 'SUPPLIES':
    case 'SUPPLY_ITEM':
    case 'SUPPLY_ITEM_TYPE':
      return 'supplies';
    case 'VET':
    case 'VET_REGION':
      return 'vet';
    default:
      return null;
  }
}
