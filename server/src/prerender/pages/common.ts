// 페이지 공통 조각(계획 §6-2) — head·헤더·푸터·규격 문장. 모든 시드 텍스트는 escapeHtml/escapeAttr 를 거친다.
import { PICK_PATH, naverMapSearchUrl, type PublicAnimalType, type PublicVet, type WsPageData } from '../../engine/index.js';
import { COPY, GLYPH } from '../copy.js';
import { escapeAttr as a, escapeHtml as h, jsonForScript } from '../html.js';
import type { SiteModel } from '../project.js';
import type { RoutePlan } from '../routes.js';
import { encodeSitemapPath } from '../sitemap.js';

export interface PageContext {
  origin: string;
  /** /vet 지도 레이아웃 예약(G-4) — 빌드 시 지도 키 "존재 여부"만. 키 값은 어디에도 싣지 않는다. */
  vetMap?: boolean;
  route: RoutePlan;
  catalogUrl: string;
  /** 자산 이름 → 정제된 인라인 SVG(prerender/mascot.ts). 비어 있으면 마스코트 없이 렌더. */
  mascots: ReadonlyMap<string, string>;
}

export interface RenderedPage {
  head: string;
  body: string;
  data: WsPageData;
}

export interface Crumb {
  name: string;
  path: string;
}

export function emptyData(): WsPageData['data'] {
  return { types: [], requirements: [], products: [], bundles: [], vets: [], testimonials: [] };
}

/** ws-data types — 모든 페이지에 노출 타입 전체(R4 A2(a): AnimalChip·L1 이 어느 페이지에서든 같은 목록). */
export function allTypes(m: Pick<SiteModel, 'types'>): WsPageData['data']['types'] {
  return m.types.map((t) => t.pub);
}

export function urlOf(origin: string, path: string): string {
  return origin + encodeSitemapPath(path);
}

/** href 용 경로(한글 세그먼트 percent-encode). */
export function hrefOf(path: string): string {
  return encodeSitemapPath(path);
}

export function wsData(ctx: PageContext, data: WsPageData['data']): WsPageData {
  const r = ctx.route;
  const route: WsPageData['route'] = { kind: r.kind, path: r.path };
  if (r.typeId !== undefined) route.typeId = r.typeId;
  if (r.family !== undefined) route.family = r.family;
  if (r.itemId !== undefined) route.itemId = r.itemId;
  if (r.region !== undefined) route.region = r.region;
  return { v: 1, route, layer: r.layer, catalogUrl: ctx.catalogUrl, data };
}

/** 스펙22 §1.6 — 라이트 고정. 템플릿(client/index.html)에 이미 있으면 site.ts 가 중복을 뺀다. */
export const COLOR_SCHEME_META = '<meta name="color-scheme" content="light">';

export function renderHead(
  ctx: PageContext,
  o: { title: string; description: string; crumbs: Crumb[]; itemList?: Crumb[] },
): string {
  const { route, origin } = ctx;
  const canonical = urlOf(origin, route.canonicalPath);
  // canonical 이 다른 비색인 라우트는 보통 canonical 로 신호를 넘긴다(D11). 예외: PICK 은 canonical / + noindex 둘 다(K1, 51 레인 A).
  const noindex = !route.indexable && (route.canonicalPath === route.path || route.kind === 'PICK');
  const ld: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: o.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: urlOf(origin, c.path) })),
    },
  ];
  if (o.itemList && o.itemList.length > 0) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: o.itemList.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, url: urlOf(origin, c.path) })),
    });
  }
  return [
    `<title>${h(o.title)}</title>`,
    `<meta name="description" content="${a(o.description)}">`,
    COLOR_SCHEME_META,
    `<link rel="canonical" href="${a(canonical)}">`,
    `<meta property="og:title" content="${a(o.title)}">`,
    `<meta property="og:description" content="${a(o.description)}">`,
    `<meta property="og:url" content="${a(canonical)}">`,
    `<meta property="og:type" content="website">`,
    noindex ? `<meta name="robots" content="noindex">` : '',
    `<script type="application/ld+json">${jsonForScript(ld.length === 1 ? ld[0] : ld)}</script>`,
  ]
    .filter((x) => x !== '')
    .join('\n');
}

export type NavCurrent = 'home' | 'supplies' | 'vet' | null;

