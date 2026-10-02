// L4/L5/L7 딥링크 = 부모(홈 B) + 레이어 안 프리렌더 aside 보관분(D2, US-017). R4 는 정적 동등, R5 에서 SPA 레이어로.
//   aside 의 제목(h2#ws-layer-title)은 Layer 제목 행으로 옮기고(제목 중복·dialog 중첩 방지), aside 는 role·aria-labelledby 를 뗀다.
//   파싱은 DOMParser(스크립트 실행 없음), 출처는 같은 문서 보관분뿐. innerHTML 경로는 여기와 StaticMain 두 곳.
import { useMemo } from 'react';
import { Layer, type LayerShellKind } from '../ui/layer/Layer';

export interface StaticLayerParts {
  title: string;
  html: string;
  kind: LayerShellKind;
}

/** aside 보관분 → {제목, 제목 뺀 aside outerHTML}. 형식이 아니면 null. */
function splitStaticLayer(asideHtml: string | null): StaticLayerParts | null {
  if (!asideHtml || typeof DOMParser !== 'function') return null;
  const doc = new DOMParser().parseFromString(asideHtml, 'text/html');
  const aside = doc.querySelector('aside.ws-layer');
  if (!aside) return null;
  const kind = aside.getAttribute('data-ws-layer');
  if (kind !== 'L4' && kind !== 'L5' && kind !== 'L7') return null;
  const h = aside.querySelector('#ws-layer-title');
  const title = h?.textContent?.trim() ?? '';
  h?.remove();
  aside.removeAttribute('role');
  aside.removeAttribute('aria-labelledby');
  aside.classList.add('ws-layer--static');
  return { title, html: aside.outerHTML, kind };
}

export interface StaticLayerProps {
  asideHtml: string | null;
  onClose(): void;
}

export default function StaticLayer({ asideHtml, onClose }: StaticLayerProps) {
  const parts = useMemo(() => splitStaticLayer(asideHtml), [asideHtml]);
  if (!parts) return null;
  return (
    <Layer kind={parts.kind} title={parts.title} onClose={onClose}>
      <div className="ws-layer-body" data-ws-static="layer" dangerouslySetInnerHTML={{ __html: parts.html }} />
    </Layer>
  );
}

/** 딥링크 레이어 닫기: 같은 출처에서 온 history 면 back, 아니면 부모 경로로 replaceState. */
export function closeDeepLink(parentPath: string, onReplaced: () => void): void {
  let sameOriginReferrer = false;
  try {
    sameOriginReferrer = document.referrer !== '' && new URL(document.referrer).origin === window.location.origin;
  } catch {
    sameOriginReferrer = false;
  }
  if (sameOriginReferrer && window.history.length > 1) {
    window.history.back();
    return;
  }
  window.history.replaceState(window.history.state, '', parentPath);
  onReplaced();
}
