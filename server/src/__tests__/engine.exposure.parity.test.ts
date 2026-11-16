// M-1 패리티(R4 A1): 엔진(engine/domain.ts·exposure.ts → projectSite) ↔ 독립 재구현(scripts/lib/seed-exposure.mjs)
//   STALE_DAYS 상수·날짜 해석·stale 주입 결과가 같아야 한다. 고정 기준일만 쓴다(실시계 0).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PHOTO_USABLE_STATUSES, STALE_DAYS, isPhotoUsable, isoDayNumber, parseCcLicenseUrl, type SeedBundle } from '../engine/index.js';
import { SEED_FILES } from '../seed/common.js';
import { projectSite } from '../prerender/project.js';
import {
  DWARF_PREVIEW_AS_OF,
  FIXTURE_AS_OF,
  FIXTURE_FIRST_STALE,
  FIXTURE_LAST_FRESH,
  GOLDEN_TAXON_ID,
  SECOND,
  V,
  V_LEGAL,
  dwarfPreview,
  patch,
  promoted,
  promotedTwo,
} from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  STALE_DAYS: number;
  dayNumber: (v: unknown) => number | null;
  ccLicenseOfUrl: (v: unknown) => string | null;
  isPhotoUsableRow: (p: unknown) => boolean;
  PHOTO_USABLE_STATUSES: Set<string>;
  computeExposure: (seed: Record<string, unknown[]>, asOf: string) => { ids: Record<string, Set<string>> };
};

const rawOf = (seed: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]]));

/** 엔진 쪽 노출 집합(프리렌더 모델에서). */
function engineIds(seed: SeedBundle, asOf: string) {
  const m = projectSite(seed, asOf);
  return {
    animalTypes: m.types.map((t) => t.id).sort(),
    curatedProducts: [...new Set(m.types.flatMap((t) => t.requirements.flatMap((r) => r.products.map((p) => p.id))))].sort(),
    setupBundles: [...new Set(m.types.flatMap((t) => t.bundles.map((b) => b.id)))].sort(),
    supplyRequirements: m.types.flatMap((t) => t.requirements.map((r) => r.requirementId)).sort(),
    compatibilityRules: m.catalog.compatibilityRules.map((c) => c.id).sort(),
  };
}
function mjsIds(seed: SeedBundle, asOf: string) {
  const ex = mjs.computeExposure(rawOf(seed), asOf);
  const sorted = (k: string): string[] => [...ex.ids[k]].sort();
  return {
    animalTypes: sorted('animalTypes'),
    curatedProducts: sorted('curatedProducts'),
    setupBundles: sorted('setupBundles'),
    supplyRequirements: sorted('supplyRequirements'),
    compatibilityRules: sorted('compatibilityRules'),
  };
}

describe('STALE_DAYS · 날짜 해석 패리티', () => {
  it('scripts/lib/seed-exposure.mjs STALE_DAYS === engine STALE_DAYS === 180', () => {
    expect(mjs.STALE_DAYS).toBe(STALE_DAYS);
    expect(STALE_DAYS).toBe(180);
  });

  it('dayNumber(mjs) 와 isoDayNumber(engine) 이 같은 값·같은 거부', () => {
    const cases = [
      '2026-01-01', '2026-06-30', '2026-12-31', '2027-03-29', '2028-02-29', '2027-02-29', '2100-02-29', '2000-02-29',
      '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', '20260101', ' 2026-01-01', '2026-01-01T00:00',
      '0999-01-01', '', null, undefined, 20260101,
    ];
    for (const c of cases) expect(mjs.dayNumber(c), String(c)).toBe(isoDayNumber(c));
    expect(isoDayNumber('2026-06-30')! - isoDayNumber('2026-01-01')!).toBe(180);
  });
});

