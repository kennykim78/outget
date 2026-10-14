// 레이어 레지스트리(C-R5-5): L1 동물 선택 · L2 체크리스트(+L3 스텝) · L4 용품 상세 · L5 규격 확인(+L6 스텝) · L7 상품 상세 · L8 이메일 저장.
//   <LayerHost registry={layerRegistry}/> 로 넘긴다. 내용이 쓰는 페이지 데이터는 app/layerPage(LayerPageProvider · useLayerPage).
//   다른 레인 모듈(L5 speccheck — FE2, L8 save — FE3)은 지연 import — 첫 화면 번들에 넣지 않는다.
import { lazy } from 'react';
import { COPY } from '@ws/copy';
import AnimalPicker from '../animal/AnimalPicker';
import ChecklistLayer from '../checklist/ChecklistLayer';
import ProductLayer from '../product/ProductLayer';
import SupplyLayer from '../supply/SupplyLayer';
import type { LayerEntry } from '../ui/layer/LayerHost';
import type { WsPageData } from '@ws/engine';
import type { LayerKind, LayerProps } from '../ui/layer/useLayer';

const SpecCheckLayer = lazy(() => import('../speccheck/SpecCheckLayer'));
const SaveLayer = lazy(() => import('../save/SaveLayer'));

export const layerRegistry: Readonly<Record<LayerKind, LayerEntry>> = {
  L1: { title: COPY.homeA.heroCta, Component: AnimalPicker },
  L2: { title: COPY.homeB.nowTitle, Component: ChecklistLayer },
  // L4·L7 제목은 내용이 용품명·상품명으로 바꾼다(useLayerChrome().setTitle). 기본은 빈 제목 — 대상 없으면 내용이 닫는다.
  L4: { title: '', Component: SupplyLayer },
  L5: { title: COPY.checkLayer.title, Component: SpecCheckLayer },
  L7: {
    title: '',
    Component: ProductLayer,
    wsId: (p) => (typeof p.productId === 'string' ? `curatedProducts#${p.productId}` : null),
  },
  L8: { title: COPY.save.title, Component: SaveLayer },
};

/**
 * 패널 data-ws-id(프리렌더 aside 와 같은 형식, 스펙33 §2.1): L4·L5 = supplyRequirements#{requirementId}(ws-data), L7 = curatedProducts#{id}.
 *   대상이 이 문서 ws-data 에 없으면 null.
 */
export function layerWsId(page: WsPageData, kind: LayerKind, props: LayerProps): string | null {
  if (kind === 'L4' || kind === 'L5') {
    const r = page.data.requirements.find((x) => x.animalTypeId === props.typeId && x.supplyItemId === props.itemId);
    return r && typeof r.requirementId === 'string' && r.requirementId !== '' ? `supplyRequirements#${r.requirementId}` : null;
  }
  if (kind === 'L7') {
    const p = page.data.products.find((x) => x.id === props.productId);
    return p ? `curatedProducts#${p.id}` : null;
  }
  return null;
}
