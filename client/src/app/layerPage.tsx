// 레이어 내용(L1·L2)이 쓰는 페이지 데이터. App 이 <LayerPageProvider page={page}> 로 LayerHost 를 감싸면 그 값을,
//   Provider 가 없으면 문서의 ws-data 를 main 과 같은 경로(resolvePageData)로 한 번 읽는다(데이터 출처는 ws-data 하나, C-2).
import { createContext, useContext, type ReactNode } from 'react';
import type { WsPageData } from '@ws/engine';
import { resolvePageData } from './pageData';

const LayerPageContext = createContext<WsPageData | null>(null);

export function LayerPageProvider({ page, children }: { page: WsPageData; children: ReactNode }) {
  return <LayerPageContext.Provider value={page}>{children}</LayerPageContext.Provider>;
}

let documentPage: WsPageData | null = null;

export function useLayerPage(): WsPageData {
  const page = useContext(LayerPageContext);
  if (page) return page;
  if (!documentPage) documentPage = resolvePageData(document, window.location);
  return documentPage;
}
