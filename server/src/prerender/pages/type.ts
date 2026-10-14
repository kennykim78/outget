// 타입 홈 B(컨텍스트 헤더 + 5섹션, UX §3.1 B) · 구성안(/setup) · 레이어 L4/L5/L7(부모 페이지 + 레이어 본문, UX §2.2).
//   D18: ① 은 L3 이전 상태 — 숫자 없이 "필수 준비를 먼저 확인해요" + REQUIRED 칩. 병원은 /vet 링크만.
import { PICK_PATH, chipSpecText, hasCompleteOptionLabels, optionLabel, type PublicProduct, type PublicVet, type WsPageData } from '../../engine/index.js';
import { COPY, formatCopy } from '../copy.js';
import { escapeAttr as a, escapeHtml as h } from '../html.js';
import type { RequirementModel, SiteModel, TypeModel } from '../project.js';
import {
  LIKE_PLACEHOLDER,
  SCRIM,
  allTypes,
  emptyLi,
  externalLink,
  hrefOf,
  glyphSpan,
  imageTile,
  layerClose,
  mainOpen,
  mascotAvatar,
  meetsBadge,
  navCurrent,
  railSection,
  renderFooter,
  renderHead,
  renderHeader,
  renderTabBar,
  ruleText,
  sortVets,
  specLine,
  vetCard,
  wsData,
  yearMonth,
  type Crumb,
  type PageContext,
  type RenderedPage,
} from './common.js';
import { familyName } from './family.js';

const LINK_TEXT = { COUPANG: COPY.supplyLayer.findCoupang, NAVER: COPY.supplyLayer.findNaver } as const;

function base(t: TypeModel): string {
  return `/${t.slug}`;
}

function crumbsOf(t: TypeModel): Crumb[] {
  const out: Crumb[] = [{ name: COPY.site.name, path: '/' }];
  if (t.family) {
    out.push({ name: familyName(t.family), path: `/${t.family}` });
  }
  out.push({ name: t.pub.displayName, path: base(t) });
  return out;
}

type ItemOf = RequirementModel['item'];

