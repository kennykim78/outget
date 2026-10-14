// 페이지 데이터 하이드레이션(계약 C-2, 단계 F0 (d)).
//   프리렌더 HTML 의 <script id="ws-data" type="application/json"> 만 읽는다(데이터 출처는 이것 하나 —
//   재노출·재정렬·재판정 없음, 불변식 ③). 검증 실패는 전부 null(fail-closed) → 빈 데이터 + routeFromLocation.
//   shell.html·vite dev 처럼 ws-data 가 없는 문서도 같은 폴백을 탄다.
import { PICK_PATH, ROUTE_KINDS, VERDICTS, WS_DATA_KEYS, type RouteKind, type WsLayer, type WsPageData, type WsRoute } from '@ws/engine';

const LAYER_KINDS = ['L4', 'L5', 'L7'] as const;

// 추천 영역에 실릴 수 있는 판정(엔진 VERDICTS 중 허용목록 — 리터럴이 엔진에서 바뀌면 타입 오류). 서버 투영(exposure)이 이미 거르지만
// ws-data 가 어긋나면 페이지 전체를 버린다 — 미달 제품이 한 건이라도 추천 영역에 그려지는 경로 0(불변식 ③, 방어 심화).
const EXPOSABLE_VERDICTS: readonly string[] = VERDICTS.filter((v) => v === 'OK' || v === 'BELOW_RECOMMENDED');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRouteKind(v: unknown): v is RouteKind {
  return typeof v === 'string' && (ROUTE_KINDS as readonly string[]).includes(v);
}

function isRoute(v: unknown): v is WsRoute {
  return isRecord(v) && isRouteKind(v.kind) && typeof v.path === 'string';
}

function isLayer(v: unknown): v is WsLayer {
  if (v === null) return true;
  if (!isRecord(v) || typeof v.typeId !== 'string') return false;
  if (!(LAYER_KINDS as readonly unknown[]).includes(v.kind)) return false;
  return v.kind === 'L7' ? typeof v.productId === 'string' : typeof v.itemId === 'string';
}

function isData(v: unknown): v is WsPageData['data'] {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== WS_DATA_KEYS.length) return false;
  if (!WS_DATA_KEYS.every((k) => Object.prototype.hasOwnProperty.call(v, k) && Array.isArray(v[k]))) return false;
  return (v.products as unknown[]).every((p) => isRecord(p) && EXPOSABLE_VERDICTS.includes(p.verdict as string));
}

/** ws-data 를 읽어 검증한다. 스크립트 없음·깨진 JSON·v≠1·미지 route.kind·data 키 불일치·배열 아님·추천 불가 verdict → null. */
export function readPageData(doc: Document): WsPageData | null {
  const el = doc.getElementById('ws-data');
  if (!el || el.tagName !== 'SCRIPT' || el.getAttribute('type') !== 'application/json') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(el.textContent ?? '');
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.v !== 1) return null;
  if (!isRoute(parsed.route)) return null;
  if (!isLayer(parsed.layer)) return null;
  if (typeof parsed.catalogUrl !== 'string') return null;
  if (!isData(parsed.data)) return null;
  return parsed as unknown as WsPageData;
}

/** 데이터 없이 경로만으로 판별 가능한 라우트. 동물·품목·지역 경로는 데이터 없이 판별하지 않는다 → NOT_FOUND. */
export function routeFromLocation(loc: Pick<Location, 'pathname'>): WsRoute {
  const trimmed = loc.pathname.replace(/\/+$/, '');
  const path = trimmed === '' ? '/' : trimmed;
  switch (path) {
    case '/':
      return { kind: 'HOME', path };
    case '/supplies':
      return { kind: 'SUPPLIES', path };
    case '/vet':
      return { kind: 'VET', path };
    case '/credits':
      return { kind: 'CREDITS', path };
    case '/save':
      return { kind: 'SAVE', path };
    case PICK_PATH:
      return { kind: 'PICK', path };
    default:
      return { kind: 'NOT_FOUND', path };
  }
}

/** 빈 데이터 페이지(폴백). catalogUrl 은 빈 문자열 — 지연 fetch 대상 없음. */
export function emptyPageData(loc: Pick<Location, 'pathname'>): WsPageData {
  return {
    v: 1,
    route: routeFromLocation(loc),
    layer: null,
    catalogUrl: '',
    data: { types: [], requirements: [], products: [], bundles: [], vets: [], testimonials: [] },
  };
}

/** main.tsx 진입점: ws-data 가 유효하면 그것, 아니면 빈 데이터 + routeFromLocation. */
export function resolvePageData(doc: Document, loc: Pick<Location, 'pathname'>): WsPageData {
  return readPageData(doc) ?? emptyPageData(loc);
}
