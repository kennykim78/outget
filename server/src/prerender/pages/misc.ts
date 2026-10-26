// 홈 A(콜드스타트 4섹션) · /{family} · /supplies · /supplies/{item}[/{type}] · /vet[/{region}] · /credits · 404.
import { ANIMAL_GROUPS, PICK_PATH, SUPPLY_CATEGORIES, type WsPageData } from '../../engine/index.js';
import { COPY, formatCopy } from '../copy.js';
import { escapeAttr as a, escapeHtml as h } from '../html.js';
import type { SiteModel, TypeModel } from '../project.js';
import { regionSegment } from '../routes.js';
import {
  SCRIM,
  allTypes,
  emptyData,
  externalLink,
  hrefOf,
  layerClose,
  mainOpen,
  mascotAvatar,
  navCurrent,
  railSection,
  splitTitle,
  renderFooter,
  renderHead,
  renderHeader,
  renderTabBar,
  sortVets,
  vetCard,
  wsData,
  type Crumb,
  type PageContext,
  type RenderedPage,
} from './common.js';
import { PRIVACY_POLICY, assertInternalHref, fillTokens, linkMailto, type PrivacyBlock, type PrivacyCell } from '../privacy-content.js';
import { familyName } from './family.js';
import { layerL4 } from './type.js';

const HOME: Crumb = { name: COPY.site.name, path: '/' };

function page(
  ctx: PageContext,
  o: {
    title: string;
    description: string;
    crumbs: Crumb[];
    main: string[];
    aside?: string;
    typeId?: string;
    header?: TypeModel;
    mainAttrs?: Readonly<Record<string, string>>;
    /** main 에 덧붙일 클래스(client 와 같은 ws-home-a 등). */
    mainClass?: string;
    data: WsPageData['data'];
  },
): RenderedPage {
  return {
    head: renderHead(ctx, { title: o.title, description: o.description, crumbs: o.crumbs }),
    body: [
      renderHeader(o.header ? o.header.pub : null, navCurrent(ctx.route), ctx),
      mainOpen(ctx, o.typeId, o.mainAttrs, o.mainClass),
      ...o.main,
      '</main>',
      o.aside ? `${SCRIM}
${o.aside}` : '',
      renderFooter(),
      renderTabBar(o.header ? o.header.pub : null, navCurrent(ctx.route)),
    ]
      .filter((x) => x !== '')
      .join('\n'),
    data: wsData(ctx, o.data),
  };
}

function typeLink(t: TypeModel): string {
  return `<li data-ws-id="animalTypes#${a(t.id)}"><a href="${a(hrefOf(`/${t.slug}`))}">${h(t.pub.displayName)}</a></li>`;
}

/** 홈 ws-data 병원 상한 — ws-data ≤ 32KB 유지(병원 1건 ≈ 300B). 넘치면 /vet 이 전체 목록. */
export const HOME_VETS_MAX = 20;

/**
 * 홈 ws-data vets: 목록 노출 병원(isVetListed — /vet 과 같은 PublicVet 투영) 중 지역 → 이름 → id 순 최대 HOME_VETS_MAX.
 *   후기 카드 "동네 병원 보기" 행동이 병원 존재 여부를 알 수 있게(HTML 본문에는 그리지 않는다).
 */
function homeVets(m: SiteModel): SiteModel['vets'] {
  return sortVets(m.vets).slice(0, HOME_VETS_MAX);
}

/**
 * 홈 ws-data types(R6 G3b) — 노출 타입 전체 + 타입별 specCheckItemId: 노출 요구사항(t.requirements — 이미 엔진 순서
 *   orderHint → priority → 시드 순) 중 specSchema.fields 가 있는 첫 항목 id. 요구사항 전체는 싣지 않는다(LCP·ws-data 크기).
 *   없으면 키 없음(클라이언트는 /{slug} 폴백).
 */
