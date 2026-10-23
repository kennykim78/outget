// 첫 화면 지연 청크(R7 성능 O1): 이 문서의 첫 커밋에 필요한데 진입 청크에 없는 것 — 딥링크 레이어 내용·/vet 페이지.
//   boot 는 이것을 기다린 뒤 첫 렌더를 한다 → 그동안 프리렌더 HTML(main·aside)이 그대로 보인다(빈 패널·레이아웃 점프 0).
//   이미 불러왔거나 필요 없으면 null(동기 렌더 — 기존 경로 그대로).
import type { WsPageData } from '@ws/engine';
import { deepLinkFor } from './deepLink';
import { layerLoaded, preloadLayer } from './layerRegistry';
import { vetPageChunk } from './pageChunks';
import { routeView } from './routeView';
import type { CapturedLayer } from './staticCapture';

export function firstScreenChunks(page: WsPageData, capturedLayer: CapturedLayer | null): Promise<void> | null {
  const waits: Promise<void>[] = [];
  // 레이어 종류만 필요 — 저장 타입(savedType)은 부모 URL 에만 쓰인다.
  const d = deepLinkFor(page, capturedLayer, null);
  if (d && !layerLoaded(d.kind)) waits.push(preloadLayer(d.kind));
  if (routeView(page).view === 'vet' && !vetPageChunk.loaded()) waits.push(vetPageChunk.preload());
  return waits.length === 0 ? null : Promise.all(waits).then(() => undefined);
}
