// 미구현 라우트(FAMILY·SETUP·SUPPLIES·SUPPLY_ITEM(_TYPE)·VET(_REGION)·CREDITS·PRIVACY·TIPS·NOT_FOUND)의 본문 = 같은 문서의 프리렌더 main 보관분(D2, US-024).
//   HTML 출처는 captureStatic(같은 문서, 빌드 산출물)뿐 — 외부·다른 문서 HTML 0(불변식 ①). innerHTML 경로는 여기 한 곳(R5 — 딥링크 레이어는 ws-data 로 React 렌더).
//   보관분이 없으면(dev·shell.html) 빈 main(데이터 없이 내용을 지어내지 않음).
import type { RouteKind } from '@ws/engine';

export interface StaticMainProps {
  kind: RouteKind;
  html: string | null;
}

export default function StaticMain({ kind, html }: StaticMainProps) {
  if (!html) return <main id="main" className="ws-page" data-ws-route={kind} data-ws-static="empty" />;
  // 보관한 outerHTML 은 main.ws-page 자체 — 감싸는 요소는 레이아웃에 끼지 않게 display: contents.
  return <div className="ws-static-main" data-ws-static="main" dangerouslySetInnerHTML={{ __html: html }} />;
}