function homeTypes(m: SiteModel): WsPageData['data']['types'] {
  return m.types.map((t) => {
    const r = t.requirements.find((x) => x.item.specSchema.fields.length > 0);
    return r ? { ...t.pub, specCheckItemId: r.item.id } : t.pub;
  });
}

/** 홈 A — ① 친구 선택 ② 실제 이용 후기(0개면 섹션 없음) ③ 소개 ④ 시작 배너. */
export function renderHome(m: SiteModel, ctx: PageContext): RenderedPage {
  return page(ctx, { title: COPY.site.homeTitle, description: COPY.site.description, crumbs: [HOME], ...homeParts(m, ctx) });
}

/**
 * /save(R5 C-R5-6, D11) — 부모 = 홈 A(저장 타입은 클라이언트만 앎) + L8 정적 본문. noindex(라우트 indexable false).
 *   ws-data 는 홈과 같은 키 값(부모 하이드레이션이 홈과 같은 화면을 그리도록). 입력 폼은 하이드레이션 후(JS 필요).
 */
export function renderSave(m: SiteModel, ctx: PageContext): RenderedPage {
  const aside = [
    '<aside class="ws-layer" id="ws-layer" data-ws-layer="L8" role="dialog" aria-labelledby="ws-layer-title">',
    `<h2 id="ws-layer-title">${h(COPY.save.title)}</h2>`,
    layerClose('/'),
    `<p>${h(COPY.save.description)}</p>`,
    `<p class="ws-meta">${h(COPY.save.noAds)}</p>`,
    `<noscript><p>${h(COPY.checkLayer.noScript)}</p></noscript>`,
    '</aside>',
  ].join('\n');
  return page(ctx, {
    title: `${COPY.save.title}${COPY.site.titleSuffix}`,
    description: COPY.save.description,
    crumbs: [HOME, { name: COPY.save.title, path: '/save' }],
    ...homeParts(m, ctx),
    aside,
  });
}

/** 친구 선택 CTA(K1, 51 레인 A ③) — JS 없이 /pick, 하이드레이션 후 client 가 L1 로 가로챈다. client Hero·StartBand 와 같은 클래스. */
export function pickCta(label: string): string {
  return `<a class="ws-btn ws-btn--fill" data-ws-action="pick-animal" href="${PICK_PATH}">${h(label)}</a>`;
}

const SAME_ORIGIN_ASSET = /^\/assets\/[A-Za-z0-9._/-]+$/;

/** 홈 A ② 후기 — client home/Reviews.tsx 사다리(0 없음 · 1–2 single · 3–5 rail · ≥6 marquee-static 정지 레일) + ReviewCard 마크업. */
function homeReviews(m: SiteModel, vetAvailable: boolean): string {
  const n = m.testimonials.length;
  if (n === 0) return '';
  const typeName = new Map(m.types.map((t) => [t.id, t.pub.displayName]));
  const card = (t: SiteModel['testimonials'][number]): string => {
    const img =
      typeof t.reviewerImage === 'string' && SAME_ORIGIN_ASSET.test(t.reviewerImage) && !t.reviewerImage.includes('..')
        ? `<img class="ws-review-photo" src="${a(t.reviewerImage)}" alt="" width="40" height="40" loading="lazy" decoding="async">`
        : '<span class="ws-review-photo" aria-hidden="true"></span>';
    const who = [typeName.get(t.animalTypeId), COPY.situation[t.situation]].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ');
    // 행동 링크: VET 은 병원이 있을 때만 /vet(K1). 그 외(체크리스트·규격·구성안)는 미선택 홈이므로 친구 선택 — 정적 /pick(하이드레이션 후 client button → L1).
    const label = t.linkedAction === 'VET' && !vetAvailable ? null : COPY.homeA.reviewAction[t.linkedAction];
    const href = t.linkedAction === 'VET' ? '/vet' : PICK_PATH;
    const action = label ? `<a class="ws-review-action ws-t-meta" href="${href}">${h(label)}<span aria-hidden="true"> ›</span></a>` : '';
    return [
      `<li class="ws-review" data-ws-id="testimonials#${a(t.id)}">`,
      `<blockquote class="ws-review-quote">${h(`“${t.quote}”`)}</blockquote>`,
      `<div class="ws-review-who">${img}<span class="ws-t-meta ws-muted">${h(who)}</span><span class="ws-pill-chip ws-pill-chip--brand">${h(COPY.homeA.reviewVerifiedChip)}</span></div>`,
      action,
      '</li>',
    ].join('');
  };
  const title = splitTitle(COPY.homeA.reviewsTitle);
  if (n <= 2) {
    return [
      '<section class="ws-reviews-section" data-ws-section="reviews" data-ws-ladder="single" aria-labelledby="ws-sec-reviews-title">',
      `<h2 id="ws-sec-reviews-title" class="ws-t-title ws-center-title">${title}</h2>`,
      '<ul class="ws-reviews-static" role="list">',
      ...m.testimonials.map(card),
      '</ul>',
      '</section>',
    ].join('\n');
  }
  return railSection({ id: 'reviews', kind: 'review', titleHtml: title, attrs: { 'data-ws-ladder': n >= 6 ? 'marquee-static' : 'rail' }, items: m.testimonials.map(card) });
}

