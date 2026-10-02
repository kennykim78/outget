// 홈 A(콜드스타트 4섹션) · /{family} · /supplies · /supplies/{item}[/{type}] · /vet[/{region}] · /credits · 404.
import { SUPPLY_CATEGORIES, type PublicVet, type WsPageData } from '../../engine/index.js';
import { COPY } from '../copy.js';
import { escapeAttr as a, escapeHtml as h } from '../html.js';
import type { SiteModel, TypeModel } from '../project.js';
import { regionSegment } from '../routes.js';
import {
  emptyData,
  externalLink,
  hrefOf,
  mainOpen,
  renderFooter,
  renderHead,
  renderHeader,
  wsData,
  type Crumb,
  type PageContext,
  type RenderedPage,
} from './common.js';
import { layerL4 } from './type.js';

const HOME: Crumb = { name: COPY.site.name, path: '/' };

function page(
  ctx: PageContext,
  o: { title: string; description: string; crumbs: Crumb[]; main: string[]; aside?: string; typeId?: string; header?: TypeModel; data: WsPageData['data'] },
): RenderedPage {
  return {
    head: renderHead(ctx, { title: o.title, description: o.description, crumbs: o.crumbs }),
    body: [
      renderHeader(o.header ? o.header.pub : null),
      mainOpen(ctx, o.typeId),
      ...o.main,
      '</main>',
      o.aside ?? '',
      renderFooter(ctx),
    ]
      .filter((x) => x !== '')
      .join('\n'),
    data: wsData(ctx, o.data),
  };
}

function typeLink(t: TypeModel): string {
  return `<li data-ws-id="animalTypes#${a(t.id)}"><a href="${a(hrefOf(`/${t.slug}`))}">${h(t.pub.displayName)}</a></li>`;
}

/** 홈 A — ① 친구 선택 ② 실제 이용 후기(0개면 섹션 없음) ③ 소개 ④ 시작 배너. */
export function renderHome(m: SiteModel, ctx: PageContext): RenderedPage {
  const typeName = new Map(m.types.map((t) => [t.id, t.pub.displayName]));
  const reviews = m.testimonials.length
    ? [
        `<section data-ws-section="reviews"><h2>${h(COPY.homeA.reviewsTitle)}</h2><ul>`,
        ...m.testimonials.map((t) =>
          [
            `<li data-ws-id="testimonials#${a(t.id)}">`,
            `<blockquote>${h(t.quote)}</blockquote>`,
            `<p>${typeName.has(t.animalTypeId) ? `${h(typeName.get(t.animalTypeId) as string)} · ` : ''}${h(COPY.situation[t.situation])}</p>`,
            `<span class="ws-chip">${h(COPY.homeA.reviewVerifiedChip)}</span>`,
            '</li>',
          ].join(''),
        ),
        '</ul></section>',
      ].join('\n')
    : '';
  return page(ctx, {
    title: COPY.site.homeTitle,
    description: COPY.site.description,
    crumbs: [HOME],
    main: [
      '<section data-ws-section="hero">',
      `<h1>${h(COPY.homeA.heroTitle)}</h1>`,
      `<p><button type="button" data-ws-action="pick-animal">${h(COPY.homeA.heroCta)}</button></p>`,
      `<ul class="ws-feature-chips">${COPY.homeA.featureChips.map((c, i) => `<li><a href="#ws-intro-${i + 1}">${h(c)}</a></li>`).join('')}</ul>`,
      '</section>',
      reviews,
      `<section data-ws-section="intro"><h2>${h(COPY.homeA.introTitle)}</h2>`,
      ...COPY.homeA.featureChips.map((c, i) => `<article id="ws-intro-${i + 1}"><h3>${h(c)}</h3></article>`),
      '</section>',
      `<section data-ws-section="start"><h2>${h(COPY.homeA.startTitle)}</h2>`,
      `<p><button type="button" data-ws-action="pick-animal">${h(COPY.homeA.startCta)}</button></p>`,
      `<p>${h(COPY.homeA.startNote)}</p>`,
      '</section>',
    ].filter((x) => x !== ''),
    data: { ...emptyData(), types: m.types.map((t) => t.pub), testimonials: m.testimonials },
  });
}

