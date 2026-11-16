// 286 U3c·U3d·U3e — 홈 A 설명 섹션(필요/불필요 · 숫자 · 함께 살 집 · 병원) 프리렌더.
//   숫자·품목명·동물·병원 집계는 시드 노출 값에서만(하드코딩 0, 불변식 ⑥·⑦), 노출 타입 0이면 섹션 0(D12 ①), PLANNED 타입 링크 0(D4),
//   병원은 그룹별 진료 타입 집계만(지도·위치 0, 불변식 ⑧), 홈 ws-data 는 요구사항을 싣지 않고 대표 타입 types[0].homeExplain 만.
import { describe, expect, it } from 'vitest';
import { ANIMAL_GROUPS, HOME_A_FIGURES_MAX, HOME_A_NEED_MAX, SPEC_WORDS, WS_DATA_KEYS, figureValueText, homeAExplainOf, minSpecFigure, type PublicRequirement, type SeedBundle, type WsPageData } from '../engine/index.js';
import { COPY, formatCopy } from '../prerender/copy.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, dwarfPreview, patch, promoted, promotedTwo, realSeed } from './fixtures/prerender-seed.js';

const TEMPLATE = '<!doctype html><html><head><!--ws:head--></head><body><div id="root"><!--ws:body--></div></body></html>';
const build = (s: SeedBundle, asOf = FIXTURE_AS_OF): SiteBuild =>
  buildSite(s, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), asOf });
const pageOf = (b: SiteBuild, path: string) => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`no page ${path}`);
  return p;
};
const mainOf = (b: SiteBuild, path: string): string => {
  const html = pageOf(b, path).html;
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'));
};
const dataOf = (b: SiteBuild, path: string): WsPageData['data'] => pageOf(b, path).data.data;
const sectionsOf = (main: string): string[] => [...main.matchAll(/<section\b[^>]*data-ws-section="([^"]+)"/g)].map((m) => m[1]);
const sectionHtml = (main: string, id: string): string => {
  const at = main.indexOf(`data-ws-section="${id}"`);
  if (at < 0) return '';
  const start = main.lastIndexOf('<section', at);
  return main.slice(start, main.indexOf('</section>', at) + '</section>'.length);
};
const HOME_PATHS = ['/', '/pick', '/save'];
const EXPLAIN = ['need-split', 'figures', 'habitats', 'vet-split'];

describe('실시드(전부 DRAFT): 설명 섹션 0 — 홈 = 히어로 · 하단 CTA 뿐(D12 ①)', () => {
  const b = build(realSeed(), '2026-11-02');
  it('섹션 [hero, start], 설명 섹션·homeExplain 0', () => {
    for (const p of HOME_PATHS) {
      expect(sectionsOf(mainOf(b, p)), p).toEqual(['hero', 'start']);
      expect(dataOf(b, p).types, p).toEqual([]);
    }
    expect(JSON.stringify(b.pages.map((x) => x.data))).not.toContain('homeExplain');
  });
});