/**
 * 홈 A 본문 — client home/HomeA.tsx(Hero · Reviews · IntroSlides(≤1023 stack) · StartBand)와 같은 태그·클래스·id·aria(51 레인 A ①).
 *   저장 타입("이어서")은 클라이언트만 알므로 정적 0.
 */
function homeParts(m: SiteModel, ctx: PageContext): { main: string[]; mainClass: string; data: WsPageData['data'] } {
  const vets = homeVets(m);
  const slides = COPY.homeA.introSlides;
  const chips = COPY.homeA.featureChips;
  return {
    main: [
      '<section class="ws-hero" data-ws-section="hero" aria-labelledby="ws-hero-title">',
      mascotAvatar(ctx, 'group-small-mammal', 'brand-soft'),
      `<h1 id="ws-hero-title" class="ws-t-display">${h(COPY.homeA.heroTitle)}</h1>`,
      pickCta(COPY.homeA.heroCta),
      `<ul class="ws-feature-chips">${chips.map((c, i) => `<li><a href="#ws-intro-${i + 1}">${h(c)}</a></li>`).join('')}</ul>`,
      '</section>',
      homeReviews(m, vets.length > 0),
      '<section class="ws-intro" data-ws-section="intro" data-ws-intro="stack" aria-labelledby="ws-sec-intro-title">',
      `<h2 id="ws-sec-intro-title" class="ws-t-title ws-center-title">${splitTitle(COPY.homeA.introTitle)}</h2>`,
      ...slides.map((s, i) =>
        [
          `<article id="ws-intro-${i + 1}" class="ws-intro-slide">`,
          // 사진 자리(빈 블록, D-8). client PhotoTile 의 data-ws-photo(추적용 슬롯 id)는 싣지 않는다 — 사용 불가 사진 id 를 산출물에 남기지 않기 위해.
          '<span class="ws-photo ws-intro-photo" aria-hidden="true"></span>',
          `<p class="ws-t-label ws-eyebrow">${h(chips[i] ?? '')}</p>`,
          `<h3 class="ws-t-title">${h(s.title)}</h3>`,
          `<p class="ws-t-body ws-muted">${h(s.body)}</p>`,
          '</article>',
        ].join(''),
      ),
      '</section>',
      '<section class="ws-band ws-band--start" data-ws-section="start" aria-labelledby="ws-start-title">',
      `<h2 id="ws-start-title" class="ws-t-title">${h(COPY.homeA.startTitle)}</h2>`,
      pickCta(COPY.homeA.startCta),
      `<p class="ws-t-meta ws-muted">${h(COPY.homeA.startNote)}</p>`,
      '</section>',
    ].filter((x) => x !== ''),
    mainClass: 'ws-home-a',
    data: { ...emptyData(), types: homeTypes(m), vets, testimonials: m.testimonials },
  };
}

