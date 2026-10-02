// 프리렌더 라우트 계획(계획 §4, D3·D4·D11·D12). 순수 — 사이트 모델 → 결정론적 라우트 목록.
//   노출 가능한 것만 만든다. /, /supplies, /vet, /credits, 404 는 항상. 비면 noindex + sitemap 제외.
//   URL 세그먼트 규칙은 seed/validate-slug.ts 단일 소스. 위반 값은 조용히 건너뛰지 않고 throw(검증 우회 방지).
import type { RouteKind, WsLayer } from '../engine/index.js';
import { RESERVED_FIRST_SEGMENTS, RESERVED_SECOND_SEGMENTS, SLUG_RE, VET_REGION_RE } from '../seed/validate-slug.js';
import { maxDate, type SiteModel } from './project.js';

export interface RoutePlan {
  /** 디코드된 경로(한글 그대로). 파일·sitemap 인코딩은 쓰는 쪽에서. */
  path: string;
  /** dist 상대 파일 경로. */
  file: string;
  kind: RouteKind;
  indexable: boolean;
  /** canonical 경로(D11: /supplies/{item}/{type} → /{slug}/supplies/{item}). */
  canonicalPath: string;
  /** sitemap lastmod(기여 레코드 verifiedAt 최댓값, D19). */
  lastmod: string | null;
  typeId?: string;
  family?: string;
  itemId?: string;
  productId?: string;
  region?: string;
  layer: WsLayer;
}

/** id 가 URL 세그먼트로 안전한지(소문자·숫자 kebab). */
const ID_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function segment(id: string, what: string): string {
  if (!ID_SEGMENT_RE.test(id)) throw new Error(`routes: ${what} id "${id}" 는 URL 세그먼트로 쓸 수 없다`);
  return id;
}

function checkSlug(slug: string, typeId: string): void {
  const segs = slug.split('/');
  if (!SLUG_RE.test(slug) || RESERVED_FIRST_SEGMENTS.includes(segs[0]) || (segs.length === 2 && RESERVED_SECOND_SEGMENTS.includes(segs[1]))) {
    throw new Error(`routes: ${typeId} 의 slug "${slug}" 가 규칙(SL01·SL03·SL05) 위반 — seed:validate 를 먼저 통과시킬 것`);
  }
}

/** "서울 마포구" → "서울-마포구"(D12). */
export function regionSegment(region: string): string {
  if (!VET_REGION_RE.test(region)) throw new Error(`routes: 병원 지역 "${region}" 형식 위반(VC03)`);
  return region.replace(/ /g, '-');
}

export function fileOf(path: string): string {
  return path === '/' ? 'index.html' : `${path.slice(1)}/index.html`;
}

export function planRoutes(m: SiteModel): RoutePlan[] {
  const out: RoutePlan[] = [];
  const seen = new Set<string>();
  const add = (r: Omit<RoutePlan, 'file' | 'canonicalPath'> & { file?: string; canonicalPath?: string }): void => {
    if (seen.has(r.path)) throw new Error(`routes: 경로 충돌 ${r.path}`);
    seen.add(r.path);
    out.push({ ...r, file: r.file ?? fileOf(r.path), canonicalPath: r.canonicalPath ?? r.path });
  };

  add({ path: '/', kind: 'HOME', indexable: true, lastmod: maxDate(m.types.map((t) => t.pub.review.verifiedAt || null)), layer: null });

  // /{family} — 2 세그먼트 slug 의 공통 첫 세그먼트(D3).
  const families = new Map<string, string[]>();
  for (const t of m.types) {
    checkSlug(t.slug, t.id);
    if (t.family) families.set(t.family, [...(families.get(t.family) ?? []), t.id]);
  }
  for (const [family, ids] of families) {
    const lm = maxDate(m.types.filter((t) => ids.includes(t.id)).map((t) => t.pub.review.verifiedAt || null));
    add({ path: `/${family}`, kind: 'FAMILY', indexable: true, lastmod: lm, family, layer: null });
  }

  for (const t of m.types) {
    const base = `/${t.slug}`;
    const typeId = t.id;
    add({ path: base, kind: 'TYPE', indexable: true, lastmod: t.lastmod, typeId, layer: null });
    if (t.bundles.length > 0) add({ path: `${base}/setup`, kind: 'SETUP', indexable: true, lastmod: t.lastmod, typeId, layer: null });
    for (const r of t.requirements) {
      const itemId = segment(r.item.id, 'SupplyItem');
      add({ path: `${base}/supplies/${itemId}`, kind: 'TYPE', indexable: true, lastmod: t.lastmod, typeId, itemId, layer: { kind: 'L4', typeId, itemId } });
      add({ path: `${base}/check/${itemId}`, kind: 'TYPE', indexable: true, lastmod: t.lastmod, typeId, itemId, layer: { kind: 'L5', typeId, itemId } });
    }
    for (const p of t.products) {
      const productId = segment(p.id, 'CuratedProduct');
      add({ path: `${base}/products/${productId}`, kind: 'TYPE', indexable: true, lastmod: t.lastmod, typeId, productId, layer: { kind: 'L7', typeId, productId } });
    }
  }

  add({ path: '/supplies', kind: 'SUPPLIES', indexable: m.items.length > 0, lastmod: maxDate(m.items.map((i) => i.lastmod)), layer: null });
  for (const it of m.items) {
    const itemId = segment(it.id, 'SupplyItem');
    add({ path: `/supplies/${itemId}`, kind: 'SUPPLY_ITEM', indexable: true, lastmod: it.lastmod, itemId, layer: null });
    for (const typeId of it.typeIds) {
      const t = m.types.find((x) => x.id === typeId);
      if (!t) continue;
      add({
        path: `/supplies/${itemId}/${segment(typeId, 'AnimalType')}`,
        kind: 'SUPPLY_ITEM_TYPE',
        indexable: false, // D11: canonical 은 타입 레이어, sitemap 제외
        canonicalPath: `/${t.slug}/supplies/${itemId}`,
        lastmod: t.lastmod,
        typeId,
        itemId,
        layer: { kind: 'L4', typeId, itemId },
      });
    }
  }

  add({ path: '/vet', kind: 'VET', indexable: m.vets.length > 0, lastmod: maxDate(m.vets.map((v) => v.verifiedAt)), layer: null });
  const regions = [...new Set(m.vets.map((v) => v.region))].sort();
  for (const region of regions) {
    const vs = m.vets.filter((v) => v.region === region);
    add({ path: `/vet/${regionSegment(region)}`, kind: 'VET_REGION', indexable: true, lastmod: maxDate(vs.map((v) => v.verifiedAt)), region, layer: null });
  }

  // R4 D6: /credits 는 항상(푸터 링크 항상, 사진 0이면 빈 상태). noindex·sitemap 제외.
  add({ path: '/credits', kind: 'CREDITS', indexable: false, lastmod: null, layer: null });
  add({ path: '/404', file: '404.html', kind: 'NOT_FOUND', indexable: false, lastmod: null, layer: null });
  return out;
}