/** /{family} — 같은 첫 세그먼트를 쓰는 노출 타입 목록(D3). */
export function renderFamily(m: SiteModel, ctx: PageContext): RenderedPage {
  const ts = m.types.filter((t) => t.family === ctx.route.family);
  const name = ts.map((t) => t.pub.displayName).join(' · ');
  return page(ctx, {
    title: `${name}${COPY.site.titleSuffix}`,
    description: COPY.site.description,
    crumbs: [HOME, { name, path: ctx.route.path }],
    main: [`<h1>${h(name)}</h1>`, `<ul class="ws-types">`, ...ts.map(typeLink), '</ul>'],
    data: { ...emptyData(), types: ts.map((t) => t.pub) },
  });
}

/** /supplies — 카테고리 그리드 10칸(US-008). 노출 항목이 없으면 링크 0 + 빈 상태. */
export function renderSupplies(m: SiteModel, ctx: PageContext): RenderedPage {
  const cells = SUPPLY_CATEGORIES.map((c) => {
    const items = m.items.filter((i) => i.category === c);
    const list = items.length
      ? `<ul>${items.map((i) => `<li data-ws-id="supplyItems#${a(i.id)}"><a href="${a(hrefOf(`/supplies/${i.id}`))}">${h(i.name)}</a></li>`).join('')}</ul>`
      : '';
    return `<li class="ws-category" data-ws-category="${a(c)}"><h2>${h(COPY.categories[c])}</h2>${list}</li>`;
  });
  return page(ctx, {
    title: `${COPY.supplies.title}${COPY.site.titleSuffix}`,
    description: COPY.supplies.intro,
    crumbs: [HOME, { name: COPY.supplies.title, path: '/supplies' }],
    main: [
      `<h1>${h(COPY.supplies.title)}</h1>`,
      `<p>${h(m.items.length ? COPY.supplies.intro : COPY.supplies.empty)}</p>`,
      '<ul class="ws-category-grid">',
      ...cells,
      '</ul>',
    ],
    data: { ...emptyData(), types: m.types.map((t) => t.pub) },
  });
}

/** /supplies/{item} — "어떤 친구의 기준을 볼까요?" + 이 항목을 노출하는 타입. /supplies/{item}/{type} 은 같은 부모 + L4. */
export function renderSupplyItem(m: SiteModel, ctx: PageContext): RenderedPage {
  const it = m.items.find((i) => i.id === ctx.route.itemId);
  if (!it) throw new Error(`pages: 노출 항목 ${ctx.route.itemId} 없음`);
  const ts = m.types.filter((t) => it.typeIds.includes(t.id));
  const crumbs: Crumb[] = [HOME, { name: COPY.supplies.title, path: '/supplies' }, { name: it.name, path: `/supplies/${it.id}` }];
  let aside: string | undefined;
  let typeId: string | undefined;
  let header: TypeModel | undefined;
  const data: WsPageData['data'] = { ...emptyData(), types: ts.map((t) => t.pub) };
  if (ctx.route.kind === 'SUPPLY_ITEM_TYPE') {
    const t = ts.find((x) => x.id === ctx.route.typeId);
    const r = t?.requirements.find((x) => x.item.id === it.id);
    if (!t || !r) throw new Error(`pages: ${ctx.route.typeId} × ${it.id} 노출 요구사항 없음`);
    aside = layerL4(t, r);
    typeId = t.id;
    header = t;
    crumbs.push({ name: t.pub.displayName, path: ctx.route.path });
    data.types = [t.pub];
    data.requirements = [r.pub];
    data.products = r.products;
  }
  return page(ctx, {
    title: `${it.name}${header ? ` · ${header.pub.displayName}` : ''}${COPY.site.titleSuffix}`,
    description: COPY.supplies.intro,
    crumbs,
    main: [
      `<h1 data-ws-id="supplyItems#${a(it.id)}">${h(it.name)}</h1>`,
      `<p>${h(COPY.supplies.chooseAnimal)}</p>`,
      '<ul class="ws-types">',
      ...ts.map(
        (t) =>
          `<li data-ws-id="animalTypes#${a(t.id)}"><a href="${a(hrefOf(`/supplies/${it.id}/${t.id}`))}">${h(t.pub.displayName)}</a></li>`,
      ),
      '</ul>',
    ],
    aside,
    typeId,
    header,
    data,
  });
}

