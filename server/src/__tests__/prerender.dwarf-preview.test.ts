// R7-B B7 — 드워프 미리보기(메모리에서만 확인표 서명(가짜 결과)·hamster-dwarf ACTIVE, 디스크는 DRAFT·PLANNED) 프리렌더 경로·내용 스냅샷.
//   게이트 G(첫 노출) 전 화면·감사 검증용. 기준일 DWARF_PREVIEW_AS_OF 고정(실시계 0, F14).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog, createEngine, type Reason } from '../engine/index.js';
import { buildSite, type BuiltPage, type SiteBuild } from '../prerender/site.js';
import { WS_DATA_MAX_BYTES } from '../prerender/cli.js';
import { projectSite } from '../prerender/project.js';
import { DWARF_PREVIEW_AS_OF, dwarfPreview, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const D = 'hamster-dwarf';
const build = (): SiteBuild =>
  buildSite(dwarfPreview(), { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: DWARF_PREVIEW_AS_OF });
const pageAt = (b: SiteBuild, path: string): BuiltPage => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`페이지 없음: ${path}`);
  return p;
};
const ruleIds = (rs: Reason[]) => rs.map((r) => r.ruleId);

/** 노출 요구사항(순서 = orderHint → priority → 시드 순). 저울(HEALTH)은 DRAFT 라 없다.
 *  BE92: 미리보기(전 ☑·C·D1)는 SupplyItem food 도 C 일괄(90 Q1)로 서명돼 사료(FOOD)가 노출된다. */
const REQ_ORDER = ['cage', 'wheel', 'bedding', 'water', 'food', 'hideout', 'sand-bath', 'sand-bath-box', 'food-bowl', 'thermo', 'chew', 'carrier', 'tubes', 'saucer'];
const ITEMS_SEED_ORDER = ['cage', 'wheel', 'saucer', 'bedding', 'water', 'food-bowl', 'food', 'hideout', 'sand-bath', 'sand-bath-box', 'chew', 'carrier', 'thermo', 'tubes'];
/** 상품 L7 순서 = 요구사항 순 → verdict OK 먼저(cp-dw-005 BELOW_RECOMMENDED 뒤) → 시드 순. */
const PRODUCT_ORDER = ['001', '002', '003', '004', '006', '007', '008', '005', '010', '011', '012', '013', '014', '015'].map((n) => `cp-dw-${n}`);

describe('디스크 시드 — 2026-11-23 활성화로 드워프 실노출', () => {
  it('projectSite(실시드, 2026-11-16 서명 + 2026-11-23 활성화) 타입 = 골든·드워프·기니피그 — 드워프 VERIFIED·ACTIVE', () => {
    const at = realSeed().animalTypes.find((t) => t.id === D);
    expect([at?.status, at?.reviewStatus]).toEqual(['ACTIVE', 'VERIFIED']);
    expect(projectSite(realSeed(), DWARF_PREVIEW_AS_OF).types.map((t) => t.id)).toEqual(['hamster-golden', 'hamster-dwarf', 'guinea-pig']);
  });
});

