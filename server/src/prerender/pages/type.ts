// 타입 홈 B(컨텍스트 헤더 + 5섹션, UX §3.1 B) · 구성안(/setup) · 레이어 L4/L5/L7(부모 페이지 + 레이어 본문, UX §2.2).
//   D18: ① 은 L3 이전 상태 — 숫자 없이 "필수 준비를 먼저 확인해요" + REQUIRED 칩. 병원은 /vet 링크만.
import { hasCompleteOptionLabels, optionLabel, type PublicProduct, type WsPageData } from '../../engine/index.js';
import { COPY, formatCopy } from '../copy.js';
import { escapeAttr as a, escapeHtml as h } from '../html.js';
import type { RequirementModel, SiteModel, TypeModel } from '../project.js';
import {
  SCRIM,
  allTypes,
  externalLink,
  hrefOf,
  imageTile,
  mainOpen,
  mascotAvatar,
  meetsBadge,
  navCurrent,
  renderFooter,
  renderHead,
  renderHeader,
  renderTabBar,
  ruleText,
  specLine,
  wsData,
  yearMonth,
  type Crumb,
  type PageContext,
  type RenderedPage,
} from './common.js';

const LINK_TEXT = { COUPANG: COPY.supplyLayer.findCoupang, NAVER: COPY.supplyLayer.findNaver } as const;

function base(t: TypeModel): string {
  return `/${t.slug}`;
}