/** 타입 카드 li — /pick(L1 정적 본문)·/{group} 공유 단일 헬퍼(56 G3 D4). */
function typeCard(ctx: PageContext, t: TypeModel): string {
  const alias = t.pub.aliases[0] ? `<span class="ws-t-meta ws-picker-muted">${h(formatCopy(COPY.homeB.aliasLine, { alias: t.pub.aliases[0] }))}</span>` : '';
  return `<li><a class="ws-type-card" href="${a(hrefOf(`/${t.slug}`))}" data-ws-id="animalTypes#${a(t.id)}">${mascotAvatar(ctx, t.pub.mascot, 'brand-soft', 'type')}<span class="ws-t-cta">${h(t.pub.displayName)}</span>${alias}</a></li>`;
}

/**
 * /pick(K1, 51 레인 A ④) — 부모 = 홈 A + L1(친구 선택) 정적 본문. noindex·sitemap 제외·canonical /. ws-data = 홈과 같은 값, route.kind PICK, layer null
 *   (/save 의 L8 딥링크와 같은 방식 — 클라이언트가 route.kind/경로로 L1 을 연다). 타입 카드는 /{slug} 문서 링크(JS 없이 선택 = 이동).
 *   "잘 모르겠어요"(검색)는 JS 필요 — 정적으로는 별명 목록을 같은 링크로 보여 준다(후보 안내 문구 포함, 종 확정 아님).
 */
export function renderPick(m: SiteModel, ctx: PageContext): RenderedPage {
  const card = (t: TypeModel): string => typeCard(ctx, t);
  const groups = ANIMAL_GROUPS.flatMap((g) => {
    const ts = m.types.filter((t) => t.pub.group === g);
    if (ts.length === 0) return [];
    return [`<section class="ws-picker-group" data-ws-group="${a(g)}"><h3 class="ws-t-section">${h(COPY.groups[g])}</h3><ul class="ws-picker-grid">${ts.map(card).join('')}</ul></section>`];
  });
  const aliased = m.types.filter((t) => t.pub.aliases.length > 0);
  const unsure = aliased.length
    ? [
        '<section class="ws-picker-unsure-static" data-ws-step="unsure">',
        `<h3 class="ws-t-section">${h(COPY.picker.unsure)}</h3>`,
        `<p class="ws-t-meta ws-picker-muted" data-ws-note="candidate">${h(COPY.picker.candidateNote)}</p>`,
        `<ul class="ws-picker-cands">${aliased
          .map(
            (t) =>
              `<li class="ws-picker-cand"><a href="${a(hrefOf(`/${t.slug}`))}" data-ws-id="animalTypes#${a(t.id)}"><span class="ws-t-cta">${h(t.pub.displayName)}</span> <span class="ws-t-meta ws-picker-muted">${h(formatCopy(COPY.homeB.aliasLine, { alias: t.pub.aliases.join(', ') }))}</span></a></li>`,
          )
          .join('')}</ul>`,
        '</section>',
      ].join('\n')
    : '';
  const aside = [
    '<aside class="ws-layer" id="ws-layer" data-ws-layer="L1" role="dialog" aria-labelledby="ws-layer-title">',
    `<h2 id="ws-layer-title">${h(COPY.homeA.heroCta)}</h2>`,
    layerClose('/'),
    '<div class="ws-layer-body ws-picker" data-ws-step="groups">',
    ...(groups.length ? groups : [`<p class="ws-t-body ws-picker-muted" data-ws-empty="types">${h(COPY.planned.title)}</p>`]),
    unsure,
    '</div>',
    '</aside>',
  ]
    .filter((x) => x !== '')
    .join('\n');
  return page(ctx, {
    title: `${COPY.homeA.heroCta}${COPY.site.titleSuffix}`,
    description: COPY.site.description,
    crumbs: [HOME, { name: COPY.homeA.heroCta, path: PICK_PATH }],
    ...homeParts(m, ctx),
    aside,
  });
}

