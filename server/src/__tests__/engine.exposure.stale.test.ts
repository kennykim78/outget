// M-1(S1) 6개월 자동 강등 — 노출 판정에 검수 나이 반영(R4 A1, D5).
//   STALE_DAYS 는 engine/domain.ts 단일 소스(validate-review W-STALE 가 import). 경계: days > 180 비노출(W-STALE 와 동일).
//   asOf 는 필수 인자(선택 인자 = fail-open 금지). isVerified 는 날짜를 보지 않는다(의미 불변).
import { describe, expect, it } from 'vitest';
import {
  STALE_DAYS,
  createCatalog,
  isAnimalTypeExposable,
  isBundleExposable,
  isCompatRuleExposable,
  isFresh,
  isProductExposable,
  isRequirementExposable,
  isVerified,
  listResolvedRequirements,
  orderExposableProducts,
  resolveRequirement,
} from '../engine/index.js';
import type { ContentMeta, CuratedProductRec, SetupBundleRec } from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

// 2026 은 평년: 01-01 + 180일 = 06-30, +181일 = 07-01.
const VAT = '2026-01-01';
const EDGE = '2026-06-30';
const PAST = '2026-07-01';

const V: Pick<ContentMeta, 'reviewStatus' | 'reviewerType' | 'verifiedBy' | 'verifiedAt'> = {
  reviewStatus: 'VERIFIED',
  reviewerType: 'EXPERIENCED_KEEPER',
  verifiedBy: 'keeper-1',
  verifiedAt: VAT,
};

function allVerified(verifiedAt = VAT) {
  const b = makeBundle();
  for (const x of [...b.supplyRequirements, ...b.supplyItems, ...b.careProfiles, ...b.animalTypes, ...b.compatibilityRules]) {
    Object.assign(x, V, { verifiedAt });
  }
  return b;
}

const product = (extra: Partial<CuratedProductRec> = {}): CuratedProductRec => ({
  id: 'p1',
  supplyItemId: 'spinner',
  careProfileIds: ['pf-test'],
  title: '회전판',
  imageAsset: null,
  specValues: { sizeCm: 26, face: 'FLAT', mount: 'FLOOR', quiet: true },
  meetsMinSpec: true,
  specVerifiedBy: 'op',
  specVerifiedAt: VAT,
  status: 'ACTIVE',
  imageLicense: 'NONE',
  contentKind: 'SPEC',
  source: [],
  ...V,
  ...extra,
});

const bundle = (extra: Partial<SetupBundleRec> = {}): SetupBundleRec => ({
  id: 'sb-1',
  careProfileId: 'pf-test',
  tier: 'BALANCED',
  name: '기본 세트',
  glyph: '·',
  purpose: '처음 준비',
  itemIds: ['box', 'spinner'],
  estimatedRangeText: null,
  note: null,
  contentKind: 'SPEC',
  source: [],
  ...V,
  ...extra,
});

describe('STALE_DAYS · isFresh (M-1)', () => {
  it('STALE_DAYS is 180 and exported from the engine barrel', () => {
    expect(STALE_DAYS).toBe(180);
  });

  it('boundary: verifiedAt + 180 fresh, + 181 stale (W-STALE 와 같은 days > 180)', () => {
    expect(isFresh({ verifiedAt: VAT }, VAT)).toBe(true);
    expect(isFresh({ verifiedAt: VAT }, EDGE)).toBe(true);
    expect(isFresh({ verifiedAt: VAT }, PAST)).toBe(false);
    // 윤년 경계: 2028-01-01 + 180 = 2028-06-29.
    expect(isFresh({ verifiedAt: '2028-01-01' }, '2028-06-29')).toBe(true);
    expect(isFresh({ verifiedAt: '2028-01-01' }, '2028-06-30')).toBe(false);
    // 연도 경계.
    expect(isFresh({ verifiedAt: '2026-12-31' }, '2027-06-29')).toBe(true);
    expect(isFresh({ verifiedAt: '2026-12-31' }, '2027-06-30')).toBe(false);
  });

  it('fail-closed: missing / malformed / impossible / future verifiedAt is not fresh', () => {
    for (const v of [null, undefined, '', '2026-1-1', '2026-02-30', '2026-13-01', '20260101', ' 2026-01-01', 20260101]) {
      expect(isFresh({ verifiedAt: v as unknown as string | null }, EDGE), String(v)).toBe(false);
    }
    expect(isFresh({ verifiedAt: '2026-07-02' }, PAST)).toBe(false); // 기준일 이후 검수 = 아직 검수되지 않음(S07 미래 날짜)
  });

  it('asOf is required and must be YYYY-MM-DD (throws — never silently fresh)', () => {
    for (const a of [undefined, null, '', '2026-7-1', '2026-02-30', 'today', 0]) {
      expect(() => isFresh({ verifiedAt: VAT }, a as unknown as string), String(a)).toThrow(RangeError);
    }
  });

  it('isVerified meaning is unchanged: ignores verifiedAt age', () => {
    expect(isVerified({ reviewStatus: 'VERIFIED', reviewerType: 'VET', verifiedAt: '2000-01-01' } as never)).toBe(true);
  });
});

