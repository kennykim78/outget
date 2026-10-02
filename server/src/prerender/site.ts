// 사이트 빌드(메모리) — 시드 묶음 + client/dist/index.html 템플릿 → 파일 목록. 디스크 쓰기는 F3 cli.ts.
//   결정론: 같은 입력이면 같은 바이트(빌드 시각·난수 없음, D19). seedDigest 는 호출부가 계산해 넘긴다(lane E 계약).
import { createHash } from 'node:crypto';
import type { PublicCatalog, RouteKind, SeedBundle, WsLayer, WsPageData } from '../engine/index.js';
import { jsonForScript } from './html.js';
import { projectSite, type SiteModel } from './project.js';
import { planRoutes, type RoutePlan } from './routes.js';
import { buildRobots } from './robots.js';
import { buildSitemap, normalizeOrigin } from './sitemap.js';
import { injectTemplate } from './template.js';
import { COLOR_SCHEME_META, type PageContext, type RenderedPage } from './pages/common.js';
import { renderCredits, renderFamily, renderHome, renderNotFound, renderSupplies, renderSupplyItem, renderVet } from './pages/misc.js';
import { renderSetupPage, renderTypePage } from './pages/type.js';

export interface BuildSiteOptions {
  /** client/dist/index.html 원문(마커 2개). */
  template: string;
  /** SITE_ORIGIN(기본 http://localhost:3001, D7). */
  origin: string;
  /** 사이트 수준 색인 허용(WS_INDEXABLE=1). 기본 false → robots Disallow: /. */
  indexable?: boolean;
  /** server/seed/*.json digest(lane E seedDigest 알고리즘). */
  seedDigest: string;
  /** 노출 기준일 YYYY-MM-DD(필수, M-1 검수 나이). CLI --now. 산출물에는 쓰지 않는다. */
  asOf: string;
  /** 자산 이름 → 정제된 인라인 SVG(mascot.ts loadMascots). 없으면 마스코트 없이 렌더. */
  mascots?: ReadonlyMap<string, string>;
}

export interface ManifestRoute {
  path: string;
  file: string;
  kind: RouteKind;
  indexable: boolean;
  typeId?: string;
  family?: string;
  itemId?: string;
  productId?: string;
  region?: string;
  layer?: Exclude<WsLayer, null>;
}

export interface PrerenderManifest {
  v: 1;
  seedDigest: string;
  indexable: boolean;
  routes: ManifestRoute[];
}

export interface BuiltPage {
  route: RoutePlan;
  html: string;
  data: WsPageData;
  /** ws-data JSON 바이트 수(F3 가 ≤ 32KB 단언). */
  wsDataBytes: number;
}

export interface SiteBuild {
  model: SiteModel;
  routes: RoutePlan[];
  pages: BuiltPage[];
  manifest: PrerenderManifest;
  catalog: PublicCatalog;
  catalogFile: string;
  /** dist 상대 경로 → 내용(UTF-8). 페이지·sitemap.xml·robots.txt·prerender-manifest.json·카탈로그. */
  files: Map<string, string>;
}

function render(m: SiteModel, ctx: PageContext): RenderedPage {
  const r = ctx.route;
  const typeOf = () => {
    const t = m.types.find((x) => x.id === r.typeId);
    if (!t) throw new Error(`site: 노출 타입 ${r.typeId} 없음(${r.path})`);
    return t;
  };
  switch (r.kind) {
    case 'HOME':
      return renderHome(m, ctx);
    case 'FAMILY':
      return renderFamily(m, ctx);
    case 'TYPE':
      return renderTypePage(m, ctx, typeOf());
    case 'SETUP':
      return renderSetupPage(m, ctx, typeOf());
    case 'SUPPLIES':
      return renderSupplies(m, ctx);
    case 'SUPPLY_ITEM':
    case 'SUPPLY_ITEM_TYPE':
      return renderSupplyItem(m, ctx);
    case 'VET':
    case 'VET_REGION':
      return renderVet(m, ctx);
    case 'CREDITS':
      return renderCredits(m, ctx);
    case 'NOT_FOUND':
      return renderNotFound(m, ctx);
  }
}

function manifestRoute(r: RoutePlan): ManifestRoute {
  const out: ManifestRoute = { path: r.path, file: r.file, kind: r.kind, indexable: r.indexable };
  if (r.typeId !== undefined) out.typeId = r.typeId;
  if (r.family !== undefined) out.family = r.family;
  if (r.itemId !== undefined) out.itemId = r.itemId;
  if (r.productId !== undefined) out.productId = r.productId;
  if (r.region !== undefined) out.region = r.region;
  if (r.layer) out.layer = r.layer;
  return out;
}

export function buildSite(seed: SeedBundle, opts: BuildSiteOptions): SiteBuild {
  if (!/^[0-9a-f]{64}$/.test(opts.seedDigest)) throw new Error('site: seedDigest 는 sha256 hex 64자');
  const origin = normalizeOrigin(opts.origin);
  const siteIndexable = opts.indexable === true;
  const model = projectSite(seed, opts.asOf);
  const routes = planRoutes(model);

  const catalog: PublicCatalog = { v: 1, seedDigest: opts.seedDigest, ...model.catalog };
  const catalogJson = `${JSON.stringify(catalog)}\n`;
  const sha8 = createHash('sha256').update(catalogJson, 'utf8').digest('hex').slice(0, 8);
  const catalogFile = `data/catalog.v1.${sha8}.json`;
  const catalogUrl = `/${catalogFile}`;
  const mascots: ReadonlyMap<string, string> = opts.mascots ?? new Map();
  const templateHasColorScheme = /<meta\s+name="color-scheme"/i.test(opts.template);

  const files = new Map<string, string>();
  const pages: BuiltPage[] = routes.map((route) => {
    const p = render(model, { origin, route, catalogUrl, mascots });
    const json = jsonForScript(p.data);
    const html = injectTemplate(opts.template, {
      head: templateHasColorScheme ? p.head.replace(`${COLOR_SCHEME_META}\n`, '') : p.head,
      body: p.body,
      rootAttrs: { 'data-ws-prerendered': '1' },
      afterRoot: `<script id="ws-data" type="application/json">${json}</script>`,
    });
    files.set(route.file, html);
    return { route, html, data: p.data, wsDataBytes: Buffer.byteLength(json, 'utf8') };
  });

  const manifest: PrerenderManifest = { v: 1, seedDigest: opts.seedDigest, indexable: siteIndexable, routes: routes.map(manifestRoute) };
  files.set(
    'sitemap.xml',
    buildSitemap(
      origin,
      routes.filter((r) => r.indexable).map((r) => (r.lastmod ? { path: r.path, lastmod: r.lastmod } : { path: r.path })),
    ),
  );
  files.set('robots.txt', buildRobots({ indexable: siteIndexable, origin }));
  files.set('prerender-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  files.set(catalogFile, catalogJson);
  return { model, routes, pages, manifest, catalog, catalogFile, files };
}