/** 라우트 → 현재 메뉴(헤더 nav·탭바 aria-current). */
export function navCurrent(route: Pick<RoutePlan, 'kind'>): NavCurrent {
  switch (route.kind) {
    case 'HOME':
    case 'FAMILY':
    case 'TYPE':
    case 'SETUP':
      return 'home';
    case 'SUPPLIES':
    case 'SUPPLY_ITEM':
    case 'SUPPLY_ITEM_TYPE':
      return 'supplies';
    case 'VET':
    case 'VET_REGION':
      return 'vet';
    default:
      return null;
  }
}

const cur = (on: boolean): string => (on ? ' aria-current="page"' : '');

/** 스펙22 §2.1 — header.ws-header > a.ws-logo + a[data-ws-chip] + nav.ws-nav(≥768 표시, 현재 메뉴 aria-current). */
export function renderHeader(
  type: Pick<PublicAnimalType, 'slug' | 'displayName'> & { mascot?: string | null } | null,
  current: NavCurrent = null,
  ctx?: PageContext,
): string {
  const caret = '<span class="ws-chip-caret" aria-hidden="true">▾</span>';
  // React AnimalChip.tsx:27 과 같은 조건·톤: 선택된 타입이 있을 때만 sm 아바타(peach-soft). ctx 없으면 출력 0.
  const avatar = type && ctx ? mascotAvatar(ctx, type.mascot, 'peach-soft', 'sm') : '';
  // K1(51 레인 A ③): 칩은 JS 없이도 정적 /pick(홈 A 부모 + L1 정적 본문). 하이드레이션 후엔 client AnimalChip 이 L1 을 연다.
  const chip = type
    ? `<a data-ws-chip class="ws-chip ws-chip--selected" href="${PICK_PATH}">${avatar}<span class="ws-chip-name">${h(type.displayName)}</span> ${caret}</a>`
    : `<a data-ws-chip class="ws-chip" href="${PICK_PATH}"><span class="ws-chip-name">${h(COPY.nav.chooseFriend)}</span> ${caret}</a>`;
  return [
    '<header class="ws-header">',
    `<a class="ws-skip-link" href="#main">${h(COPY.nav.skipToMain)}</a>`,
    `<a class="ws-logo" href="/">${h(COPY.nav.logo)}</a>`,
    chip,
    '<nav class="ws-nav">',
    `<a href="/supplies"${cur(current === 'supplies')}>${h(COPY.nav.supplies)}</a>`,
    `<a href="/vet"${cur(current === 'vet')}>${h(COPY.nav.vet)}</a>`,
    '</nav>',
    '</header>',
  ].join('\n');
}

// 탭바 아이콘(디자인 리뷰 F7 — 보드 SVG, viewBox 0 0 24 24, stroke-width 2, 22px, currentColor, 장식). client TabBar.tsx 와 같은 마크업.
const TAB_ICONS = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  supplies: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>',
  vet: '<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
} as const;

function tabIcon(k: keyof typeof TAB_ICONS): string {
  return `<svg class="ws-tab-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" focusable="false">${TAB_ICONS[k]}</svg>`;
}

/** 스펙22 §2.3 — nav.ws-tabbar(≤767 표시): 홈(타입 페이지면 그 타입 홈)·용품·병원. */
export function renderTabBar(type: Pick<PublicAnimalType, 'slug'> | null, current: NavCurrent): string {
  const home = type ? hrefOf(`/${type.slug}`) : '/';
  const tab = (k: keyof typeof TAB_ICONS, href: string, label: string): string =>
    `<a class="ws-tab" href="${a(href)}"${cur(current === k)}>${tabIcon(k)}<span class="ws-tab-label">${h(label)}</span></a>`;
  return [
    '<nav class="ws-tabbar">',
    tab('home', home, COPY.nav.tabHome),
    tab('supplies', '/supplies', COPY.nav.tabSupplies),
    tab('vet', '/vet', COPY.nav.tabVet),
    '</nav>',
  ].join('\n');
}