describe('exposure chain demotes stale content (asOf)', () => {
  it('whole chain fresh at +180, nothing at +181', () => {
    const cat = createCatalog(allVerified());
    expect(isAnimalTypeExposable(cat, 'critter', EDGE)).toBe(true);
    expect(listResolvedRequirements(cat, 'critter').some((r) => isRequirementExposable(cat, r, EDGE))).toBe(true);
    expect(isProductExposable(cat, 'critter', product(), EDGE)).toBe(true);
    expect(isBundleExposable(cat, 'critter', bundle(), EDGE)).toBe(true);
    expect(isCompatRuleExposable(cat.compatibilityRules[0], EDGE)).toBe(true);

    expect(isAnimalTypeExposable(cat, 'critter', PAST)).toBe(false);
    expect(listResolvedRequirements(cat, 'critter').some((r) => isRequirementExposable(cat, r, PAST))).toBe(false);
    expect(isProductExposable(cat, 'critter', product({ verifiedAt: PAST }), PAST)).toBe(false);
    expect(isBundleExposable(cat, 'critter', bundle({ verifiedAt: PAST }), PAST)).toBe(false);
    expect(isCompatRuleExposable(cat.compatibilityRules[0], PAST)).toBe(false);
  });

  // 체인의 어느 ContentMeta 하나만 오래돼도 0(fail-closed).
  for (const link of ['animalType', 'careProfile', 'item', 'requirement'] as const) {
    it(`only ${link} stale → requirement, type, product, bundle all hidden`, () => {
      const b = allVerified(EDGE);
      const old = '2025-12-31'; // EDGE 기준 181일
      if (link === 'animalType') b.animalTypes.find((x) => x.id === 'critter')!.verifiedAt = old;
      if (link === 'careProfile') b.careProfiles.find((x) => x.id === 'pf-test')!.verifiedAt = old;
      if (link === 'item') b.supplyItems.find((x) => x.id === 'spinner')!.verifiedAt = old;
      if (link === 'requirement')
        b.supplyRequirements.find((x) => x.careProfileId === 'pf-test' && x.supplyItemId === 'spinner')!.verifiedAt = old;
      const cat = createCatalog(b);
      const r = resolveRequirement(cat, 'critter', 'spinner')!;
      expect(isRequirementExposable(cat, r, EDGE)).toBe(false);
      const p = product({ verifiedAt: EDGE });
      expect(isProductExposable(cat, 'critter', p, EDGE)).toBe(false);
      expect(orderExposableProducts(cat, 'critter', [p], EDGE)).toEqual([]);
      expect(isBundleExposable(cat, 'critter', bundle({ verifiedAt: EDGE }), EDGE)).toBe(false);
      if (link === 'animalType' || link === 'careProfile') expect(isAnimalTypeExposable(cat, 'critter', EDGE)).toBe(false);
    });
  }

  it('product / bundle / rule own verifiedAt stale → hidden even if the chain is fresh', () => {
    const cat = createCatalog(allVerified(EDGE));
    expect(isProductExposable(cat, 'critter', product({ verifiedAt: '2025-12-31' }), EDGE)).toBe(false);
    expect(isProductExposable(cat, 'critter', product({ verifiedAt: null }), EDGE)).toBe(false);
    expect(isBundleExposable(cat, 'critter', bundle({ verifiedAt: '2025-12-31' }), EDGE)).toBe(false);
    expect(isCompatRuleExposable({ ...cat.compatibilityRules[0], verifiedAt: '2025-12-31' }, EDGE)).toBe(false);
  });

  it('every exposure function rejects a missing / malformed asOf (no fail-open default)', () => {
    const cat = createCatalog(allVerified());
    const r = resolveRequirement(cat, 'critter', 'spinner')!;
    const bad = undefined as unknown as string;
    expect(() => isRequirementExposable(cat, r, bad)).toThrow(RangeError);
    expect(() => isAnimalTypeExposable(cat, 'critter', bad)).toThrow(RangeError);
    expect(() => isProductExposable(cat, 'critter', product(), bad)).toThrow(RangeError);
    expect(() => orderExposableProducts(cat, 'critter', [product()], bad)).toThrow(RangeError);
    expect(() => isBundleExposable(cat, 'critter', bundle(), bad)).toThrow(RangeError);
    expect(() => isCompatRuleExposable(cat.compatibilityRules[0], bad)).toThrow(RangeError);
  });
});
