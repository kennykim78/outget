// 문서 안 링크 가로채기(계약 C-R5-5 · 스펙33 §2.1). 레이어 URL 링크(L4 /{slug}/supplies/{item} · L5 /{slug}/check/{item} ·
//   L7 /{slug}/products/{id} · L8 /save)를 누르면, 같은 문서 ws-data 에 대상이 있을 때만 레이어를 push 한다.
//   대상이 없으면(다른 타입·다른 페이지 데이터) 기본 동작 = 문서 이동(D10 — SPA push 는 같은 문서 ws-data 범위만).
//   링크 마크업(href)은 그대로 — JS 꺼짐·새 탭·크롤러는 프리렌더 딥링크 문서로 간다.
import type { WsPageData } from '@ws/engine';
import { layerStore, type HistoryLayerProps, type LayerKind, type LayerProps, type OpenOptions } from '../ui/layer/useLayer';

export interface LayerTarget {
  kind: LayerKind;
  props: HistoryLayerProps;
  url: string;
}

const SAVE_PATH = '/save';
const LAYER_SEGMENT: Readonly<Record<string, LayerKind>> = { supplies: 'L4', check: 'L5', products: 'L7' };

function decodePath(path: string): string | null {
  try {
    return decodeURI(path);
  } catch {
    return null;
  }
}

/** 경로 → 이 문서에서 열 수 있는 레이어(없으면 null). */
export function layerTargetFor(pathname: string, page: WsPageData): LayerTarget | null {
  const path = decodePath(pathname.replace(/\/+$/, '') || '/');
  if (path === null) return null;
  if (path === SAVE_PATH) return { kind: 'L8', props: {}, url: pathname };
  for (const type of page.data.types) {
    const prefix = `/${type.slug}/`;
    if (!path.startsWith(prefix)) continue;
    const m = /^([a-z]+)\/([^/]+)$/.exec(path.slice(prefix.length));
    if (!m) continue;
    const kind = LAYER_SEGMENT[m[1]];
    const id = m[2];
    if (!kind) continue;
    const hasItem = (itemId: string) =>
      page.data.requirements.some((r) => r.animalTypeId === type.id && r.supplyItemId === itemId);
    if (kind === 'L7') {
      const p = page.data.products.find((x) => x.id === id);
      if (p && hasItem(p.supplyItemId)) return { kind, props: { typeId: type.id, productId: id }, url: pathname };
    } else if (hasItem(id)) {
      return { kind, props: { typeId: type.id, itemId: id }, url: pathname };
    }
  }
  return null;
}

type OpenFn = (kind: LayerKind, props?: LayerProps, opts?: OpenOptions) => void;

/** document 에 클릭 가로채기를 건다. 반환값 = 해제. open 은 테스트 주입용(기본 layerStore.open). */
export function installLayerLinks(doc: Document, getPage: () => WsPageData, open: OpenFn = (k, p, o) => layerStore.open(k, p, o)): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    const a = target?.closest('a[href]');
    if (!(a instanceof HTMLAnchorElement)) return;
    const t = a.getAttribute('target');
    if ((t !== null && t !== '' && t !== '_self') || a.hasAttribute('download')) return;
    const view = doc.defaultView;
    if (!view) return;
    let url: URL;
    try {
      url = new URL(a.href, view.location.href);
    } catch {
      return;
    }
    if (url.origin !== view.location.origin) return;
    const found = layerTargetFor(url.pathname, getPage());
    if (!found) return;
    e.preventDefault();
    open(found.kind, found.props, { url: `${url.pathname}${url.search}` });
  };
  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}
