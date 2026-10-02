// 부트스트랩(계약 C-2): ws-data 읽기 → 정적 보관 → createRoot 교체 렌더(D1) → #root[data-ws-prerendered] 제거.
//   main.tsx 와 F8 하이드레이션 테스트가 같은 경로를 쓴다.
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { resolvePageData } from './pageData';
import { captureStatic } from './staticCapture';

export function boot(doc: Document, loc: Pick<Location, 'pathname'>): Root {
  const rootEl = doc.getElementById('root');
  if (!rootEl) throw new Error('root element not found');
  const page = resolvePageData(doc, loc);
  const captured = captureStatic(rootEl);
  const root = createRoot(rootEl);
  root.render(
    <StrictMode>
      <App page={page} captured={captured} />
    </StrictMode>,
  );
  rootEl.removeAttribute('data-ws-prerendered');
  return root;
}
