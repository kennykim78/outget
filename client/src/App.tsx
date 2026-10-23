// WithSmall 앱 루트(계약 C-2 · C-R5-5). 셸(GlobalHeader · 화면 · Footer · TabBar) + LayerHost.
//   화면: HOME·SAVE = 홈 A(F4), TYPE = 홈 B(F5), 나머지 = StaticMain(F8, 보관 프리렌더 본문).
//   레이어 딥링크(L4·L5·L7 URL, /save)는 ws-data 로 같은 React 레이어를 마운트(app/deepLink) — 정적 aside 는 레이어 마운트와
//   같은 useLayoutEffect 에서 걷힌다(이중 aside 0). 문서 안 레이어 URL 링크는 app/layerLinks 가 push 로 가로챈다.
//   데이터는 page(ws-data)만 — 재노출·재정렬 없음(불변식 ③). 인증 컨텍스트 없음(D10).
import { Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import type { WsPageData } from '@ws/engine';
import { useAnimalSelection } from './animal/selection';
import { deepLinkFor } from './app/deepLink';
import { installLayerLinks } from './app/layerLinks';
import { LayerPageProvider } from './app/layerPage';
import { installLayerWarmup, layerRegistry, layerWsId } from './app/layerRegistry';
import { routeView } from './app/routeView';
import StaticMain from './app/StaticMain';
import type { CapturedStatic } from './app/staticCapture';
import HomeA from './home/HomeA';
import HomeB from './home/HomeB';
import Footer from './shell/Footer';
import GlobalHeader from './shell/GlobalHeader';
import TabBar from './shell/TabBar';
import { navCurrentFor, pickShellType, typeHomeHref } from './shell/shellType';
import { removePrerenderedLayer } from './ui/layer/Layer';
import LayerHost from './ui/layer/LayerHost';
import { layerStore, useLayer, useOpenLayer } from './ui/layer/useLayer';
import { vetPageChunk } from './app/pageChunks';
import { ChunkBoundary } from './app/preloadable';

// /vet 는 지연 청크(R7 O1). 대기·청크 오류 시 같은 문서의 프리렌더 main(StaticMain) — boot 가 첫 렌더 전에 청크를 기다리므로 보통 보이지 않는다.
const VetPage = vetPageChunk.Component;

export interface AppProps {
  page: WsPageData;
  captured: CapturedStatic;
  /** 저장된 ws.animalType 덮어쓰기(테스트용). 생략하면 animal/selection(F2a)의 값. */
  storedTypeId?: string | null;
}

export default function App({ page, captured, storedTypeId }: AppProps) {
  const layer = useLayer();
  const open = useOpenLayer();
  const selection = useAnimalSelection(page.data.types);
  const stored = storedTypeId !== undefined ? storedTypeId : selection.typeId;
  const type = pickShellType(page.data.types, page.route.typeId, stored);
  const continueType = pickShellType(page.data.types, null, stored);
  const current = navCurrentFor(page.route.kind);
  const rv = routeView(page);

  // 딥링크: 문서 부팅 1회 — 레이어 URL 이면 depth 0 레이어 항목으로, 아니면 이전 문서가 남긴 레이어 state 정리.
  const deepLink = useRef(deepLinkFor(page, captured.layer, continueType));
  useLayoutEffect(() => {
    removePrerenderedLayer(document);
    const d = deepLink.current;
    if (d) layerStore.initDeepLink(d.kind, d.props, d.parent, { documentParent: d.documentParent, wsId: d.wsId });
    else layerStore.clearStaleState();
  }, []);

  // 문서 안 레이어 URL 링크 → 같은 문서 ws-data 에 대상이 있으면 push(C-R5-5).
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => installLayerLinks(document, () => pageRef.current), []);

  // R7 O1 미리 불러오기: 첫 사용자 움직임(포인터 올림·터치·키보드 포커스) 때 자주 여는 레이어 청크를 한 번 받는다.
  //   부팅·측정(무입력) 구간에는 아무것도 받지 않는다 — 진입 청크·TBT 에 영향 0. 트리거별 매핑 없이 한 곳(단순).
  useEffect(() => installLayerWarmup(document), []);

  const openL1 = () => layer.open('L1');
  const openL2 = () => layer.open('L2');
  const openL8 = () => layer.open('L8', {}, { url: '/save' });

  let view;
  if (rv.view === 'homeA') {
    view = <HomeA page={page} continueType={continueType} onPick={openL1} />;
  } else if (rv.view === 'homeB') {
    view = <HomeB page={page} type={rv.type} capturedMain={captured.main} onOpenL1={openL1} onOpenL2={openL2} onOpenL8={openL8} />;
  } else if (rv.view === 'vet') {
    const fallback = <StaticMain kind={page.route.kind} html={captured.main} />;
    view = (
      <ChunkBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <VetPage page={page} capturedMain={captured.main} />
        </Suspense>
      </ChunkBoundary>
    );
  } else {
    view = <StaticMain kind={page.route.kind} html={captured.main} />;
  }

  return (
    <>
      <GlobalHeader type={type} current={current} chipExpanded={open?.kind === 'L1'} onChipOpen={openL1} />
      {view}
      <Footer />
      <TabBar homeHref={type ? typeHomeHref(type) : '/'} current={current} />
      <LayerPageProvider page={page}>
        <LayerHost registry={layerRegistry} wsIdFor={(k, p) => layerWsId(page, k, p)} />
      </LayerPageProvider>
    </>
  );
}
