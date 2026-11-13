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
    expect(main).toContain('<ul class="ws-rail ws-starters" role="list" tabindex="0" aria-labelledby="ws-sec-starters-title">');
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

  it('헤더 칩 = a[data-ws-chip][href=/pick] (홈·타입 모두)', () => {
    expect(html(b, '/')).toMatch(/<a data-ws-chip class="ws-chip" href="\/pick">/);
    expect(html(b, '/hamster/golden')).toMatch(/<a data-ws-chip class="ws-chip ws-chip--selected" href="\/pick">/);
  });
});

describe('홈 B 마크업 = React HomeB(빈 저장소)', () => {
  const b = build(promoted());
  const page = html(b, '/hamster/golden');
  const main = mainOf(page);

  it('main.ws-home-b · 컨텍스트 헤더(h1#ws-context-title · 상태 줄 · change-animal a[href=/pick])', () => {
    expect(main).toMatch(/^<main id="main" class="ws-page ws-home-b" data-ws-route="TYPE" data-ws-type="hamster-golden">/);
    expect(main).toContain('<section class="ws-context" data-ws-id="animalTypes#hamster-golden" aria-labelledby="ws-context-title">');
    expect(main).toContain('<h1 id="ws-context-title" class="ws-t-display">');
    expect(main).toContain(`<a class="ws-btn ws-btn--outline" data-ws-action="change-animal" href="/pick">${COPY.nav.changeFriend}</a>`);
    expect(main).toMatch(/<span class="ws-avatar ws-avatar--lg ws-avatar--peach-soft" aria-hidden="true"><img src="\/mascots\/hamster-golden\.svg" width="96" height="96" alt="" fetchpriority="high"><\/span>/);
    // R6 F2b ②: LCP 마스코트는 이 하나뿐 — 페이지 전체에서 fetchpriority 1회, 헤더 칩 등 나머지는 decoding=async 유지.
    expect(page.match(/fetchpriority=/g)).toHaveLength(1);
    expect(page).toMatch(/<span class="ws-avatar ws-avatar--sm ws-avatar--peach-soft" aria-hidden="true"><img src="\/mascots\/hamster-golden\.svg" width="24" height="24" alt="" decoding="async"><\/span>/);
  });

  it('① ② ③ 레일 섹션 = RailSection 클래스, ① neutral 칩, ④ 링크 섹션, ⑤ 저장 배너', () => {
    expect(main).toMatch(/<section class="ws-rail-section ws-rail-section--need" data-ws-section="now" aria-labelledby="ws-sec-now-title"[^>]*id="ws-now"/);
    expect(main).toContain(`<p class="ws-rail-sub ws-t-body">${COPY.homeB.nowBeforeSetup}</p>`);
    expect(main).toContain('<ul class="ws-rail ws-chips" role="list" tabindex="0" aria-labelledby="ws-sec-now-title">');
    expect(main).toMatch(/<a class="ws-need ws-need--neutral" href="\/hamster\/golden\/supplies\/[a-z-]+" data-ws-state="neutral"><span class="ws-need-name">/);
    expect(main).toContain('<section class="ws-rail-section ws-rail-section--bundle" data-ws-section="bundles"');
    expect(main).toContain('<section class="ws-rail-section ws-rail-section--product" data-ws-section="products"');
    expect(main).toContain('<ul class="ws-rail ws-products" role="list"');
    expect(main).toContain('<section class="ws-band ws-band--save" data-ws-section="save" aria-labelledby="ws-save-title">');
    expect(main).toContain(`<a class="ws-save-link ws-t-meta" href="/save">${COPY.homeB.saveLink}</a>`);
    expect(main).toMatch(/<section class="ws-vet-link" data-ws-section="vet"|<section class="ws-rail-section ws-rail-section--vet" data-ws-section="vet"/);
    expect(main).not.toContain('<button');
  });

  it('상품 표면 표식 유지(client PRODUCT_SURFACE_SELECTOR) — section[data-ws-section=products] · ul.ws-products · li.ws-product[data-ws-id^=curatedProducts#]', () => {
    expect(main).toContain('data-ws-section="products"');
    expect(main).toMatch(/<ul class="ws-rail ws-products"/);
    expect(main).toMatch(/<li class="ws-product" data-ws-id="curatedProducts#cp-001">/);
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
