// 사이트 빌드(메모리) — 시드 묶음 + client/dist/index.html 템플릿 → 파일 목록. 디스크 쓰기는 F3 cli.ts.
//   결정론: 같은 입력이면 같은 바이트(빌드 시각·난수 없음, D19). seedDigest 는 호출부가 계산해 넘긴다(lane E 계약).
import { createHash } from 'node:crypto';
import {
  encodeWsPage,
  feedVariantFile,
  isWsFeedData,
  toWsPageV1,
  type AffiliateCodes,
  type FeedLiveStage,
  type PublicCatalog,
  type PublicFeedBlock,
  type PublicFeedRailCard,
  type RouteKind,
  type SeedBundle,
  type WsFeedData,
  type WsLayer,
  type WsPageData,
} from '../engine/index.js';
import { FEED_MANIFEST_FILE, buildFeedOutputs, type FeedOutput, type ProductFeedInput } from './feed-out.js';
import type { PageFeed } from './pages/feed.js';
import { jsonForScript } from './html.js';
import { projectSite, type SiteModel } from './project.js';
import { planRoutes, type RoutePlan } from './routes.js';
import { PRIVACY_POLICY, privacyPagePublished, type PrivacyPolicy } from './privacy-content.js';
import { buildRobots } from './robots.js';
import { buildSitemap, normalizeOrigin } from './sitemap.js';
import { injectTemplate } from './template.js';
import { COLOR_SCHEME_META, type PageContext, type RenderedPage } from './pages/common.js';
import { renderCredits, renderFamily, renderHome, renderNotFound, renderPick, renderPrivacy, renderSave, renderSupplies, renderSupplyItem, renderVet } from './pages/misc.js';
import { renderSetupPage, renderTipsPage, renderTypePage } from './pages/type.js';

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
  /** /vet 지도 레이아웃 예약(G-4): 빌드 시 지도 키가 "있는지"만. 키 값은 받지도 싣지도 않는다. 기본 false(목록 전용). */
  vetMap?: boolean;
  /**
   * ws-data 와이어 버전(기본 2 = engine/ws-wire encodeWsPage — searchLinks 제거·출처 표, 제휴 링크가 있는 페이지는 3).
   *   1 = 구 형식(engine/ws-wire toWsPageV1 — 메모리 객체에서 SEARCH 링크의 kind 키만 뺀 것, 273). 제휴 꺼짐이면 제휴 코드 이전 v1 바이트와 같다
   *   (fixtures/affiliate/off-baseline-v1.sha256.json). 메모리 객체 그대로가 아니다 — 259 의 kind:'SEARCH' 는 v1 에 싣지 않는다.
   *   1 은 구·신 빌드 대조 테스트와 긴급 롤백용 — ws-data 밖 HTML 바이트는 두 값에서 같다.
   */
  wsDataWire?: 1 | 2;
  /**
   * 259 제휴 링크 맵(검색어 → 공급자 코드, prerender/affiliate.ts toAffiliateLinkMap). 없으면 꺼짐 — 산출물은 제휴 코드 이전과 바이트 동일.
   *   cli.ts 는 게이트(affiliateGate)가 켜졌을 때만 넘긴다. 링크 href·고지에만 쓰이고 노출·순서에는 영향 0(불변식 ③).
   *   와이어: 제휴 링크가 있는 페이지만 v3(aff), 나머지는 v2 그대로.
   */
  affiliate?: ReadonlyMap<string, AffiliateCodes>;
  /**
   * 운영 빌드(NODE_ENV=production 프리렌더, cli.ts)면 true → manifest.mode 'production'. 기본 false('development').
   *   compliance C9-PRIVACY 가 이 값으로 /privacy 자리표시({{KENNY:})를 FAIL(운영)·WARN(개발)으로 가른다 — 'development' 가 아니면 운영으로 본다.
   */
  production?: boolean;
  /** 처리방침 데이터(테스트 주입용 — 기본 privacy-content.ts PRIVACY_POLICY). 294: 운영 빌드에서 자리표시가 남았으면 /privacy 를 내보내지 않는다. */
  privacyPolicy?: PrivacyPolicy;
  /**
   * 362 N6·N7 상품 피드(cli.ts 는 productFeedGate 가 켜졌을 때만 넘긴다). 없으면 피드 산출물 0 — 나머지 파일 바이트 불변.
   *   피드는 ws-data 에 싣지 않는다(C1) — 정적 JSON {slug}/feed/{item}(.noprice).json + feed-manifest.json(feed-out.ts).
   */
  productFeed?: ProductFeedInput;
}

