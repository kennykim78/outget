// 공개 카탈로그 → 클라이언트 엔진(L5 규격 확인용, R5 에서 UI 연결 — R4 는 로더만).
//   불변식 ①: 카탈로그는 이 사이트가 빌드 때 만든 정적 파일만 — 정확한 경로 패턴 + 동일 출처, 리다이렉트 금지.
//   불변식 ⑥: 최종값 계산은 서버와 같은 엔진(@ws/engine createEngine)이 한다 — 클라이언트에 별도 구현 없음.
//   표시용: 여기 결과로 상품 노출·정렬을 바꾸지 않는다(노출은 빌드 시 ws-data 가 결정, 불변식 ③).
import { createCatalog, createEngine, type CatalogInput, type Engine, type PublicCatalog } from '@ws/engine';

const CATALOG_PATH_RE = /^\/data\/catalog\.v1\.[0-9a-f]{8}\.json$/;
const CATALOG_ARRAYS = ['animalTypes', 'careProfiles', 'supplyItems', 'supplyRequirements', 'compatibilityRules'] as const;

export class CatalogLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogLoadError';
  }
}

/** 경로 정확 일치(`/data/catalog.v1.<sha8>.json`) + 동일 출처. 쿼리·해시·상대 경로·다른 스킴 거부. */
export function isCatalogUrl(url: string, origin: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (CATALOG_PATH_RE.test(url)) return true;
  if (!url.startsWith(`${origin}/`)) return false;
  return CATALOG_PATH_RE.test(url.slice(origin.length));
}

function isCatalog(x: unknown): x is PublicCatalog {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return o.v === 1 && CATALOG_ARRAYS.every((k) => Array.isArray(o[k]));
}

export interface LoadEngineDeps {
  fetch?: typeof fetch;
  /** 기본 = location.origin. */
  origin?: string;
}

const memo = new Map<string, Promise<Engine>>();

async function fetchEngine(url: string, f: typeof fetch): Promise<Engine> {
  let res: Response;
  try {
    res = await f(url, { credentials: 'same-origin', redirect: 'error' });
  } catch (e) {
    throw new CatalogLoadError(`카탈로그를 불러오지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new CatalogLoadError(`카탈로그 응답 ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CatalogLoadError('카탈로그 형식이 올바르지 않아요');
  }
  if (!isCatalog(body)) throw new CatalogLoadError('카탈로그 버전·형태가 맞지 않아요');
  const input: CatalogInput = {
    animalTypes: body.animalTypes,
    careProfiles: body.careProfiles,
    supplyItems: body.supplyItems,
    supplyRequirements: body.supplyRequirements,
    compatibilityRules: body.compatibilityRules,
  };
  return createEngine(createCatalog(input));
}

/** catalogUrl(ws-data) → 엔진. URL 별 메모이즈(진행 중 요청 공유), 실패는 메모하지 않는다. */
export function loadEngine(catalogUrl: string, deps: LoadEngineDeps = {}): Promise<Engine> {
  const origin = deps.origin ?? window.location.origin;
  if (!isCatalogUrl(catalogUrl, origin)) {
    return Promise.reject(new CatalogLoadError('허용되지 않는 카탈로그 주소예요'));
  }
  const key = catalogUrl.startsWith('/') ? catalogUrl : catalogUrl.slice(origin.length);
  const hit = memo.get(key);
  if (hit) return hit;
  const f = deps.fetch ?? fetch;
  const p = fetchEngine(key, f);
  memo.set(key, p);
  p.catch(() => {
    if (memo.get(key) === p) memo.delete(key);
  });
  return p;
}

/** 테스트 전용. */
export function clearEngineCacheForTest(): void {
  memo.clear();
}
