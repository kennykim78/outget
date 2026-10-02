// 프리렌더 정적 HTML 보관(계약 C-2, 단계 F0 (e)).
//   createRoot 가 #root 를 교체 렌더하기 전에(D1) 같은 문서의 main.ws-page·aside.ws-layer outerHTML 을 문자열로 보관한다.
//   미구현 라우트(StaticMain)·L4/L5/L7 딥링크(StaticLayer)가 F8 에서 이 문자열만 다시 그린다 —
//   같은 문서에서 보관한 것만(불변식 ①: 외부·다른 문서 HTML 0).

export interface CapturedStatic {
  /** #root 안 main.ws-page 의 outerHTML(없으면 null). */
  main: string | null;
  /** #root 안 aside.ws-layer 의 outerHTML(없으면 null). */
  layer: string | null;
}

export const NO_CAPTURE: CapturedStatic = Object.freeze({ main: null, layer: null });

/** mount 전 호출. root 가 없으면 빈 보관. */
export function captureStatic(root: Element | null): CapturedStatic {
  if (!root) return NO_CAPTURE;
  const main = root.querySelector('main.ws-page');
  const layer = root.querySelector('aside.ws-layer');
  return { main: main ? main.outerHTML : null, layer: layer ? layer.outerHTML : null };
}
