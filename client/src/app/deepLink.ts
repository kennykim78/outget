// 딥링크 레이어(C-R5-5 · 스펙33 §2.1 · D-55): 이 문서가 레이어 URL 로 열렸으면 ws-data 로 같은 React 레이어를 마운트한다.
//   - TYPE + layer(L4·L5·L7): 부모 = 타입 홈 /{slug}(같은 문서 = 홈 B) → 닫기 replaceState.
//   - SUPPLY_ITEM_TYPE + L4(383 · PRD US-008 183-187): /supplies/{item}/{type}. 부모 = /supplies/{item}(프리렌더 renderSupplyItem 이
//     선언한 부모 — 같은 문서의 main 이 그 화면) → 닫기 replaceState. 387(384 D3·D4): 닫은 뒤 제목 = 부모 문서 제목, 바로 앞 history 항목이
//     부모 문서면 닫기 = 뒤로(같은 URL 항목이 둘 생기지 않게 — useLayer closeDeepLinkEntry).
//   - /pick(K1): L1, 부모 = / (같은 문서 = 홈 A) → 닫기 replaceState('/').
//   - SAVE(/save): L8, 부모 = 저장 타입 홈 또는 / — 이 문서의 화면은 홈 A 라 / 면 replaceState, 타입 홈이면 문서 이동(location.replace).
import { COPY } from '@ws/copy';
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
  /** 다 닫았을 때 문서 제목(부모 문서의 프리렌더 제목). 없으면 LayerHost 기본(홈 제목). */
  parentTitle?: string;
  /** 바로 앞 history 항목이 부모 문서면 닫기 = 뒤로(SUPPLY_ITEM_TYPE 만). */
  backToParent?: boolean;
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
  const bySupply = page.route.kind === 'SUPPLY_ITEM_TYPE' && layer?.kind === 'L4';
  if (layer === null || (page.route.kind !== 'TYPE' && !bySupply)) return null;
  const type = page.data.types.find((t) => t.id === layer.typeId && t.id === page.route.typeId);
  if (!type) return null;
  const props: HistoryLayerProps =
    layer.kind === 'L7' ? { typeId: layer.typeId, productId: layer.productId } : { typeId: layer.typeId, itemId: layer.itemId };
  const wsId = captured !== null && captured.kind === layer.kind ? captured.wsId : null;
  if (bySupply && layer.kind === 'L4') {
    // 부모 /supplies/{item} 의 제목 = 프리렌더 renderSupplyItem 과 같은 형식(「{용품}{titleSuffix}」, 용품 이름 = 같은 SupplyItem).
    const name = page.data.requirements.find((r) => r.animalTypeId === type.id && r.supplyItemId === layer.itemId)?.item.name;
    return {
      kind: layer.kind,
      props,
      parent: encodeURI(`/supplies/${layer.itemId}`),
      documentParent: false,
      wsId,
      ...(name ? { parentTitle: `${name}${COPY.site.titleSuffix}` } : {}),
      backToParent: true,
    };
  }
  return { kind: layer.kind, props, parent: typeHomeHref(type), documentParent: false, wsId };
}
