// 라우트 → 화면(계약 C-2 · C-R5-6): HOME·SAVE·/pick = 홈 A(SAVE 는 + L8, /pick 은 + L1 딥링크), TYPE = 홈 B(layer 있으면 + React 레이어 딥링크),
//   나머지 = StaticMain.
import type { PublicAnimalType, WsPageData, WsRoute } from '@ws/engine';

export type RouteView =
  | { view: 'homeA' }
  | { view: 'homeB'; type: PublicAnimalType; layer: boolean }
  | { view: 'vet' }
  | { view: 'static' };

/** /pick(K1 — 홈 A 부모 + L1). 프리렌더 route.kind PICK(레인 A routes.ts) · ws-data 없을 땐 routeFromLocation 이 같은 종류를 준다. */
export function isPickRoute(route: Pick<WsRoute, 'kind'>): boolean {
  return route.kind === 'PICK';
}

export function routeView(page: WsPageData): RouteView {
  if (page.route.kind === 'HOME' || page.route.kind === 'SAVE' || isPickRoute(page.route)) return { view: 'homeA' };
  if (page.route.kind === 'VET' || page.route.kind === 'VET_REGION') return { view: 'vet' }; // F3-1(FE3) — /vet React
  if (page.route.kind === 'TYPE') {
    const type = page.data.types.find((t) => t.id === page.route.typeId);
    // 타입을 데이터에서 못 찾으면(검증된 ws-data 에선 없어야 함) 보관 정적 본문으로 — 지어내지 않는다.
    if (type) return { view: 'homeB', type, layer: page.layer !== null };
  }
  return { view: 'static' };
}