/** 스펙22 §2.19 — 크레딧 링크는 항상(R4 D6, C6). 처리방침 링크도 항상(계획 86 P8, compliance C9-PRIVACY). */
export function renderFooter(): string {
  return [
    '<footer class="ws-footer">',
    `<p>${h(COPY.footer.identity)}</p>`,
    `<p>${h(COPY.footer.health)}</p>`,
    `<p><a href="/privacy">${h(COPY.footer.privacy)}</a> · <a href="/credits">${h(COPY.credits.footerLink)}</a></p>`,
    '</footer>',
  ].join('\n');
}

/** 레이어 딥링크 페이지: aside.ws-layer 앞의 스크림(스펙22 §2.9 G4). 장식 — 닫기 동작은 하이드레이션 후. */
export const SCRIM = '<div class="ws-scrim" aria-hidden="true"></div>';

/** 상태 글리프(텍스트 문자, 장식이면 aria-hidden). */
export function glyphSpan(kind: keyof typeof GLYPH): string {
  return `<span class="ws-glyph" data-ws-glyph="${a(kind)}" aria-hidden="true">${h(GLYPH[kind])}</span>`;
}

/** 스펙22 §4-1 — "✓ 기준 충족" 배지(상품 카드·L7). */
export function meetsBadge(): string {
  return `<span class="ws-badge">${glyphSpan('ready')}${h(COPY.product.badge)}</span>`;
}

/** 스펙22 §4-2 — imageAsset 없을 때 대체 타일: item.glyph(있으면) + "이미지 준비 중". */
export function imageTile(glyph: string | null | undefined): string {
  const g = typeof glyph === 'string' && glyph.trim() !== '' ? `<span class="ws-tile-glyph">${h(glyph)}</span>` : '';
  return `<span class="ws-tile" aria-hidden="true">${g}<span class="ws-tile-label">${h(COPY.product.imagePending)}</span></span>`;
}

/** 마스코트 자산 이름(client AnimalAvatar ASSET_RE 와 같은 규칙). */
const MASCOT_ASSET_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** client AnimalAvatar IMG_PX 와 같은 표. */
const AVATAR_PX = { lg: 96, md: 40, sm: 24, type: 56 } as const;
export type AvatarSize = keyof typeof AVATAR_PX;

/**
 * 마스코트 아바타 — client/src/ui/AnimalAvatar.tsx 와 같은 마크업(O-1, 51 레인 A: 인라인 SVG D-2 결정을 뒤집음):
 *   span.ws-avatar.ws-avatar--{size}.ws-avatar--{tone}[aria-hidden] > img[src=/mascots/{asset}.svg width height alt="" decoding=async].
 *   리포 자산만(불변식 ①): 이름 형식 + 빌드 시 docs/design/mascots 에서 읽어 정제 통과한 자산(ctx.mascots)에 있을 때만 img. 없으면 빈 디스크.
 *   R6 F2b ②: lg·peach-soft(컨텍스트 헤더 — 유일 조합, /{group}/{type} LCP)만 decoding 대신 fetchpriority="high".
 *   AnimalAvatar.tsx isLcpAvatar 와 같은 규칙.
 */
export function mascotAvatar(
  ctx: PageContext,
  asset: string | null | undefined,
  tone: 'brand-soft' | 'peach-soft' | 'surface',
  size: AvatarSize = 'lg',
): string {
  const ok = typeof asset === 'string' && MASCOT_ASSET_RE.test(asset) && ctx.mascots.has(asset);
  const px = AVATAR_PX[size];
  const extra = size === 'lg' && tone === 'peach-soft' ? 'fetchpriority="high"' : 'decoding="async"';
  const img = ok ? `<img src="/mascots/${a(asset)}.svg" width="${px}" height="${px}" alt="" ${extra}>` : '';
  return `<span class="ws-avatar ws-avatar--${size} ws-avatar--${tone}" aria-hidden="true">${img}</span>`;
}

/** 정적 레이어 닫기 링크(51 레인 A ⑥) — JS 없이 부모 문서로. 라벨은 기존 supplyLayer.close. */
export function layerClose(parentPath: string): string {
  return `<a class="ws-layer-close" href="${a(hrefOf(parentPath))}">${h(COPY.supplyLayer.close)}</a>`;
}

export function mainOpen(ctx: PageContext, typeId?: string, attrs: Readonly<Record<string, string>> = {}, extraClass?: string): string {
  const t = typeId !== undefined ? ` data-ws-type="${a(typeId)}"` : '';
  const extra = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${a(v)}"`)
    .join('');
  const cls = extraClass ? `ws-page ${extraClass}` : 'ws-page';
  return `<main id="main" class="${a(cls)}" data-ws-route="${a(ctx.route.kind)}"${t}${extra}>`;
}

