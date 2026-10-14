// 부트스트랩(계약 C-2): ws-data 읽기 → 정적 보관 → createRoot 교체 렌더(D1) → #root[data-ws-prerendered] 제거.
//   main.tsx 와 F8 하이드레이션 테스트가 같은 경로를 쓴다. 첫 줄 = 매직링크 토큰 제거(captureMagicToken).
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { captureMagicToken } from '../save/magicLink';
import { emptyPageData, readPageData } from './pageData';
import { captureStatic, stripProductSurfaces } from './staticCapture';

export function boot(doc: Document, loc: Pick<Location, 'pathname'>): Root {
  // 매직링크 토큰(/save#t=)을 가장 먼저 URL·히스토리에서 지운다 — 렌더·L8 지연 청크·어떤 fetch 보다 앞(C-R5-2 · D1). 멱등(L8 이 다시 불러도 메모리 값).
  captureMagicToken();
  const rootEl = doc.getElementById('root');
  if (!rootEl) throw new Error('root element not found');
  // ws-data 가 없거나 검증에서 거부되면 빈 데이터 + 보관 본문에서 상품 추천 표면 제거(fail-closed, 불변식 ③ · QA-M D1).
  const data = readPageData(doc);
  const page = data ?? emptyPageData(loc);
  const captured = captureStatic(rootEl, { stripProducts: data === null });
  if (data === null) stripProductSurfaces(rootEl); // 렌더 커밋 전 프레임에도 남기지 않는다
  const root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <App page={page} captured={captured} />
    </StrictMode>,
  );
  rootEl.removeAttribute('data-ws-prerendered');
  return root;
}
