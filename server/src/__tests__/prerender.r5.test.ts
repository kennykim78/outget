// R5 B2-5·G-4·G-6 프리렌더: /save(SAVE·noindex·L8), 타입 ws-data vets(treats 필터 ≤20), /vet 카드·지역 칩·레이아웃,
//   ProductCard ♡ 형제, L7 추천 이유 템플릿, /supplies 행, /setup priority meta. 불변식 ③⑤⑦⑧.
import { describe, expect, it } from 'vitest';
import { WS_DATA_KEYS, naverMapSearchUrl, type SeedBundle, type VetClinicSeedRec } from '../engine/index.js';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { COPY } from '../prerender/copy.js';
import { renderHeader } from '../prerender/pages/common.js';
import { TYPE_VETS_MAX } from '../prerender/pages/type.js';
import { FIXTURE_AS_OF, patch, promoted, realSeed, unsignedRealSeed } from './fixtures/prerender-seed.js';

const TEMPLATE = '<!doctype html><html><head><!--ws:head--></head><body><div id="root"><!--ws:body--></div></body></html>';
const ORIGIN = 'http://localhost:3001';
const build = (s: SeedBundle, o: { vetMap?: boolean; indexable?: boolean } = {}): SiteBuild =>
  buildSite(s, { template: TEMPLATE, origin: ORIGIN, seedDigest: 'a'.repeat(64), asOf: FIXTURE_AS_OF, ...o });
const html = (b: SiteBuild, path: string): string => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`no page ${path}`);
  return p.html;
};
const data = (b: SiteBuild, path: string) => b.pages.find((x) => x.route.path === path)!.data;

