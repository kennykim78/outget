// 레이어 호스트 — 저장소(useLayer)의 현재 레이어를 registry 로 찾아 <Layer> 안에 그린다. 한 번에 하나.
//   popstate 를 연결한다(뒤로 = 이전 레이어 또는 닫기). 내용 컴포넌트가 throw 해도 페이지 전체가 무너지지 않게 레이어만 닫는다.
//   내용은 React.lazy 일 수 있다(L5·L8 등 다른 레인 모듈) — Suspense 대기 중에도 레이어 껍데기(제목·✕)는 그대로.
//   document.title(R6 G1): 열리면 "<레이어 제목> — WithSmall"(프리렌더 titleSuffix 와 같은 형식), 스텝·setTitle 로 제목이 바뀌면 갱신,
//   다 닫히면 연 직전 제목으로 복원. 딥링크(depth 0)로 시작한 레이어는 직전 제목이 레이어 자신의 프리렌더 제목이라 홈 제목으로 복원.
import { Component, Suspense, useEffect, useLayoutEffect, useRef, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { COPY } from '@ws/copy';
import { Layer } from './Layer';
import { layerStore, readLayerState, useOpenLayer, type LayerKind, type LayerProps } from './useLayer';

/** 지금 열린 레이어 패널의 제목 텍스트(aria-labelledby 대상 — 흰 제목 행·L2 밴드 모두). 없으면 ''. */
function openLayerHeading(doc: Document): string {
  const panel = doc.querySelector('.ws-layer-root [role="dialog"]');
  const id = panel?.getAttribute('aria-labelledby');
  const el = id ? doc.getElementById(id) : null;
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 레이어 문서 제목 — 프리렌더 page title 과 같은 접미사(COPY.site.titleSuffix). */
export function layerDocumentTitle(heading: string): string {
  return `${heading}${COPY.site.titleSuffix}`;
}

export interface LayerContentProps {
  props: LayerProps;
  close(): void;
}

export interface LayerEntry {
  /** 레이어 기본 제목(aria-labelledby 대상). 내용은 useLayerChrome().setTitle 로 바꾼다. */
  title: string;
  Component: ComponentType<LayerContentProps>;
  /** 패널 data-ws-id(프리렌더 aside 와 같은 식별자). 모르면 null. */
  wsId?(props: LayerProps): string | null;
}

export type LayerRegistry = Readonly<Partial<Record<LayerKind, LayerEntry>>>;

export interface LayerHostProps {
  registry: LayerRegistry;
  /** 패널 data-ws-id 를 페이지 데이터로 정한다(app — 예: L4·L5 supplyRequirements#{requirementId}). null 이면 다음 후보. */
  wsIdFor?(kind: LayerKind, props: LayerProps): string | null;
}

class LayerErrorBoundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('[LayerHost] 레이어 내용 오류', error, info.componentStack);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 같은 종류라도 대상이 바뀌면(L4 → 대안 L4) 내용 상태를 새로 시작한다. */
function layerKey(kind: LayerKind, props: LayerProps): string {
  const ids = ['typeId', 'itemId', 'productId'].map((k) => (typeof props[k] === 'string' ? (props[k] as string) : '')).join('|');
  return `${kind}:${ids}`;
}

/** 렌더마다 바뀌지 않는 안정 참조(내용 컴포넌트의 layout effect 재실행 방지). */
const closeLayer = (): void => layerStore.close();

export default function LayerHost({ registry, wsIdFor }: LayerHostProps) {
  const open = useOpenLayer();

  useEffect(() => {
    const onPop = (e: PopStateEvent) => layerStore.onPopState(e);
    const onShow = (e: PageTransitionEvent) => layerStore.onPageShow(e);
    const onHide = () => layerStore.onPageHide();
    window.addEventListener('popstate', onPop);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // 문서 제목: Layer 의 포털·제목은 자식 layout effect 에서 붙으므로 여기(부모 layout effect)에서 읽을 수 있다.
  const baseTitle = useRef<string | null>(null);
  const entryTitle = open ? registry[open.kind]?.title ?? '' : '';
  useLayoutEffect(() => {
    if (open === null) {
      if (baseTitle.current !== null) {
        document.title = baseTitle.current;
        baseTitle.current = null;
      }
      return;
    }
    if (baseTitle.current === null) {
      // 딥링크(depth 0): 부모 문서 제목이 있으면 그것(387 D3 — /supplies/{item}/{type} → /supplies/{item}), 없으면 홈 제목.
      baseTitle.current =
        readLayerState(window.history.state)?.wsDepth === 0 ? layerStore.deepLinkParentTitle() ?? COPY.site.homeTitle : document.title;
    }
    const sync = (): void => {
      const heading = openLayerHeading(document) || entryTitle;
      if (heading === '') return;
      const next = layerDocumentTitle(heading);
      if (document.title !== next) document.title = next;
    };
    sync();
    if (typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(sync); // 스텝 전환·setTitle·L2 밴드 교체·대안 L4 교체
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [open, entryTitle]);

  if (open === null) return null;
  const entry = registry[open.kind];
  if (!entry) return null;
  const close = closeLayer;
  const Content = entry.Component;
  const wsId = wsIdFor?.(open.kind, open.props) ?? open.wsId ?? entry.wsId?.(open.props) ?? null;
  // 스텝(L1 그룹→종 · L3→L2 · L5↔L6)은 같은 인스턴스의 내용 교체 — 키 대신 stepKey 로 알려 Layer 가 포커스를 새 제목으로 옮긴다(D1).
  const stepKey = typeof open.props.step === 'string' ? open.props.step : '';
  return (
    <Layer key={layerKey(open.kind, open.props)} kind={open.kind} title={entry.title} wsId={wsId} onClose={close} stepKey={stepKey}>
      <LayerErrorBoundary onError={close}>
        <Suspense fallback={null}>
          <Content props={open.props} close={close} />
        </Suspense>
      </LayerErrorBoundary>
    </Layer>
  );
}
