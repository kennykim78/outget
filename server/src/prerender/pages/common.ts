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
  /** 294: false 면 /privacy 를 내보내지 않은 빌드 — 푸터 처리방침 링크 0(site.ts privacyPagePublished). 생략 = true(바이트 동일). */
  privacyPage?: boolean;
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

/** 헤더 nav id(메뉴 단추 aria-controls) — client shell/GlobalHeader.tsx NAV_ID 와 같은 값. */
export const NAV_ID = 'ws-nav';

/**
 * 「크기 확인」 메뉴 대상(U2b, D3 ①) — client home/intent.ts intentHref('SPEC_CHECK') 와 같은 규칙·같은 입력(이 문서 ws-data).
 *   타입 없음 = /pick(무JS: L1 → 타입 홈, 하이드레이션 후 L1 경유 의도 보존) · 대상 항목 = ws-data types[].specCheckItemId,
 *   없으면 이 문서 requirements 중 그 타입의 규격 필드가 있는 첫 항목 · 둘 다 없으면 타입 홈.
 */
export function specCheckHref(type: Pick<PublicAnimalType, 'id' | 'slug'> | null, data: WsPageData['data'] | null): string {
  if (!type) return PICK_PATH;
  const home = hrefOf(`/${type.slug}`);
  if (!data) return home;
  const fromType = data.types.find((t) => t.id === type.id)?.specCheckItemId;
  const itemId =
    typeof fromType === 'string' && fromType !== ''
      ? fromType
      : data.requirements.find((x) => x.animalTypeId === type.id && x.item.specSchema.fields.length > 0)?.supplyItemId;
  return itemId ? `${home}/check/${encodeURIComponent(itemId)}` : home;
}

/**
 * 전역 헤더(U2b · R3 v1b / R4 시안, Kenny D1·D2·D3 2026-11-14) — client shell/GlobalHeader.tsx 와 같은 마크업.
 *   header.ws-header > 건너뛰기 · a.ws-logo · button.ws-menu-btn(≤767 「메뉴」, aria-expanded/controls) · nav#ws-nav.ws-nav
 *   (준비물 · 크기 확인 · 병원 · 동물 칩). 칩 = 미선택 「친구 선택하기」 채운 버튼 / 선택 = 동물 이름(D1: CTA 자리를 칩으로).
 *   하단 탭바 없음(D2). 무JS: CSS @media (scripting: none) 가 ≤767 에서도 nav 를 펼쳐 둔다(메뉴 단추 숨김).
 */
export function renderHeader(
  type: Pick<PublicAnimalType, 'id' | 'slug' | 'displayName'> | null,
  current: NavCurrent = null,
  data: WsPageData['data'] | null = null,
): string {
  // K1(51 레인 A ③): 칩은 JS 없이도 정적 /pick(홈 A 부모 + L1 정적 본문). 하이드레이션 후엔 client AnimalChip 이 L1 을 연다.
  const chip = type
    ? `<a data-ws-chip class="ws-chip ws-chip--selected" href="${PICK_PATH}"><span class="ws-chip-name">${h(type.displayName)}</span></a>`
    : `<a data-ws-chip class="ws-chip ws-btn ws-btn--fill" href="${PICK_PATH}"><span class="ws-chip-name">${h(COPY.nav.chooseFriend)}</span></a>`;
  return [
    '<header class="ws-header">',
    `<a class="ws-skip-link" href="#main">${h(COPY.nav.skipToMain)}</a>`,
    `<a class="ws-logo" href="/">${h(COPY.nav.logo)}</a>`,
    `<button type="button" class="ws-menu-btn" aria-expanded="false" aria-controls="${NAV_ID}">${h(COPY.nav.menu)}</button>`,
    `<nav class="ws-nav" id="${NAV_ID}" aria-label="${a(COPY.nav.menuLabel)}">`,
    `<a href="/supplies"${cur(current === 'supplies')}>${h(COPY.nav.menuSupplies)}</a>`,
    `<a data-ws-nav="spec-check" href="${a(specCheckHref(type, data))}">${h(COPY.nav.menuSpecCheck)}</a>`,
    `<a href="/vet"${cur(current === 'vet')}>${h(COPY.nav.vet)}</a>`,
    chip,
    '</nav>',
    '</header>',
  ].join('\n');
}

/**
 * 푸터(U2b·D3 최소 범위, R3 시안 v1b) — client shell/Footer.tsx 와 같은 마크업.
 *   로고 · 한 줄 소개 · 처리방침(항상 — 계획 86 P8, compliance C9-PRIVACY) · 사진 출처(/credits 항상 — R4 D6, 불변식 ① 사용권 공개)
 *   · 의료 고지(불변식 ⑤) · ©. 소개·문의 링크 없음(D3).
 *   R4-3(R4 시안 affiliate_candidates): affOn(이 문서의 레이어 aside 에 제휴 링크가 그려짐)일 때만 © 바로 앞에 제휴 고지 F(원문, 전부 펼침).
 *   꺼짐이면 이전과 바이트 동일(off 기준선 불변).
 *   294(Kenny 2026-11-16): privacyOn=false(운영 빌드 ∧ 처리방침 자리표시 남음 → /privacy 비노출)면 처리방침 링크만 뺀다 — client Footer 와 같은 규칙.
 */
