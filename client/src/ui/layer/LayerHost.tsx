// 레이어 호스트 — 저장소(useLayer)의 현재 레이어를 registry 로 찾아 <Layer> 안에 그린다. 한 번에 하나.
//   popstate 를 연결한다(뒤로 = 이전 레이어 또는 닫기). 내용 컴포넌트가 throw 해도 페이지 전체가 무너지지 않게 레이어만 닫는다.
//   내용은 React.lazy 일 수 있다(L5·L8 등 다른 레인 모듈) — Suspense 대기 중에도 레이어 껍데기(제목·✕)는 그대로.
import { Component, Suspense, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { Layer } from './Layer';
import { layerStore, useOpenLayer, type LayerKind, type LayerProps } from './useLayer';

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
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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