describe('승격 골든(promoted): 숫자 · 함께 살 집 · 병원(1곳) — 필요/불필요는 NOT_NOW 노출 0이라 없음', () => {
  const s = promoted();
  const b = build(s);
  const main = mainOf(b, '/');
  const typeReqs = dataOf(b, '/hamster/golden').requirements;

  it('섹션 순서(R3 시안 v1b) = hero, starters, figures, habitats, vet-split, start', () => {
    expect(sectionsOf(main)).toEqual(['hero', 'starters', 'figures', 'habitats', 'vet-split', 'start']);
  });

  it('숫자 행 = 타입 페이지 노출 요구사항의 REQUIRED · minSpecFigure 순서 그대로(시드 값, 최대 2) — 이름·숫자·단위·「이상」', () => {
    const want = typeReqs
      .filter((r) => r.priority === 'REQUIRED')
      .map((r) => ({ r, f: minSpecFigure(r.item.specSchema, r.minSpec) }))
      .filter((x) => x.f !== null)
      .slice(0, 2);
    expect(want.length).toBeGreaterThan(0); // 공허한 통과 방지
    const sec = sectionHtml(main, 'figures');
    const rows = [...sec.matchAll(/<li class="ws-figure" data-ws-id="supplyRequirements#([^"]+)"><p class="ws-t-section ws-figure-label">([^<]+)<\/p><p class="ws-figure-num"><span class="ws-figure-value">([^<]+)<\/span><span class="ws-figure-unit">([^<]+)<\/span><\/p><\/li>/g)].map(
      (m) => [m[1], m[2], m[3], m[4]],
    );
    expect(rows).toEqual(
      want.map(({ r, f }) => [
        r.requirementId,
        f!.base !== null ? `${r.item.name} ${f!.base}` : r.item.name,
        figureValueText(f!),
        f!.unit ? `${f!.unit} ${SPEC_WORDS.gte}` : SPEC_WORDS.gte,
      ]),
    );
    expect(sec).toContain(`<p class="ws-t-meta ws-eyebrow ws-explain-eyebrow">${formatCopy(COPY.homeA.figuresEyebrow, { animal: dataOf(b, '/').types[0].displayName })}</p>`);
    expect(sec).toContain(`<a class="ws-home-link" href="/hamster/golden/check/${want[0].r.item.id}">${COPY.homeA.figuresLink}<span aria-hidden="true"> →</span></a>`);
    expect(b.pages.some((x) => x.route.path === `/hamster/golden/check/${want[0].r.item.id}`)).toBe(true);
  });

  it('시드 값을 바꾸면 화면 숫자가 따라 바뀐다(쳇바퀴 최소 지름 27 → 26)', () => {
    const t = promoted();
    const row = t.supplyRequirements.find((r) => r.id === 'req-syrian-wheel') as unknown as { minSpec: { rules: Array<{ key: string; value: unknown }> } };
    const before = row.minSpec.rules.find((r) => r.key === 'diameterCm')?.value;
    expect(before).toBe(27);
    patch(t, 'supplyRequirements', 'req-syrian-wheel', { minSpec: { ...row.minSpec, rules: row.minSpec.rules.map((r) => (r.key === 'diameterCm' ? { ...r, value: 26 } : r)) } });
    const sec = sectionHtml(mainOf(build(t), '/'), 'figures');
    expect(sec).toContain('<span class="ws-figure-value">26</span>');
    expect(sec).not.toContain('<span class="ws-figure-value">27</span>');
    expect(sectionHtml(main, 'figures')).toContain('<span class="ws-figure-value">27</span>');
  });

  it('필요/불필요 섹션 없음(노출 NOT_NOW 0) — 시드에 없는 항목명을 만들지 않는다', () => {
    expect(typeReqs.some((r) => r.priority === 'NOT_NOW')).toBe(false);
    expect(main).not.toContain('data-ws-section="need-split"');
    for (const x of ['꾸미기용 소품', '여분의 식기', '추가 장식품', '28']) expect(main).not.toContain(x);
  });

  it('함께 살 집 = 노출 타입 카드만(→ 타입 홈), oneLiner 한 줄, PLANNED 타입 링크 0', () => {
    const sec = sectionHtml(main, 'habitats');
    expect(sec).toContain(
      '<section class="ws-rail-section ws-rail-section--habitat ws-rail-section--grid3 ws-home-sec ws-habitats-sec" data-ws-section="habitats" aria-labelledby="ws-sec-habitats-title">',
    );
    expect(sec).toContain(`<h2 id="ws-sec-habitats-title" class="ws-t-display ws-home-sec-title">${COPY.homeA.habitatsTitle}</h2>`);
    const cards = [...sec.matchAll(/<a class="ws-starter ws-habitat" href="([^"]+)" data-ws-id="animalTypes#([^"]+)">/g)].map((m) => [m[1], m[2]]);
    expect(cards).toEqual([['/hamster/golden', 'hamster-golden']]);
    const golden = s.animalTypes.find((t) => t.id === 'hamster-golden') as { oneLiner: string };
    expect(sec).toContain(`<span class="ws-t-meta ws-muted ws-starter-sub">${golden.oneLiner}</span>`);
    const planned = s.animalTypes.filter((t) => t.status === 'PLANNED');
    expect(planned.length).toBeGreaterThan(0);
    for (const t of planned) {
      expect(main, t.id).not.toContain(`href="/${t.slug}"`);
      expect(main, t.id).not.toContain(`animalTypes#${t.id}"`);
    }
  });

  it('병원 = 그룹별 진료 타입 집계(노출 병원 treats), 이름·주소·전화·좌표·지도 0', () => {
    const vets = dataOf(b, '/').vets;
    expect(vets.length).toBeGreaterThan(0);
    const sec = sectionHtml(main, 'vet-split');
    expect(sec).toContain(
      `<li data-ws-group="SMALL_MAMMAL"><span class="ws-t-cta ws-vet-row-name">${formatCopy(COPY.homeA.vetRow, { name: COPY.groups.SMALL_MAMMAL })}</span><span class="ws-t-body ws-muted ws-vet-row-types">${dataOf(b, '/').types[0].displayName}</span></li>`,
    );
    expect(sec).not.toContain('data-ws-group="PARROT"');
    expect(sec).not.toContain(COPY.homeB.vetEmpty);
    for (const v of vets) for (const x of [v.name, v.address, v.phone]) expect(sec).not.toContain(x);
    expect(sec).toContain(`<a class="ws-home-link" href="/vet">${COPY.homeB.vetLink}<span aria-hidden="true"> →</span></a>`);
    expect(sec).not.toMatch(/<img\b|<iframe\b|<script\b|map\.naver|openapi\.map|lat|lng/);
  });

  it('노출 병원 0이면 「확인된 병원이 아직 없어요」(허구 0)', () => {
    const t = promoted();
    for (const v of t.vetClinics) Object.assign(v, { treats: [] });
    const sec = sectionHtml(mainOf(build(t), '/'), 'vet-split');
    expect(sec).toContain(`<p class="ws-t-body ws-muted ws-vet-rows-empty">${COPY.homeB.vetEmpty}</p>`);
    expect(sec).not.toContain('ws-vet-rows"');
  });

  it('홈 ws-data: 요구사항 0 · 키 6개 · homeExplain 은 types[0] 에만, 홈 외 페이지엔 없음', () => {
    for (const p of HOME_PATHS) {
      const d = dataOf(b, p);
      expect(d.requirements, p).toEqual([]);
      expect(Object.keys(d)).toEqual([...WS_DATA_KEYS]);
      expect(d.types[0].homeExplain, p).toBeDefined();
      expect(sectionsOf(mainOf(b, p)).filter((x) => EXPLAIN.includes(x)), p).toEqual(['figures', 'habitats', 'vet-split']);
    }
    for (const p of b.pages.filter((x) => !HOME_PATHS.includes(x.route.path))) {
      for (const t of p.data.data.types) expect('homeExplain' in t, p.route.path).toBe(false);
    }
  });
});

