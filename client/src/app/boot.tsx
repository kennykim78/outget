// 부트스트랩(계약 C-2): ws-data 읽기 → 정적 보관 → createRoot 교체 렌더(D1) → #root[data-ws-prerendered] 제거.
//   main.tsx 와 F8 하이드레이션 테스트가 같은 경로를 쓴다. 첫 줄 = 매직링크 토큰 제거(captureMagicToken).
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from '../App';
import { captureMagicToken } from '../save/magicLink';
import { emptyPageData, readPageData } from './pageData';
import { captureStatic, stripProductSurfaces } from './staticCapture';

/** hashchange 구독은 문서 수명 동안 1개(boot 재호출·테스트에서 중복 등록 0). */
let hashWatch = false;

export function boot(doc: Document, loc: Pick<Location, 'pathname'>): Root {
  // 매직링크 토큰(/save#t=)을 가장 먼저 URL·히스토리에서 지운다 — 렌더·L8 지연 청크·어떤 fetch 보다 앞(C-R5-2 · D1). 멱등(L8 이 다시 불러도 메모리 값).
  captureMagicToken();
  // R6 D2(SEC-5 방어 심화): 같은 탭에서 해시만 바뀌어도(어느 경로든 #t=) 즉시 지운다 — 붙잡는 것은 /save 만(captureMagicToken).
  //   /save 는 useLayer popstate 가 먼저 처리해 L8 을 연다(popstate → hashchange 순). 여기는 그 밖의 경로·popstate 없는 경우의 안전망.
  if (!hashWatch) {
    hashWatch = true;
    window.addEventListener('hashchange', () => {
      captureMagicToken();
    });
  }
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
