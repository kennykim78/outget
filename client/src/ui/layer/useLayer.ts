// 레이어 열기/닫기(UX v2.3.1 · 스펙22 §2.9). 한 번에 하나, 같은 URL 에 history.state.wsLayer 를 push → 뒤로 = 닫기.
//   R4 SPA 레이어는 L1·L2 만(L3 은 L2 안 스텝). L4/L5/L7 은 R4 문서 이동 + 딥링크 StaticLayer(D4·D2).
//   상태는 모듈 단일 저장소 — LayerHost 가 구독하고 popstate 를 연결한다(Provider 불필요).
import { useSyncExternalStore } from 'react';

export type LayerKind = 'L1' | 'L2';
export type LayerProps = Record<string, unknown>;

export interface LayerControl {
  open(kind: LayerKind, props?: LayerProps): void;
  close(): void;
}

export interface OpenLayer {
  kind: LayerKind;
  props: LayerProps;
}

type Listener = () => void;

let current: OpenLayer | null = null;
/** 이 저장소가 history 항목을 push 했는지(닫을 때 back 으로 되돌릴지). */
let pushed = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

function historyState(): Record<string, unknown> {
  const s: unknown = window.history.state;
  return typeof s === 'object' && s !== null ? (s as Record<string, unknown>) : {};
}

function hasLayerState(s: unknown): boolean {
  return typeof s === 'object' && s !== null && typeof (s as { wsLayer?: unknown }).wsLayer === 'string';
}

export const layerStore = {
  get(): OpenLayer | null {
    return current;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  /** 열기. 이미 열려 있으면 교체(history 항목 추가 없음 — 한 번에 하나). */
  open(kind: LayerKind, props: LayerProps = {}): void {
    if (current === null) {
      window.history.pushState({ ...historyState(), wsLayer: kind }, '');
      pushed = true;
    } else {
      window.history.replaceState({ ...historyState(), wsLayer: kind }, '');
    }
    current = { kind, props };
    emit();
  },
  /** 닫기. 직접 push 한 항목이면 history.back() → popstate 에서 실제로 닫힌다(뒤로가기와 같은 경로). */
  close(): void {
    if (current === null) return;
    if (pushed && hasLayerState(window.history.state)) {
      window.history.back();
      return;
    }
    current = null;
    pushed = false;
    emit();
  },
  /** popstate 처리: 레이어 상태가 없는 항목으로 돌아오면 닫는다. */
  onPopState(e: PopStateEvent): void {
    if (current !== null && !hasLayerState(e.state)) {
      current = null;
      pushed = false;
      emit();
    }
  },
  /** 테스트 전용 초기화. */
  resetForTest(): void {
    current = null;
    pushed = false;
    emit();
  },
};

/** 현재 열린 레이어(구독). */
export function useOpenLayer(): OpenLayer | null {
  return useSyncExternalStore(layerStore.subscribe, layerStore.get, () => null);
}

const control: LayerControl = {
  open: (kind, props) => layerStore.open(kind, props),
  close: () => layerStore.close(),
};

export function useLayer(): LayerControl {
  return control;
}
