// 51 레인 A — 프리렌더 마크업 ↔ React 정렬(K1 /pick 포함). 근거: _workspace/51_architect_persona_fix.md, P4 _workspace/screens/p4/.
//   홈 A(Hero·StartBand — 286 U3a) · 홈 B(HomeB 빈 저장소) 클래스 · CTA a[href=/pick] · 마스코트 img(O-1)
//   · 정적 레이어 id/닫기 링크 · 404 복귀 링크 · /pick(noindex·L1 aside·sitemap 제외·canonical /) · 상품 표면 표식(불변식 ③) 고정.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PICK_PATH, ROUTE_KINDS, type SeedBundle } from '../engine/index.js';
import { COPY } from '../prerender/copy.js';
import { loadMascots } from '../prerender/mascot.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { FIXTURE_AS_OF, patch, promoted } from './fixtures/prerender-seed.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const MASCOTS = loadMascots(join(ROOT, 'docs', 'design', 'mascots'));
const TEMPLATE = '<!doctype html><html><head><!--ws:head--></head><body><div id="root"><!--ws:body--></div></body></html>';
const ORIGIN = 'http://localhost:3001';
const build = (s: SeedBundle, o: { indexable?: boolean } = {}): SiteBuild =>
  buildSite(s, { template: TEMPLATE, origin: ORIGIN, seedDigest: 'a'.repeat(64), asOf: FIXTURE_AS_OF, mascots: MASCOTS, ...o });
const html = (b: SiteBuild, path: string): string => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`no page ${path}`);
  return p.html;
};
const mainOf = (page: string): string => page.slice(page.indexOf('<main'), page.indexOf('</main>'));
const asideOf = (page: string): string => page.slice(page.indexOf('<aside'), page.indexOf('</aside>'));
/** 여는 태그 중 class 에 c 가 있는 것. */
const tagsWithClass = (s: string, c: string): string[] =>
  [...s.matchAll(/<[a-z0-9]+\b[^>]*>/g)].map((m) => m[0]).filter((t) => (/\bclass="([^"]*)"/.exec(t)?.[1] ?? '').split(/\s+/).includes(c));