/** 'YYYY-MM-DD' → 'YYYY.MM'(US-007 "마지막 검수 2026.09"). */
export function yearMonth(d: string | null | undefined): string | null {
  return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? `${d.slice(0, 4)}.${d.slice(5, 7)}` : null;
}

// ── 규격 문장 — 엔진 단일 소스(C-R5-8, D17). 기존 import 경로 호환용 re-export ──
export { ruleText, specLine, chipSpecText } from '../../engine/index.js';

export function externalLink(href: string, text: string): string {
  return `<a href="${a(href)}" target="_blank" rel="noopener noreferrer nofollow">${h(text)}<span class="ws-visually-hidden">${h(` ${COPY.a11y.newWindow}`)}</span></a>`;
}

/** 259 제휴 링크(111/261 §1) — externalLink 와 라벨·새 창 안내 같고 rel 에 sponsored, 고지 A 를 aria-describedby 로 잇는다. */
export function affiliateLink(href: string, text: string, describedBy: string): string {
  return `<a href="${a(href)}" target="_blank" rel="sponsored nofollow noopener noreferrer" aria-describedby="${a(describedBy)}">${h(text)}<span class="ws-visually-hidden">${h(` ${COPY.a11y.newWindow}`)}</span></a>`;
}

// ── 병원 카드(G-4, 스펙33 §4 VetCard) — /vet·/vet/{region}·타입 홈 ④ 공용 ─────────────
/**
 * li.ws-vet: 병원명 → 확인 배지(verifiedAt 있을 때 "✓ 전화 확인 YYYY.MM") → 주소 → 전화번호 meta(DR m-5) → 진료 동물(노출 타입 표시명만, 원시 id 0)
 *   + 야간·응급 칩(true 일 때만) → [전화](tel:) [길찾기](네이버 지도 웹 검색 — engine naverMapSearchUrl 단일 헬퍼, 새 창,
 *   noopener noreferrer nofollow). 거리·좌표·"진료 가능" 단정 0(불변식 ⑤⑧). 검색어 = 병원명 + 주소(시드 텍스트).
 */
