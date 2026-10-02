// 라우트 → 화면(계약 C-2): HOME = 홈 A, TYPE = 홈 B(layer 있으면 + StaticLayer), 나머지 = StaticMain.
import type { PublicAnimalType, WsPageData } from '@ws/engine';

export type RouteView =
  | { view: 'homeA' }
  | { view: 'homeB'; type: PublicAnimalType; layer: boolean }
  | { view: 'static' };

export function routeView(page: WsPageData): RouteView {
  if (page.route.kind === 'HOME') return { view: 'homeA' };
  if (page.route.kind === 'TYPE') {
    const type = page.data.types.find((t) => t.id === page.route.typeId);
    // 타입을 데이터에서 못 찾으면(검증된 ws-data 에선 없어야 함) 보관 정적 본문으로 — 지어내지 않는다.
    if (type) return { view: 'homeB', type, layer: page.layer !== null };
  }
  return { view: 'static' };
}
