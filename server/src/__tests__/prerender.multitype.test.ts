// 다동물 감사 54 M1 — 2타입 프리렌더(서버). 골든 + 합성 두 번째 타입(promotedTwo, 메모리 전용 — 디스크 시드 불변).
//   검사: 그룹 페이지·/supplies/{item} 링크, 타입별 ws-data 분리, 상품 careProfileIds 범위, 번들 범위, sitemap.
//   호환 규칙 카탈로그 범위(project.ts projectCatalog, M4) — ⑦.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { buildSite, type BuiltPage, type SiteBuild } from '../prerender/site.js';
import { FIXTURE_AS_OF, SECOND, V, promotedTwo, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const ORIGIN = 'http://localhost:3001';
const A = 'hamster-golden';
const B = SECOND.typeId;

const build = (seed: SeedBundle): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: ORIGIN, seedDigest: 'a'.repeat(64), indexable: true, asOf: FIXTURE_AS_OF });

type Row = Record<string, unknown>;
interface WsDoc {
  route: Row;
  data: Record<string, Row[]>;
}
function wsDataOf(html: string): WsDoc {
  const m = /<script id="ws-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('ws-data 없음');
  return JSON.parse(m[1]) as WsDoc;
}
const pageAt = (b: SiteBuild, path: string): BuiltPage => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`페이지 없음: ${path}`);
  return p;
};
const typePages = (b: SiteBuild, typeId: string): BuiltPage[] => b.pages.filter((p) => p.route.typeId === typeId);

