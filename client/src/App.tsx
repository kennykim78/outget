// WithSmall 앱 루트(계약 C-2). 셸(GlobalHeader · 화면 · Footer · TabBar) + LayerHost.
//   화면: HOME = 홈 A(F4), TYPE = 홈 B(F5, layer 딥링크면 + StaticLayer — F8), 나머지 = StaticMain(F8, 보관 프리렌더 본문).
//   데이터는 page(ws-data)만 — 재노출·재정렬 없음(불변식 ③). 인증 컨텍스트 없음(D10).
import { useState } from 'react';
import type { WsPageData } from '@ws/engine';
import { useAnimalSelection } from './animal/selection';
import { LayerPageProvider } from './app/layerPage';
import { layerRegistry } from './app/layerRegistry';
import { routeView } from './app/routeView';
import StaticLayer, { closeDeepLink } from './app/StaticLayer';
import StaticMain from './app/StaticMain';
import type { CapturedStatic } from './app/staticCapture';
import HomeA from './home/HomeA';
import HomeB from './home/HomeB';
import Footer from './shell/Footer';
import GlobalHeader from './shell/GlobalHeader';
import TabBar from './shell/TabBar';
import { navCurrentFor, pickShellType, typeHomeHref } from './shell/shellType';
import LayerHost from './ui/layer/LayerHost';
import { useLayer, useOpenLayer } from './ui/layer/useLayer';

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
  const [deepLinkOpen, setDeepLinkOpen] = useState(rv.view === 'homeB' && rv.layer);

  const openL1 = () => layer.open('L1');
  const openL2 = () => layer.open('L2');

  let view;
  if (rv.view === 'homeA') {
    view = <HomeA page={page} continueType={continueType} onPick={openL1} />;
  } else if (rv.view === 'homeB') {
    view = <HomeB page={page} type={rv.type} capturedMain={captured.main} onOpenL1={openL1} onOpenL2={openL2} />;
  } else {
    view = <StaticMain kind={page.route.kind} html={captured.main} />;
  }

  return (
    <>
      <GlobalHeader type={type} current={current} chipExpanded={open?.kind === 'L1'} onChipOpen={openL1} />
      {view}
      <Footer />
      <TabBar homeHref={type ? typeHomeHref(type) : '/'} current={current} />
      {rv.view === 'homeB' && deepLinkOpen ? (
        <StaticLayer asideHtml={captured.layer} onClose={() => closeDeepLink(typeHomeHref(rv.type), () => setDeepLinkOpen(false))} />
      ) : null}
      <LayerPageProvider page={page}>
        <LayerHost registry={layerRegistry} />
      </LayerPageProvider>
    </>
  );
}
