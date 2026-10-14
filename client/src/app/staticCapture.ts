// 프리렌더 정적 HTML 보관(계약 C-2, 단계 F0 (e) · R5 스펙33 §2.1).
//   createRoot 가 #root 를 교체 렌더하기 전에(D1) 같은 문서의 main.ws-page outerHTML 과 aside.ws-layer 의 식별 속성만 보관한다.
//   미구현 라우트(StaticMain)가 이 문자열만 다시 그린다 — 같은 문서에서 보관한 것만(불변식 ①: 외부·다른 문서 HTML 0).
//   딥링크 레이어는 R5 부터 ws-data 로 React 레이어를 마운트한다 — aside 는 HTML 이 아니라 data-ws-layer·data-ws-id 만 남긴다.

export interface CapturedLayer {
  /** aside 의 data-ws-layer(L4·L5·L7). */
  kind: string | null;
  /** aside 의 data-ws-id — React 패널이 같은 값을 유지한다. */
  wsId: string | null;
}

export interface CapturedStatic {
  /** #root 안 main.ws-page 의 outerHTML(없으면 null). */
  main: string | null;
  /** #root 안 aside.ws-layer 의 식별 속성(없으면 null). */
  layer: CapturedLayer | null;
}

export const NO_CAPTURE: CapturedStatic = Object.freeze({ main: null, layer: null });

/**
 * 상품 추천 표면(프리렌더 표식 — server/src/prerender/pages/type.ts: section[data-ws-section=products] :139,
 * ul.ws-products :123, li.ws-product[data-ws-id^=curatedProducts#] :59, L4 section[data-ws-part=products] :206).
 * ws-data 가 없거나 거부되면(검증 실패 = 운영에서 무해한 원인 없음) 이 표면은 보관본에서 지운다 — fail-closed(불변식 ③, QA-M D1).
 */
export const PRODUCT_SURFACE_SELECTOR =
  '[data-ws-section="products"], [data-ws-part="products"], ul.ws-products, li.ws-product, [data-ws-id^="curatedProducts#"]';

/** el 안의 상품 추천 표면을 모두 지운다(제자리). */
export function stripProductSurfaces(el: Element): void {
  for (const x of Array.from(el.querySelectorAll(PRODUCT_SURFACE_SELECTOR))) x.remove();
}

export interface CaptureOptions {
  /** true = ws-data 없음·거부 → 상품 추천 표면을 뺀 보관본. */
  stripProducts?: boolean;
}

/** mount 전 호출. root 가 없으면 빈 보관. */
export function captureStatic(root: Element | null, opts: CaptureOptions = {}): CapturedStatic {
  if (!root) return NO_CAPTURE;
  const found = root.querySelector('main.ws-page');
  const main = found && opts.stripProducts ? (found.cloneNode(true) as Element) : found;
  if (main && opts.stripProducts) stripProductSurfaces(main);
  const aside = root.querySelector('aside.ws-layer');
  return {
    main: main ? main.outerHTML : null,
    layer: aside ? { kind: aside.getAttribute('data-ws-layer'), wsId: aside.getAttribute('data-ws-id') } : null,
  };
}