describe('드워프 미리보기 — 경로 스냅샷', () => {
  const b = build();

  it('노출 타입 = 드워프 1, 골든 0', () => {
    expect(b.model.types.map((t) => t.id)).toEqual([D]);
  });

  it('경로 집합(홈 A · /hamster · /hamster/dwarf · setup · L4/L5 × 14 · L7 × 14 · /supplies × 14 × 2 · 고정 6)', () => {
    expect(b.routes.map((r) => r.path)).toEqual([
      '/',
      '/hamster',
      '/hamster/dwarf',
      '/hamster/dwarf/setup',
      ...REQ_ORDER.flatMap((i) => [`/hamster/dwarf/supplies/${i}`, `/hamster/dwarf/check/${i}`]),
      ...PRODUCT_ORDER.map((p) => `/hamster/dwarf/products/${p}`),
      '/supplies',
      ...ITEMS_SEED_ORDER.flatMap((i) => [`/supplies/${i}`, `/supplies/${i}/${D}`]),
      '/vet',
      '/save',
      '/pick',
      '/credits',
      '/privacy',
      '/404',
    ]);
  });

  it('골든·저울 경로 0, 사료 경로는 있음(BE92)', () => {
    const paths = b.routes.map((r) => r.path);
    expect(paths.filter((p) => /golden|\/scale(\/|$)/.test(p))).toEqual([]);
    expect(paths.filter((p) => /\/food(\/|$)/.test(p))).toEqual(['/hamster/dwarf/supplies/food', '/hamster/dwarf/check/food', '/supplies/food', `/supplies/food/${D}`]);
  });

  it('홈 A: ws-data 타입 = 드워프 1(피커 카드는 /pick 정적 본문), /hamster: 드워프 카드만', () => {
    const home = pageAt(b, '/');
    expect(home.data.data.types.map((t) => t.id)).toEqual([D]);
    expect(home.html).not.toContain('hamster-golden');
    expect(pageAt(b, '/pick').html).toContain(`<a class="ws-type-card" href="/hamster/dwarf" data-ws-id="animalTypes#${D}"`);
    const fam = pageAt(b, '/hamster').html;
    const hrefs = [...fam.matchAll(/<a class="ws-type-card" href="([^"]+)"/g)].map((x) => x[1]);
    expect(hrefs).toEqual(['/hamster/dwarf']);
  });

  it('/hamster/dwarf(L2 체크리스트 입력): 요구사항 14 순서·우선순위, 번들 3(사료 포함), 상품 14', () => {
    const d = pageAt(b, '/hamster/dwarf').data.data;
    expect(d.requirements.map((r) => r.supplyItemId)).toEqual(REQ_ORDER);
    expect(d.requirements.filter((r) => r.priority === 'REQUIRED').map((r) => r.supplyItemId)).toEqual(['cage', 'wheel', 'bedding', 'water', 'food', 'hideout', 'sand-bath', 'sand-bath-box']);
    expect(d.bundles.map((x) => x.id)).toEqual(['sb-dwarf-budget', 'sb-dwarf-balanced', 'sb-dwarf-reuse']);
    expect(d.bundles.every((x) => x.itemIds.includes('food'))).toBe(true);
    expect(d.bundles.every((x) => x.estimatedRangeText === null)).toBe(true);
    expect(d.products.map((p) => p.id)).toEqual(PRODUCT_ORDER);
  });

  it('L4 cage: 최소 규격 4개(철망 간격 9mm 는 "형태 철망일 때" 조건부) + 권장(철망 제외 · 철망일 때 간격 6mm — 2026-10-25 권장으로 강등)', () => {
    const html = pageAt(b, '/hamster/dwarf/supplies/cage').html;
    expect(html).toContain('바닥 가로 100cm 이상');
    expect(html).toContain('형태 철망일 때 — 철망 간격 6mm 이하');
    expect(html).toContain('형태 철망 제외');
  });

  it('L4 모래 2행: /supplies/sand-bath = 목욕 모래, /supplies/sand-bath-box = 모래 목욕통', () => {
    expect(pageAt(b, '/hamster/dwarf/supplies/sand-bath').html).toContain('목욕 모래');
    expect(pageAt(b, '/hamster/dwarf/supplies/sand-bath-box').html).toContain('짧은 변');
  });

  it('L6 내 케이지 판정(공개 카탈로그 → 클라와 같은 createEngine 경로)', () => {
    const c = b.catalog;
    const eng = createEngine(createCatalog({ animalTypes: c.animalTypes, careProfiles: c.careProfiles, supplyItems: c.supplyItems, supplyRequirements: c.supplyRequirements, compatibilityRules: c.compatibilityRules }));
    const base = { floorWcm: 100, floorDcm: 50, heightCm: 50 };
    expect(eng.specCheck(D, 'cage', { type: 'WIRE', ...base, barGapMm: 9.5 }).verdict).toBe('BELOW_MIN'); // 최소 9mm 이하(BE92 Q2), 6mm 는 권장
    expect(eng.specCheck(D, 'cage', { type: 'WIRE', ...base, barGapMm: 9 }).verdict).toBe('BELOW_RECOMMENDED');
    expect(eng.specCheck(D, 'cage', { type: 'OTHER', ...base }).verdict).toBe('OK');
    expect(eng.specCheck(D, 'cage', { type: 'WIRE', ...base }).verdict).toBe('CHECK');
    const ctx = (h: number) => ({ ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50, heightCm: h } } });
    expect(eng.requirementCompat(D, 'wheel', ctx(50)).verdict).toBe('OK');
    const low = eng.requirementCompat(D, 'wheel', ctx(41));
    expect(low.verdict).toBe('CHECK');
    expect(ruleIds(low.reasons)).toEqual(['cr-dwarf-wheel-cage-bedding#0']);
    // DRAFT 공용 규칙(cr-wheel-cage·cr-water-cage)은 공개 카탈로그에 없다.
    expect(c.compatibilityRules.map((r) => r.id)).toEqual(['cr-dwarf-wheel-cage-bedding', 'cr-dwarf-tubes-cage']);
  });

  it('공개 카탈로그: 용품 14(저울 제외), 요구사항 14, verifiedBy 0', () => {
    expect(b.catalog.supplyItems.map((i) => i.id)).toEqual(ITEMS_SEED_ORDER);
    expect(b.catalog.supplyRequirements).toHaveLength(14);
  });

  it('모든 산출물: kenny·저울 DRAFT 문장·Taxon id·법 문구·골든 0(드워프 사료 문장 속 비교 언급 제외), Phodopus 는 VERIFIED 행의 출처 인용에만', () => {
    const files = [...b.files.entries()];
    // BE92: 사료가 노출되면 드워프 사료 문장(Kenny 확정, BE90)이 골든햄스터용 사료를 비교로 언급한다 — 그 두 구절만 빼고 센다.
    const all = files.map(([, c]) => c).join('\n').split('골든햄스터용이 아닌').join('').split('고지방 골든햄스터용 사료').join('');
    // 보안 79 H-1: 검수 방식·서명 메타(reviewBasis·ROW_CHECKED·AI_RESEARCH_BULK·factHash·review-signatures)도 0 — 서명된 미리보기(dwarfSigned) 기준.
    for (const w of ['kenny', 'req-dwarf-scale', '주방 저울', 'phodopus-', '시행규칙', '야생생물법', 'mesocricetus', 'hamster-golden', '골든햄스터', 'reviewBasis', 'ROW_CHECKED', 'AI_RESEARCH_BULK', 'factHash', 'review-signatures']) {
      expect(all.split(w).length - 1, w).toBe(0);
    }
    for (const [f, c] of files) {
      const stripped = c.replace(/https:\/\/animaldiversity\.org\/accounts\/Phodopus_campbelli\/|Animal Diversity Web — Phodopus campbelli|Handbook of the Mammals of the World Vol\.7 — Phodopus sungorus \(Zenodo 사본\)/g, '');
      expect(stripped, f).not.toContain('Phodopus');
    }
  });

  it('sitemap: 드워프 경로 lastmod 2026-10-24, 골든 0', () => {
    const sm = b.files.get('sitemap.xml') ?? '';
    expect(sm).toContain('<loc>http://localhost:3001/hamster/dwarf</loc><lastmod>2026-10-24</lastmod>');
    expect(sm).not.toContain('golden');
  });

  // R7-B 발견(v1 ws-data 33.9~34.0KB, 44쪽 > 32KB) → 계획 73 ws-data 와이어 v2(engine/ws-wire: searchLinks 제거 + 출처 표)로 해소.
  //   wsDataBytes = HTML 에 실린 와이어 바이트. 상한(cli.ts WS_DATA_MAX_BYTES 32KB)은 그대로, 여유 목표 = 최대 < 24KB.
  it('ws-data 상한 — 와이어 v2 기준 초과 페이지 0, 최대 < 28KB(경고선)', () => {
    const over = b.pages.filter((p) => p.wsDataBytes > WS_DATA_MAX_BYTES).map((p) => p.route.path);
    expect(over).toEqual([]);
    // BE92: 사료 요구사항이 모든 드워프 페이지 ws-data 에 실려 최대 약 24.7KB → 여유 목표 24KB → 26KB.
    // 기니피그 S3(decisions 2026-10-27 'S2 크기 실측 수용', 오케스트레이터): 스키마 확장 +약 1.2KB → 단언을 경고선 28KB(28,672B)로. 상한 32KB 불변.
    expect(Math.max(...b.pages.map((p) => p.wsDataBytes))).toBeLessThan(28 * 1024);
  });
});