/** 294: /privacy 비노출 빌드의 #root 표식 — 클라이언트(client/src/app/privacyPage.ts)가 푸터·L8 처리방침 링크를 숨긴다. */
export const PRIVACY_OFF_ATTR = 'data-ws-privacy';
export const PRIVACY_OFF_VALUE = 'off';

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
  /** 빌드 모드(계획 86 P11, compliance C9-PRIVACY). */
  mode: 'production' | 'development';
  /** 294: /privacy 를 내보내지 않은 빌드만 false(내보낸 빌드는 키 없음 — 기존 manifest 바이트 그대로). 기동 검사(config/env.ts)·compliance C9 가 읽는다. */
  privacyPage?: false;
  routes: ManifestRoute[];
}

export interface BuiltPage {
  route: RoutePlan;
  html: string;
  data: WsPageData;
  /** HTML 에 실린 ws-data JSON(와이어, 기본 v2) 바이트 수(F3 가 ≤ 32KB 단언). data 는 메모리(v1) 객체. */
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
  /** 294: /privacy 를 내보냈는가(privacy-content.ts privacyPagePublished). */
  privacyPage: boolean;
  /** 362 N6 홈 B 레일 피드 카드(타입 id → 품목당 1장, D-2). 피드 꺼짐이면 빈 Map. 마크업·ws-data 는 feedPages(1.5KB 예산 뒤 목록). */
  feedRail: Map<string, PublicFeedRailCard[]>;
  /**
   * 362 N9 피드 HTML 변형(dist {dir}/index.feed.html · index.feed-noprice.html). 기본 파일(pages)은 피드 없음 그대로.
   *   대상: 피드 블록이 1개 이상인 타입의 TYPE 라우트 전부(홈 B 레일·L4/L5/L7 — 같은 main) + 문서 요구사항 중 블록이 있는 /supplies/{item}/{type}. 그 밖 라우트는 변형 0.
   */
  feedPages: BuiltFeedPage[];
}

export interface BuiltFeedPage extends BuiltPage {
  stage: FeedLiveStage;
  /** 변형 파일(dist 상대). 기본 파일은 route.file. */
  file: string;
}

/** 이 라우트의 피드 변형 입력(없으면 null — 변형 파일 0). */
function pageFeedFor(page: BuiltPage, feed: FeedOutput, stage: FeedLiveStage): PageFeed | null {
  const { route } = page;
  if (route.typeId === undefined) return null;
  const tf = feed.types.get(route.typeId);
  const data = tf?.data[stage];
  if (!tf || !data) return null;
  const blockOf = (id: string) => tf.blocks.get(id)?.[stage];
  if (route.kind === 'TYPE') {
    const blocks = new Map<string, PublicFeedBlock>();
    for (const id of data.items) {
      const b = blockOf(id);
      if (b) blocks.set(id, b);
    }
    return { blocks, data };
  }
  if (route.kind === 'SUPPLY_ITEM_TYPE' && route.itemId !== undefined) {
    // 387: supplyItemTypeData 가 기본 문서에 실은 결과를 그대로 사용한다(대안·케이지·호환 대상 중복 계산 0).
    const included = new Set(page.data.data.requirements.map((r) => r.supplyItemId));
    const blocks = new Map<string, PublicFeedBlock>();
    for (const id of data.items) {
      const b = blockOf(id);
      if (included.has(id) && b) blocks.set(id, b);
    }
    if (blocks.size === 0) return null;
    const items = [...blocks.keys()];
    const sit: WsFeedData =
      stage === 'full' && data.priceCheckedOn !== undefined
        ? { v: 1, stage, freshMs: data.freshMs, priceCheckedOn: data.priceCheckedOn, items, rail: [] }
        : { v: 1, stage, freshMs: data.freshMs, items, rail: [] };
    return { blocks, data: sit };
  }
  return null;
}