describe('/save(C-R5-6, D11)', () => {
  const b = build(promoted(), { indexable: true });
  it('SAVE 라우트 1개, noindex, sitemap 제외, robots Disallow /save, 매니페스트 indexable false', () => {
    const r = b.routes.filter((x) => x.kind === 'SAVE');
    expect(r).toEqual([expect.objectContaining({ path: '/save', file: 'save/index.html', indexable: false, layer: null })]);
    expect(html(b, '/save')).toContain('<meta name="robots" content="noindex">');
    expect(b.files.get('sitemap.xml')).not.toContain('/save');
    expect(b.files.get('robots.txt')).toContain('Disallow: /save\n');
    expect(b.manifest.routes.find((x) => x.path === '/save')).toMatchObject({ kind: 'SAVE', indexable: false });
  });
  it('부모 = 홈 셸(히어로) + L8 정적 본문(US-025 문구), ws-data route.kind SAVE·types 전체, 키 6개', () => {
    const page = html(b, '/save');
    expect(page).toContain('data-ws-section="hero"');
    const aside = page.slice(page.indexOf('<aside'), page.indexOf('</aside>'));
    expect(aside).toContain('data-ws-layer="L8"');
    expect(aside).toContain(COPY.save.title);
    expect(aside).toContain(COPY.save.noAds);
    expect(aside).not.toMatch(/<input|<form/); // 입력은 하이드레이션 후
    const d = data(b, '/save');
    expect(d.route).toEqual({ kind: 'SAVE', path: '/save' });
    expect(d.layer).toBeNull();
    expect(d.data.types.map((t) => t.id)).toEqual(['hamster-golden']);
    expect(Object.keys(d.data)).toEqual([...WS_DATA_KEYS]);
  });
  it('색인 비허용 사이트는 기존대로 전면 Disallow', () => {
    expect(build(promoted()).files.get('robots.txt')).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('타입 페이지 ws-data.vets(C-R5-6, D16)', () => {
  const s = promoted();
  s.vetClinics = [
    vet('vc-b', { region: '서울 마포구', name: '나 병원' }),
    vet('vc-a', { region: '서울 강남구', name: '가 병원' }),
    vet('vc-other', { treats: ['budgie'] }),
    vet('vc-reported', { verification: { status: 'REPORTED', method: 'USER_REPORT', verifiedAt: null, note: null } }),
    vet('vc-blinded', { verification: { status: 'BLINDED', method: 'PHONE_CALL', verifiedAt: '2026-09-28', note: null } }),
  ];
  const b = build(s);
  it('treats ∋ typeId 인 노출 병원만, 지역 → 이름 → id 순, 모든 타입 라우트 공통', () => {
    for (const p of ['/hamster/golden', '/hamster/golden/supplies/wheel', '/hamster/golden/check/cage', '/hamster/golden/products/cp-001']) {
      expect(data(b, p).data.vets.map((v) => v.id), p).toEqual(['vc-a', 'vc-b']);
    }
    const all = JSON.stringify([...b.files.values()]);
    expect(all).not.toContain('vc-reported');
    expect(all).not.toContain('vc-blinded');
    expect(all).not.toContain('ops-note-hidden');
  });
  it('setup 페이지 ws-data 도 같은 vets(타입 데이터), products 0 유지', () => {
    const d = data(b, '/hamster/golden/setup').data;
    expect(d.vets.map((v) => v.id)).toEqual(['vc-a', 'vc-b']);
    expect(d.products).toEqual([]);
  });
  it(`상한 ${TYPE_VETS_MAX}`, () => {
    const s2 = promoted();
    s2.vetClinics = Array.from({ length: 25 }, (_, i) => vet(`vc-${String(i).padStart(2, '0')}`));
    const vs = data(build(s2), '/hamster/golden').data.vets;
    expect(vs).toHaveLength(TYPE_VETS_MAX);
    expect(vs[0].id).toBe('vc-00');
  });
  it('홈 B 병원 레일(R4-2b 복원) = ws-data vets 순서 VetCard, 레일 아래 /vet 링크', () => {
    const page = html(b, '/hamster/golden');
    const sec = page.slice(page.indexOf('data-ws-section="vet"'), page.indexOf('data-ws-section="save"'));
    const ids = [...sec.matchAll(/data-ws-id="vetClinics#([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['vc-a', 'vc-b']);
    expect(data(b, '/hamster/golden').data.vets.map((v) => v.id)).toEqual(ids);
    // R4 시안 톤: → 텍스트 링크는 레일 아래(ws-rail-foot).
    expect(sec).toContain(`<a class="ws-home-link ws-rail-foot" href="/vet">${COPY.homeB.vetLink}`);
    expect(sec.indexOf('vetClinics#')).toBeLessThan(sec.indexOf('href="/vet"'));
    expect(sec).not.toContain(COPY.homeB.vetEmpty);
  });
});

describe('/vet(G-4)', () => {
  const s = promoted();
  s.vetClinics = [
    vet('vc-1', { night: true, emergency: false, treats: ['hamster-golden', 'hidden-species'] }),
    vet('vc-2', { region: '서울 강남구', verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: null, note: null } }),
  ];
  const list = build(s);
  it('키 없음 → main[data-ws-vet-layout=list], 지도 블록 0 / vetMap → map + 빈 블록 예약(aria-hidden)', () => {
    expect(html(list, '/vet')).toContain('data-ws-route="VET" data-ws-vet-layout="list"');
    expect(html(list, '/vet')).not.toContain('ws-vet-map');
    const map = build(s, { vetMap: true });
    expect(html(map, '/vet')).toContain('data-ws-vet-layout="map"');
    expect(html(map, '/vet/서울-마포구')).toContain('<div class="ws-vet-map" aria-hidden="true"></div>');
  });
  it('VetCard: 진료 동물 = 노출 타입 표시명만(원시 id 0), 확인 배지, 야간 칩(true 만), 전화 tel:, 길찾기 = naverMapSearchUrl(병원명 주소) 새 창', () => {
    const page = html(list, '/vet/서울-마포구');
    const card = page.slice(page.indexOf('vetClinics#vc-1'), page.indexOf('</li>', page.indexOf('vetClinics#vc-1')));
    expect(card).toContain(`${COPY.vet.treats}: 골든햄스터`);
    expect(card).not.toContain('hidden-species');
    expect(card).not.toContain('hamster-golden');
    expect(card).toContain(`${COPY.vet.verifiedBadge} 2026.09`);
    expect(card).toContain(`<span class="ws-chip">${COPY.vet.night}</span>`);
    expect(card).not.toContain(COPY.vet.emergency);
    expect(card).toContain('href="tel:021112222"');
    // DR m-5: 버튼 라벨 = "전화"만, 번호는 aria-label + 주소 아래 meta 줄
    const phone = card.match(/<p class="ws-vet-phone">([^<]+)<\/p>/);
    expect(phone).not.toBeNull();
    expect(card.indexOf('ws-vet-address')).toBeLessThan(card.indexOf('ws-vet-phone'));
    expect(card).toContain(`aria-label="${COPY.vet.call} ${phone?.[1]}" data-ws-action="vet-call">${COPY.vet.call}</a>`);
    const href = naverMapSearchUrl('병원 vc-1 서울 마포구 vc-1로 1').replace(/&/g, '&amp;');
    expect(card).toContain(
      `<a class="ws-btn ws-btn--outline" href="${href}" target="_blank" rel="noopener noreferrer nofollow" data-ws-action="vet-route">${COPY.vet.directions}<span class="ws-visually-hidden"> ${COPY.a11y.newWindow}</span></a>`,
    );
    expect(card.match(/data-ws-action="vet-route"/g)).toHaveLength(1);
    expect(card).not.toMatch(/km|거리|진료 가능/);
    expect(card).not.toContain(COPY.vet.reportedBadge);
  });
  it('verifiedAt 없으면 배지 생략(제보됨 배지 0, D15)', () => {
    const page = html(list, '/vet/서울-강남구');
    expect(page).not.toContain(COPY.vet.verifiedBadge);
    expect(page).not.toContain(COPY.vet.reportedBadge);
  });
  it('조건 줄: 라벨 p#ws-vet-filters-label + group[aria-labelledby], 진료 동물·야간·응급 chip(aria-pressed=false)', () => {
    const page = html(list, '/vet');
    expect(page).toContain(`<p class="ws-vet-row-label" id="ws-vet-filters-label">${COPY.vet.filtersTitle}</p>`);
    expect(page).toContain('<div class="ws-vet-filters" role="group" aria-labelledby="ws-vet-filters-label">');
    // R4-6: 진료 동물 칩 = 「{동물} 진료」(시안 「✓ 골든햄스터 진료」 — ✓ 는 선택 시 CSS).
    expect(page).toContain('<button type="button" class="ws-filter-chip" aria-pressed="false">골든햄스터 진료</button>');
    expect(page).toContain(`<button type="button" class="ws-filter-chip" aria-pressed="false">${COPY.vet.night}</button>`);
    expect(page).toContain(`<button type="button" class="ws-filter-chip" aria-pressed="false">${COPY.vet.emergency}</button>`);
  });
  it('지역 칩: 전체 + 지역, 현재 aria-current, 지역 페이지 제목 템플릿', () => {
    const all = html(list, '/vet');
    expect(all).toContain(`<li><a href="/vet" aria-current="page">${COPY.vet.all}</a></li>`);
    const mapo = html(list, '/vet/서울-마포구');
    expect(mapo).toContain(`<li><a href="/vet">${COPY.vet.all}</a></li>`);
    expect(mapo).toContain(`href="/vet/${encodeURIComponent('서울-마포구')}" aria-current="page">서울 마포구</a>`);
    expect(mapo).toContain('<h1>서울 마포구 · 우리 동네 병원</h1>');
    expect(mapo).toContain(COPY.vet.visitNote);
  });
  it('R4-6: 제목 바로 다음 = 방문 안내 한 줄(시안 원문), 그다음 「지역 선택」 줄 — 병원 목록보다 앞', () => {
    expect(COPY.vet.visitNote).toBe('방문 전 진료 여부를 병원에 문의해 주세요.');
    expect(COPY.vet.regionsTitle).toBe('지역 선택');
    const page = html(list, '/vet');
    expect(page).toContain(`</h1>\n<p class="ws-vet-note">${COPY.vet.visitNote}</p>`);
    expect(page.indexOf('ws-vet-note')).toBeLessThan(page.indexOf('ws-vet-row--regions'));
    expect(page.indexOf('ws-vet-row--regions')).toBeLessThan(page.indexOf('<ul class="ws-vets">'));
    expect(page.match(/class="ws-vet-note"/g)).toHaveLength(1);
    expect(page).not.toContain('ws-state--empty');
  });
  it('R4-6: 병원 0 → 상태 머리 h2 「확인된 병원이 아직 없어요」 + emptyAll, 허구 병원·지도·필터·지역 0', () => {
    const s0 = promoted();
    s0.vetClinics = [];
    const page = html(build(s0), '/vet');
    const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
    expect(main).toContain(
      `<div class="ws-state ws-state--empty" data-ws-state-kind="empty"><h2 class="ws-state-title">${COPY.vet.emptyTitle}</h2><p class="ws-state-body">${COPY.vet.emptyAll}</p></div>`,
    );
    expect(COPY.vet.emptyTitle).toBe('확인된 병원이 아직 없어요');
    for (const x of ['ws-vets', 'ws-vet-map', 'ws-vet-filters', 'ws-region-chips', 'vetClinics#', 'ws-vet-row']) expect(main).not.toContain(x);
    expect(main).toContain(COPY.vet.visitNote);
  });
});

describe('G-6 프리렌더 정합', () => {
  const b = build(promoted());
  it('ProductCard(L4 후보 영역): ♡ span 은 링크의 형제(a 안 0), 숫자 0', () => {
    const page = html(b, '/hamster/golden/supplies/wheel');
    const li = page.slice(page.indexOf('<li class="ws-product"'), page.indexOf('</li>', page.indexOf('<li class="ws-product"')));
    expect(li).toMatch(/<\/a>\n<span class="ws-like" aria-hidden="true"><span class="ws-like-glyph" aria-hidden="true">♡<\/span><\/span>\n?$/);
    const a = li.slice(li.indexOf('<a '), li.indexOf('</a>'));
    expect(a).not.toContain('ws-like');
  });
  it('L7 추천 이유 = 템플릿(SPEC_MET·OK → "{동물} 권장 규격 충족", PROFILE_MATCH → "{용품} 요구사항과 일치"), 용품 기준 링크', () => {
    const page = html(b, '/hamster/golden/products/cp-001');
    const aside = page.slice(page.indexOf('<aside'), page.indexOf('</aside>'));
    const reasons = [...aside.matchAll(/<ul class="ws-reasons">(.*?)<\/ul>/g)][0][1];
    const items = [...reasons.matchAll(/<\/span>([^<]+)<\/li>/g)].map((m) => m[1]);
    expect(items.length).toBeGreaterThan(0);
    for (const t of items) expect(['골든햄스터 권장 규격 충족', '골든햄스터 최소 규격 충족', '쳇바퀴 요구사항과 일치']).toContain(t);
    expect(aside).toContain(`href="/hamster/golden/supplies/wheel">쳇바퀴 기준 보기 ›</a>`);
    expect(aside).not.toMatch(/구매|최저가|원\b/);
  });
  it('L7 BELOW_RECOMMENDED 상품 → "{동물} 최소 규격 충족"', () => {
    const s = promoted();
    const cp = s.curatedProducts.find((p) => p.id === 'cp-001')!;
    patch(s, 'curatedProducts', 'cp-001', { specValues: { ...cp.specValues, diameterCm: 28 } });
    const page = html(build(s), '/hamster/golden/products/cp-001');
    expect(page).toContain('골든햄스터 최소 규격 충족');
    expect(page).not.toContain('골든햄스터 권장 규격 충족');
  });
  it('/supplies: 노출 항목 있는 카테고리만, SupplyRow = 글리프(aria-hidden) + 이름 + ›', () => {
    const page = html(b, '/supplies');
    const cats = [...page.matchAll(/data-ws-category="([A-Z_]+)"/g)].map((m) => m[1]);
    expect(cats).toEqual(['CAGE', 'WHEEL']);
    expect(page).toContain(
      '<a class="ws-supply-row" href="/supplies/wheel"><span class="ws-supply-glyph" aria-hidden="true">🎡</span><span class="ws-supply-name">쳇바퀴</span><span class="ws-supply-chevron" aria-hidden="true">›</span></a>',
    );
    expect(page).not.toMatch(/curatedProducts#|ws-product/);
  });
  it('/setup: 항목 행에 priority meta', () => {
    const page = html(b, '/hamster/golden/setup');
    expect(page).toMatch(/<a href="\/hamster\/golden\/supplies\/cage">케이지<span class="ws-row-priority">(필수|권장|선택)<\/span><span class="ws-row-chevron" aria-hidden="true">›<\/span><\/a>/);
  });
  it('/setup: 번들 note 가 있으면 p.ws-bundle-note 로 렌더(메모리 변형), 없으면 0', () => {
    const s = promoted();
    patch(s, 'setupBundles', 'sb-syrian-budget', { note: '픽스처 번들 메모' });
    expect(html(build(s), '/hamster/golden/setup')).toContain('<p class="ws-bundle-note">픽스처 번들 메모</p>');
    patch(s, 'setupBundles', 'sb-syrian-budget', { note: undefined });
    expect(html(build(s), '/hamster/golden/setup')).not.toContain('ws-bundle-note');
  });
});

// 병원 시드 행(테스트 픽스처 — 좌표는 항상 null).
function vet(id: string, over: Partial<VetClinicSeedRec> = {}): VetClinicSeedRec {
  return {
    id,
    name: `병원 ${id}`,
    region: '서울 마포구',
    treats: ['hamster-golden'],
    night: null,
    emergency: null,
    phone: '02-111-2222',
    address: `서울 마포구 ${id}로 1`,
    lat: null,
    lng: null,
    verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-28', note: 'ops-note-hidden' },
    ...over,
  };
}

describe('PublicRequirement.requirementId(R5 계약 확장)', () => {
  const b = build(promoted());
  it('타입·레이어·SUPPLY_ITEM_TYPE ws-data 요구사항마다 노출 requirement id, 프리렌더 data-ws-id 와 같다', () => {
    const ids = data(b, '/hamster/golden').data.requirements.map((r) => [r.requirementId, r.supplyItemId]);
    expect(ids).toEqual([
      ['req-syrian-cage', 'cage'],
      ['req-syrian-wheel', 'wheel'],
    ]);
    for (const p of ['/hamster/golden/supplies/wheel', '/hamster/golden/check/wheel', '/supplies/wheel/hamster-golden']) {
      const d = data(b, p).data.requirements.find((r) => r.supplyItemId === 'wheel');
      expect(d?.requirementId, p).toBe('req-syrian-wheel');
      expect(html(b, p), p).toContain('data-ws-id="supplyRequirements#req-syrian-wheel"');
    }
  });
  it('키는 첫 자리, 비노출 요구사항 id 는 어떤 ws-data 에도 없다', () => {
    const r = data(b, '/hamster/golden').data.requirements[0];
    expect(Object.keys(r)[0]).toBe('requirementId');
    const all = b.pages.map((p) => JSON.stringify(p.data)).join('\n');
    expect(all).not.toContain('req-syrian-bedding');
  });
});

// U2b(Kenny D1 2026-11-14): 헤더 칩 = CTA 자리. 미선택 「친구 선택하기」 채운 버튼, 선택 = 이름만(R4 시안 — 아바타·▾ 없음, DR-4 NIT-1 대체).
describe("renderHeader 칩·크기 확인(U2b)", () => {
  const t = { id: "hamster-golden", slug: "hamster/golden", displayName: "골든햄스터" };
  it("선택: 이름만(아바타·▾ 0), 미선택: ws-btn--fill 「친구 선택하기」", () => {
    const sel = renderHeader(t, null);
    expect(sel).toContain('<a data-ws-chip class="ws-chip ws-chip--selected" href="/pick"><span class="ws-chip-name">골든햄스터</span></a>');
    expect(sel).not.toMatch(/ws-avatar|ws-chip-caret|<img/);
    expect(renderHeader(null, null)).toContain(`<a data-ws-chip class="ws-chip ws-btn ws-btn--fill" href="/pick"><span class="ws-chip-name">${COPY.nav.chooseFriend}</span></a>`);
  });
  it("크기 확인: 미선택 /pick · ws-data specCheckItemId → 규격 필드 첫 요구사항 → 타입 홈", () => {
    const spec = (h: string) => /<a data-ws-nav="spec-check" href="([^"]*)">/.exec(h)?.[1];
    expect(spec(renderHeader(null, null))).toBe("/pick");
    expect(spec(renderHeader(t, null))).toBe("/hamster/golden");
    const data = { types: [{ id: t.id, specCheckItemId: "wheel" }], requirements: [] } as unknown as Parameters<typeof renderHeader>[2];
    expect(spec(renderHeader(t, null, data))).toBe("/hamster/golden/check/wheel");
    const req = (id: string, fields: number) => ({ animalTypeId: t.id, supplyItemId: id, item: { specSchema: { fields: Array.from({ length: fields }, () => ({})) } } });
    const data2 = { types: [{ id: t.id }], requirements: [req("bowl", 0), req("cage", 2)] } as unknown as Parameters<typeof renderHeader>[2];
    expect(spec(renderHeader(t, null, data2))).toBe("/hamster/golden/check/cage");
  });
});

describe('홈 ws-data types[].specCheckItemId(R6 G3b)', () => {
  const HOME_PATHS = ['/', '/pick', '/save'];
  it('승격 픽스처: HOME·PICK·SAVE 의 골든 타입에 규격 필드가 있는 첫 노출 요구사항 id, 요구사항은 싣지 않는다', () => {
    const b = build(promoted());
    const typeReqs = data(b, '/hamster/golden').data.requirements;
    const expected = typeReqs.find((r) => r.item.specSchema.fields.length > 0)?.supplyItemId;
    expect(expected).toBe('cage');
    for (const p of HOME_PATHS) {
      const d = data(b, p).data;
      expect(d.types.map((t) => [t.id, t.specCheckItemId]), p).toEqual([['hamster-golden', expected]]);
      expect(d.requirements, p).toEqual([]);
      expect(Object.keys(d)).toEqual([...WS_DATA_KEYS]);
    }
    // 딥링크 대상 라우트가 실재(L5).
    expect(b.pages.some((x) => x.route.path === `/hamster/golden/check/${expected}`)).toBe(true);
  });
  it('홈 외 페이지 types 에는 키 없음', () => {
    const b = build(promoted());
    for (const p of b.pages.filter((x) => !HOME_PATHS.includes(x.route.path))) {
      for (const t of p.data.data.types) expect(Object.prototype.hasOwnProperty.call(t, 'specCheckItemId'), p.route.path).toBe(false);
    }
  });
  it('규격 필드가 있는 노출 요구사항이 0이면 키 없음(fail-closed)', () => {
    const s = promoted();
    for (const it of s.supplyItems) (it as { specSchema: unknown }).specSchema = { fields: [] };
    const b = build(s);
    for (const p of HOME_PATHS) for (const t of data(b, p).data.types) expect('specCheckItemId' in t, p).toBe(false);
  });
  it('노출 0 시드(서명 전 기준 실시드, 메모리): 노출 타입 0 → 홈 types 비어 있음, 산출물 어디에도 specCheckItemId 없음', () => {
    const b = build(unsignedRealSeed());
    for (const p of HOME_PATHS) expect(data(b, p).data.types, p).toEqual([]);
    expect(JSON.stringify(b.pages.map((x) => x.data))).not.toContain('specCheckItemId');
  });
  it('디스크 실시드(2026-11-16 서명 + 2026-11-23 9종 활성화): 홈 types = 9타입 · 소동물 cage · 앵무 4종 bird-cage(종 간 품목 혼입 없음)', () => {
    const b = build(realSeed());
    for (const p of HOME_PATHS) {
      expect(data(b, p).data.types.map((t) => [t.id, t.specCheckItemId]), p).toEqual([
        ['hamster-golden', 'cage'], ['hamster-dwarf', 'cage'], ['gerbil-mongolian', 'cage'], ['guinea-pig', 'cage'],
        ['budgie', 'bird-cage'], ['cockatiel', 'bird-cage'], ['lovebird-peach', 'bird-cage'], ['sun-conure', 'bird-cage'],
        ['hamster-robo', 'cage'],
      ]);
    }
  });
});

describe('홈 ws-data types[].setupAvailable(286 U3b — 시작 카드 「구성안」)', () => {
  const HOME_PATHS = ['/', '/pick', '/save'];
  it('승격 픽스처: 노출 구성안이 있는 타입 = true, 그 타입의 /setup 라우트 실재 · 홈 외 페이지 types 에는 키 없음', () => {
    const b = build(promoted());
    for (const p of HOME_PATHS) {
      const d = data(b, p).data;
      for (const t of d.types) {
        const hasRoute = b.pages.some((x) => x.route.path === `/${t.slug}/setup`);
        expect(t.setupAvailable === true, `${p} ${t.id}`).toBe(hasRoute);
      }
      expect(d.types.some((t) => t.setupAvailable === true), p).toBe(true);
      expect(d.bundles, p).toEqual([]);
    }
    for (const p of b.pages.filter((x) => !HOME_PATHS.includes(x.route.path))) {
      for (const t of p.data.data.types) expect('setupAvailable' in t, p.route.path).toBe(false);
    }
  });
  it('구성안 0 → 키 없음 · /setup 없음 · 홈 「구성안」 카드 없음(fail-closed)', () => {
    const s = promoted();
    s.setupBundles.length = 0;
    const b = build(s);
    for (const p of HOME_PATHS) for (const t of data(b, p).data.types) expect('setupAvailable' in t, p).toBe(false);
    expect(b.pages.some((x) => x.route.kind === 'SETUP')).toBe(false);
    const home = b.pages.find((x) => x.route.path === '/')!.html;
    expect(home).toContain('data-ws-intent="CHECKLIST"');
    expect(home).not.toContain('data-ws-intent="SETUP"');
  });
  it('노출 0 시드(서명 전 기준 실시드, 메모리): 노출 타입 0 → 키 없음 · 홈에 시작 카드 섹션 없음(D12 ①)', () => {
    const b = build(unsignedRealSeed());
    expect(JSON.stringify(b.pages.map((x) => x.data))).not.toContain('setupAvailable');
    for (const p of HOME_PATHS) expect(b.pages.find((x) => x.route.path === p)!.html, p).not.toContain('data-ws-section="starters"');
  });
  it('디스크 실시드(2026-11-16 서명 + 2026-11-23 활성화): 골든 구성안 3종은 패킷 밖(DRAFT) → 골든 키 없음 · 드워프 구성안 3종 VERIFIED → 드워프만 setupAvailable true(/setup 실재) · 기니피그 구성안 0 → 키 없음 · 시작 카드 섹션 있음', () => {
    const b = build(realSeed());
    expect(realSeed().setupBundles.filter((x) => x.careProfileId === 'cp-hamster-syrian').map((x) => x.reviewStatus)).toEqual(['DRAFT', 'DRAFT', 'DRAFT']);
    for (const p of HOME_PATHS) {
      const types = data(b, p).data.types;
      expect(types.filter((t) => t.setupAvailable === true).map((t) => t.id), p).toEqual(['hamster-dwarf']);
      for (const t of types) expect([p, t.id, t.setupAvailable === true]).toEqual([p, t.id, b.pages.some((x) => x.route.path === `/${t.slug}/setup`)]);
      expect(b.pages.find((x) => x.route.path === p)!.html, p).toContain('data-ws-section="starters"');
    }
    for (const p of b.pages.filter((x) => !HOME_PATHS.includes(x.route.path))) {
      for (const t of p.data.data.types) expect('setupAvailable' in t, p.route.path).toBe(false);
    }
  });
});