describe('홈 A 마크업 = React Hero·StartBand(R3 시안 v1b, 286 U3a)', () => {
  const b = build(promoted());
  const main = mainOf(html(b, '/'));

  it('건너뛰기 링크(WCAG 2.4.1) = 문서 첫 a, a.ws-skip-link[href=#main], main#main 존재', () => {
    const page = html(b, '/');
    const first = /<a\b[^>]*>/.exec(page)?.[0] ?? '';
    expect(first).toBe('<a class="ws-skip-link" href="#main">');
    expect(page).toContain(`>${COPY.nav.skipToMain}</a>`);
    expect(page).toContain('<main id="main" ');
  });

  it('main.ws-page.ws-home-a + 섹션 순서 [hero, starters, start] — 후기·소개 섹션 0(D6)', () => {
    expect(main).toMatch(/^<main id="main" class="ws-page ws-home-a" data-ws-route="HOME">/);
    const sections = [...main.matchAll(/<section\b[^>]*data-ws-section="([^"]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual(['hero', 'starters', 'start']);
    for (const gone of ['ws-reviews', 'ws-review', 'ws-intro', 'ws-feature-chips', 'ws-split-title', 'testimonials#']) expect(main).not.toContain(gone);
  });

  it('히어로 = h1 + 부제 + 선택 바(a.ws-pick-bar[href=/pick], 입력 아님) — 마스코트·기능 칩 0', () => {
    expect(main).toContain('<section class="ws-hero" data-ws-section="hero" aria-labelledby="ws-hero-title">');
    expect(main).toContain(`<h1 id="ws-hero-title" class="ws-t-display ws-hero-title">${COPY.homeA.heroTitle}</h1>`);
    expect(main).toContain(`<p class="ws-t-body ws-muted ws-hero-sub">${COPY.homeA.heroSub}</p>`);
    expect(main).toContain(
      `<a class="ws-pick-bar" data-ws-action="pick-animal" href="${PICK_PATH}"><span class="ws-pick-bar-label">${COPY.homeA.heroBar}</span><span class="ws-pick-bar-go"><svg `,
    );
    expect(main).not.toMatch(/<(input|textarea)\b/);
    expect(main).not.toContain('ws-avatar');
  });

  it('시작 카드(286 U3b) = RailSection starter·grid3 + li > a.ws-starter[data-ws-action=start-card][href=/pick](빈 사진 자리 + 제목·화살표 + 한 줄)', () => {
    expect(main).toContain(
      `<section class="ws-rail-section ws-rail-section--starter ws-rail-section--grid3" data-ws-section="starters" aria-labelledby="ws-sec-starters-title">`,
    );
    expect(main).toContain(`<h2 id="ws-sec-starters-title" class="ws-t-section">${COPY.homeA.startersTitle}</h2>`);
    expect(main).toContain('<ul class="ws-rail ws-starters" role="list" aria-labelledby="ws-sec-starters-title">');
    const cards = [...main.matchAll(/<a class="ws-starter" data-ws-action="start-card" data-ws-intent="([A-Z_]+)" href="([^"]+)">/g)];
    expect(cards.map((m) => m[1])).toEqual(['CHECKLIST', 'SPEC_CHECK', 'SETUP']);
    for (const m of cards) expect(m[2]).toBe(PICK_PATH);
    for (const x of ['CHECKLIST', 'SPEC_CHECK', 'SETUP'] as const) {
      const c = COPY.homeA.starters[x];
      expect(main).toContain(
        `<a class="ws-starter" data-ws-action="start-card" data-ws-intent="${x}" href="${PICK_PATH}"><span class="ws-photo ws-starter-photo" aria-hidden="true"></span><span class="ws-starter-head"><span class="ws-t-cta ws-starter-title">${c.title}</span><span class="ws-starter-go"><svg `,
      );
      expect(main).toContain(`<span class="ws-t-meta ws-muted ws-starter-sub">${c.sub}</span></a></li>`);
    }
    // 사진 = 빈 자리표시(① 사용권 사진 없음), 추적용 슬롯 id 비노출.
    const sec = main.slice(main.indexOf('data-ws-section="starters"'), main.indexOf('data-ws-section="start"'));
    expect(sec).not.toMatch(/<img\b|data-ws-photo|ws-btn--fill|ws-chip/);
  });

  it('하단 CTA = section.ws-start > div.ws-start-text(h2 + 한 줄) + 채운 버튼 1', () => {
    expect(main).toContain('<section class="ws-start" data-ws-section="start" aria-labelledby="ws-start-title">');
    expect(main).toContain(
      `<div class="ws-start-text"><h2 id="ws-start-title" class="ws-t-display ws-start-title">${COPY.homeA.startTitle}</h2><p class="ws-t-body ws-muted">${COPY.homeA.startBody}</p></div>`,
    );
  });

  it('채운 CTA 1(하단) + 선택 바 1 = a[data-ws-action=pick-animal][href=/pick] 2곳, button 0', () => {
    const fills = tagsWithClass(main, 'ws-btn--fill');
    expect(fills).toEqual([`<a class="ws-btn ws-btn--fill" data-ws-action="pick-animal" href="${PICK_PATH}">`]);
    const picks = [...main.matchAll(/<[a-z]+\b[^>]*data-ws-action="pick-animal"[^>]*>/g)].map((m) => m[0]);
    expect(picks).toHaveLength(2);
    for (const t of picks) expect(t).toMatch(/^<a\b[^>]*\shref="\/pick"/);
    expect(main).not.toContain('<button');
  });

  it('D6: 승인 후기가 있어도 홈 HTML·ws-data 에 후기 0(노출 경로 0 일치)', () => {
    expect(b.model.testimonials.map((t) => t.id)).toEqual(['t-001']); // 픽스처에 노출 가능 후기가 있다(공허한 통과 방지)
    const home = b.pages.find((x) => x.route.path === '/')!;
    expect(home.data.data.testimonials).toEqual([]);
    expect(home.html).not.toContain('testimonials#');
  });

  it('마스코트 = React AnimalAvatar 와 같은 img(/mascots/{asset}.svg, alt="") — 인라인 SVG 0(O-1) · /pick L1 타입 카드', () => {
    const aside = asideOf(html(b, PICK_PATH));
    expect(aside).toContain('<span class="ws-avatar ws-avatar--type ws-avatar--brand-soft" aria-hidden="true"><img src="/mascots/hamster-golden.svg" width="56" height="56" alt=""');
    expect(html(b, PICK_PATH)).not.toContain('ws-mascot-svg');
  });

  it('리포에 없는 마스코트 자산이면 img 0(빈 디스크) — 불변식 ①', () => {
    const b0 = buildSite(promoted(), { template: TEMPLATE, origin: ORIGIN, seedDigest: 'a'.repeat(64), asOf: FIXTURE_AS_OF });
    expect(asideOf(html(b0, PICK_PATH))).toContain('<span class="ws-avatar ws-avatar--type ws-avatar--brand-soft" aria-hidden="true"></span>');
    expect(html(b0, '/')).not.toContain('/mascots/');
    expect(html(b0, PICK_PATH)).not.toContain('/mascots/');
  });

  it('헤더 칩 = a[data-ws-chip][href=/pick] (홈·타입 모두) — U2b: 미선택 채운 버튼, 선택 이름', () => {
    expect(html(b, '/')).toMatch(/<a data-ws-chip class="ws-chip ws-btn ws-btn--fill" href="\/pick">/);
    expect(html(b, '/hamster/golden')).toMatch(/<a data-ws-chip class="ws-chip ws-chip--selected" href="\/pick">/);
  });
});

describe('홈 B 마크업 = React HomeB(빈 저장소)', () => {
  const b = build(promoted());
  const page = html(b, '/hamster/golden');
  const main = mainOf(page);

  it('main.ws-home-b · 컨텍스트 헤더(눈썹 · h1#ws-context-title · change-animal a[href=/pick] 「바꾸기」) — 마스코트 없음(R4 시안)', () => {
    expect(main).toMatch(/^<main id="main" class="ws-page ws-home-b" data-ws-route="TYPE" data-ws-type="hamster-golden">/);
    expect(main).toContain('<section class="ws-context" data-ws-id="animalTypes#hamster-golden" aria-labelledby="ws-context-title">');
    expect(main).toContain(`<div class="ws-context-text"><p class="ws-t-meta ws-muted ws-context-eyebrow">${COPY.homeB.contextEyebrow}</p><h1 id="ws-context-title" class="ws-t-display">`);
    expect(main).toContain(`<a class="ws-context-change" data-ws-action="change-animal" href="/pick" aria-label="${COPY.nav.changeFriend}">${COPY.homeB.change}</a>`);
    // R4-2: 컨텍스트 헤더 마스코트 제거 → LCP 우선 이미지 0(h1 글자가 LCP). U2b(D1·R4 시안): 헤더 칩도 이름만 — 문서에 마스코트 img 0.
    expect(main).not.toContain('ws-avatar--lg');
    expect(page.match(/fetchpriority=/g)).toBeNull();
    expect(page).not.toContain('/mascots/hamster-golden.svg');
  });

  it('섹션 = 컨텍스트 → now → later? → bundles → spec → products → vet → save(PRD US-003 순서, R4-2b), ① 요약 카드 + neutral 항목 카드 + 항목 링크 줄, 정적 주 버튼 = a', () => {
    const order = ['now', 'bundles', 'spec', 'products', 'vet', 'save'].map((s) => main.indexOf(`data-ws-section="${s}"`));
    expect(order.every((x) => x > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(main).toContain('<section class="ws-home-sec ws-now" data-ws-section="now" data-ws-answered="0" aria-labelledby="ws-sec-now-title">');
    expect(main).toContain(`<p class="ws-t-body ws-muted ws-home-sec-lead">${COPY.homeB.nowLead}</p>`);
    expect(main).toContain(`<p class="ws-t-body ws-muted ws-now-count">${COPY.homeB.nowBeforeSetup}</p>`);
    expect(main).toMatch(
      new RegExp(`<a class="ws-btn ws-btn--fill ws-now-cta" data-ws-action="open-checklist" href="/hamster/golden/supplies/[a-z-]+">${COPY.homeB.nowCtaStart}</a>`),
    );
    expect(main).toMatch(
      /<li class="ws-now-item" data-ws-item="cage" data-ws-id="supplyRequirements#req-syrian-cage"><a class="ws-now-card" href="\/hamster\/golden\/supplies\/cage" data-ws-state="neutral"><span class="ws-photo ws-now-photo" aria-hidden="true"><\/span><span class="ws-t-title ws-now-name">케이지<\/span><span class="ws-t-body ws-muted ws-now-reason">[^<]+\.<\/span><\/a><\/li>/,
    );
    // qa MED-1: ≤767 항목 줄 = 이름마다 L4 링크(비링크 이름 줄 0)
    expect(main).toContain(
      '<div class="ws-now-lines"><div class="ws-t-body ws-now-line" data-ws-line="all"><ul class="ws-now-links" role="list"><li data-ws-now-link="cage"><a class="ws-now-link" href="/hamster/golden/supplies/cage" data-ws-state="neutral"><span class="ws-now-link-name">케이지</span></a></li>',
    );
    expect(main).toContain(`<a class="ws-home-link ws-save-link" href="/save">${COPY.homeB.saveLink}<span aria-hidden="true"> →</span></a>`);
    expect(main).toContain(`<a class="ws-home-link ws-rail-foot" href="/vet">${COPY.homeB.vetLink}<span aria-hidden="true"> →</span></a>`);
    // 채운 CTA 1개 · 버튼 0(정적)
    expect(main.match(/ws-btn--fill/g)).toHaveLength(1);
    expect(main).not.toContain('<button');
  });

  it('처음 준비한다면 · 기준에 맞는 준비물 · 병원 레일 = RailSection tone=home(display 제목 · 레일 · → 링크), 카드 = BundleCard·ProductCard·VetCard', () => {
    expect(main).toContain(
      '<section class="ws-rail-section ws-rail-section--bundle ws-home-sec ws-bundles-sec" data-ws-section="bundles" aria-labelledby="ws-sec-bundles-title">',
    );
    expect(main).toContain(`<div class="ws-rail-heading ws-home-sec-head"><h2 id="ws-sec-bundles-title" class="ws-t-display ws-home-sec-title">${COPY.homeB.bundlesTitle}</h2></div>`);
    expect(main).toMatch(/<li class="ws-bundle" data-ws-id="setupBundles#sb-syrian-budget" data-ws-tier="BUDGET">/);
    expect(main).toContain(`<a class="ws-home-link ws-rail-foot" href="/hamster/golden/setup">${COPY.setup.detailLink}<span aria-hidden="true"> →</span></a>`);
    expect(main).toContain(
      '<section class="ws-rail-section ws-rail-section--product ws-home-sec ws-products-sec" data-ws-section="products" aria-labelledby="ws-sec-products-title">',
    );
    expect(main).toMatch(/<li class="ws-product" data-ws-id="curatedProducts#cp-001">/);
    expect(main).toContain('<section class="ws-rail-section ws-rail-section--vet ws-home-sec ws-vet-sec" data-ws-section="vet" aria-labelledby="ws-sec-vet-title">');
    expect(main).toContain(`<p class="ws-t-body ws-muted ws-home-sec-lead">${COPY.homeB.vetLead}</p><p class="ws-t-body ws-muted ws-home-sec-lead">${COPY.homeB.vetAsk}</p>`);
    expect(main).toMatch(/<li class="ws-vet" data-ws-id="vetClinics#vc-mapo-01">\n<h3>/);
    expect(main).not.toContain(COPY.homeB.vetEmpty);
  });

  it('병원 0(SLOT 뿐) → 레일 없이 「확인된 병원이 아직 없어요」 + /vet 링크(허구 병원 0) · 구성안·상품 0 → 섹션 없음', () => {
    const s = promoted();
    s.vetClinics = [];
    s.setupBundles = [];
    s.curatedProducts = [];
    const m = mainOf(html(build(s), '/hamster/golden'));
    expect(m).toContain('<section class="ws-home-sec ws-vet-sec" data-ws-section="vet" aria-labelledby="ws-sec-vet-title">');
    expect(m).toContain(`<p class="ws-t-body ws-muted ws-home-sec-lead">${COPY.homeB.vetEmpty}</p>`);
    expect(m).toContain(`<a class="ws-home-link" href="/vet">${COPY.homeB.vetLink}<span aria-hidden="true"> →</span></a>`);
    expect(m).not.toMatch(/li class="ws-vet"|data-ws-section="bundles"|data-ws-section="products"/);
  });

  it('③ 규격 확인 = 엔진 minSpecFigure(시드 규칙 값 그대로) · 링크 L5 · 시드 값을 바꾸면 화면이 따라 바뀐다', () => {
    expect(main).toContain('<section class="ws-home-sec ws-spec-sec" data-ws-section="spec" data-ws-id="supplyRequirements#req-syrian-cage" aria-labelledby="ws-sec-spec-title">');
    expect(main).toContain(`<p class="ws-t-section ws-spec-sec-label">${COPY.verdict.minSpecLabel}</p>`);
    expect(main).toContain('<p class="ws-spec-sec-num"><span class="ws-spec-sec-value">100×50×50</span><span class="ws-spec-sec-unit">cm</span></p>');
    expect(main).toContain('<a class="ws-home-link" href="/hamster/golden/check/cage">내 케이지 확인하기<span aria-hidden="true"> →</span></a>');
    const s = promoted();
    const cage = s.supplyRequirements.find((r) => r.id === 'req-syrian-cage');
    if (!cage) throw new Error('fixture: req-syrian-cage');
    cage.minSpec = { rules: cage.minSpec.rules.map((r) => (r.key === 'floorWcm' ? { ...r, value: 120 } : r)) };
    expect(mainOf(html(build(s), '/hamster/golden'))).toContain('<span class="ws-spec-sec-value">120×50×50</span>');
  });

  it('상품 표면 표식(client PRODUCT_SURFACE_SELECTOR) — 홈 B 레일 section[data-ws-section=products] · ul.ws-products 와 L4 후보 영역', () => {
    expect(main).toContain('<ul class="ws-rail ws-products" role="list" tabindex="0" aria-labelledby="ws-sec-products-title">');
    const l4 = asideOf(html(b, '/hamster/golden/supplies/wheel'));
    expect(l4).toContain('<section data-ws-part="products">');
    expect(l4).toMatch(/<li class="ws-product" data-ws-id="curatedProducts#cp-001">/);
  });
});

describe('정적 레이어 id·닫기 링크(L4/L5/L7/L8/L1)', () => {
  const b = build(promoted());
  const cases: Array<[string, string, string]> = [
    ['/hamster/golden/supplies/cage', 'L4', '/hamster/golden'],
    ['/supplies/cage/hamster-golden', 'L4', '/supplies/cage'],
    ['/hamster/golden/check/cage', 'L5', '/hamster/golden'],
    ['/hamster/golden/products/cp-001', 'L7', '/hamster/golden'],
    ['/save', 'L8', '/'],
    [PICK_PATH, 'L1', '/'],
  ];
  for (const [path, kind, parent] of cases) {
    it(`${path} → aside#ws-layer[data-ws-layer=${kind}] 안 a.ws-layer-close[href=${parent}]`, () => {
      const aside = asideOf(html(b, path));
      expect(aside).toMatch(new RegExp(`^<aside class="ws-layer" id="ws-layer" data-ws-layer="${kind}"`));
      expect(aside).toContain(`<a class="ws-layer-close" href="${parent}">${COPY.supplyLayer.close}</a>`);
    });
  }
});

describe('404 복귀 링크', () => {
  it('/ · /supplies · /vet(notFound.vetLink)', () => {
    const main = mainOf(html(build(promoted()), '/404'));
    expect(main).toContain(`<a href="/">${COPY.notFound.home}</a>`);
    expect(main).toContain(`<a href="/supplies">${COPY.nav.supplies}</a>`);
    expect(main).toContain(`<a href="/vet">${COPY.notFound.vetLink}</a>`);
  });
});

describe('/vet 지역 칩 줄(P5 레인 E)', () => {
  it('p#ws-vet-regions-label + ul.ws-region-chips[aria-labelledby], aria-label 0', () => {
    const s = promoted();
    const b = build(s);
    const page = html(b, '/vet');
    if (b.model.vets.length === 0) return expect(page).not.toContain('ws-region-chips');
    expect(page).toContain(`<p class="ws-vet-row-label" id="ws-vet-regions-label">${COPY.vet.regionsTitle}</p>`);
    expect(page).toContain('<ul class="ws-region-chips" aria-labelledby="ws-vet-regions-label">');
    expect(page).not.toMatch(/<ul class="ws-region-chips" aria-label=/);
  });

  it('병원 카드 제목 레벨(P3 D10): /vet = h2, 홈 B 레일 = h3', () => {
    const b = build(promoted());
    expect(b.model.vets.length).toBeGreaterThan(0);
    const vetPage = html(b, '/vet');
    expect(vetPage).toMatch(/<li class="ws-vet" data-ws-id="vetClinics#[^"]+">\n<h2>/);
    expect(vetPage).not.toMatch(/<li class="ws-vet"[^>]*>\n<h3>/);
    const typePage = mainOf(html(b, '/hamster/golden'));
    if (typePage.includes('class="ws-vet"')) {
      expect(typePage).toMatch(/<li class="ws-vet" data-ws-id="vetClinics#[^"]+">\n<h3>/);
      expect(typePage).not.toMatch(/<li class="ws-vet"[^>]*>\n<h2>/);
    }
  });
});

describe('/pick(K1)', () => {
  const b = build(promoted(), { indexable: true });
  const page = html(b, PICK_PATH);

  it('라우트 PICK 1개, indexable false, canonical /, noindex, sitemap 제외, 매니페스트 등록', () => {
    expect(ROUTE_KINDS).toContain('PICK');
    expect(b.routes.filter((r) => r.kind === 'PICK')).toEqual([
      expect.objectContaining({ path: '/pick', file: 'pick/index.html', indexable: false, canonicalPath: '/', layer: null }),
    ]);
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
    expect(b.files.get('sitemap.xml')).not.toContain('/pick');
    expect(b.manifest.routes.find((r) => r.path === '/pick')).toMatchObject({ kind: 'PICK', indexable: false });
  });

  it('ws-data = 홈과 같은 data, route {kind:PICK, path:/pick}, layer null', () => {
    const d = b.pages.find((x) => x.route.path === PICK_PATH)!.data;
    const home = b.pages.find((x) => x.route.path === '/')!.data;
    expect(d.route).toEqual({ kind: 'PICK', path: '/pick' });
    expect(d.layer).toBeNull();
    expect(d.data).toEqual(home.data);
  });

  it('부모 = 홈 A 본문 + L1 aside(노출 타입 링크, 마스코트 img, 잘 모르겠어요 별칭 목록)', () => {
    expect(mainOf(page)).toContain('<section class="ws-hero" data-ws-section="hero"');
    expect(page).toMatch(/<div class="ws-scrim" aria-hidden="true"><\/div>\n<aside class="ws-layer" id="ws-layer" data-ws-layer="L1"/);
    const aside = asideOf(page);
    expect(aside).toContain(`<h2 id="ws-layer-title">${COPY.picker.title}</h2>`);
    expect(COPY.picker.title).toBe(COPY.homeA.heroBar); // 286 U4: L1 제목 = 홈 선택 바 문장
    expect(aside).toContain(`<p class="ws-t-body ws-picker-muted">${COPY.picker.groupsLead}</p>`);
    expect(aside).toContain(`<h3 class="ws-t-section">${COPY.groups.SMALL_MAMMAL}</h3>`);
    expect(aside).toMatch(/<a class="ws-type-card" href="\/hamster\/golden" data-ws-id="animalTypes#hamster-golden"><span class="ws-avatar ws-avatar--type ws-avatar--brand-soft" aria-hidden="true"><img src="\/mascots\/hamster-golden\.svg" width="56" height="56"/);
    const types = [...aside.matchAll(/class="ws-type-card" href="([^"]+)"/g)].map((m) => m[1]);
    expect(types).toEqual(b.model.types.map((t) => `/${t.slug}`));
    // 비노출 그룹(앵무새 타입 0)은 섹션 없음
    expect(aside).not.toContain('data-ws-group="PARROT"');
    expect(aside).not.toMatch(/<button|<form|<input/);
  });

  it('별칭이 있으면 "잘 모르겠어요" 정적 목록(후보 안내 문구), 없으면 섹션 0', () => {
    const s = promoted();
    patch(s, 'animalTypes', 'hamster-golden', { aliases: ['골드햄스터', '시리안햄스터'] });
    const aside = asideOf(html(build(s), PICK_PATH));
    expect(aside).toContain(`<h3 class="ws-t-section">${COPY.picker.unsure}</h3>`);
    expect(aside).toContain(COPY.picker.candidateNote);
    expect(aside).toContain('골드햄스터, 시리안햄스터');
    const s2 = promoted();
    patch(s2, 'animalTypes', 'hamster-golden', { aliases: [] });
    expect(asideOf(html(build(s2), PICK_PATH))).not.toContain(COPY.picker.unsure);
  });
});