export function vetCard(v: PublicVet, typeNames: ReadonlyMap<string, string>, level: 2 | 3 = 3): string {
  const flags = [v.night ? COPY.vet.night : '', v.emergency ? COPY.vet.emergency : ''].filter((x) => x !== '');
  const treats = v.treats.map((id) => typeNames.get(id)).filter((x): x is string => typeof x === 'string');
  const ym = yearMonth(v.verifiedAt);
  const tel = v.phone.replace(/[^0-9+]/g, '');
  return [
    `<li class="ws-vet" data-ws-id="vetClinics#${a(v.id)}">`,
    // P3 D10(axe heading-order): /vet 페이지는 h2(목록 위 h2 없음), 홈 B 레일은 h3 — client VetCard level prop 과 같게.
    `<h${level}>${h(v.name)}</h${level}>`,
    ym ? `<p class="ws-vet-badge">${glyphSpan('ready')}${h(COPY.vet.verifiedBadge)} ${h(ym)}</p>` : '',
    `<p class="ws-vet-address">${h(v.address)}</p>`,
    v.phone !== '' ? `<p class="ws-vet-phone">${h(v.phone)}</p>` : '',
    treats.length ? `<p class="ws-vet-treats">${h(COPY.vet.treats)}: ${h(treats.join(' · '))}</p>` : '',
    flags.length ? `<p>${flags.map((f) => `<span class="ws-chip">${h(f)}</span>`).join(' ')}</p>` : '',
    '<p class="ws-vet-actions">',
    // DR m-5: 버튼 라벨은 "전화"만(줄바꿈 방지), 번호는 접근 이름(aria-label)과 위 meta 줄에.
    tel ? `<a class="ws-btn ws-btn--outline" href="tel:${a(tel)}" aria-label="${a(`${COPY.vet.call} ${v.phone}`)}" data-ws-action="vet-call">${h(COPY.vet.call)}</a>` : '',
    `<a class="ws-btn ws-btn--outline" href="${a(naverMapSearchUrl(`${v.name} ${v.address}`))}" target="_blank" rel="noopener noreferrer nofollow" data-ws-action="vet-route">${h(COPY.vet.directions)}<span class="ws-visually-hidden">${h(` ${COPY.a11y.newWindow}`)}</span></a>`,
    '</p>',
    '</li>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** 노출 병원 정렬: 지역 → 이름 → id(코드 포인트 비교, 결정론). */
export function sortVets<T extends Pick<PublicVet, 'region' | 'name' | 'id'>>(vs: readonly T[]): T[] {
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  return [...vs].sort((p, q) => cmp(p.region, q.region) || cmp(p.name, q.name) || cmp(p.id, q.id));
}

/** client home/SplitTitle.tsx 와 같은 마크업 — " — " 기준 제목/부제(구분 기호는 시각적으로 숨김). */
export function splitTitle(text: string): string {
  const i = text.indexOf(' — ');
  if (i < 0) return `<span class="ws-split-title">${h(text)}</span>`;
  return `<span class="ws-split-title">${h(text.slice(0, i))}</span><span class="ws-visually-hidden"> — </span><span class="ws-split-sub">${h(text.slice(i + 3))}</span>`;
}

export type RailKind = 'need' | 'bundle' | 'product' | 'vet' | 'review';
const RAIL_LIST_CLASS: Record<RailKind, string> = { need: 'ws-chips', bundle: 'ws-bundles', product: 'ws-products', vet: 'ws-vets', review: 'ws-reviews' };

/**
 * client ui/RailSection.tsx 와 같은 마크업(51 레인 A): section.ws-rail-section.ws-rail-section--{kind}[data-ws-section aria-labelledby]
 *   > div.ws-rail-head(div.ws-rail-heading(h2#ws-sec-{id}-title.ws-t-section + p.ws-rail-sub) + div.ws-rail-tools(전체 › 링크만))
 *   + ul.ws-rail.ws-{chips|bundles|products|vets|reviews}[role=list tabindex=0]. ‹ › 화살표는 넘칠 때만(하이드레이션 후) — 정적 0.
 *   titleHtml 은 이미 이스케이프된 조각, items 는 li 조각들.
 */
export function railSection(o: {
  id: string;
  kind: RailKind;
  titleHtml: string;
  sub?: string | null;
  more?: { label: string; href: string } | null;
  attrs?: Readonly<Record<string, string>>;
  items: readonly string[];
}): string {
  const titleId = `ws-sec-${o.id}-title`;
  const extra = Object.entries(o.attrs ?? {})
    .map(([k, v]) => ` ${k}="${a(v)}"`)
    .join('');
  const more = o.more ? `<a class="ws-rail-more ws-t-meta" href="${a(o.more.href)}">${h(o.more.label)}<span aria-hidden="true"> ›</span></a>` : '';
  return [
    `<section class="ws-rail-section ws-rail-section--${o.kind}" data-ws-section="${a(o.id)}" aria-labelledby="${titleId}"${extra}>`,
    '<div class="ws-rail-head">',
    `<div class="ws-rail-heading"><h2 id="${titleId}" class="ws-t-section">${o.titleHtml}</h2>${o.sub ? `<p class="ws-rail-sub ws-t-body">${h(o.sub)}</p>` : ''}</div>`,
    `<div class="ws-rail-tools">${more}</div>`,
    '</div>',
    `<ul class="ws-rail ${RAIL_LIST_CLASS[o.kind]}" role="list" tabindex="0" aria-labelledby="${titleId}">`,
    ...o.items,
    '</ul>',
    '</section>',
  ].join('\n');
}

/** 레일 빈 상태 li(client li.ws-empty-li > p.ws-t-body.ws-muted). */
export function emptyLi(text: string): string {
  return `<li class="ws-empty-li"><p class="ws-t-body ws-muted">${h(text)}</p></li>`;
}

/** ProductCard ♡ 자리(스펙33 §2.4, D-38): 링크 형제 span, 하이드레이션 후 버튼으로 교체. 숫자 0(프리렌더). */
export const LIKE_PLACEHOLDER = '<span class="ws-like" aria-hidden="true"><span class="ws-like-glyph" aria-hidden="true">♡</span></span>';