describe('promotedTwo 픽스처 — 2타입 모델', () => {
  const seed = promotedTwo();
  const b = build(seed);

  it('두 타입 모두 노출되고 각자 프로필을 쓴다', () => {
    expect(b.model.types.map((t) => [t.id, t.rec.careProfileId])).toEqual([
      [A, 'cp-hamster-syrian'],
      [B, SECOND.careProfileId],
    ]);
    // 실제 PLANNED 행은 승격하지 않았다.
    expect(b.model.types.some((t) => t.id === 'hamster-dwarf')).toBe(false);
  });

  it('① /hamster 그룹 페이지가 두 타입을 링크한다', () => {
    const fam = pageAt(b, '/hamster');
    expect(fam.route.kind).toBe('FAMILY');
    expect(fam.html).toContain('href="/hamster/golden"');
    expect(fam.html).toContain(`href="/${SECOND.slug}"`);
    expect(fam.html).toContain(`data-ws-id="animalTypes#${A}"`);
    expect(fam.html).toContain(`data-ws-id="animalTypes#${B}"`);
  });

  it('② /supplies/cage 가 두 타입을 링크하고, /supplies/cage/{type} 2개는 비색인 + canonical=타입 레이어', () => {
    const it0 = pageAt(b, '/supplies/cage');
    expect(it0.html).toContain(`href="/supplies/cage/${A}"`);
    expect(it0.html).toContain(`href="/supplies/cage/${B}"`);
    const slugOf: Record<string, string> = { [A]: 'hamster/golden', [B]: SECOND.slug };
    const sm = b.files.get('sitemap.xml') as string;
    for (const id of [A, B]) {
      const p = pageAt(b, `/supplies/cage/${id}`);
      expect(p.route.kind).toBe('SUPPLY_ITEM_TYPE');
      expect(p.route.indexable).toBe(false);
      expect(p.route.canonicalPath).toBe(`/${slugOf[id]}/supplies/cage`);
      expect(p.html).toContain(`<link rel="canonical" href="${ORIGIN}/${slugOf[id]}/supplies/cage">`);
      // D11: canonical 이 다른 비색인 라우트는 noindex 대신 canonical 로 신호(기존 prerender.site 테스트와 같은 규칙).
      expect(p.html).not.toContain('<meta name="robots" content="noindex">');
      expect(sm).not.toContain(`/supplies/cage/${id}<`);
      expect(wsDataOf(p.html).data.requirements.map((r) => r.animalTypeId)).toEqual([id]);
    }
  });

  it('③ 타입 B 문서의 ws-data requirements 는 B 것만(A 문서는 A 것만)', () => {
    const pb = typePages(b, B);
    const pa = typePages(b, A);
    expect(pb.length).toBeGreaterThan(0);
    expect(pa.length).toBeGreaterThan(0);
    for (const p of pb) {
      const reqs = wsDataOf(p.html).data.requirements;
      expect(reqs.every((r) => r.animalTypeId === B), p.route.path).toBe(true);
      expect(p.html).not.toMatch(/data-ws-id="supplyRequirements#req-syrian-/);
    }
    const bType = wsDataOf(pageAt(b, `/${SECOND.slug}`).html);
    expect(bType.data.requirements.map((r) => r.requirementId).sort()).toEqual([...SECOND.requirementIds].sort());
    for (const p of pa) {
      expect(wsDataOf(p.html).data.requirements.every((r) => r.animalTypeId === A), p.route.path).toBe(true);
    }
  });

  it('④ 상품은 careProfileIds 에 든 프로필의 타입에만', () => {
    const tA = b.model.types.find((t) => t.id === A);
    const tB = b.model.types.find((t) => t.id === B);
    expect(tA?.products.map((p) => p.id)).toEqual(['cp-001']);
    expect(tB?.products.map((p) => p.id)).toEqual([SECOND.productId]);
    expect(b.pages.some((p) => p.route.path === `/hamster/golden/products/${SECOND.productId}`)).toBe(false);
    expect(b.pages.some((p) => p.route.path === `/${SECOND.slug}/products/cp-001`)).toBe(false);
    for (const p of typePages(b, B)) {
      expect(wsDataOf(p.html).data.products.map((x) => x.id).includes('cp-001'), p.route.path).toBe(false);
      expect(p.html).not.toContain('curatedProducts#cp-001"');
    }
    for (const p of typePages(b, A)) {
      expect(wsDataOf(p.html).data.products.map((x) => x.id).includes(SECOND.productId), p.route.path).toBe(false);
      expect(p.html).not.toContain(`curatedProducts#${SECOND.productId}"`);
    }
  });

  it('⑤ A 번들은 B 페이지에 0(B 번들도 A 페이지에 0)', () => {
    for (const p of typePages(b, B)) {
      expect(wsDataOf(p.html).data.bundles.map((x) => x.id).includes('sb-syrian-budget'), p.route.path).toBe(false);
      expect(p.html).not.toContain('setupBundles#sb-syrian-budget"');
    }
    for (const p of typePages(b, A)) {
      expect(wsDataOf(p.html).data.bundles.map((x) => x.id).includes(SECOND.bundleId), p.route.path).toBe(false);
      expect(p.html).not.toContain(`setupBundles#${SECOND.bundleId}"`);
    }
    expect(wsDataOf(pageAt(b, `/${SECOND.slug}/setup`).html).data.bundles.map((x) => x.id)).toEqual([SECOND.bundleId]);
    expect(wsDataOf(pageAt(b, '/hamster/golden/setup').html).data.bundles.map((x) => x.id)).toEqual(['sb-syrian-budget']);
  });

  it('⑥ sitemap 에 두 타입 경로가 모두 있다', () => {
    const sm = b.files.get('sitemap.xml') as string;
    for (const path of [
      '/hamster',
      '/hamster/golden',
      '/hamster/golden/supplies/cage',
      '/hamster/golden/setup',
      `/${SECOND.slug}`,
      `/${SECOND.slug}/supplies/cage`,
      `/${SECOND.slug}/supplies/wheel`,
      `/${SECOND.slug}/check/cage`,
      `/${SECOND.slug}/setup`,
      `/${SECOND.slug}/products/${SECOND.productId}`,
    ]) {
      expect(sm, path).toContain(`<loc>${ORIGIN}${path}</loc>`);
    }
  });

  it('⑦ 호환 규칙 카탈로그(M4): 노출 프로필 범위·범위 없음만, 비노출(DRAFT)·미존재 프로필 범위 VERIFIED 규칙은 0', () => {
    const s = promotedTwo();
    const src = s.compatibilityRules.find((c) => c.id === 'cr-wheel-cage');
    if (!src) throw new Error('fixture: cr-wheel-cage 없음');
    Object.assign(src, { ...V });
    const scoped = (id: string, careProfileId: string) => ({ ...JSON.parse(JSON.stringify(src)), id, careProfileId, ...V });
    s.careProfiles.push({ ...JSON.parse(JSON.stringify(s.careProfiles[0])), id: 'cp-fixture-draft', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null });
    s.compatibilityRules.push(
      scoped('cr-scope-b', SECOND.careProfileId),
      scoped('cr-scope-draft', 'cp-fixture-draft'),
      scoped('cr-scope-ghost', 'cp-fixture-ghost'),
    );
    const built = build(s);
    expect(built.catalog.compatibilityRules.map((c) => [c.id, c.careProfileId])).toEqual([
      ['cr-wheel-cage', null],
      ['cr-scope-b', SECOND.careProfileId],
    ]);
    const file = built.files.get(built.catalogFile) as string;
    for (const hidden of ['cr-scope-draft', 'cr-scope-ghost', 'cp-fixture-draft', 'cp-fixture-ghost']) expect(file, hidden).not.toContain(hidden);
    // 모든 페이지 HTML 에도 숨은 규칙 id 0.
    for (const p of built.pages) {
      expect(p.html, p.route.path).not.toContain('cr-scope-draft');
      expect(p.html, p.route.path).not.toContain('cr-scope-ghost');
    }
  });

  it('디스크 시드는 그대로(두 번째 타입 행 없음)', () => {
    expect(seed.animalTypes.filter((t) => t.id === B)).toHaveLength(1);
    expect(promotedTwo()).toEqual(seed); // 결정론
  });
});

describe('G3 그룹 페이지 /hamster (56)', () => {
  const b = build(promotedTwo());
  const fam = pageAt(b, '/hamster');
  const cardOf = (html: string, id: string): string => {
    const m = new RegExp(`<li><a class="ws-type-card"[^>]*data-ws-id="animalTypes#${id}">.*?</a></li>`).exec(html);
    if (!m) throw new Error(`카드 없음: ${id}`);
    return m[0];
  };

  it('1) h1 그룹명 · 안내 · 카드 격자 · 56px 마스코트, 가운데점 결합·ul.ws-types 없음', () => {
    expect(fam.html).toContain('<h1>햄스터</h1>');
    expect(fam.html).toContain('class="ws-t-body ws-family-intro"');
    expect(fam.html).toContain('<ul class="ws-picker-grid ws-family-grid">');
    expect(fam.html).toContain('class="ws-avatar ws-avatar--type');
    // 마스코트 자산이 있는 빌드(opts.mascots)에서는 56px 이미지가 카드 안에 들어간다.
    const withMascot = buildSite(promotedTwo(), { template: TEMPLATE, origin: ORIGIN, seedDigest: 'a'.repeat(64), indexable: true, asOf: FIXTURE_AS_OF, mascots: new Map([['hamster-golden', '<svg/>']]) });
    expect(pageAt(withMascot, '/hamster').html).toContain('<img src="/mascots/hamster-golden.svg" width="56" height="56"');
    // ws-data(타입 oneLiner 의 ' · ' 는 사실 문구)는 제외 — 문서 마크업에서 타입명 결합이 없어야 한다.
    expect(fam.html.split('id="ws-data"')[0]).not.toContain(' · ');
    expect(fam.html).not.toContain('class="ws-types"');
    expect(fam.html).toContain('<title>햄스터');
  });

  it('2) PLANNED 드워프: 이름·별칭이 HTML·ws-data 에 0, 시드 행은 비검수(불변식 7)', () => {
    const row = realSeed().animalTypes.find((t) => t.id === 'hamster-dwarf');
    expect(row?.status).toBe('PLANNED');
    expect(row?.reviewStatus).not.toBe('VERIFIED');
    expect(row?.reviewerType).toBe('AI_DRAFT');
    const ws = JSON.stringify(wsDataOf(fam.html));
    for (const w of ['드워프', '정글리안', '윈터화이트', '캠벨', '드햄', 'hamster-dwarf', 'hamster/dwarf']) {
      expect(fam.html, w).not.toContain(w);
      expect(ws, w).not.toContain(w);
    }
  });

  it('3) 두 타입 = 카드 2개 시드 순, 브레드크럼 JSON-LD 에 그룹명 "햄스터"', () => {
    const hrefs = [...fam.html.matchAll(/<a class="ws-type-card" href="([^"]+)"/g)].map((x) => x[1]);
    expect(hrefs).toEqual(['/hamster/golden', `/${SECOND.slug}`]);
    const ld = [...fam.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => x[1]).join(' ');
    expect(ld).toContain('"name":"햄스터"');
    expect(ld).not.toContain(' · ');
    const typeLd = pageAt(b, '/hamster/golden').html;
    expect(typeLd).toContain('"name":"햄스터"');
  });

  it('4) 표시명 없는 그룹은 빌드 실패', () => {
    const s = promotedTwo();
    const t = s.animalTypes.find((x) => x.id === SECOND.typeId);
    if (!t) throw new Error('fixture');
    t.slug = 'rabbit/fixture';
    expect(() => build(s)).toThrow(/그룹 표시명 없음/);
  });

  it('5) typeCard 는 /pick 과 /hamster 에서 바이트 동일', () => {
    const pick = pageAt(b, '/pick').html;
    for (const id of [A, B]) expect(cardOf(fam.html, id)).toBe(cardOf(pick, id));
  });
});
