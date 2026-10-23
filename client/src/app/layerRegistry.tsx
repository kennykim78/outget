// 레이어 레지스트리(C-R5-5): L1 동물 선택 · L2 체크리스트(+L3 스텝) · L4 용품 상세 · L5 규격 확인(+L6 스텝) · L7 상품 상세 · L8 이메일 저장.
//   <LayerHost registry={layerRegistry}/> 로 넘긴다. 내용이 쓰는 페이지 데이터는 app/layerPage(LayerPageProvider · useLayerPage).
//   내용은 전부 지연 청크(R7 성능 O1 — L1·L2·L4·L7 도 진입 청크에서 뺐다. L5 speccheck·L8 save 는 R5 부터). 첫 화면 번들에 넣지 않는다.
//   대기 중에는 LayerHost 의 Suspense(fallback null)로 레이어 껍데기(제목·✕)만. 딥링크 부팅은 boot 가 청크를 먼저 기다려(firstScreenChunks)
//   프리렌더 aside 가 첫 커밋까지 남는다 — 빈 패널·제목 점프 0.
import { COPY } from '@ws/copy';
import type { LayerContentProps, LayerEntry } from '../ui/layer/LayerHost';
import type { WsPageData } from '@ws/engine';
import type { LayerKind, LayerProps } from '../ui/layer/useLayer';
import { preloadable, type Preloadable } from './preloadable';

const chunks: Readonly<Record<LayerKind, Preloadable<LayerContentProps>>> = {
  L1: preloadable(() => import('../animal/AnimalPicker'), 'AnimalPicker'),
  L2: preloadable(() => import('../checklist/ChecklistLayer'), 'ChecklistLayer'),
  L4: preloadable(() => import('../supply/SupplyLayer'), 'SupplyLayer'),
  L5: preloadable(() => import('../speccheck/SpecCheckLayer'), 'SpecCheckLayer'),
  L7: preloadable(() => import('../product/ProductLayer'), 'ProductLayer'),
  L8: preloadable(() => import('../save/SaveLayer'), 'SaveLayer'),
};

/** 레이어 내용 청크를 미리 불러온다(멱등) — 트리거 hover·focus, 딥링크 부팅. */
export function preloadLayer(kind: LayerKind): Promise<void> {
  return chunks[kind].preload();
}

/** 첫 사용자 움직임에 미리 받는 레이어(홈 A·B 에서 바로 열리는 것). L5·L8 은 L4·L2 안에서 열려 그때 받는다. */
export const WARMUP_LAYERS: readonly LayerKind[] = ['L1', 'L2', 'L4', 'L7'];

/** 첫 pointerover·touchstart·focusin 한 번에 WARMUP_LAYERS 청크를 받는다(실패는 무시 — 열 때 다시 시도). 해제 함수 반환. */
export function installLayerWarmup(doc: Document): () => void {
  const events = ['pointerover', 'touchstart', 'focusin'] as const;
  const warm = (): void => {
    off();
    for (const k of WARMUP_LAYERS) preloadLayer(k).catch(() => undefined);
  };
  const off = (): void => {
    for (const e of events) doc.removeEventListener(e, warm, true);
  };
  for (const e of events) doc.addEventListener(e, warm, { capture: true, passive: true });
  return off;
}

/** 이미 불러왔으면 true(부팅이 기다릴지 판단). */
export function layerLoaded(kind: LayerKind): boolean {
  return chunks[kind].loaded();
}

export const layerRegistry: Readonly<Record<LayerKind, LayerEntry>> = {
  L1: { title: COPY.homeA.heroCta, Component: chunks.L1.Component },
  L2: { title: COPY.homeB.nowTitle, Component: chunks.L2.Component },
  // L4·L7 제목은 내용이 용품명·상품명으로 바꾼다(useLayerChrome().setTitle). 기본은 빈 제목 — 대상 없으면 내용이 닫는다.
  L4: { title: '', Component: chunks.L4.Component },
  L5: { title: COPY.checkLayer.title, Component: chunks.L5.Component },
  L7: {
    title: '',
    Component: chunks.L7.Component,
    wsId: (p) => (typeof p.productId === 'string' ? `curatedProducts#${p.productId}` : null),
  },
  L8: { title: COPY.save.title, Component: chunks.L8.Component },
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
