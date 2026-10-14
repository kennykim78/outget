// 딥링크 레이어(C-R5-5 · 스펙33 §2.1 · D-55): 이 문서가 레이어 URL 로 열렸으면 ws-data 로 같은 React 레이어를 마운트한다.
//   - TYPE + layer(L4·L5·L7): 부모 = 타입 홈 /{slug}(같은 문서 = 홈 B) → 닫기 replaceState.
//   - /pick(K1): L1, 부모 = / (같은 문서 = 홈 A) → 닫기 replaceState('/').
//   - SAVE(/save): L8, 부모 = 저장 타입 홈 또는 / — 이 문서의 화면은 홈 A 라 / 면 replaceState, 타입 홈이면 문서 이동(location.replace).
import type { PublicAnimalType, WsPageData } from '@ws/engine';
import { typeHomeHref } from '../shell/shellType';
import type { HistoryLayerProps, LayerKind } from '../ui/layer/useLayer';
import { isPickRoute } from './routeView';
import type { CapturedLayer } from './staticCapture';

export interface DeepLink {
  kind: LayerKind;
  props: HistoryLayerProps;
  parent: string;
  documentParent: boolean;
  wsId: string | null;
}

export function deepLinkFor(page: WsPageData, captured: CapturedLayer | null, savedType: PublicAnimalType | null): DeepLink | null {
  if (page.route.kind === 'SAVE') {
    const parent = savedType ? typeHomeHref(savedType) : '/';
    return { kind: 'L8', props: {}, parent, documentParent: parent !== '/', wsId: null };
  }
  if (isPickRoute(page.route)) {
    const wsId = captured !== null && captured.kind === 'L1' ? captured.wsId : null;
    return { kind: 'L1', props: {}, parent: '/', documentParent: false, wsId };
  }
  const layer = page.layer;
  if (page.route.kind !== 'TYPE' || layer === null) return null;
  const type = page.data.types.find((t) => t.id === layer.typeId && t.id === page.route.typeId);
  if (!type) return null;
  const props: HistoryLayerProps =
    layer.kind === 'L7' ? { typeId: layer.typeId, productId: layer.productId } : { typeId: layer.typeId, itemId: layer.itemId };
  const wsId = captured !== null && captured.kind === layer.kind ? captured.wsId : null;
  return { kind: layer.kind, props, parent: typeHomeHref(type), documentParent: false, wsId };
}