describe('두 노출 타입(promotedTwo): 대표 = 시드 순 첫 타입, 함께 살 집 = 두 카드', () => {
  const b = build(promotedTwo());
  const d = dataOf(b, '/');
  it('homeExplain 은 첫 타입에만, 카드 순서 = 노출 타입 순서', () => {
    expect(d.types.length).toBe(2);
    expect('homeExplain' in d.types[0]).toBe(true);
    expect('homeExplain' in d.types[1]).toBe(false);
    const sec = sectionHtml(mainOf(b, '/'), 'habitats');
    expect([...sec.matchAll(/data-ws-id="animalTypes#([^"]+)"/g)].map((m) => m[1])).toEqual(d.types.map((t) => t.id));
  });
});

describe('드워프 미리보기(dwarfPreview): 필요/불필요 = 시드 레코드 이름, 병원 0', () => {
  const b = build(dwarfPreview(), DWARF_PREVIEW_AS_OF);
  const main = mainOf(b, '/');
  const typeReqs = dataOf(b, '/hamster/dwarf').requirements;
  it('섹션 순서 = hero, starters, need-split, figures, habitats, vet-split, start', () => {
    expect(sectionsOf(main)).toEqual(['hero', 'starters', 'need-split', 'figures', 'habitats', 'vet-split', 'start']);
  });
  it('필요해요 = REQUIRED 앞 3 · 지금은 필요 없어요 = NOT_NOW 시드 레코드(이름 그대로, 순서 그대로)', () => {
    const sec = sectionHtml(main, 'need-split');
    const col = (key: string): string[][] => {
      const at = sec.indexOf(`data-ws-col="${key}"`);
      const part = sec.slice(at, sec.indexOf('</ul>', at));
      return [...part.matchAll(/<li class="ws-t-body" data-ws-id="supplyRequirements#([^"]+)">([^<]+)<\/li>/g)].map((m) => [m[1], m[2]]);
    };
    const expectOf = (p: string) =>
      typeReqs
        .filter((r) => r.priority === p)
        .slice(0, 3)
        .map((r) => [r.requirementId, r.item.name]);
    expect(expectOf('NOT_NOW').length).toBeGreaterThan(0);
    expect(col('need')).toEqual(expectOf('REQUIRED'));
    expect(col('not-now')).toEqual(expectOf('NOT_NOW'));
    expect(sec).toContain(`<p class="ws-t-meta ws-eyebrow ws-explain-eyebrow">${formatCopy(COPY.homeA.needEyebrow, { animal: dataOf(b, '/').types[0].displayName })}</p>`);
    expect(sec).toContain(`<a class="ws-home-link" href="/hamster/dwarf">${COPY.homeA.needLink}<span aria-hidden="true"> →</span></a>`);
  });
  it('노출 병원 0 → 「확인된 병원이 아직 없어요」, 그룹 행 0', () => {
    expect(dataOf(b, '/').vets).toEqual([]);
    const sec = sectionHtml(main, 'vet-split');
    expect(sec).toContain(COPY.homeB.vetEmpty);
    for (const g of ANIMAL_GROUPS) expect(sec).not.toContain(`data-ws-group="${g}"`);
  });
});

describe('engine homeAExplainOf(순수) — 상한·열 짝·fail-closed', () => {
  const b = build(dwarfPreview(), DWARF_PREVIEW_AS_OF);
  const reqs = dataOf(b, '/hamster/dwarf').requirements;
  it('figures ≤ 2(REQUIRED·숫자 규칙만), need·notNow ≤ 3', () => {
    const ex = homeAExplainOf(reqs)!;
    expect(ex.figures.length).toBeLessThanOrEqual(HOME_A_FIGURES_MAX);
    expect(ex.need.length).toBeLessThanOrEqual(HOME_A_NEED_MAX);
    expect(ex.notNow.length).toBeLessThanOrEqual(HOME_A_NEED_MAX);
    const reqIds = new Set(reqs.filter((r) => r.priority === 'REQUIRED').map((r) => r.requirementId));
    for (const f of ex.figures) expect(reqIds.has(f.requirementId)).toBe(true);
  });
  it('NOT_NOW 가 없으면 need·notNow 둘 다 [](한 열만 그리지 않는다), 숫자도 없으면 null', () => {
    const noLater: PublicRequirement[] = reqs.filter((r) => r.priority !== 'NOT_NOW');
    const ex = homeAExplainOf(noLater)!;
    expect([ex.need, ex.notNow]).toEqual([[], []]);
    expect(ex.figures.length).toBeGreaterThan(0);
    expect(homeAExplainOf(noLater.map((r) => ({ ...r, minSpec: { rules: [] } })))).toBeNull();
    expect(homeAExplainOf([])).toBeNull();
  });
});