function vetCard(v: PublicVet): string {
  const flags = [v.night ? COPY.vet.night : '', v.emergency ? COPY.vet.emergency : ''].filter((x) => x !== '');
  return [
    `<li class="ws-vet" data-ws-id="vetClinics#${a(v.id)}">`,
    `<h3>${h(v.name)}</h3>`,
    `<p>${h(v.address)}</p>`,
    flags.length ? `<p>${flags.map((f) => `<span class="ws-chip">${h(f)}</span>`).join(' ')}</p>` : '',
    v.phone ? `<p><a href="tel:${a(v.phone.replace(/[^0-9+]/g, ''))}">${h(COPY.vet.call)} ${h(v.phone)}</a></p>` : '',
    '</li>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** /vet — 지역 목록 + 전체 병원, 0이면 빈 상태. /vet/{region} — 지역 병원. 좌표는 ws-data 에만(지도는 R4 클라이언트). */
export function renderVet(m: SiteModel, ctx: PageContext): RenderedPage {
  const region = ctx.route.region;
  const vets = region === undefined ? m.vets : m.vets.filter((v) => v.region === region);
  const regions = [...new Set(m.vets.map((v) => v.region))].sort();
  const crumbs: Crumb[] = [HOME, { name: COPY.vet.title, path: '/vet' }];
  if (region !== undefined) crumbs.push({ name: region, path: ctx.route.path });
  const main =
    region === undefined
      ? [
          `<h1>${h(COPY.vet.title)}</h1>`,
          vets.length
            ? `<h2>${h(COPY.vet.regionsTitle)}</h2><ul class="ws-regions">${regions
                .map((r) => `<li><a href="${a(hrefOf(`/vet/${regionSegment(r)}`))}">${h(r)}</a></li>`)
                .join('')}</ul>`
            : `<p>${h(COPY.vet.emptyAll)}</p>`,
        ]
      : [`<h1>${h(region)} · ${h(COPY.vet.title)}</h1>`, vets.length ? '' : `<p>${h(COPY.vet.emptyRegion)}</p>`];
  if (vets.length) main.push(`<ul class="ws-vets">\n${vets.map(vetCard).join('\n')}\n</ul>`);
  main.push(`<p class="ws-vet-note">${h(COPY.vet.visitNote)}</p>`); // K1: 병원 목록 근처에 항상
  return page(ctx, {
    title: `${region ? `${region} · ` : ''}${COPY.vet.title}${COPY.site.titleSuffix}`,
    description: vets.length ? COPY.vet.visitNote : COPY.vet.emptyAll,
    crumbs,
    main: main.filter((x) => x !== ''),
    data: { ...emptyData(), vets },
  });
}

/** /credits — CC BY 계열 사진 저작자 표시(PRD US-021 계열, C6). */
export function renderCredits(m: SiteModel, ctx: PageContext): RenderedPage {
  return page(ctx, {
    title: `${COPY.credits.title}${COPY.site.titleSuffix}`,
    description: COPY.credits.intro,
    crumbs: [HOME, { name: COPY.credits.title, path: '/credits' }],
    main: [
      `<h1>${h(COPY.credits.title)}</h1>`,
      `<p>${h(COPY.credits.intro)}</p>`,
      '<ul class="ws-credits">',
      ...m.credits.map((c) =>
        [
          `<li data-ws-id="photos#${a(c.id)}">`,
          `<p>${h(c.scene)}</p>`,
          c.author ? `<p>${h(COPY.credits.author)}: ${h(c.author)}</p>` : '',
          `<p>${h(COPY.credits.license)}: ${h(c.license)}</p>`,
          `<p>${h(COPY.credits.source)}: ${externalLink(c.sourceUrl, c.source)}</p>`,
          '</li>',
        ]
          .filter((x) => x !== '')
          .join(''),
      ),
      '</ul>',
    ],
    data: emptyData(),
  });
}

/** 404 — 그룹 진입 링크(US-001). */
export function renderNotFound(m: SiteModel, ctx: PageContext): RenderedPage {
  const families = [...new Set(m.types.map((t) => t.family).filter((f): f is string => f !== null))];
  const singles = m.types.filter((t) => t.family === null);
  return page(ctx, {
    title: `${COPY.notFound.title}${COPY.site.titleSuffix}`,
    description: COPY.notFound.body,
    crumbs: [HOME],
    main: [
      `<h1>${h(COPY.notFound.title)}</h1>`,
      `<p>${h(COPY.notFound.body)}</p>`,
      '<ul class="ws-groups">',
      ...families.map((f) => {
        const names = m.types.filter((t) => t.family === f).map((t) => t.pub.displayName).join(' · ');
        return `<li><a href="${a(hrefOf(`/${f}`))}">${h(names)}</a></li>`;
      }),
      ...singles.map(typeLink),
      `<li><a href="/">${h(COPY.notFound.home)}</a></li>`,
      '</ul>',
    ],
    data: { ...emptyData(), types: m.types.map((t) => t.pub) },
  });
}
