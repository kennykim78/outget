// 페이지 공통 조각(계획 §6-2) — head·헤더·푸터·규격 문장. 모든 시드 텍스트는 escapeHtml/escapeAttr 를 거친다.
import {
  optionLabel,
  splitLabel,
  type PublicAnimalType,
  type RuleCond,
  type SpecField,
  type SpecRule,
  type SpecSchema,
  type SpecValue,
  type WsPageData,
} from '../../engine/index.js';
import { COPY, GLYPH } from '../copy.js';
import { escapeAttr as a, escapeHtml as h, jsonForScript } from '../html.js';
import type { SiteModel } from '../project.js';
import type { RoutePlan } from '../routes.js';
import { encodeSitemapPath } from '../sitemap.js';

export interface PageContext {
  origin: string;
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
  const noindex = !route.indexable && route.canonicalPath === route.path;
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
export function renderHeader(type: Pick<PublicAnimalType, 'slug' | 'displayName'> | null, current: NavCurrent = null): string {
  const caret = '<span class="ws-chip-caret" aria-hidden="true">▾</span>';
  const chip = type
    ? `<a data-ws-chip href="${a(hrefOf(`/${type.slug}`))}">${h(type.displayName)} ${caret}</a>`
    : `<a data-ws-chip href="/">${h(COPY.nav.chooseFriend)} ${caret}</a>`;
  return [
    '<header class="ws-header">',
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

/** 스펙22 §2.19 — 크레딧 링크는 항상(R4 D6, C6). */
export function renderFooter(): string {
  return [
    '<footer class="ws-footer">',
    `<p>${h(COPY.footer.identity)}</p>`,
    `<p>${h(COPY.footer.health)}</p>`,
    `<p><a href="/credits">${h(COPY.credits.footerLink)}</a></p>`,
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

/** 스펙22 §2.16 D-2 — 히어로·컨텍스트 헤더 인라인 마스코트(정제 SVG, aria-hidden). 자산 없으면 빈 디스크. */
export function mascotAvatar(ctx: PageContext, asset: string | null | undefined, tone: 'brand-soft' | 'peach-soft'): string {
  const svg = typeof asset === 'string' ? ctx.mascots.get(asset) : undefined;
  return `<span class="ws-avatar ws-avatar--lg ws-avatar--${tone}" aria-hidden="true">${svg ?? ''}</span>`;
}

export function mainOpen(ctx: PageContext, typeId?: string): string {
  const t = typeId !== undefined ? ` data-ws-type="${a(typeId)}"` : '';
  return `<main class="ws-page" data-ws-route="${a(ctx.route.kind)}"${t}>`;
}

/** 'YYYY-MM-DD' → 'YYYY.MM'(US-007 "마지막 검수 2026.09"). */
export function yearMonth(d: string | null | undefined): string | null {
  return typeof d === 'string' && /^\d{4}-\d{2}/.test(d) ? `${d.slice(0, 4)}.${d.slice(5, 7)}` : null;
}

// ── 규격 문장(시드 specSchema 라벨 + 규칙 값) ───────────────────
//   enum 값은 engine optionLabel() 단일 헬퍼로만 표시(스펙22 §4-3) — 라벨 없는 값은 원시 코드로 내보내지 않는다.
function fieldOf(schema: SpecSchema, key: string): SpecField | undefined {
  return Array.isArray(schema?.fields) ? schema.fields.find((f) => f.key === key) : undefined;
}

/** 값 표시. enum 라벨이 없으면 null(호출부가 행·항목을 생략). */
function valueLabel(f: SpecField | undefined, v: SpecValue): string | null {
  if (f?.type === 'number' && typeof v === 'number') return `${v}${splitLabel(f.label).unit}`;
  if (f?.type === 'enum') return optionLabel(f, v);
  if (typeof v === 'boolean') return v ? '' : COPY.spec.none;
  if (typeof v === 'string' && f === undefined) return null; // 스키마 밖 키의 문자열 값 = 원시 코드일 수 있음
  return String(v);
}

function condText(schema: SpecSchema, c: RuleCond): string | null {
  const f = fieldOf(schema, c.key);
  const name = f ? splitLabel(f.label).base : c.key;
  const raw = Array.isArray(c.value) ? c.value : [c.value];
  const vals = raw.map((v) => valueLabel(f, v));
  if (vals.some((v) => v === null)) return null;
  const vs = vals as string[];
  switch (c.op) {
    case 'gte':
      return `${name} ${vs[0]} ${COPY.spec.gte}`;
    case 'lte':
      return `${name} ${vs[0]} ${COPY.spec.lte}`;
    case 'eq':
      if (typeof raw[0] === 'boolean') return raw[0] ? name : `${name} ${COPY.spec.none}`;
      return `${name} ${vs[0]}`;
    case 'in':
      return `${name} ${vs.join(' · ')}`;
    case 'not_in':
      return `${name} ${vs.join(' · ')} ${COPY.spec.notIn}`;
    default:
      return name;
  }
}

/**
 * 규칙 → "바닥 가로 60cm 이상"(조건부면 "형태 철장일 때 — …").
 *   라벨 없는 enum 값이 규칙·when 어디에든 있으면 null — L4 조건 행을 숨긴다(스펙22 §4-3).
 */
export function ruleText(schema: SpecSchema, r: SpecRule): string | null {
  const main = condText(schema, r);
  if (main === null) return null;
  const whens = Array.isArray(r.when) ? r.when.map((c) => condText(schema, c)) : [];
  if (whens.some((w) => w === null)) return null;
  const when = whens.join(' · ');
  return when ? `${when}${COPY.spec.when} — ${main}` : main;
}

/** 상품 규격 한 줄: "지름 30cm · 바닥면 통면 · 설치 스탠드". 라벨 없는 enum 필드·값 없는 필드는 생략. */
export function specLine(schema: SpecSchema, values: Readonly<Record<string, SpecValue | undefined>>): string {
  const parts: string[] = [];
  for (const f of Array.isArray(schema?.fields) ? schema.fields : []) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (f.type === 'boolean') {
      if (v === true) parts.push(splitLabel(f.label).base);
      continue;
    }
    const shown = valueLabel(f, v);
    if (shown === null) continue;
    parts.push(`${splitLabel(f.label).base} ${shown}`);
  }
  return parts.join(' · ');
}

export function externalLink(href: string, text: string): string {
  return `<a href="${a(href)}" target="_blank" rel="noopener noreferrer nofollow">${h(text)}</a>`;
}
