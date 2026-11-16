// 타입 홈 B(R4 시안 home_selected 톤 + PRD US-003 섹션 — 컨텍스트 헤더 + 지금·나중·처음 준비·규격·준비물·병원·저장) · 구성안(/setup)
//   · 레이어 L4/L5/L7(부모 페이지 + 레이어 본문, UX §2.2).
//   D18: ① 은 L3 이전 상태 — 숫자 없이 "필수 준비를 먼저 확인해요" + REQUIRED 항목 카드(neutral).
import { PICK_PATH, chipSpecText, figureValueText, minSpecFigure, reasonLine, hasCompleteOptionLabels, isFieldOptionalForDisplay, optionLabel, splitLabel, visibleSpecFields, type MinSpecFigure, type PublicProduct, type PublicVet, type WsPageData } from '../../engine/index.js';
import { affiliateDisclosureOn, renderableSearchLinks } from '../affiliate.js';
import { COPY, formatCopy, objectParticle } from '../copy.js';
import { escapeAttr as a, escapeHtml as h } from '../html.js';
import type { RequirementModel, SiteModel, TypeModel } from '../project.js';
import {
  LIKE_PLACEHOLDER,
  SCRIM,
  affNote,
  affiliateLink,
  allTypes,
  externalLink,
  hrefOf,
  glyphSpan,
  imageTile,
  layerClose,
  mainOpen,
  meetsBadge,
  navCurrent,
  renderFooter,
  renderHead,
  renderHeader,
  ruleText,
  railSection,
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

/** 스펙22 §2.7 — li.ws-product > a > img|span.ws-tile, .ws-product-title, .ws-spec(비면 생략), .ws-badge(○ 기준 충족, R4-1). 가격·판매처 없음. */
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

/** 구성안 글리프(client home/BundleCard.tsx TIER_GLYPH 와 같은 표). */
const TIER_GLYPH: Readonly<Record<string, string>> = { BUDGET: '\u{1F33F}', BALANCED: '☁', USED_MIX: '♻' };

/** 구성안 카드 — client home/BundleCard.tsx 의 빈 저장소 출력(개수 = bundle.itemCount)과 같은 마크업. */
function bundleCard(b: TypeModel['bundles'][number]): string {
  return [
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
}

/** 타입 페이지 ws-data 병원 상한(D16) — ws-data ≤ 32KB 유지. */
export const TYPE_VETS_MAX = 20;

/** 타입 페이지 ws-data vets(C-R5-6, D16): 노출 병원 중 treats ∋ typeId, 지역 → 이름 → id, 최대 TYPE_VETS_MAX. */
export function typeVets(m: Pick<SiteModel, 'vets'>, typeId: string): PublicVet[] {
  return sortVets(m.vets.filter((v) => Array.isArray(v.treats) && v.treats.includes(typeId))).slice(0, TYPE_VETS_MAX);
}

/** 홈 B 화살표 링크 꼬리(장식) — client HomeB Arrow 와 같은 마크업. */
const ARROW = '<span aria-hidden="true"> →</span>';

function homeSecHead(id: string, title: string, lead?: string | null): string {
  return `<div class="ws-home-sec-head"><h2 id="${a(id)}" class="ws-t-display ws-home-sec-title">${h(title)}</h2>${
    lead ? `<p class="ws-t-body ws-muted ws-home-sec-lead">${h(lead)}</p>` : ''
  }</div>`;
}

/**
 * 「{용품} 규격 확인」 대상 — t.requirements(= ws-data 순서)에서 처음 나오는 REQUIRED 중 최소 규격 숫자(엔진 minSpecFigure)가 있는 것.
 *   client home/HomeB.tsx specTarget 과 같은 규칙. 없으면 null(섹션 없음 — 숫자를 만들지 않는다, 불변식 ⑥·⑦).
 */
function specTarget(t: TypeModel): { r: RequirementModel; figure: MinSpecFigure } | null {
  for (const r of t.requirements) {
    if (r.pub.priority !== 'REQUIRED') continue;
    const figure = minSpecFigure(r.item.specSchema, r.pub.minSpec);
    if (figure) return { r, figure };
  }
  return null;
}

/**
 * 타입 홈 본문(부모 페이지, R4 시안 home_selected 톤 · R4-2b PRD US-003 섹션 복원) — client home/HomeB.tsx 의 빈 저장소(2질문 전·내 케이지 없음·이메일 미연결)
 *   출력과 같은 태그·클래스·id·aria. 컨텍스트 헤더 → 지금 필요한 것(요약 카드 + 필수 항목 카드 neutral + 모바일 항목 링크 줄) → 나중에 필요한 것(NOT_NOW)
 *   → 처음 준비한다면(구성안 레일) → {용품} 규격 확인(엔진 minSpecFigure) → 기준에 맞는 준비물(상품 레일, 노출 순서 그대로 — 불변식 ③)
 *   → 병원(treats ∋ 타입 노출 병원 카드 레일, 0 이면 「확인된 병원이 아직 없어요」) → 저장 안내.
 *   PRD 순서(지금 → 처음 준비 → 준비물 → 병원 → 저장)는 지키고, R4 시안 섹션(나중에·규격)은 관련 섹션 뒤에 둔다. 데이터 없는 나중에·처음 준비·규격·준비물은 섹션 없음.
 *   하이드레이션 후에만 동작하는 버튼(① 주 버튼 → L2)은 정적에서 같은 클래스의 링크(첫 필수 항목 L4 문서).
 */
function typeMain(ctx: PageContext, m: SiteModel, t: TypeModel): string {
  const required = t.requirements.filter((r) => r.pub.priority === 'REQUIRED');
  const later = t.requirements.filter((r) => r.pub.priority === 'NOT_NOW');
  const itemHref = (r: RequirementModel): string => hrefOf(`${base(t)}/supplies/${r.item.id}`);
  const nowCard = (r: RequirementModel): string => {
    // D9 ②: 이유 한 줄 = whyShort ?? firstSentence(why) (engine reasonLine 단일 소스 — client HomeB 와 같은 함수).
    const reason = reasonLine(r.pub);
    return [
      `<li class="ws-now-item" data-ws-item="${a(r.item.id)}" data-ws-id="supplyRequirements#${a(r.requirementId)}">`,
      `<a class="ws-now-card" href="${a(itemHref(r))}" data-ws-state="neutral">`,
      // 사진 자리(빈 블록 — photos.json 전부 SLOT, 생성 이미지 금지 ①). client PhotoTile 의 data-ws-photo(추적용)는 싣지 않는다.
      '<span class="ws-photo ws-now-photo" aria-hidden="true"></span>',
      `<span class="ws-t-title ws-now-name">${h(r.item.name)}</span>`,
      reason ? `<span class="ws-t-body ws-muted ws-now-reason">${h(reason)}</span>` : '',
      '</a></li>',
    ].join('');
  };
  const lead = [
    '<li class="ws-now-lead">',
    '<span class="ws-photo ws-now-photo" aria-hidden="true"></span>',
    `<h3 class="ws-t-title ws-now-name">${h(COPY.homeB.nowCardTitle)}</h3>`,
    `<p class="ws-t-body ws-muted ws-now-count">${h(required.length ? COPY.homeB.nowBeforeSetup : COPY.homeB.nowEmpty)}</p>`,
    // React 는 L2 를 여는 button. 정적(무JS)은 첫 필수 항목 문서(L4) — 없으면 타입 홈.
    `<a class="ws-btn ws-btn--fill ws-now-cta" data-ws-action="open-checklist" href="${a(required.length ? itemHref(required[0]) : hrefOf(base(t)))}">${h(COPY.homeB.nowCtaStart)}</a>`,
    '</li>',
  ].join('');
  const nowSection = [
    '<section class="ws-home-sec ws-now" data-ws-section="now" data-ws-answered="0" aria-labelledby="ws-sec-now-title">',
    homeSecHead('ws-sec-now-title', COPY.homeB.nowTitle, COPY.homeB.nowLead),
    `<ul class="ws-now-grid" role="list">${lead}${required.map(nowCard).join('')}</ul>`,
    // ≤767 항목 줄(MED-1): 이름마다 L4 링크(비링크 이름 줄 금지). 정적 = L3 전 → 상태 표시 없음(neutral).
    required.length
      ? `<div class="ws-now-lines"><div class="ws-t-body ws-now-line" data-ws-line="all"><ul class="ws-now-links" role="list">${required
          .map(
            (r) =>
              `<li data-ws-now-link="${a(r.item.id)}"><a class="ws-now-link" href="${a(itemHref(r))}" data-ws-state="neutral"><span class="ws-now-link-name">${h(r.item.name)}</span></a></li>`,
          )
          .join('')}</ul></div></div>`
      : '',
    '</section>',
  ];
  const laterSection = later.length
    ? [
        '<section class="ws-home-sec ws-later" data-ws-section="later" aria-labelledby="ws-sec-later-title">',
        homeSecHead('ws-sec-later-title', COPY.homeB.laterTitle),
        '<ul class="ws-later-list" role="list">',
        ...later.map((r) => {
          const reason = r.pub.notNowReason ?? reasonLine(r.pub);
          return `<li data-ws-item="${a(r.item.id)}" data-ws-id="supplyRequirements#${a(r.requirementId)}"><span class="ws-t-cta ws-later-name">${h(r.item.name)}</span>${
            reason ? `<span class="ws-t-body ws-muted ws-later-reason">${h(reason)}</span>` : ''
          }</li>`;
        }),
        '</ul>',
        '</section>',
      ]
    : [];
  const spec = specTarget(t);
  const specSection = spec
    ? [
        `<section class="ws-home-sec ws-spec-sec" data-ws-section="spec" data-ws-id="supplyRequirements#${a(spec.r.requirementId)}" aria-labelledby="ws-sec-spec-title">`,
        '<div class="ws-spec-sec-text">',
        homeSecHead('ws-sec-spec-title', formatCopy(COPY.homeB.specTitle, { name: spec.r.item.name })),
        `<p class="ws-t-meta ws-muted ws-spec-sec-basis">${h(formatCopy(COPY.homeB.specBasis, { animal: t.pub.displayName }))}</p>`,
        `<p class="ws-t-section ws-spec-sec-label">${h(spec.figure.base !== null ? formatCopy(COPY.verdict.minOf, { name: spec.figure.base }) : COPY.verdict.minSpecLabel)}</p>`,
        `<p class="ws-spec-sec-num"><span class="ws-spec-sec-value">${h(figureValueText(spec.figure))}</span>${
          spec.figure.unit ? `<span class="ws-spec-sec-unit">${h(spec.figure.unit)}</span>` : ''
        }</p>`,
        `<a class="ws-home-link" href="${a(hrefOf(`${base(t)}/check/${spec.r.item.id}`))}">${h(formatCopy(COPY.homeB.specMine, { name: spec.r.item.name }))}${ARROW}</a>`,
        '</div>',
        '<span class="ws-photo ws-spec-sec-photo" aria-hidden="true"></span>',
        '</section>',
      ]
    : [];
  // 처음 준비한다면 — 노출 구성안(검수 통과)만, 0 이면 섹션 없음(/setup 도 그때만 생성된다 — routes.ts).
  const bundlesSection = t.bundles.length
    ? railSection({
        id: 'bundles',
        kind: 'bundle',
        tone: 'home',
        titleHtml: h(COPY.homeB.bundlesTitle),
        foot: { label: COPY.setup.detailLink, href: hrefOf(`${base(t)}/setup`) },
        items: t.bundles.map(bundleCard),
      })
    : '';
  // 기준에 맞는 준비물 — t.products = 요구사항 순서 × orderExposableProducts(규격 → 검수 → 선호, 미달 0 · VERIFIED 만) 그대로. 0 이면 섹션 없음.
  //   상품 표면 표식 유지(client staticCapture PRODUCT_SURFACE_SELECTOR): section[data-ws-section=products] · ul.ws-products · li.ws-product.
  const productsSection = t.products.length
    ? railSection({
        id: 'products',
        kind: 'product',
        tone: 'home',
        titleHtml: h(COPY.homeB.productsTitle),
        items: t.products.map((p) => productCard(t, p, itemFor(t, p.supplyItemId))),
      })
    : '';
  // 병원 — treats ∋ 타입 노출 병원(SLOT 은 로더가 건너뜀 → 허구 병원 0). 정적 링크는 /vet(하이드레이션 후 client 가 ?treats= — decisions 2026-11-10 M-2).
  const vets = typeVets(m, t.id);
  const typeNames = new Map(m.types.map((x) => [x.id, x.pub.displayName] as const));
  const vetTitle = formatCopy(COPY.homeB.vetTitle, { animal: objectParticle(t.pub.displayName) });
  const vetSection = vets.length
    ? railSection({
        id: 'vet',
        kind: 'vet',
        tone: 'home',
        titleHtml: h(vetTitle),
        lead: [COPY.homeB.vetLead, COPY.homeB.vetAsk],
        foot: { label: COPY.homeB.vetLink, href: '/vet' },
        items: vets.map((v) => vetCard(v, typeNames)),
      })
    : [
        '<section class="ws-home-sec ws-vet-sec" data-ws-section="vet" aria-labelledby="ws-sec-vet-title">',
        homeSecHead('ws-sec-vet-title', vetTitle, COPY.homeB.vetEmpty),
        `<a class="ws-home-link" href="/vet">${h(COPY.homeB.vetLink)}${ARROW}</a>`,
        '</section>',
      ].join('\n');
  return [
    mainOpen(ctx, t.id, {}, 'ws-home-b'),
    `<section class="ws-context" data-ws-id="animalTypes#${a(t.id)}" aria-labelledby="ws-context-title">`,
    `<div class="ws-context-text"><p class="ws-t-meta ws-muted ws-context-eyebrow">${h(COPY.homeB.contextEyebrow)}</p><h1 id="ws-context-title" class="ws-t-display">${h(t.pub.displayName)}</h1></div>`,
    `<a class="ws-context-change" data-ws-action="change-animal" href="${PICK_PATH}" aria-label="${a(COPY.nav.changeFriend)}">${h(COPY.homeB.change)}</a>`,
    '</section>',
    ...nowSection,
    ...laterSection,
    bundlesSection,
    ...specSection,
    productsSection,
    vetSection,
    '<section class="ws-home-sec ws-save-sec" data-ws-section="save" aria-labelledby="ws-save-title">',
    `<h2 id="ws-save-title" class="ws-t-display ws-home-sec-title">${h(COPY.homeB.saveTitle)}</h2>`,
    `<a class="ws-home-link ws-save-link" href="/save">${h(COPY.homeB.saveLink)}${ARROW}</a>`,
    '</section>',
    '</main>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/** 259 고지 A 의 id(261 §1: ws-aff-a-{supplyItemId} — 페이지당 레이어 aside 1개라 유일, 빌드마다 같다). */
const affNoteId = (r: RequirementModel): string => `ws-aff-a-${r.item.id}`;

/* 259 제휴 고지 마크업(note-a·note-b·note-f)은 common.ts affNote 한 곳(R4-3 — 푸터 고지 F 와 같은 원문·마크업). */

/** 고지 B — A 와 같은 판정(affiliateDisclosureOn: 렌더 필터 통과 AFFILIATE ≥ 1). 아니면 ''(꺼짐 = 바이트 동일). */
function affNoteB(r: RequirementModel): string {
  return affiliateDisclosureOn(r.pub.searchLinks) ? affNote('b') : '';
}

function searchBlock(r: RequirementModel): string {
  const links = renderableSearchLinks(r.pub.searchLinks);
  if (links.length === 0) {
    // R4-3(R4 시안 affiliate_candidates): 그릴 상인 링크(URL)가 0 → 비활성 상인 버튼 「상인 링크 준비 중」 1개(클라 SearchBlock 과 같은 판정).
    //   검색어도 없으면 블록 없음(이전과 같음). 엔진은 검색어가 있으면 링크 ≥ 1 이라 정상 빌드에서는 그려지지 않는다(off 기준선 불변).
    if (r.pub.searchKeyword.trim() === '') return '';
    return [
      '<div class="ws-search">',
      `<h3>${h(COPY.supplyLayer.findWithCondition)}</h3>`,
      `<p>${h(COPY.supplyLayer.searchKeyword)}: <span class="ws-keyword">${h(r.pub.searchKeyword)}</span></p>`,
      `<button type="button" disabled>${h(COPY.supplyLayer.merchantPending)}</button>`,
      '</div>',
    ].join('\n');
  }
  const on = affiliateDisclosureOn(r.pub.searchLinks);
  return [
    '<div class="ws-search">',
    `<h3>${h(COPY.supplyLayer.findWithCondition)}</h3>`,
    `<p>${h(COPY.supplyLayer.searchKeyword)}: <span class="ws-keyword">${h(r.pub.searchKeyword)}</span></p>`,
    on ? affNote('a', affNoteId(r)) : '',
    ...links.map((l) =>
      l.kind === 'AFFILIATE' ? affiliateLink(l.href, LINK_TEXT[l.provider], affNoteId(r)) : externalLink(l.href, LINK_TEXT[l.provider]),
    ),
    '</div>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/**
 * L4 용품 상세 — R4-4(R4 시안 l4_supply: 규격 → 검수 → 상인 링크, client SupplyLayer 와 같은 순서):
 *   (고지 B) → 「{동물} · {용품}」 → 메타 → 사진 자리(빈 블록) → (지금은 필요 없어요) → 왜 → 조건(최소/권장) → 주의 → 피할 것 → 대안
 *   → 상품 2~3 → 검수 내용(마지막 검수 · 출처) → [규격 확인] + 찾기(상인 링크).
 */
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
    affNoteB(r),
    `<p class="ws-supply-eyebrow">${h(t.pub.displayName)} · ${h(r.item.name)}</p>`,
    `<p class="ws-meta">${h(COPY.priority[p.priority])} · ${h(COPY.orderHint[p.orderHint])}</p>`,
    // 사진 자리(빈 블록 — photos.json 전부 SLOT, 생성 이미지 금지 ①). client PhotoTile 의 data-ws-photo(추적용)는 싣지 않는다.
    '<span class="ws-photo ws-supply-photo" aria-hidden="true"></span>',
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
    r.products.length
      ? `<section data-ws-part="products"><h3>${h(COPY.supplyLayer.matchingProducts)}</h3><ul>\n${r.products
          .slice(0, 3)
          .map((x) => productCard(t, x, r.item))
          .join('\n')}\n</ul></section>`
      : '',
    lm || p.source.length
      ? [
          `<section data-ws-part="verified"><h3>${h(COPY.supplyLayer.reviewTitle)}</h3>`,
          lm ? `<p class="ws-verified">${h(COPY.supplyLayer.lastVerified)} ${h(lm)}</p>` : '',
          p.source.length
            ? `<p class="ws-source">${h(COPY.supplyLayer.source)}: ${p.source.map((s) => externalLink(s.url, s.title)).join(' · ')}</p>`
            : '',
          '</section>',
        ]
          .filter((x) => x !== '')
          .join('\n')
      : '',
    '<div class="ws-actions">',
    `<a href="${a(hrefOf(`${base(t)}/check/${r.item.id}`))}">${h(COPY.supplyLayer.checkSpec)}</a>`,
    searchBlock(r),
    '</div>',
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
 *   specSchema optional 필드는 라벨 뒤 " · 선택"(copy checkLayer.optional) — 단 minSpec 이 참조하면 생략(isFieldOptionalForDisplay, client 와 같은 판정).
 *   ruleScoped 필드는 해석된 규칙이 참조할 때만 렌더(visibleSpecFields).
 */
function layerL5(t: TypeModel, r: RequirementModel): string {
  // 기니피그 S5: ruleScoped 필드는 이 요구사항(해석 후 min·rec)의 규칙이 참조할 때만(visibleSpecFields, client 와 같은 헬퍼).
  const schema = r.item.specSchema;
  const all = visibleSpecFields(schema, r.pub.minSpec, r.pub.recommendedSpec);
  const fields = all.filter(hasCompleteOptionLabels).map((f) => {
    const id = `ws-f-${f.key}`;
    const opt = isFieldOptionalForDisplay(f, r.pub.minSpec) ? `<span class="ws-optional"> · ${h(COPY.checkLayer.optional)}</span>` : '';
    if (f.type === 'number') {
      // 286 U5a(client SpecForm unitInside 와 같은 규칙): 라벨은 이름만, 단위는 칸 안(aria-describedby). 단위 없는 라벨은 그대로.
      const { base, unit } = splitLabel(f.label);
      const input = (described: string): string =>
        `<input class="ws-spec-input" id="${a(id)}" name="${a(f.key)}" type="number"${numAttr('min', f.min)}${numAttr('max', f.max)} inputmode="decimal"${described}>`;
      if (unit === '') return `<label for="${a(id)}">${h(f.label)}${opt}</label>${input('')}`;
      const unitId = `${id}-unit`;
      return `<label for="${a(id)}">${h(base)}${opt}</label><span class="ws-spec-inputwrap">${input(` aria-describedby="${a(unitId)}"`)}<span class="ws-spec-unit" id="${a(unitId)}">${h(unit)}</span></span>`;
    }
    const label = `<label for="${a(id)}">${h(f.label)}${opt}</label>`;
    if (f.type === 'boolean') {
      // 스펙33 §4 SpecForm(G-6): 라디오 카드 "예"/"아니오" 2개, 기본값 없음.
      const radio = (v: 'true' | 'false', text: string): string =>
        `<label class="ws-radio-card"><input type="radio" name="${a(f.key)}" value="${v}">${h(text)}</label>`;
      return `<fieldset class="ws-radio-cards" role="radiogroup"><legend>${h(f.label)}${opt}</legend>${radio('true', COPY.verdict.yes)}${radio('false', COPY.verdict.no)}</fieldset>`;
    }
    const opts = f.options.map((o) => `<option value="${a(o)}">${h(optionLabel(f, o) as string)}</option>`).join('');
    return `${label}<select id="${a(id)}" name="${a(f.key)}"><option value=""></option>${opts}</select>`;
  });
  // 286 U5a 입력 상태(client SpecCheckLayer 와 같은 조립): 「{동물} · {용품}」 → 질문 문장 → 기준 보조줄(chipSpecText 만, 수치 재계산 없음).
  const minText = chipSpecText(schema, r.pub.minSpec);
  const recText = chipSpecText(schema, r.pub.recommendedSpec);
  const headMeta = [
    `${t.pub.displayName} ${COPY.verdict.basisSuffix}`,
    minText ? `${COPY.verdict.min} ${minText}` : null,
    recText ? `${COPY.verdict.recommended} ${recText}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  return [
    `<aside class="ws-layer" id="ws-layer" data-ws-layer="L5" role="dialog" aria-labelledby="ws-layer-title" aria-describedby="ws-layer-desc" data-ws-id="supplyRequirements#${a(r.requirementId)}">`,
    `<h2 id="ws-layer-title">${h(COPY.checkLayer.title)}</h2>`,
    layerClose(base(t)),
    `<p id="ws-layer-desc" class="ws-meta">${h(t.pub.displayName)} · ${h(r.item.name)}</p>`,
    `<h3 class="ws-spec-ask">${h(formatCopy(COPY.checkLayer.ask, { name: r.item.name }))}</h3>`,
    `<p class="ws-meta">${h(headMeta)}</p>`,
    '<form class="ws-check" data-ws-form="spec-check"><fieldset disabled>',
    ...fields.map((x) => `<div class="ws-field">${x}</div>`),
    `<button type="submit">${h(COPY.checkLayer.submit)}</button>`,
    '</fieldset></form>',
    `<noscript><p>${h(COPY.checkLayer.noScript)}</p></noscript>`,
    '</aside>',
  ].join('\n');
}

/**
 * L7 상품 상세 — R4-9(client ProductLayer 와 같은 순서, L4 시안의 규격 → 검수 → 상인 링크 짜임): 제목(상품명) → (고지 B) → 「{동물} · {용품}」
 *   → 이미지 → ○ 기준 충족 → 규격 한 줄 → 마지막 검수 → 추천 이유(자동 조립) → 용품 기준 링크 → [이 조건으로 찾기]. 가격·판매처 없음.
 */
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
    `<h2 id="ws-layer-title">${h(p.title)}</h2>`,
    layerClose(base(t)),
    affNoteB(r),
    `<p class="ws-supply-eyebrow" data-ws-id="supplyItems#${a(r.item.id)}">${h(t.pub.displayName)} · ${h(r.item.name)}</p>`,
    p.imageAsset ? `<img src="${a(p.imageAsset)}" alt="${a(p.title)}" decoding="async" width="160" height="160">` : imageTile(r.item.glyph),
    `<p>${meetsBadge()}</p>`,
    spec ? `<p class="ws-spec">${h(spec)}</p>` : '',
    lm ? `<p class="ws-verified">${h(COPY.supplyLayer.lastVerified)} ${h(lm)}</p>` : '',
    `<h3>${h(COPY.product.reasonsTitle)}</h3>`,
    `<ul class="ws-reasons">${reasons.map((x) => `<li>${glyphSpan('ok')}${h(x)}</li>`).join('')}</ul>`,
    `<p><a href="${a(hrefOf(`${base(t)}/supplies/${r.item.id}`))}">${h(formatCopy(COPY.product.supplyBasisLink, { name: r.item.name }))}</a></p>`,
    searchBlock(r),
    '</aside>',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

/**
 * D6-B(Kenny 2026-11-14): L5 결과 아래 「크기 확인에 도움 된 점」 후보 — 서버 투영(m.testimonials = isTestimonialPublic:
 *   APPROVED ∧ verifiedUsage ∧ 노출 타입, 불변식 ⑦) 중 이 타입 ∧ linkedAction=SPEC_CHECK 만, 시드 순서 첫 1건.
 *   용품 단위 연결 필드가 없어 용품까지는 거르지 않는다(「같은 규격」 표기 없음). 0건이면 [] — 클라이언트는 영역째 그리지 않는다.
 *   선정 순서(여러 건일 때)는 운영 결정 전까지 시드 순서 첫 건 — 별점·인기·판매 지표 없음.
 *   정적 L5 는 입력 상태만 그리므로(판정 없음) 후기 마크업은 정적 HTML 에 없다 — ws-data 로만 싣는다.
 */
export function specCheckTestimonials(m: Pick<SiteModel, 'testimonials'>, typeId: string): WsPageData['data']['testimonials'] {
  // L5 후기는 선 1개 + 텍스트(사진 없음) — 리뷰어 사진 경로는 싣지 않는다(쓰지 않는 자산 참조 0).
  return m.testimonials
    .filter((x) => x.animalTypeId === typeId && x.linkedAction === 'SPEC_CHECK')
    .slice(0, 1)
    .map((x) => ({ ...x, reviewerImage: null }));
}

/** ws-data — types 는 노출 타입 전체(R4 A2(a)), 나머지는 이 타입의 것. */
function typeData(m: SiteModel, t: TypeModel): WsPageData['data'] {
  return {
    types: allTypes(m),
    requirements: t.requirements.map((r) => r.pub),
    products: t.products,
    bundles: t.bundles,
    vets: typeVets(m, t.id),
    testimonials: specCheckTestimonials(m, t.id),
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
  // R4-3: 푸터 고지 F 판정 대상 — 검색 블록을 그리는 레이어(L4·L7)의 요구사항. L5 정적판은 검색 블록이 없다(판정 없음).
  let affReq: RequirementModel | null = null;
  if (layer && (layer.kind === 'L4' || layer.kind === 'L5')) {
    const r = t.requirements.find((x) => x.item.id === layer.itemId);
    if (!r) throw new Error(`pages: ${t.id} 에 노출 요구사항 ${layer.itemId} 없음`);
    aside = layer.kind === 'L4' ? layerL4(t, r) : layerL5(t, r);
    if (layer.kind === 'L4') affReq = r;
    const label = layer.kind === 'L4' ? r.item.name : `${COPY.checkLayer.title} · ${r.item.name}`;
    title = `${t.pub.displayName} ${label}${COPY.site.titleSuffix}`;
    description = r.pub.why;
    crumbs.push({ name: label, path: ctx.route.path });
  } else if (layer && layer.kind === 'L7') {
    const p = t.products.find((x) => x.id === layer.productId);
    if (!p) throw new Error(`pages: ${t.id} 에 노출 상품 ${layer.productId} 없음`);
    aside = layerL7(t, p);
    affReq = t.requirements.find((x) => x.item.id === p.supplyItemId) ?? null;
    title = `${p.title}${COPY.site.titleSuffix}`;
    crumbs.push({ name: p.title, path: ctx.route.path });
  }
  const data = typeData(m, t);
  const itemList = t.requirements
    .filter((r) => r.pub.priority === 'REQUIRED')
    .map((r) => ({ name: r.item.name, path: `${base(t)}/supplies/${r.item.id}` }));
  return {
    head: renderHead(ctx, { title, description, crumbs, itemList: layer ? undefined : itemList }),
    body: [
      renderHeader(t.pub, navCurrent(ctx.route), data),
      typeMain(ctx, m, t),
      aside ? `${SCRIM}\n${aside}` : '',
      renderFooter(affReq !== null && affiliateDisclosureOn(affReq.pub.searchLinks), ctx.privacyPage !== false),
    ]
      .filter((x) => x !== '')
      .join('\n'),
    data: wsData(ctx, data),
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
  const setupData = { ...typeData(m, t), products: [] };
  const body = [
    renderHeader(t.pub, navCurrent(ctx.route), setupData),
    mainOpen(ctx, t.id),
    `<h1>${h(t.pub.displayName)} · ${h(COPY.homeB.bundlesTitle)}</h1>`,
    ...cards,
    '</main>',
    renderFooter(false, ctx.privacyPage !== false),
  ].join('\n');
  return {
    head: renderHead(ctx, {
      title: `${t.pub.displayName} ${COPY.homeB.bundlesTitle}${COPY.site.titleSuffix}`,
      description: formatCopy(COPY.site.typeDescription, { animal: t.pub.displayName }),
      crumbs,
    }),
    body,
    data: wsData(ctx, setupData),
  };
}