function render(m: SiteModel, ctx: PageContext, policy: PrivacyPolicy): RenderedPage {
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
    case 'TIPS':
      return renderTipsPage(m, ctx, typeOf());
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
    case 'PRIVACY':
      return renderPrivacy(m, ctx, policy);
    case 'SAVE':
      return renderSave(m, ctx);
    case 'PICK':
      return renderPick(m, ctx);
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
  const model = projectSite(seed, opts.asOf, opts.affiliate);
  const policy = opts.privacyPolicy ?? PRIVACY_POLICY;
  const privacyPage = privacyPagePublished(opts.production === true, policy);
  const routes = planRoutes(model, { privacyPage });

  const catalog: PublicCatalog = { v: 1, seedDigest: opts.seedDigest, ...model.catalog };
  const catalogJson = `${JSON.stringify(catalog)}\n`;
  const sha8 = createHash('sha256').update(catalogJson, 'utf8').digest('hex').slice(0, 8);
  const catalogFile = `data/catalog.v1.${sha8}.json`;
  const catalogUrl = `/${catalogFile}`;
  const mascots: ReadonlyMap<string, string> = opts.mascots ?? new Map();
  const templateHasColorScheme = /<meta\s+name="color-scheme"/i.test(opts.template);

  const files = new Map<string, string>();
  const renderOne = (route: RoutePlan, feed?: PageFeed): BuiltPage => {
    const ctx: PageContext = { origin, route, catalogUrl, mascots, vetMap: opts.vetMap === true, privacyPage };
    if (feed) ctx.feed = feed;
    const p = render(model, ctx, policy);
    const json = jsonForScript(opts.wsDataWire === 1 ? toWsPageV1(p.data) : encodeWsPage(p.data));
    const html = injectTemplate(opts.template, {
      head: templateHasColorScheme ? p.head.replace(`${COLOR_SCHEME_META}\n`, '') : p.head,
      body: p.body,
      rootAttrs: privacyPage ? { 'data-ws-prerendered': '1' } : { 'data-ws-prerendered': '1', [PRIVACY_OFF_ATTR]: PRIVACY_OFF_VALUE },
      afterRoot: `<script id="ws-data" type="application/json">${json}</script>`,
    });
    return { route, html, data: p.data, wsDataBytes: Buffer.byteLength(json, 'utf8') };
  };
  const pages: BuiltPage[] = routes.map((route) => {
    const b = renderOne(route);
    files.set(route.file, b.html);
    return b;
  });

  const manifest: PrerenderManifest = {
    v: 1,
    seedDigest: opts.seedDigest,
    indexable: siteIndexable,
    mode: opts.production === true ? 'production' : 'development',
    ...(privacyPage ? {} : { privacyPage: false as const }),
    routes: routes.map(manifestRoute),
  };
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
  let feedRail = new Map<string, PublicFeedRailCard[]>();
  const feedPages: BuiltFeedPage[] = [];
  if (opts.productFeed) {
    const feed = buildFeedOutputs(seed, model, opts.asOf, opts.productFeed);
    const put = (k: string, v: string): void => {
      if (files.has(k)) throw new Error(`site: 피드 산출물 경로 충돌 ${k}`);
      files.set(k, v);
    };
    for (const [k, v] of feed.files) put(k, v);
    feedRail = feed.rail;
    if (feed.manifest) {
      for (const stage of feed.stages) {
        for (const base of pages) {
          const { route } = base;
          const pf = pageFeedFor(base, feed, stage);
          if (!pf) continue;
          const file = feedVariantFile(route.file, stage);
          if (file === null) throw new Error(`site: 피드 변형 파일 이름을 만들 수 없다 ${route.file}`);
          const b = renderOne(route, pf);
          const wire = b.data.data.feed;
          if (!isWsFeedData(wire)) throw new Error(`site: 피드 변형 ${file} data.feed 형식 위반`);
          put(file, b.html);
          feedPages.push({ ...b, stage, file });
          feed.manifest.pages[stage].push(file);
        }
        feed.manifest.pages[stage].sort();
      }
      put(FEED_MANIFEST_FILE, `${JSON.stringify(feed.manifest, null, 2)}\n`);
    }
  }
  return { model, routes, pages, manifest, catalog, catalogFile, files, privacyPage, feedRail, feedPages };
}