/** 스펙22 §2.7 — li.ws-product > a > img|span.ws-tile, .ws-product-title, .ws-spec(비면 생략), .ws-badge(✓ 기준 충족). 가격·판매처 없음. */
function productCard(t: TypeModel, p: PublicProduct, item: ItemOf | undefined): string {
  const img = p.imageAsset
    ? `<img src="${a(p.imageAsset)}" alt="${a(p.title)}" loading="lazy" decoding="async" width="160" height="160">`
    : imageTile(item?.glyph);
  const spec = item ? specLine(item.specSchema, p.specValues) : '';
  return [
    `<li class="ws-product" data-ws-id="curatedProducts#${a(p.id)}">`,
    `<a href="${a(hrefOf(`${base(t)}/products/${p.id}`))}">`,
    img,
    `<span class="ws-product-title">${h(p.title)}</span>`,
    spec ? `<span class="ws-spec">${h(spec)}</span>` : '',
    `<span class="ws-product-foot">${meetsBadge()}</span>`,
    '</a>',
    LIKE_PLACEHOLDER,
    '</li>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function itemFor(t: TypeModel, itemId: string): ItemOf | undefined {
  return t.requirements.find((r) => r.item.id === itemId)?.item;
}

/** 타입 홈 ④·ws-data 병원 상한(D16) — ws-data ≤ 32KB 유지. */
export const TYPE_VETS_MAX = 20;

/** 타입 페이지 ws-data vets(C-R5-6, D16): 노출 병원 중 treats ∋ typeId, 지역 → 이름 → id, 최대 TYPE_VETS_MAX. */
export function typeVets(m: Pick<SiteModel, 'vets'>, typeId: string): PublicVet[] {
  return sortVets(m.vets.filter((v) => Array.isArray(v.treats) && v.treats.includes(typeId))).slice(0, TYPE_VETS_MAX);
}

/** 구성안 글리프(client home/BundleCard.tsx TIER_GLYPH 와 같은 표). */
const TIER_GLYPH: Readonly<Record<string, string>> = { BUDGET: '\u{1F33F}', BALANCED: '☁', USED_MIX: '♻' };

/**
 * 타입 홈 본문(부모 페이지) — client home/HomeB.tsx 의 빈 저장소(2질문 전·내 케이지 없음·이메일 미연결) 출력과 같은 태그·클래스·id·aria(51 레인 A ②).
 *   ① 칩 = NeedChip neutral(글리프 없음, 규격 요약 있으면 표시) · ② BundleCard(개수 = bundle.itemCount) · ③ ProductCard(순서 = 노출 순서 그대로, 불변식 ③)
 *   · ④ 병원 레일 또는 링크 섹션 · ⑤ 저장 배너. 하이드레이션 후에만 동작하는 버튼(전체 ›→L2 등)은 정적 0 또는 같은 목적의 링크.
 */
function typeMain(ctx: PageContext, m: SiteModel, t: TypeModel): string {
  const required = t.requirements.filter((r) => r.pub.priority === 'REQUIRED');
  const needChip = (r: RequirementModel): string => {
    const spec = chipSpecText(r.item.specSchema, r.pub.minSpec);
    return `<li data-ws-item="${a(r.item.id)}" data-ws-id="supplyRequirements#${a(r.requirementId)}"><a class="ws-need ws-need--neutral" href="${a(hrefOf(`${base(t)}/supplies/${r.item.id}`))}" data-ws-state="neutral"><span class="ws-need-name">${h(r.item.name)}</span>${spec ? `<span class="ws-t-meta ws-need-spec">${h(spec)}</span>` : ''}</a></li>`;
  };
  const vets = typeVets(m, t.id);
  const typeNames = new Map(m.types.map((x) => [x.id, x.pub.displayName]));
  const bundleCard = (b: TypeModel['bundles'][number]): string =>
    [
      `<li class="ws-bundle" data-ws-id="setupBundles#${a(b.id)}" data-ws-tier="${a(b.tier)}">`,
      `<span class="ws-bundle-glyph" aria-hidden="true">${h(TIER_GLYPH[b.tier] ?? '')}</span>`,
      `<h3 class="ws-t-section">${h(b.name)}</h3>`,
      `<p class="ws-t-meta ws-muted">${h(b.purpose)}</p>`,
      `<p class="ws-t-spec">${h(formatCopy(COPY.bundle.itemCount, { n: b.itemIds.length }))}</p>`,
      b.estimatedRangeText
        ? `<p class="ws-range ws-t-meta ws-muted">${h(b.estimatedRangeText)}</p><p class="ws-range-note ws-t-meta ws-muted">${h(COPY.setup.priceNote)}</p>`
        : '',
      '</li>',
    ]
      .filter((x) => x !== '')
      .join('\n');
  const alias = t.pub.aliases[0] ? formatCopy(COPY.homeB.aliasLine, { alias: t.pub.aliases[0] }) : null;
  const vetSection = vets.length
    ? railSection({
        id: 'vet',
        kind: 'vet',
        titleHtml: h(COPY.homeB.vetTitle),
        more: { label: COPY.homeB.vetLink, href: '/vet' },
        items: vets.map((v) => vetCard(v, typeNames)),
      })
    : [
        '<section class="ws-vet-link" data-ws-section="vet" aria-labelledby="ws-sec-vet-title">',
        `<h2 id="ws-sec-vet-title" class="ws-t-section">${h(COPY.homeB.vetTitle)}</h2>`,
        `<p><a class="ws-rail-more ws-t-meta" href="/vet">${h(COPY.homeB.vetLink)}<span aria-hidden="true"> ›</span></a></p>`,
        '</section>',
      ].join('\n');
  return [
    mainOpen(ctx, t.id, {}, 'ws-home-b'),
    `<section class="ws-context" data-ws-id="animalTypes#${a(t.id)}" aria-labelledby="ws-context-title">`,
    mascotAvatar(ctx, t.pub.mascot, 'peach-soft'),
    `<h1 id="ws-context-title" class="ws-t-display">${h(t.pub.displayName)}</h1>`,
    alias ? `<p class="ws-t-meta ws-muted">${h(alias)}</p>` : '',
    t.pub.oneLiner ? `<p class="ws-t-body ws-muted ws-context-status">${h(t.pub.oneLiner)}</p>` : '',
    `<a class="ws-btn ws-btn--outline" data-ws-action="change-animal" href="${PICK_PATH}">${h(COPY.nav.changeFriend)}</a>`,
    '</section>',
    railSection({
      id: 'now',
      kind: 'need',
      titleHtml: h(COPY.homeB.nowTitle),
      sub: COPY.homeB.nowBeforeSetup,
      more: { label: COPY.nav.seeAll, href: hrefOf(`${base(t)}/setup`) },
      // 정적 앵커: ⑤ 저장 배너 CTA(#ws-now)의 이동 대상. client RailSection 은 id 를 달지 않는다(하이드레이션 후 CTA 는 L2).
      attrs: { id: 'ws-now', 'data-ws-answered': '0' },
      items: required.length ? required.map(needChip) : [emptyLi(COPY.homeB.nowEmpty)],
    }),
    railSection({
      id: 'bundles',
      kind: 'bundle',
      titleHtml: h(COPY.homeB.bundlesTitle),
      more: t.bundles.length ? { label: COPY.setup.detailLink, href: hrefOf(`${base(t)}/setup`) } : null,
      items: t.bundles.length ? t.bundles.map(bundleCard) : [emptyLi(COPY.homeB.bundlesEmpty)],
    }),
    // 상품 표면 표식 유지(client staticCapture PRODUCT_SURFACE_SELECTOR): section[data-ws-section=products] · ul.ws-products · li.ws-product.
    railSection({
      id: 'products',
      kind: 'product',
      titleHtml: h(COPY.homeB.productsTitle),
      items: t.products.length ? t.products.map((p) => productCard(t, p, itemFor(t, p.supplyItemId))) : [emptyLi(COPY.homeB.productsEmpty)],
    }),
    vetSection,
    '<section class="ws-band ws-band--save" data-ws-section="save" aria-labelledby="ws-save-title">',
    `<h2 id="ws-save-title" class="ws-t-title">${h(formatCopy(COPY.homeB.saveTitle, { animal: t.pub.displayName }))}</h2>`,
    `<p class="ws-t-meta ws-muted">${h(COPY.homeB.deviceOnly)}</p>`,
    `<a class="ws-btn ws-btn--fill" href="${a(hrefOf(base(t)))}#ws-now">${h(COPY.homeB.saveCta)}</a>`,
    `<a class="ws-save-link ws-t-meta" href="/save">${h(COPY.homeB.saveLink)}</a>`,
    '</section>',
    '</main>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function searchBlock(r: RequirementModel): string {
  if (r.pub.searchLinks.length === 0) return '';
  return [
    '<div class="ws-search">',
    `<h3>${h(COPY.supplyLayer.findWithCondition)}</h3>`,
    `<p>${h(COPY.supplyLayer.searchKeyword)}: <span class="ws-keyword">${h(r.pub.searchKeyword)}</span></p>`,
    ...r.pub.searchLinks.map((l) => externalLink(l.href, LINK_TEXT[l.provider])),
    '</div>',
  ].join('\n');
}

/** L4 용품 상세 — 순서 고정: 왜 → 조건(최소/권장) → 주의 → 피할 것 → 대안 → [규격 확인][찾기] → 마지막 검수 → 상품 2~3. */
export function layerL4(t: TypeModel, r: RequirementModel, parentPath: string = base(t)): string {
  const p = r.pub;
  const schema = r.item.specSchema;
  // 스펙22 §4-3: 라벨 없는 enum 값(규칙·when)이 들어간 조건 행은 숨긴다 — 원시 코드 비노출.
  const rules = (title: string, rs: typeof p.minSpec.rules): string => {
    const rows = rs.flatMap((x) => {
      const text = ruleText(schema, x);
      return text === null ? [] : [`<li>${h(text)}${x.reason ? ` — ${h(x.reason)}` : ''}</li>`];
    });
    return rows.length ? `<h4>${h(title)}</h4>\n<ul>\n${rows.join('\n')}\n</ul>` : '';
  };
  const alts = p.item.alternativeIds
    .map((id) => t.requirements.find((x) => x.item.id === id))
    .filter((x): x is RequirementModel => x !== undefined);
  const lm = yearMonth(p.lastVerifiedAt);
  return [
    `<aside class="ws-layer" id="ws-layer" data-ws-layer="L4" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#${a(r.requirementId)}">`,
    `<h2 id="ws-layer-title" data-ws-id="supplyItems#${a(r.item.id)}">${h(r.item.name)}</h2>`,
    layerClose(parentPath),
    `<p class="ws-meta">${h(COPY.priority[p.priority])} · ${h(COPY.orderHint[p.orderHint])}</p>`,
    p.priority === 'NOT_NOW' ? `<p>${h(COPY.supplyLayer.notNow)}${p.notNowReason ? ` — ${h(p.notNowReason)}` : ''}</p>` : '',
    `<section data-ws-part="why"><h3>${h(COPY.supplyLayer.why)}</h3><p>${h(p.why)}</p></section>`,
    `<section data-ws-part="conditions"><h3>${h(COPY.supplyLayer.conditions)}</h3>`,
    rules(COPY.supplyLayer.min, p.minSpec.rules),
    rules(COPY.supplyLayer.recommended, p.recommendedSpec.rules),
    '</section>',
    p.caution ? `<section data-ws-part="caution"><h3>${h(COPY.supplyLayer.caution)}</h3><p>${h(p.caution)}</p></section>` : '',
    p.avoid ? `<section data-ws-part="avoid"><h3>${h(COPY.supplyLayer.avoid)}</h3><p>${h(p.avoid)}</p></section>` : '',
    alts.length
      ? `<section data-ws-part="alternatives"><h3>${h(COPY.supplyLayer.alternatives)}</h3><p>${h(COPY.supplyLayer.alternativesNote)}</p><ul>\n${alts
          .map((x) => `<li data-ws-id="supplyItems#${a(x.item.id)}"><a href="${a(hrefOf(`${base(t)}/supplies/${x.item.id}`))}">${h(x.item.name)}</a></li>`)
          .join('\n')}\n</ul></section>`
      : '',
    '<div class="ws-actions">',
    `<a href="${a(hrefOf(`${base(t)}/check/${r.item.id}`))}">${h(COPY.supplyLayer.checkSpec)}</a>`,
    searchBlock(r),
    '</div>',
    lm ? `<p class="ws-verified">${h(COPY.supplyLayer.lastVerified)} ${h(lm)}</p>` : '',
    p.source.length
      ? `<p class="ws-source">${h(COPY.supplyLayer.source)}: ${p.source.map((s) => externalLink(s.url, s.title)).join(' · ')}</p>`
      : '',
    r.products.length
      ? `<section data-ws-part="products"><h3>${h(COPY.supplyLayer.matchingProducts)}</h3><ul>\n${r.products
          .slice(0, 3)
          .map((x) => productCard(t, x, r.item))
          .join('\n')}\n</ul></section>`
      : '',
    '</aside>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** 숫자 속성(보안 L-3): 유한수만 String(Number(v)) → escapeAttr, 아니면 속성 생략. */
function numAttr(name: string, v: unknown): string {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? ` ${name}="${a(String(n))}"` : '';
}

/**
 * L5 규격 확인 — 정적 폼(판정 없음, 하이드레이션 후 활성).
 *   스펙22 §4-3·§4-4: optionLabels 가 불완전한 enum 필드는 렌더하지 않는다(엔진은 값 없음 → CHECK, fail-closed).
 *   specSchema optional 필드는 라벨 뒤 " · 선택"(copy checkLayer.optional).
 */
function layerL5(t: TypeModel, r: RequirementModel): string {
  const all = Array.isArray(r.item.specSchema?.fields) ? r.item.specSchema.fields : [];
  const fields = all.filter(hasCompleteOptionLabels).map((f) => {
    const id = `ws-f-${f.key}`;
    const opt = f.optional === true ? `<span class="ws-optional"> · ${h(COPY.checkLayer.optional)}</span>` : '';
    const label = `<label for="${a(id)}">${h(f.label)}${opt}</label>`;
    if (f.type === 'number') {
      return `${label}<input id="${a(id)}" name="${a(f.key)}" type="number"${numAttr('min', f.min)}${numAttr('max', f.max)} inputmode="decimal">`;
    }
    if (f.type === 'boolean') {
      // 스펙33 §4 SpecForm(G-6): 라디오 카드 "예"/"아니오" 2개, 기본값 없음.
      const radio = (v: 'true' | 'false', text: string): string =>
        `<label class="ws-radio-card"><input type="radio" name="${a(f.key)}" value="${v}">${h(text)}</label>`;
      return `<fieldset class="ws-radio-cards" role="radiogroup"><legend>${h(f.label)}${opt}</legend>${radio('true', COPY.verdict.yes)}${radio('false', COPY.verdict.no)}</fieldset>`;
    }
    const opts = f.options.map((o) => `<option value="${a(o)}">${h(optionLabel(f, o) as string)}</option>`).join('');
    return `${label}<select id="${a(id)}" name="${a(f.key)}"><option value=""></option>${opts}</select>`;
  });
  return [
    `<aside class="ws-layer" id="ws-layer" data-ws-layer="L5" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#${a(r.requirementId)}">`,
    `<h2 id="ws-layer-title">${h(COPY.checkLayer.title)} · ${h(r.item.name)}</h2>`,
    layerClose(base(t)),
    `<p>${h(COPY.checkLayer.intro)}</p>`,
    '<form class="ws-check" data-ws-form="spec-check"><fieldset disabled>',
    ...fields.map((x) => `<div class="ws-field">${x}</div>`),
    `<button type="submit">${h(COPY.checkLayer.submit)}</button>`,
    '</fieldset></form>',
    `<noscript><p>${h(COPY.checkLayer.noScript)}</p></noscript>`,
    '</aside>',
  ].join('\n');
}

/** L7 상품 상세 — 이미지·상품명·용품 종류·규격 한 줄·추천 이유(자동 조립)·검수일·[이 조건으로 찾기]. 가격·판매처 없음. */
function layerL7(t: TypeModel, p: PublicProduct): string {
  const r = t.requirements.find((x) => x.item.id === p.supplyItemId) as RequirementModel;
  const lm = yearMonth(p.specVerifiedAt);
  // 스펙33 §5.4(G-6): 추천 이유 = 템플릿만(상품별 자유 문구 0). SPEC_MET 은 verdict 로 권장/최소를 가른다.
  const reasons = p.reasonCodes.map((c) =>
    c === 'SPEC_MET'
      ? formatCopy(p.verdict === 'OK' ? COPY.product.reasonSpecRecommended : COPY.product.reasonSpecMinimum, { animal: t.pub.displayName })
      : formatCopy(COPY.product.reasonProfileTpl, { name: r.item.name }),
  );
  const spec = specLine(r.item.specSchema, p.specValues);
  return [
    `<aside class="ws-layer" id="ws-layer" data-ws-layer="L7" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="curatedProducts#${a(p.id)}">`,
    layerClose(base(t)),
    p.imageAsset ? `<img src="${a(p.imageAsset)}" alt="${a(p.title)}" decoding="async" width="160" height="160">` : imageTile(r.item.glyph),
    `<h2 id="ws-layer-title">${h(p.title)}</h2>`,
    `<p class="ws-meta" data-ws-id="supplyItems#${a(r.item.id)}">${h(r.item.name)}</p>`,
    spec ? `<p class="ws-spec">${h(spec)}</p>` : '',
    `<p>${meetsBadge()}</p>`,
    `<h3>${h(COPY.product.reasonsTitle)}</h3>`,
    `<ul class="ws-reasons">${reasons.map((x) => `<li>${glyphSpan('ready')}${h(x)}</li>`).join('')}</ul>`,
    `<p><a href="${a(hrefOf(`${base(t)}/supplies/${r.item.id}`))}">${h(formatCopy(COPY.product.supplyBasisLink, { name: r.item.name }))}</a></p>`,
    lm ? `<p class="ws-verified">${h(COPY.supplyLayer.lastVerified)} ${h(lm)}</p>` : '',
    searchBlock(r),
    '</aside>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** ws-data — types 는 노출 타입 전체(R4 A2(a)), 나머지는 이 타입의 것. */
function typeData(m: SiteModel, t: TypeModel): WsPageData['data'] {
  return {
    types: allTypes(m),
    requirements: t.requirements.map((r) => r.pub),
    products: t.products,
    bundles: t.bundles,
    vets: typeVets(m, t.id),
    testimonials: [],
  };
}

/** /{slug} 와 레이어 딥링크(/supplies/{item} L4, /check/{item} L5, /products/{id} L7). */
export function renderTypePage(m: SiteModel, ctx: PageContext, t: TypeModel): RenderedPage {
  const layer = ctx.route.layer;
  let aside = '';
  const seoTitle = typeof t.rec.seoTitle === 'string' && t.rec.seoTitle.trim() !== '' ? t.rec.seoTitle : null;
  const seoDesc = typeof t.rec.seoDescription === 'string' && t.rec.seoDescription.trim() !== '' ? t.rec.seoDescription : null;
  let title = seoTitle ?? formatCopy(COPY.site.typeTitle, { animal: t.pub.displayName }) + COPY.site.titleSuffix;
  let description = seoDesc ?? formatCopy(COPY.site.typeDescription, { animal: t.pub.displayName });
  const crumbs = crumbsOf(t);
  if (layer && (layer.kind === 'L4' || layer.kind === 'L5')) {
    const r = t.requirements.find((x) => x.item.id === layer.itemId);
    if (!r) throw new Error(`pages: ${t.id} 에 노출 요구사항 ${layer.itemId} 없음`);
    aside = layer.kind === 'L4' ? layerL4(t, r) : layerL5(t, r);
    const label = layer.kind === 'L4' ? r.item.name : `${COPY.checkLayer.title} · ${r.item.name}`;
    title = `${t.pub.displayName} ${label}${COPY.site.titleSuffix}`;
    description = r.pub.why;
    crumbs.push({ name: label, path: ctx.route.path });
  } else if (layer && layer.kind === 'L7') {
    const p = t.products.find((x) => x.id === layer.productId);
    if (!p) throw new Error(`pages: ${t.id} 에 노출 상품 ${layer.productId} 없음`);
    aside = layerL7(t, p);
    title = `${p.title}${COPY.site.titleSuffix}`;
    crumbs.push({ name: p.title, path: ctx.route.path });
  }
  const itemList = t.requirements
    .filter((r) => r.pub.priority === 'REQUIRED')
    .map((r) => ({ name: r.item.name, path: `${base(t)}/supplies/${r.item.id}` }));
  return {
    head: renderHead(ctx, { title, description, crumbs, itemList: layer ? undefined : itemList }),
    body: [
      renderHeader(t.pub, navCurrent(ctx.route), ctx),
      typeMain(ctx, m, t),
      aside ? `${SCRIM}\n${aside}` : '',
      renderFooter(),
      renderTabBar(t.pub, navCurrent(ctx.route)),
    ]
      .filter((x) => x !== '')
      .join('\n'),
    data: wsData(ctx, typeData(m, t)),
  };
}

/** /{slug}/setup — 구성안 3안 상세(노출 번들 ≥ 1 일 때만 생성). */
export function renderSetupPage(m: SiteModel, ctx: PageContext, t: TypeModel): RenderedPage {
  const crumbs = [...crumbsOf(t), { name: COPY.homeB.bundlesTitle, path: ctx.route.path }];
  const cards = t.bundles.map((b) =>
    [
      `<section class="ws-bundle" data-ws-id="setupBundles#${a(b.id)}">`,
      `<h2>${h(b.name)}</h2>`,
      `<p>${h(b.purpose)}</p>`,
      `<h3>${h(COPY.setup.itemsTitle)}</h3>`,
      `<ul>\n${b.itemIds
        .map((id) => t.requirements.find((r) => r.item.id === id))
        .filter((r): r is RequirementModel => r !== undefined)
        .map(
          (r) =>
            `<li data-ws-id="supplyItems#${a(r.item.id)}"><a href="${a(hrefOf(`${base(t)}/supplies/${r.item.id}`))}">${h(r.item.name)}<span class="ws-row-priority">${h(COPY.priority[r.pub.priority])}</span><span class="ws-row-chevron" aria-hidden="true">›</span></a></li>`,
        )
        .join('\n')}\n</ul>`,
      b.estimatedRangeText
        ? `<h3>${h(COPY.setup.rangeTitle)}</h3><p>${h(b.estimatedRangeText)}</p><p class="ws-range-note">${h(COPY.setup.priceNote)}</p>`
        : '',
      b.note ? `<p class="ws-bundle-note">${h(b.note)}</p>` : '',
      '</section>',
    ]
      .filter((x) => x !== '')
      .join('\n'),
  );
  const body = [
    renderHeader(t.pub, navCurrent(ctx.route), ctx),
    mainOpen(ctx, t.id),
    `<h1>${h(t.pub.displayName)} · ${h(COPY.homeB.bundlesTitle)}</h1>`,
    ...cards,
    '</main>',
    renderFooter(),
    renderTabBar(t.pub, navCurrent(ctx.route)),
  ].join('\n');
  return {
    head: renderHead(ctx, {
      title: `${t.pub.displayName} ${COPY.homeB.bundlesTitle}${COPY.site.titleSuffix}`,
      description: formatCopy(COPY.site.typeDescription, { animal: t.pub.displayName }),
      crumbs,
    }),
    body,
    data: wsData(ctx, { ...typeData(m, t), products: [] }),
  };
}