export function renderFooter(affOn = false, privacyOn = true): string {
  const privacyLink = privacyOn ? `<a href="/privacy">${h(COPY.footer.privacy)}</a> ` : '';
  return [
    '<footer class="ws-footer">',
    `<p class="ws-footer-brand"><span class="ws-footer-logo">${h(COPY.nav.logo)}</span> <span class="ws-footer-tagline">${h(COPY.footer.tagline)}</span></p>`,
    `<p class="ws-footer-links">${privacyLink}<a href="/credits">${h(COPY.credits.footerLink)}</a></p>`,
    `<p class="ws-footer-note">${h(COPY.footer.medical)}</p>`,
    affOn ? affNote('f') : '',
    `<p class="ws-footer-copy">${h(COPY.footer.copyright)}</p>`,
    '</footer>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/**
 * 259 제휴 고지(111/261 §1) — note-a(검색 블록 안, 상인 버튼 바로 위) · note-b(레이어 본문 첫 요소) · note-f(R4-3 페이지 하단 푸터).
 *   문구 = COPY.affiliate.coupang 원문(자식 태그 0, class 는 ws-t-meta·ws-aff-note 만 — compliance C10-AFF-OUT). 클라이언트 supply/AffNote 와 같은 마크업.
 */
export function affNote(kind: 'a' | 'b' | 'f', id?: string): string {
  return `<p class="ws-t-meta ws-aff-note"${id ? ` id="${a(id)}"` : ''} data-ws-aff="note-${kind}">${h(COPY.affiliate.coupang)}</p>`;
}

/** 레이어 딥링크 페이지: aside.ws-layer 앞의 스크림(스펙22 §2.9 G4). 장식 — 닫기 동작은 하이드레이션 후. */
export const SCRIM = '<div class="ws-scrim" aria-hidden="true"></div>';

/** 상태 글리프(텍스트 문자, 장식이면 aria-hidden). */
export function glyphSpan(kind: keyof typeof GLYPH): string {
  return `<span class="ws-glyph" data-ws-glyph="${a(kind)}" aria-hidden="true">${h(GLYPH[kind])}</span>`;
}

/** 스펙22 §4-1 — 「기준 충족」 배지(상품 카드·L7). 글리프 = 판정 4상태 ○(R4-1, 클라이언트 ProductCard·ProductLayer 와 같은 표). */
export function meetsBadge(): string {
  return `<span class="ws-badge">${glyphSpan('ok')}${h(COPY.product.badge)}</span>`;
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

export type RailKind = 'need' | 'bundle' | 'product' | 'vet' | 'review' | 'starter' | 'habitat';
const RAIL_LIST_CLASS: Record<RailKind, string> = {
  need: 'ws-chips',
  bundle: 'ws-bundles',
  product: 'ws-products',
  vet: 'ws-vets',
  review: 'ws-reviews',
  starter: 'ws-starters',
  // 286 U3e(D4) — 홈 A 「함께 살 집」 노출 타입 카드(grid3, 카드 모양은 시작 카드와 같음).
  habitat: 'ws-habitats',
};

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
  /** 286 U3b — 'grid3' = ≥768 3열 그리드 / ≤767 가로 레일 peek(홈 A 시작 카드 전용). 생략 = 기존 레일(홈 B 무변경). */
  layout?: 'grid3';
  /** R4-2b 홈 B 톤 — client RailSection tone='home' 과 같은 마크업(section + ws-home-sec ws-{id}-sec, 제목 display, lead 문단, 레일 아래 → 링크). */
  tone?: 'home';
  lead?: readonly string[];
  foot?: { label: string; href: string } | null;
  items: readonly string[];
}): string {
  const titleId = `ws-sec-${o.id}-title`;
  const home = o.tone === 'home';
  const extra = Object.entries(o.attrs ?? {})
    .map(([k, v]) => ` ${k}="${a(v)}"`)
    .join('');
  const more = o.more ? `<a class="ws-rail-more ws-t-meta" href="${a(o.more.href)}">${h(o.more.label)}<span aria-hidden="true"> ›</span></a>` : '';
  return [
    `<section class="ws-rail-section ws-rail-section--${o.kind}${o.layout ? ` ws-rail-section--${o.layout}` : ''}${home ? ` ws-home-sec ws-${a(o.id)}-sec` : ''}" data-ws-section="${a(o.id)}" aria-labelledby="${titleId}"${extra}>`,
    '<div class="ws-rail-head">',
    home
      ? `<div class="ws-rail-heading ws-home-sec-head"><h2 id="${titleId}" class="ws-t-display ws-home-sec-title">${o.titleHtml}</h2>${(o.lead ?? [])
          .map((x) => `<p class="ws-t-body ws-muted ws-home-sec-lead">${h(x)}</p>`)
          .join('')}</div>`
      : `<div class="ws-rail-heading"><h2 id="${titleId}" class="ws-t-section">${o.titleHtml}</h2>${o.sub ? `<p class="ws-rail-sub ws-t-body">${h(o.sub)}</p>` : ''}</div>`,
    `<div class="ws-rail-tools">${more}</div>`,
    '</div>',
    `<ul class="ws-rail ${RAIL_LIST_CLASS[o.kind]}" role="list"${o.layout === 'grid3' ? '' : ' tabindex="0"'} aria-labelledby="${titleId}">`,
    ...o.items,
    '</ul>',
    ...(home && o.foot ? [`<a class="ws-home-link ws-rail-foot" href="${a(o.foot.href)}">${h(o.foot.label)}<span aria-hidden="true"> →</span></a>`] : []),
    '</section>',
  ].join('\n');
}

/** ProductCard ♡ 자리(스펙33 §2.4, D-38): 링크 형제 span, 하이드레이션 후 버튼으로 교체. 숫자 0(프리렌더). */
export const LIKE_PLACEHOLDER = '<span class="ws-like" aria-hidden="true"><span class="ws-like-glyph" aria-hidden="true">♡</span></span>';