describe('CC 증서 URL 패리티(S1 M-3) — engine parseCcLicenseUrl ↔ mjs ccLicenseOfUrl', () => {
  it('같은 분류·같은 거부', () => {
    const cases = [
      'https://creativecommons.org/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by-sa/4.0/',
      'https://creativecommons.org/licenses/by/2.0/deed.ko',
      'https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hant',
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://creativecommons.org/licenses/by/4.0',
      'https://creativecommons.org/licenses/by-nc/4.0/',
      'http://creativecommons.org/licenses/by/4.0/',
      'https://CreativeCommons.org/licenses/by/4.0/',
      'https://creativecommons.org:443/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by/4.0/?a=1',
      'https://creativecommons.org/licenses/by/4.0/#x',
      'https://creativecommons.org@evil.example/licenses/by/4.0/',
      'https://evil.creativecommons.org/licenses/by/4.0/',
      'https://creativecommons.org.evil.example/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by/4.0/../../x/',
      'https://creativecommons.org/licenses/by/40/',
      '',
      null,
      42,
    ];
    for (const c of cases) expect(mjs.ccLicenseOfUrl(c), String(c)).toBe(parseCcLicenseUrl(c)?.license ?? null);
  });
});

describe('사진 사용 가능 패리티(S-R4 L-C·L-D·L-E) — engine isPhotoUsable ↔ mjs isPhotoUsableRow', () => {
  const base = {
    id: 'ph-x', scene: 's', slot: 'intro-1', query: 'q', source: 'WIKIMEDIA', license: 'CC_BY', author: 'A',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    downloadedAt: '2026-09-30', modified: false, status: 'READY',
  };
  const variants: Array<Record<string, unknown>> = [
    {},
    { status: 'SLOT' }, { status: 'ACTIVE' }, { status: 'ready' }, { status: undefined }, { status: '' }, { status: null },
    { downloadedAt: '2026-02-30' }, { downloadedAt: '2026/09/30' }, { downloadedAt: '2026-9-30' }, { downloadedAt: ' ' }, { downloadedAt: null }, { downloadedAt: '0999-01-01' },
    { sourceUrl: 'https://localhost/x.jpg' }, { sourceUrl: 'https://x' }, { sourceUrl: 'http://e.org/x' }, { sourceUrl: 'https://e.org' },
    { sourceUrl: 'https://e.org/a b' }, { sourceUrl: 'https://e.org?x=1' }, { sourceUrl: 'HTTPS://e.org/x' }, { sourceUrl: 'https:///e.org' },
    { licenseUrl: 'https://creativecommons.org/licenses/by/9.9/' }, { licenseUrl: 'https://creativecommons.org/licenses/by/2.5/' },
    { licenseUrl: 'https://creativecommons.org/licenses/by/1.0/' }, { licenseUrl: null },
    { license: 'CC0', author: null, licenseUrl: null }, { license: 'CC_BY_SA' }, { license: 'SITE_LICENSE', licenseUrl: null },
    { license: 'UNKNOWN' }, { author: ' ' }, { source: '' },
  ];
  it.each(variants.map((v) => [JSON.stringify(v), v] as const))('%s', (_n, v) => {
    const p = { ...base, ...v };
    expect(mjs.isPhotoUsableRow(p)).toBe(isPhotoUsable(p as never));
  });
  it('상태 허용목록 동일', () => {
    expect([...mjs.PHOTO_USABLE_STATUSES]).toEqual([...PHOTO_USABLE_STATUSES]);
  });
});

