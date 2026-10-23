// 코드 분할 도우미(R7 성능 O1): React.lazy + 미리 불러오기.
//   - preload() = 같은 import() 를 한 번만 시작(레이어 트리거 hover·딥링크 부팅 대기). 실패하면 다음 호출이 다시 시도.
//   - 이미 불러온 모듈이면 Suspense 를 거치지 않고 같은 렌더에서 바로 그린다(React.lazy 는 해결된 promise 여도 한 번 대기한다)
//     → 딥링크 부팅(boot 가 청크를 기다린 뒤 첫 렌더)·테스트에서 내용이 첫 커밋에 들어간다(빈 패널·제목 점프 0).
//   - 마운트 때 한 번 고른 구현을 유지한다(같은 인스턴스가 lazy → 실제 컴포넌트로 바뀌어 내용 상태를 잃지 않게).
import { Component, lazy, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react';

export interface Preloadable<P extends object> {
  Component: ComponentType<P>;
  /** 청크를 불러온다(멱등). */
  preload(): Promise<void>;
  /** 이미 불러왔으면 true. */
  loaded(): boolean;
}

export function preloadable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, name: string): Preloadable<P> {
  let mod: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const start = (): Promise<{ default: ComponentType<P> }> => {
    if (!pending) {
      pending = load().then(
        (m) => {
          mod = m.default;
          return m;
        },
        (e: unknown) => {
          pending = null;
          throw e;
        },
      );
    }
    return pending;
  };
  const Lazy = lazy(start);
  function Chunk(props: P) {
    const [Impl] = useState<ComponentType<P>>(() => mod ?? (Lazy as unknown as ComponentType<P>));
    return <Impl {...props} />;
  }
  Chunk.displayName = `Chunk(${name})`;
  return {
    Component: Chunk,
    preload: () => start().then(() => undefined),
    loaded: () => mod !== null,
  };
}

/** 지연 청크 오류(오프라인 등) 시 fallback 으로 대신 그린다 — 페이지 전체가 무너지지 않게. */
export class ChunkBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('[ChunkBoundary] 지연 청크 오류', error, info.componentStack);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
