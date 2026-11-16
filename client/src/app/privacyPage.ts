// 294(Kenny 2026-11-16): 처리방침(/privacy) 노출 여부 — 빌드 시 결정, 클라이언트는 읽기만.
//   운영 프리렌더가 처리방침 자리표시({{KENNY:…})가 남은 채로 빌드되면 /privacy 를 내보내지 않고, 모든 프리렌더 문서의
//   #root 에 data-ws-privacy="off" 를 단다(server/src/prerender/site.ts PRIVACY_OFF_ATTR·PRIVACY_OFF_VALUE 와 같은 값).
//   푸터(shell/Footer.tsx)·L8 저장 레이어(save/SaveLayer.tsx)는 이 함수가 false 면 처리방침 링크를 그리지 않는다.
//   표식이 없으면(개발·시험 빌드, vite dev, 단위 시험) 기존 그대로 링크를 그린다. 6값을 채워 다시 빌드하면 표식이 사라져 자동으로 돌아온다.
//   createRoot 교체 렌더는 #root 속성을 지우지 않는다(boot.tsx 는 data-ws-prerendered 만 지운다) — 문서 수명 동안 같은 값.
export const PRIVACY_OFF_ATTR = 'data-ws-privacy';
export const PRIVACY_OFF_VALUE = 'off';

/** 이 문서에서 처리방침 링크를 그려도 되는가. */
export function privacyPageOn(doc: Document = document): boolean {
  return doc.getElementById('root')?.getAttribute(PRIVACY_OFF_ATTR) !== PRIVACY_OFF_VALUE;
}