function crumbsOf(m: SiteModel, t: TypeModel): Crumb[] {
  const out: Crumb[] = [{ name: COPY.site.name, path: '/' }];
  if (t.family) {
    const fam = m.types.filter((x) => x.family === t.family).map((x) => x.pub.displayName);
    out.push({ name: fam.join(' · '), path: `/${t.family}` });
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
    meetsBadge(),
    '</a>',
    '</li>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

function itemFor(t: TypeModel, itemId: string): ItemOf | undefined {
  return t.requirements.find((r) => r.item.id === itemId)?.item;
}

/** 타입 홈 본문(부모 페이지). */
function typeMain(ctx: PageContext, t: TypeModel): string {
  const required = t.requirements.filter((r) => r.pub.priority === 'REQUIRED');
  const now = required.length
    ? `<ul class="ws-chips">\n${required
        .map(
          (r) =>
            `<li data-ws-id="supplyRequirements#${a(r.requirementId)}"><a href="${a(hrefOf(`${base(t)}/supplies/${r.item.id}`))}">${h(r.item.name)}</a></li>`,
        )
        .join('\n')}\n</ul>`
    : `<p>${h(COPY.homeB.nowEmpty)}</p>`;
  const bundles = t.bundles.length
    ? `<ul class="ws-bundles">\n${t.bundles
        .map((b) =>
          [
            `<li data-ws-id="setupBundles#${a(b.id)}">`,
            `<h3>${h(b.name)}</h3>`,
            `<p>${h(b.purpose)}</p>`,
            b.estimatedRangeText
              ? `<p class="ws-range">${h(b.estimatedRangeText)}</p><p class="ws-range-note">${h(COPY.setup.priceNote)}</p>`
              : '',
            '</li>',
          ]
            .filter((x) => x !== '')
            .join('\n'),
        )
        .join('\n')}\n</ul>\n<p><a href="${a(hrefOf(`${base(t)}/setup`))}">${h(COPY.setup.detailLink)}</a></p>`
    : `<p>${h(COPY.homeB.bundlesEmpty)}</p>`;
  const products = t.products.length
    ? `<ul class="ws-products">\n${t.products.map((p) => productCard(t, p, itemFor(t, p.supplyItemId))).join('\n')}\n</ul>`
    : `<p>${h(COPY.homeB.productsEmpty)}</p>`;
  return [
    mainOpen(ctx, t.id),
    `<section class="ws-context" data-ws-id="animalTypes#${a(t.id)}">`,
    mascotAvatar(ctx, t.pub.mascot, 'peach-soft'),
    `<h1>${h(t.pub.displayName)}</h1>`,
    t.pub.oneLiner ? `<p>${h(t.pub.oneLiner)}</p>` : '',
    `<p><a href="/" data-ws-action="change-animal">${h(COPY.nav.changeFriend)}</a></p>`,
    '</section>',
    `<section data-ws-section="now" id="ws-now"><h2>${h(COPY.homeB.nowTitle)}</h2><p>${h(COPY.homeB.nowBeforeSetup)}</p>`,
    now,
    '</section>',
    `<section data-ws-section="bundles"><h2>${h(COPY.homeB.bundlesTitle)}</h2>`,
    bundles,
    '</section>',
    `<section data-ws-section="products"><h2>${h(COPY.homeB.productsTitle)}</h2>`,
    products,
    '</section>',
    `<section data-ws-section="vet"><h2>${h(COPY.homeB.vetTitle)}</h2><p><a href="/vet">${h(COPY.homeB.vetLink)}</a></p></section>`,
    `<section data-ws-section="save"><h2>${h(formatCopy(COPY.homeB.saveTitle, { animal: t.pub.displayName }))}</h2>`,
    `<p><a href="${a(hrefOf(base(t)))}#ws-now">${h(COPY.homeB.saveCta)}</a></p>`,
    `<p><a href="/save">${h(COPY.homeB.saveLink)}</a></p>`,
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
export function layerL4(t: TypeModel, r: RequirementModel): string {
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
    `<aside class="ws-layer" data-ws-layer="L4" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#${a(r.requirementId)}">`,
    `<h2 id="ws-layer-title" data-ws-id="supplyItems#${a(r.item.id)}">${h(r.item.name)}</h2>`,
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
function layerL5(r: RequirementModel): string {
  const all = Array.isArray(r.item.specSchema?.fields) ? r.item.specSchema.fields : [];
  const fields = all.filter(hasCompleteOptionLabels).map((f) => {
    const id = `ws-f-${f.key}`;
    const opt = f.optional === true ? `<span class="ws-optional"> · ${h(COPY.checkLayer.optional)}</span>` : '';
    const label = `<label for="${a(id)}">${h(f.label)}${opt}</label>`;
    if (f.type === 'number') {
      return `${label}<input id="${a(id)}" name="${a(f.key)}" type="number"${numAttr('min', f.min)}${numAttr('max', f.max)} inputmode="decimal">`;
    }
    if (f.type === 'boolean') return `<input id="${a(id)}" name="${a(f.key)}" type="checkbox">${label}`;
    const opts = f.options.map((o) => `<option value="${a(o)}">${h(optionLabel(f, o) as string)}</option>`).join('');
    return `${label}<select id="${a(id)}" name="${a(f.key)}"><option value=""></option>${opts}</select>`;
  });
  return [
    `<aside class="ws-layer" data-ws-layer="L5" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="supplyRequirements#${a(r.requirementId)}">`,
    `<h2 id="ws-layer-title">${h(COPY.checkLayer.title)} · ${h(r.item.name)}</h2>`,
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
  const reasons = p.reasonCodes.map((c) => (c === 'SPEC_MET' ? COPY.product.reasonSpecMet : COPY.product.reasonProfileMatch));
  const spec = specLine(r.item.specSchema, p.specValues);
  return [
    `<aside class="ws-layer" data-ws-layer="L7" role="dialog" aria-labelledby="ws-layer-title" data-ws-id="curatedProducts#${a(p.id)}">`,
    p.imageAsset ? `<img src="${a(p.imageAsset)}" alt="${a(p.title)}" decoding="async" width="160" height="160">` : imageTile(r.item.glyph),
    `<h2 id="ws-layer-title">${h(p.title)}</h2>`,
    `<p class="ws-meta" data-ws-id="supplyItems#${a(r.item.id)}">${h(r.item.name)}</p>`,
    spec ? `<p class="ws-spec">${h(spec)}</p>` : '',
    `<p>${meetsBadge()}</p>`,
    `<h3>${h(COPY.product.reasonsTitle)}</h3>`,
    `<ul>${reasons.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`,
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
    vets: [],
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
  const crumbs = crumbsOf(m, t);
  if (layer && (layer.kind === 'L4' || layer.kind === 'L5')) {
    const r = t.requirements.find((x) => x.item.id === layer.itemId);
    if (!r) throw new Error(`pages: ${t.id} 에 노출 요구사항 ${layer.itemId} 없음`);
    aside = layer.kind === 'L4' ? layerL4(t, r) : layerL5(r);
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
      renderHeader(t.pub, navCurrent(ctx.route)),
      typeMain(ctx, t),
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
  const crumbs = [...crumbsOf(m, t), { name: COPY.homeB.bundlesTitle, path: ctx.route.path }];
  const cards = t.bundles.map((b) =>
    [
      `<section class="ws-bundle" data-ws-id="setupBundles#${a(b.id)}">`,
      `<h2>${h(b.name)}</h2>`,
      `<p>${h(b.purpose)}</p>`,
      `<h3>${h(COPY.setup.itemsTitle)}</h3>`,
      `<ul>\n${b.itemIds
        .map((id) => t.requirements.find((r) => r.item.id === id))
        .filter((r): r is RequirementModel => r !== undefined)
        .map((r) => `<li data-ws-id="supplyItems#${a(r.item.id)}"><a href="${a(hrefOf(`${base(t)}/supplies/${r.item.id}`))}">${h(r.item.name)}</a></li>`)
        .join('\n')}\n</ul>`,
      b.estimatedRangeText
        ? `<h3>${h(COPY.setup.rangeTitle)}</h3><p>${h(b.estimatedRangeText)}</p><p class="ws-range-note">${h(COPY.setup.priceNote)}</p>`
        : '',
      b.note ? `<p>${h(b.note)}</p>` : '',
      '</section>',
    ]
      .filter((x) => x !== '')
      .join('\n'),
  );
  const body = [
    renderHeader(t.pub, navCurrent(ctx.route)),
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
