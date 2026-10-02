// 페이지 공통 조각(계획 §6-2) — head·헤더·푸터·규격 문장. 모든 시드 텍스트는 escapeHtml/escapeAttr 를 거친다.
import {
  splitLabel,
  type PublicAnimalType,
  type RuleCond,
  type SpecField,
  type SpecRule,
  type SpecSchema,
  type SpecValue,
  type WsPageData,
} from '../../engine/index.js';
import { COPY } from '../copy.js';
import { escapeAttr as a, escapeHtml as h, jsonForScript } from '../html.js';
import type { RoutePlan } from '../routes.js';
import { encodeSitemapPath } from '../sitemap.js';

export interface PageContext {
  origin: string;
  route: RoutePlan;
  /** /credits 라우트가 있으면 모든 페이지 푸터에 링크(C6). */
  hasCredits: boolean;
  catalogUrl: string;
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

export function renderHeader(type: Pick<PublicAnimalType, 'slug' | 'displayName'> | null): string {
  const chip = type
    ? `<a data-ws-chip href="${a(hrefOf(`/${type.slug}`))}">${h(type.displayName)}</a>`
    : `<a data-ws-chip href="/">${h(COPY.nav.chooseFriend)}</a>`;
  return [
    '<header class="ws-header">',
    `<a class="ws-logo" href="/">${h(COPY.nav.logo)}</a>`,
    chip,
    '<nav class="ws-nav">',
    `<a href="/supplies">${h(COPY.nav.supplies)}</a>`,
    `<a href="/vet">${h(COPY.nav.vet)}</a>`,
    '</nav>',
    '</header>',
  ].join('\n');
}

export function renderFooter(ctx: PageContext): string {
  return [
    '<footer class="ws-footer">',
    `<p>${h(COPY.footer.identity)}</p>`,
    `<p>${h(COPY.footer.health)}</p>`,
    ctx.hasCredits ? `<p><a href="/credits">${h(COPY.credits.footerLink)}</a></p>` : '',
    '</footer>',
  ]
    .filter((x) => x !== '')
    .join('\n');
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
function fieldOf(schema: SpecSchema, key: string): SpecField | undefined {
  return Array.isArray(schema?.fields) ? schema.fields.find((f) => f.key === key) : undefined;
}

function valueLabel(f: SpecField | undefined, v: SpecValue): string {
  if (f?.type === 'number' && typeof v === 'number') return `${v}${splitLabel(f.label).unit}`;
  if (f?.type === 'enum' && typeof v === 'string') return f.optionLabels?.[v] ?? v;
  if (typeof v === 'boolean') return v ? '' : COPY.spec.none;
  return String(v);
}

function condText(schema: SpecSchema, c: RuleCond): string {
  const f = fieldOf(schema, c.key);
  const name = f ? splitLabel(f.label).base : c.key;
  const vals = Array.isArray(c.value) ? c.value : [c.value];
  switch (c.op) {
    case 'gte':
      return `${name} ${valueLabel(f, vals[0])} ${COPY.spec.gte}`;
    case 'lte':
      return `${name} ${valueLabel(f, vals[0])} ${COPY.spec.lte}`;
    case 'eq':
      if (typeof vals[0] === 'boolean') return vals[0] ? name : `${name} ${COPY.spec.none}`;
      return `${name} ${valueLabel(f, vals[0])}`;
    case 'in':
      return `${name} ${vals.map((v) => valueLabel(f, v)).join(' · ')}`;
    case 'not_in':
      return `${name} ${vals.map((v) => valueLabel(f, v)).join(' · ')} ${COPY.spec.notIn}`;
    default:
      return name;
  }
}

/** 규칙 → "바닥 가로 60cm 이상"(조건부면 "형태 철장일 때 — …"). */
export function ruleText(schema: SpecSchema, r: SpecRule): string {
  const main = condText(schema, r);
  const when = Array.isArray(r.when) && r.when.length > 0 ? r.when.map((c) => condText(schema, c)).join(' · ') : '';
  return when ? `${when}${COPY.spec.when} — ${main}` : main;
}

/** 상품 규격 한 줄: "지름 30cm · 바닥면 통면 · 설치 스탠드". */
export function specLine(schema: SpecSchema, values: Readonly<Record<string, SpecValue | undefined>>): string {
  const parts: string[] = [];
  for (const f of Array.isArray(schema?.fields) ? schema.fields : []) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (f.type === 'boolean') {
      if (v === true) parts.push(splitLabel(f.label).base);
      continue;
    }
    parts.push(`${splitLabel(f.label).base} ${valueLabel(f, v)}`);
  }
  return parts.join(' · ');
}

export function externalLink(href: string, text: string): string {
  return `<a href="${a(href)}" target="_blank" rel="noopener noreferrer nofollow">${h(text)}</a>`;
}