/** /{family} — 그룹 표시명 h1 + 안내 + 같은 첫 세그먼트를 쓰는 노출 타입 카드(시드 순, 56 G3). */
export function renderFamily(m: SiteModel, ctx: PageContext): RenderedPage {
  const ts = m.types.filter((t) => t.family === ctx.route.family);
  const name = familyName(ctx.route.family ?? '');
  return page(ctx, {
    title: `${name}${COPY.site.titleSuffix}`,
    description: COPY.site.description,
    crumbs: [HOME, { name, path: ctx.route.path }],
    main: [
      `<h1>${h(name)}</h1>`,
      `<p class="ws-t-body ws-family-intro">${h(COPY.group.intro)}</p>`,
      '<ul class="ws-picker-grid ws-family-grid">',
      ...ts.map((t) => typeCard(ctx, t)),
      '</ul>',
    ],
    data: { ...emptyData(), types: allTypes(m) },
  });
}

/**
 * /supplies — SupplyCategory 순서, 노출 항목 ≥1 카테고리만(스펙33 §5.6 D-49), 그룹 section + SupplyRow(글리프 + 이름 + ›, D-48).
 *   노출 항목이 없으면 그룹 0 + 빈 상태. 상품·가격·마스코트 0.
 */
export function renderSupplies(m: SiteModel, ctx: PageContext): RenderedPage {
  const row = (i: SiteModel['items'][number]): string => {
    const glyph = m.cat.supplyItems.get(i.id)?.glyph;
    const g = typeof glyph === 'string' && glyph.trim() !== '' ? `<span class="ws-supply-glyph" aria-hidden="true">${h(glyph)}</span>` : '';
    return `<li data-ws-id="supplyItems#${a(i.id)}"><a class="ws-supply-row" href="${a(hrefOf(`/supplies/${i.id}`))}">${g}<span class="ws-supply-name">${h(i.name)}</span><span class="ws-supply-chevron" aria-hidden="true">›</span></a></li>`;
  };
  const cells = SUPPLY_CATEGORIES.flatMap((c) => {
    const items = m.items.filter((i) => i.category === c);
    if (items.length === 0) return [];
    return [`<section class="ws-category" data-ws-category="${a(c)}"><h2>${h(COPY.categories[c])}</h2><ul class="ws-supply-rows">${items.map(row).join('')}</ul></section>`];
  });
  return page(ctx, {
    title: `${COPY.supplies.title}${COPY.site.titleSuffix}`,
    description: COPY.supplies.intro,
    crumbs: [HOME, { name: COPY.supplies.title, path: '/supplies' }],
    main: [
      `<h1>${h(COPY.supplies.title)}</h1>`,
      `<p>${h(m.items.length ? COPY.supplies.intro : COPY.supplies.empty)}</p>`,
      ...cells,
    ],
    data: { ...emptyData(), types: allTypes(m) },
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
  const data: WsPageData['data'] = { ...emptyData(), types: allTypes(m) };
  if (ctx.route.kind === 'SUPPLY_ITEM_TYPE') {
    const t = ts.find((x) => x.id === ctx.route.typeId);
    const r = t?.requirements.find((x) => x.item.id === it.id);
    if (!t || !r) throw new Error(`pages: ${ctx.route.typeId} × ${it.id} 노출 요구사항 없음`);
    aside = layerL4(t, r, `/supplies/${it.id}`);
    typeId = t.id;
    header = t;
    crumbs.push({ name: t.pub.displayName, path: ctx.route.path });
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

/**
 * /vet — 지역 칩("전체" + 지역, aria-current) + 병원 카드, 0이면 빈 상태. /vet/{region} — 지역 병원(스펙33 §5.8, G-4).
 *   main[data-ws-vet-layout=map|list] 는 빌드 시 지도 키 존재 여부만(ctx.vetMap) — map 이면 빈 지도 블록을 예약한다.
 *   필터(진료 동물·야간·응급)·목록|지도 전환·제보 섹션은 하이드레이션 후(클라이언트). 좌표는 ws-data 에만.
 */
export function renderVet(m: SiteModel, ctx: PageContext): RenderedPage {
  const region = ctx.route.region;
  const vets = sortVets(region === undefined ? m.vets : m.vets.filter((v) => v.region === region));
  const regions = [...new Set(m.vets.map((v) => v.region))].sort();
  const typeNames = new Map(m.types.map((t) => [t.id, t.pub.displayName]));
  const layout = ctx.vetMap === true ? 'map' : 'list';
  const crumbs: Crumb[] = [HOME, { name: COPY.vet.title, path: '/vet' }];
  if (region !== undefined) crumbs.push({ name: region, path: ctx.route.path });
  const cur = (on: boolean): string => (on ? ' aria-current="page"' : '');
  const chips = regions.length
    ? // P5 레인 E: 지역 칩 줄 = 라벨 행(p#ws-vet-regions-label) + ul[aria-labelledby]. 넘침 힌트·필터 줄은 클라이언트 전용.
      `<div class="ws-vet-row ws-vet-row--regions"><div class="ws-vet-row-head"><p class="ws-vet-row-label" id="ws-vet-regions-label">${h(COPY.vet.regionsTitle)}</p></div><ul class="ws-region-chips" aria-labelledby="ws-vet-regions-label"><li><a href="/vet"${cur(region === undefined)}>${h(COPY.vet.all)}</a></li>${regions
        .map((r) => `<li><a href="${a(hrefOf(`/vet/${regionSegment(r)}`))}"${cur(r === region)}>${h(r)}</a></li>`)
        .join('')}</ul></div>`
    : '';
  // 조건(필터) 줄 = 클라이언트 VetPage 와 같은 마크업(초기 상태 = 필터 없음, aria-pressed=false). no-JS 에서 버튼은 비동작.
  const usedTreats = new Set(vets.flatMap((v) => v.treats));
  const chip = (label: string): string => `<button type="button" class="ws-filter-chip" aria-pressed="false">${h(label)}</button>`;
  const filters = vets.length
    ? `<div class="ws-vet-row ws-vet-row--filters"><div class="ws-vet-row-head"><p class="ws-vet-row-label" id="ws-vet-filters-label">${h(COPY.vet.filtersTitle)}</p></div><div class="ws-vet-filters" role="group" aria-labelledby="ws-vet-filters-label">${[
        ...m.types.filter((t) => usedTreats.has(t.id)).map((t) => chip(t.pub.displayName)),
        chip(COPY.vet.night),
        chip(COPY.vet.emergency),
      ].join('')}</div></div>`
    : '';
  const main = [
    `<h1>${h(region === undefined ? COPY.vet.title : formatCopy(COPY.vet.regionTitle, { name: region }))}</h1>`,
    chips,
    filters,
    vets.length ? '' : `<p>${h(region === undefined ? COPY.vet.emptyAll : COPY.vet.emptyRegion)}</p>`,
    layout === 'map' && vets.length ? '<div class="ws-vet-map" aria-hidden="true"></div>' : '',
    vets.length ? `<ul class="ws-vets">\n${vets.map((v) => vetCard(v, typeNames, 2)).join('\n')}\n</ul>` : '',
    `<p class="ws-vet-note">${h(COPY.vet.visitNote)}</p>`, // K1: 병원 목록 근처에 항상
  ];
  return page(ctx, {
    title: `${region ? `${region} · ` : ''}${COPY.vet.title}${COPY.site.titleSuffix}`,
    description: vets.length ? COPY.vet.visitNote : COPY.vet.emptyAll,
    crumbs,
    main: main.filter((x) => x !== ''),
    mainAttrs: { 'data-ws-vet-layout': layout },
    data: { ...emptyData(), types: allTypes(m), vets },
  });
}

/**
 * /credits — CC BY 계열 사진 저작자 표시(C6, S1 M-3). R4 D6: 항상 생성(noindex·sitemap 제외), 0건이면 빈 상태.
 *   항목마다 장면 · 저작자 · 라이선스명(증서 링크) · 수정 여부 · 원본 링크(출처 사이트명).
 */
/** 사진 source 코드 → "표시명 · "(copy credits.sourceName). 이름 없는 코드는 원시 코드 대신 생략(원본 링크만). */
function sourceLabel(code: string): string {
  const names: Readonly<Record<string, string>> = COPY.credits.sourceName;
  const name = Object.prototype.hasOwnProperty.call(names, code) ? names[code] : undefined;
  return typeof name === 'string' && name !== '' ? `${h(name)} · ` : '';
}

export function renderCredits(m: SiteModel, ctx: PageContext): RenderedPage {
  const items = m.credits.map((c) =>
    [
      `<li class="ws-credit" data-ws-id="photos#${a(c.id)}">`,
      `<p class="ws-credit-scene">${h(c.scene)}</p>`,
      c.author ? `<p>${h(COPY.credits.author)}: <span class="ws-credit-author">${h(c.author)}</span></p>` : '',
      `<p>${h(COPY.credits.license)}: ${externalLink(c.licenseUrl, c.licenseName)}</p>`,
      `<p>${h(COPY.credits.modified)}: ${h(c.modified ? COPY.credits.modifiedYes : COPY.credits.modifiedNo)}</p>`,
      `<p>${h(COPY.credits.source)}: ${sourceLabel(c.source)}${externalLink(c.sourceUrl, COPY.credits.original)}</p>`,
      '</li>',
    ]
      .filter((x) => x !== '')
      .join(''),
  );
  return page(ctx, {
    title: `${COPY.credits.title}${COPY.site.titleSuffix}`,
    description: COPY.credits.intro,
    crumbs: [HOME, { name: COPY.credits.title, path: '/credits' }],
    main: [
      `<h1>${h(COPY.credits.title)}</h1>`,
      `<p>${h(COPY.credits.intro)}</p>`,
      items.length ? ['<ul class="ws-credits">', ...items, '</ul>'].join('\n') : `<p class="ws-empty">${h(COPY.credits.empty)}</p>`,
    ],
    data: { ...emptyData(), types: allTypes(m) },
  });
}

function privacyBlock(b: PrivacyBlock): string {
  const t = (s: string): string => linkMailto(fillTokens(h(s)));
  // 96 S2: 셀 둘째 줄 보조(받는 때) — 같은 셀 안 span(block), 열은 늘리지 않는다.
  const cell = (c: PrivacyCell): string => (typeof c === 'string' ? t(c) : `${t(c.text)}<span class="ws-t-meta ws-privacy-meta">${t(c.meta)}</span>`);
  if ('p' in b) {
    // 96 N2: 문단 끝 내부 텍스트 링크(외부 링크 0 — assertInternalHref).
    const link = b.link ? ` <a href="${a(assertInternalHref(b.link.href))}">${h(b.link.text)}</a>` : '';
    return `<p>${t(b.p)}${link}</p>`;
  }
  if ('ul' in b) return `<ul>${b.ul.map((x) => `<li>${t(x)}</li>`).join('')}</ul>`;
  const { caption, head, rows } = b.table;
  // 96 S3: 가로 스크롤 래퍼 없음 — 390 에서 표가 폭 안에 들어오는 것은 e2e/static.spec 이 검사.
  return [
    `<table class="ws-privacy-table"><caption>${t(caption)}</caption>`,
    `<thead><tr>${head.map((c) => `<th scope="col">${t(c)}</th>`).join('')}</tr></thead>`,
    `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${cell(c)}</th>` : `<td>${cell(c)}</td>`)).join('')}</tr>`).join('')}</tbody>`,
    '</table>',
  ].join('');
}

/**
 * /privacy(계획 86 P8) — 개인정보 처리방침. 항상 생성, 색인·sitemap 포함(오케스트레이터 2026-10-25). /credits 와 같은 page() 틀.
 *   본문 = privacy-content.ts(구조화 섹션). 기간 숫자는 privacy/policy.ts 단일 출처 → span[data-ws-policy](compliance C9-PRIVACY 대조).
 *   Kenny 미정 값은 {{KENNY:키}} 그대로 — production 산출물이면 compliance FAIL.
 */
export function renderPrivacy(m: SiteModel, ctx: PageContext): RenderedPage {
  const p = PRIVACY_POLICY;
  const anchor = (id: string): string => `privacy-${id}`;
  const toc = [
    '<nav class="ws-privacy-toc" aria-labelledby="ws-privacy-toc-title">',
    `<h2 id="ws-privacy-toc-title">${h(COPY.privacy.toc)}</h2>`,
    `<ol>${p.sections.map((s) => `<li><a href="#${a(anchor(s.id))}">${h(s.title)}</a></li>`).join('')}</ol>`,
    '</nav>',
  ].join('\n');
  const sections = p.sections.map((s, i) =>
    [
      `<section class="ws-privacy-section" id="${a(anchor(s.id))}" data-ws-privacy-section="${a(s.id)}" aria-labelledby="${a(`${anchor(s.id)}-title`)}">`,
      `<h2 id="${a(`${anchor(s.id)}-title`)}">${h(`${i + 1}. ${s.title}`)}${s.notApplicable ? ` <span class="ws-pill-chip">${h(COPY.privacy.notApplicable)}</span>` : ''}</h2>`,
      ...s.blocks.map(privacyBlock),
      '</section>',
    ].join('\n'),
  );
  const previous = [
    '<section class="ws-privacy-section" id="privacy-previous" data-ws-privacy-section="previous" aria-labelledby="privacy-previous-title">',
    `<h2 id="privacy-previous-title">${h(COPY.privacy.previousTitle)}</h2>`,
    p.previousVersions.length
      ? `<ul>${p.previousVersions.map((v) => `<li>${h(`${COPY.privacy.version} ${v.version} · ${COPY.privacy.effectiveDate} `)}${fillTokens(h(v.effectiveDate))}</li>`).join('')}</ul>`
      : `<p>${h(COPY.privacy.previousNone)}</p>`,
    '</section>',
  ].join('\n');
  return page(ctx, {
    title: `${COPY.privacy.title}${COPY.site.titleSuffix}`,
    description: COPY.privacy.description,
    crumbs: [HOME, { name: COPY.privacy.title, path: '/privacy' }],
    main: [
      `<h1>${h(COPY.privacy.title)}</h1>`,
      `<p class="ws-privacy-meta ws-t-meta" data-ws-privacy-version="${a(p.version)}">${h(`${COPY.privacy.version} ${p.version} · ${COPY.privacy.effectiveDate} `)}${fillTokens(h(p.effectiveDate))}</p>`,
      ...p.intro.map((x) => `<p>${fillTokens(h(x))}</p>`),
      toc,
      ...sections,
      previous,
    ],
    data: { ...emptyData(), types: allTypes(m) },
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
        return `<li><a href="${a(hrefOf(`/${f}`))}">${h(familyName(f))}</a></li>`;
      }),
      ...singles.map(typeLink),
      '</ul>',
      // 51 레인 A ⑦: 복귀 링크 — 홈·용품·병원(병원 라벨 notFound.vetLink).
      '<ul class="ws-notfound-links">',
      `<li><a href="/">${h(COPY.notFound.home)}</a></li>`,
      `<li><a href="/supplies">${h(COPY.nav.supplies)}</a></li>`,
      `<li><a href="/vet">${h(COPY.notFound.vetLink)}</a></li>`,
      '</ul>',
    ],
    data: { ...emptyData(), types: allTypes(m) },
  });
}
