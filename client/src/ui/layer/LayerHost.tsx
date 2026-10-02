// 레이어 호스트 — 저장소(useLayer)의 현재 레이어를 registry 로 찾아 <Layer> 안에 그린다. 한 번에 하나.
//   popstate 를 연결한다(뒤로 = 닫기). 내용 컴포넌트가 throw 해도 페이지 전체가 무너지지 않게 레이어만 닫는다.
import { Component, useEffect, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import { Layer } from './Layer';
import { layerStore, useOpenLayer, type LayerKind, type LayerProps } from './useLayer';

export interface LayerEntry {
  /** 레이어 기본 제목(aria-labelledby 대상). 스텝은 useLayerChrome().setTitle 로 바꾼다. */
  title: string;
  Component: ComponentType<{ props: LayerProps; close(): void }>;
}

export type LayerRegistry = Readonly<Record<LayerKind, LayerEntry>>;

export interface LayerHostProps {
  registry: LayerRegistry;
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

export default function LayerHost({ registry }: LayerHostProps) {
  const open = useOpenLayer();

  useEffect(() => {
    const onPop = (e: PopStateEvent) => layerStore.onPopState(e);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (open === null) return null;
  const entry = registry[open.kind];
  const close = () => layerStore.close();
  const Content = entry.Component;
  return (
    // key = kind: 교체(L1 → L2) 시 내용 상태를 새로 시작한다.
    <Layer key={open.kind} kind={open.kind} title={entry.title} onClose={close}>
      <LayerErrorBoundary onError={close}>
        <Content props={open.props} close={close} />
      </LayerErrorBoundary>
    </Layer>
  );
}
