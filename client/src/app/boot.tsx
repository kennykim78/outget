// 부트스트랩(계약 C-2): ws-data 읽기 → 정적 보관 → createRoot 교체 렌더(D1) → 첫 커밋 후 #root[data-ws-prerendered] 제거.
//   main.tsx 와 F8 하이드레이션 테스트가 같은 경로를 쓴다. 첫 줄 = 매직링크 토큰 제거(captureMagicToken).
import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { COPY } from '@ws/copy';
import App from '../App';
import { captureMagicToken } from '../save/magicLink';
import { rememberFeedPopular } from '../supply/feedTitle';
import { firstScreenChunks } from './firstScreen';
import { emptyPageData, readPageData } from './pageData';
import { captureStatic, stripProductSurfaces } from './staticCapture';

/** 첫 커밋 뒤(passive effect)에 프리렌더 표식을 지운다 — root.render 는 비동기라 호출 직후엔 아직 보관 HTML 이 화면에 있다(e2e 하이드레이션 신호). */
function PrerenderDone({ rootEl, children }: { rootEl: HTMLElement; children: ReactNode }): ReactNode {
  useEffect(() => {
    rootEl.removeAttribute('data-ws-prerendered');
  }, [rootEl]);
  return children;
}

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
  // 385(381 D2): 정적 L4 피드 블록 제목이 「많이 찾는 상품」이면 JSON 을 읽기 전에도 같은 제목 — 교체 렌더 전에 읽는다.
  if (data?.layer?.kind === 'L4') {
    const head = rootEl.querySelector('aside.ws-layer [data-ws-part="feed"] > h3');
    rememberFeedPopular(data.layer.typeId, data.layer.itemId, head?.textContent === COPY.feed.title);
  }
  if (data === null) stripProductSurfaces(rootEl); // 렌더 커밋 전 프레임에도 남기지 않는다
  const root = createRoot(rootEl);
  const render = (): void => {
    root.render(
      <StrictMode>
        <PrerenderDone rootEl={rootEl}>
          <App page={page} captured={captured} />
        </PrerenderDone>
      </StrictMode>,
    );
  };
  // R7 O1: 첫 커밋에 필요한 지연 청크(딥링크 레이어·/vet)가 아직이면 먼저 받는다 — 그동안 프리렌더 HTML 이 그대로 남는다.
  //   청크 오류여도 렌더한다(레이어는 LayerHost 오류 경계가 닫고, /vet 은 ChunkBoundary 가 보관 main 을 그린다).
  const wait = firstScreenChunks(page, captured.layer);
  if (wait === null) render();
  else void wait.then(render, render);
  return root;
}