describe('stale 주입 — 엔진·독립 구현 결과 동일', () => {
  const dates = ['2026-09-29', FIXTURE_AS_OF, FIXTURE_LAST_FRESH, FIXTURE_FIRST_STALE, '2027-12-31'];
  it.each(dates)('기준일 %s', (asOf) => {
    const s = promoted();
    expect(engineIds(s, asOf)).toEqual(mjsIds(s, asOf));
  });

  const OLD = '2026-03-31'; // FIXTURE_AS_OF(2026-11-03) 기준 217일
  const links: Array<[keyof SeedBundle, string]> = [
    ['animalTypes', 'hamster-golden'],
    ['careProfiles', 'cp-hamster-syrian'],
    ['supplyItems', 'cage'],
    ['supplyItems', 'wheel'],
    ['supplyRequirements', 'req-syrian-cage'],
    ['supplyRequirements', 'req-syrian-wheel'],
    ['curatedProducts', 'cp-001'],
    ['setupBundles', 'sb-syrian-budget'],
  ];
  it.each(links)('%s#%s 만 오래됨', (key, id) => {
    const s = promoted();
    const before = engineIds(s, FIXTURE_AS_OF);
    patch(s, key, id, { verifiedAt: OLD });
    const after = engineIds(s, FIXTURE_AS_OF);
    expect(after).toEqual(mjsIds(s, FIXTURE_AS_OF));
    expect(after).not.toEqual(before); // 주입이 실제로 무언가를 숨겼다
  });

  // M4(감사 54 #5): 프로필 범위 호환 규칙 — 엔진 projectCatalog ↔ mjs computeExposure 같은 집합.
  it('프로필 범위 호환 규칙: 노출 프로필만 남고 비노출(DRAFT)·미존재 프로필 규칙은 양쪽 모두 0', () => {
    const s = promotedTwo();
    // BE92: 실시드 범위 없는 규칙(cr-wheel-cage) 삭제(85) → 골든 범위 규칙 복제 + 범위 제거 픽스처(cr-unscoped, 메모리).
    const base = s.compatibilityRules.find((c) => c.id === 'cr-syrian-wheel-cage-bedding');
    if (!base) throw new Error('fixture: cr-syrian-wheel-cage-bedding 없음');
    const src = { ...JSON.parse(JSON.stringify(base)), id: 'cr-unscoped', ...V } as typeof base;
    delete (src as { careProfileId?: string | null }).careProfileId;
    s.compatibilityRules.push(src);
    const scoped = (id: string, careProfileId: string) => ({ ...JSON.parse(JSON.stringify(src)), id, careProfileId, ...V });
    s.careProfiles.push({ ...JSON.parse(JSON.stringify(s.careProfiles[0])), id: 'cp-fixture-draft', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null });
    s.compatibilityRules.push(
      scoped('cr-scope-a', 'cp-hamster-syrian'),
      scoped('cr-scope-b', SECOND.careProfileId),
      scoped('cr-scope-draft', 'cp-fixture-draft'),
      scoped('cr-scope-ghost', 'cp-fixture-ghost'),
    );
    const want = ['cr-scope-a', 'cr-scope-b', 'cr-unscoped'];
    expect(engineIds(s, FIXTURE_AS_OF).compatibilityRules).toEqual(want);
    expect(mjsIds(s, FIXTURE_AS_OF).compatibilityRules).toEqual(want);
    // B 타입이 내려가면(프로필 비노출) B 범위 규칙도 양쪽에서 빠진다.
    patch(s, 'animalTypes', SECOND.typeId, { reviewStatus: 'DRAFT' });
    const want2 = ['cr-scope-a', 'cr-unscoped'];
    expect(engineIds(s, FIXTURE_AS_OF).compatibilityRules).toEqual(want2);
    expect(mjsIds(s, FIXTURE_AS_OF).compatibilityRules).toEqual(want2);
  });

  // Kenny 2026-10-24 K-4 되돌림: 타입 노출은 Taxon 을 보지 않는다. Taxon 참조(catalog taxonId·taxonIds)는 검수 완료일 때만 — 엔진 ↔ mjs ids.taxa 같은 집합.
  describe('Taxon 미검수여도 노출 동일, Taxon 참조는 검수 완료만(패리티)', () => {
    /** 엔진 카탈로그가 싣는 Taxon 참조 집합. */
    function engineTaxonRefs(seed: SeedBundle): string[] {
      const c = projectSite(seed, FIXTURE_AS_OF).catalog;
      const refs = [...c.animalTypes.map((t) => t.taxonId), ...c.careProfiles.flatMap((p) => p.taxonIds)];
      return [...new Set(refs.filter((x): x is string => typeof x === 'string'))].sort();
    }
    const mjsTaxa = (seed: SeedBundle): string[] => [...mjs.computeExposure(rawOf(seed), FIXTURE_AS_OF).ids.taxa].sort();
    const base = engineIds(promoted({ taxonVerified: true }), FIXTURE_AS_OF);

    const cases: Array<[string, (s: SeedBundle) => void]> = [
      ['Taxon DRAFT(디스크 상태)', () => {}],
      ['Taxon VERIFIED + AI_DRAFT 위장', (s) => patch(s, 'taxa', GOLDEN_TAXON_ID, { ...V_LEGAL, reviewerType: 'AI_DRAFT' })],
      ['Taxon NEEDS_REVIEW', (s) => patch(s, 'taxa', GOLDEN_TAXON_ID, { ...V_LEGAL, reviewStatus: 'NEEDS_REVIEW' })],
      ['Taxon 오래됨', (s) => patch(s, 'taxa', GOLDEN_TAXON_ID, { ...V_LEGAL, verifiedAt: OLD })],
      ['taxonId null', (s) => patch(s, 'animalTypes', 'hamster-golden', { taxonId: null })],
      ['taxonId 미존재', (s) => patch(s, 'animalTypes', 'hamster-golden', { taxonId: 'tx-ghost' })],
      ['taxa 행 전부 제거', (s) => void (s.taxa = [])],
    ];
    it.each(cases)('%s → 양쪽 노출 집합 그대로(골든 노출), Taxon 참조 0', (_n, inject) => {
      const s = promoted();
      inject(s);
      expect(engineIds(s, FIXTURE_AS_OF)).toEqual(base);
      expect(engineIds(s, FIXTURE_AS_OF).animalTypes).toEqual(['hamster-golden']);
      expect(mjsIds(s, FIXTURE_AS_OF)).toEqual(base);
      expect(engineTaxonRefs(s)).toEqual([]);
      expect(mjsTaxa(s)).toEqual([]);
    });

    it('Taxon VERIFIED(OFFICIAL_SOURCE) → 노출 집합 같고 Taxon 참조만 생긴다(양쪽 동일)', () => {
      const s = promoted({ taxonVerified: true });
      expect(engineIds(s, FIXTURE_AS_OF)).toEqual(mjsIds(s, FIXTURE_AS_OF));
      expect(engineTaxonRefs(s)).toEqual([GOLDEN_TAXON_ID]);
      expect(mjsTaxa(s)).toEqual([GOLDEN_TAXON_ID]);
    });

    // 277 QA M-1(PM 대안 규칙): 프로필 taxonIds 에서 「비노출 AnimalType 의 taxonId」만 뺀다. 자기 타입이 없는 프로필 전용 VERIFIED Taxon 은
    //   양쪽 참조에 남고(QA 68 LOW 동작 복귀), 비노출 타입(디스크 PLANNED 드워프)의 프로필에만 있는 VERIFIED Taxon 은 프로필째 비노출이라 양쪽 0.
    it('자기 타입 없는 프로필 전용 VERIFIED Taxon → 양쪽 참조에 포함, 비노출 프로필 전용 Taxon 은 양쪽 0', () => {
      const s = promoted({ taxonVerified: true });
      const src = s.taxa.find((t) => t.id === GOLDEN_TAXON_ID);
      if (!src) throw new Error('fixture: 골든 Taxon 없음');
      s.taxa.push({ ...JSON.parse(JSON.stringify(src)), id: 'fixture-profile-only', scientificName: 'Fixtureus profilonly', ...V_LEGAL });
      patch(s, 'careProfiles', 'cp-hamster-syrian', { taxonIds: [GOLDEN_TAXON_ID, 'fixture-profile-only'] });
      patch(s, 'taxa', 'phodopus-sungorus', { ...V_LEGAL }); // cp-hamster-dwarf 전용 — hamster-dwarf 는 PLANNED
      expect(engineIds(s, FIXTURE_AS_OF)).toEqual(mjsIds(s, FIXTURE_AS_OF));
      const want = ['fixture-profile-only', GOLDEN_TAXON_ID].sort();
      expect(engineTaxonRefs(s)).toEqual(want);
      expect(mjsTaxa(s)).toEqual(want);
      const cp = projectSite(s, FIXTURE_AS_OF).catalog.careProfiles.find((p) => p.id === 'cp-hamster-syrian');
      expect(cp?.taxonIds).toEqual([GOLDEN_TAXON_ID, 'fixture-profile-only']);
    });

    // 277 QA M-1 (a): 드워프 공유 프로필 — 노출 타입 hamster-dwarf(taxonId sungorus) 하나뿐이어도, 자기 타입이 없는 캠벨은
    //   VERIFIED 면 cp-hamster-dwarf.taxonIds 에 남는다(엔진·mjs 같음). 78d266f 규칙(노출 타입 taxon 만)이면 캠벨이 빠져 빨강.
    it('dwarfPreview: sungorus·campbelli 둘 다 VERIFIED → cp-hamster-dwarf.taxonIds 에 둘 다 남음(양쪽 동일)', () => {
      const s = dwarfPreview();
      const dwarf = s.animalTypes.find((t) => t.id === 'hamster-dwarf');
      expect(dwarf?.taxonId).toBe('phodopus-sungorus');
      expect(s.animalTypes.some((t) => t.taxonId === 'phodopus-campbelli')).toBe(false); // 캠벨은 자기 타입 없음
      patch(s, 'taxa', 'phodopus-sungorus', { ...V_LEGAL });
      patch(s, 'taxa', 'phodopus-campbelli', { ...V_LEGAL });
      const c = projectSite(s, DWARF_PREVIEW_AS_OF).catalog;
      expect(c.animalTypes.map((t) => t.id)).toContain('hamster-dwarf');
      expect(c.careProfiles.find((p) => p.id === 'cp-hamster-dwarf')?.taxonIds).toEqual(['phodopus-sungorus', 'phodopus-campbelli']);
      const refs = [...new Set([...c.animalTypes.map((t) => t.taxonId), ...c.careProfiles.flatMap((p) => p.taxonIds)].filter((x): x is string => typeof x === 'string'))].sort();
      expect(refs).toEqual(expect.arrayContaining(['phodopus-campbelli', 'phodopus-sungorus']));
      expect([...mjs.computeExposure(rawOf(s), DWARF_PREVIEW_AS_OF).ids.taxa].sort()).toEqual(refs);
      expect(engineIds(s, DWARF_PREVIEW_AS_OF)).toEqual(mjsIds(s, DWARF_PREVIEW_AS_OF));
    });

    // 271 qa LOW-1 본 시나리오: 비공개 종(로보) Taxon 이 VERIFIED 로 합성되고 노출 프로필(공유)에 들어가도 산출물에 id·학명 0.
    it('공유 프로필에 비공개 종 Taxon(VERIFIED 합성) → 산출물 전체에 그 id·학명 0, 노출 타입 taxon 은 유지', () => {
      const s = promoted({ taxonVerified: true });
      const robo = s.taxa.find((t) => t.id === 'phodopus-roborovskii');
      if (!robo) throw new Error('fixture: 로보 Taxon 없음');
      const sci = String(robo.scientificName);
      expect(sci).toMatch(/roborovskii/);
      patch(s, 'taxa', 'phodopus-roborovskii', { ...V_LEGAL });
      patch(s, 'careProfiles', 'cp-hamster-syrian', { taxonIds: [GOLDEN_TAXON_ID, 'phodopus-roborovskii'] });
      const site = projectSite(s, FIXTURE_AS_OF);
      expect(site.catalog.animalTypes.map((t) => t.id)).not.toContain('hamster-robo');
      expect(site.catalog.careProfiles.find((p) => p.id === 'cp-hamster-syrian')?.taxonIds).toEqual([GOLDEN_TAXON_ID]);
      const out = JSON.stringify(site);
      expect(out).not.toContain('phodopus-roborovskii');
      expect(out).not.toContain(sci);
      expect(out).not.toMatch(/roborovskii/i);
      expect(engineTaxonRefs(s)).toEqual([GOLDEN_TAXON_ID]);
      expect(mjsTaxa(s)).toEqual([GOLDEN_TAXON_ID]);
    });

    it('2타입: B 의 Taxon 만 DRAFT 여도 두 타입 모두 노출, B 의 Taxon 참조만 빠진다(양쪽 동일)', () => {
      const s = promotedTwo();
      patch(s, 'taxa', GOLDEN_TAXON_ID, { ...V_LEGAL });
      s.taxa.push({ ...JSON.parse(JSON.stringify(s.taxa.find((t) => t.id === GOLDEN_TAXON_ID))), id: 'fixture-taxon-b', reviewStatus: 'DRAFT' });
      patch(s, 'animalTypes', SECOND.typeId, { taxonId: 'fixture-taxon-b' });
      patch(s, 'careProfiles', SECOND.careProfileId, { taxonIds: ['fixture-taxon-b'] });
      expect(engineIds(s, FIXTURE_AS_OF).animalTypes).toEqual([SECOND.typeId, 'hamster-golden'].sort());
      expect(engineIds(s, FIXTURE_AS_OF)).toEqual(mjsIds(s, FIXTURE_AS_OF));
      expect(engineTaxonRefs(s)).toEqual([GOLDEN_TAXON_ID]);
      expect(mjsTaxa(s)).toEqual([GOLDEN_TAXON_ID]);
      const b = projectSite(s, FIXTURE_AS_OF).catalog.animalTypes.find((t) => t.id === SECOND.typeId);
      expect(b?.taxonId).toBeNull();
      patch(s, 'taxa', 'fixture-taxon-b', { ...V_LEGAL });
      expect(engineTaxonRefs(s)).toEqual(['fixture-taxon-b', GOLDEN_TAXON_ID].sort());
      expect(mjsTaxa(s)).toEqual(['fixture-taxon-b', GOLDEN_TAXON_ID].sort());
    });
  });

  // M-1(QA): 최소·권장 해석 규칙이 둘 다 빈 요구사항(무규격)을 가리키는 상품은 meetsMinSpec:true·ACTIVE·VERIFIED 여도 양쪽 모두 비노출.
  it('무규격 요구사항 + ACTIVE + meetsMinSpec:true + VERIFIED 상품 → 엔진·mjs 모두 노출 false', () => {
    const s = promoted();
    const before = engineIds(s, FIXTURE_AS_OF);
    expect(before.curatedProducts).toContain('cp-001');
    expect(mjsIds(s, FIXTURE_AS_OF).curatedProducts).toContain('cp-001');
    patch(s, 'supplyRequirements', 'req-syrian-wheel', { minSpec: { rules: [] }, recommendedSpec: { rules: [] } });
    patch(s, 'animalTypes', 'hamster-golden', { careOverrides: {} });
    const prod = s.curatedProducts.find((p) => p.id === 'cp-001');
    expect(prod?.status).toBe('ACTIVE');
    expect(prod?.meetsMinSpec).toBe(true);
    expect(engineIds(s, FIXTURE_AS_OF).curatedProducts).not.toContain('cp-001');
    expect(mjsIds(s, FIXTURE_AS_OF).curatedProducts).not.toContain('cp-001');
    expect(engineIds(s, FIXTURE_AS_OF)).toEqual(mjsIds(s, FIXTURE_AS_OF));
  });

  it('verifiedAt 누락·미래 날짜 주입도 동일(fail-closed)', () => {
    const nextDay = new Date(Date.parse(`${FIXTURE_AS_OF}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(nextDay).toBe('2026-11-17');
    for (const v of [null, nextDay, 'bad']) { // FIXTURE_AS_OF 다음 날 = 미래(옛 고정값 2026-11-04 는 기준일 2026-11-03 이동 뒤 과거가 되어 FIXTURE_AS_OF 에서 파생)
      const s = promoted();
      patch(s, 'careProfiles', 'cp-hamster-syrian', { verifiedAt: v });
      expect(engineIds(s, FIXTURE_AS_OF)).toEqual(mjsIds(s, FIXTURE_AS_OF));
      expect(engineIds(s, FIXTURE_AS_OF).animalTypes).toEqual([]);
    }
  });
});
