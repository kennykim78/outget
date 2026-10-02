// 레이어 레지스트리(L1 동물 선택 · L2 체크리스트(+L3 스텝)). <LayerHost registry={layerRegistry}/> 로 넘긴다.
//   내용이 쓰는 페이지 데이터는 app/layerPage(LayerPageProvider · useLayerPage).
import { COPY } from '@ws/copy';
import AnimalPicker from '../animal/AnimalPicker';
import ChecklistLayer from '../checklist/ChecklistLayer';
import type { LayerRegistry } from '../ui/layer/LayerHost';

export const layerRegistry: LayerRegistry = {
  L1: { title: COPY.homeA.heroCta, Component: AnimalPicker },
  L2: { title: COPY.homeB.nowTitle, Component: ChecklistLayer },
};
