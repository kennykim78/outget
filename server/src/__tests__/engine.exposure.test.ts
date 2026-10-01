// 노출 규칙(불변식 3·7, A-6) — 엔진에서 노출을 판단하는 유일한 모듈.
import { describe, expect, it } from 'vitest';
import {
  createCatalog,
  isProductExposable,
  isRequirementExposable,
  isTestimonialExposable,
  isVerified,
  isVetListed,
  resolveRequirement,
} from '../engine/index.js';
import type { ContentMeta, CuratedProductRec, TestimonialRec, VetClinicSeedRec } from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

const VERIFIED: Pick<ContentMeta, 'reviewStatus' | 'reviewerType' | 'verifiedBy' | 'verifiedAt'> = {
  reviewStatus: 'VERIFIED',
  reviewerType: 'EXPERIENCED_KEEPER',
  verifiedBy: 'keeper-1',
  verifiedAt: '2026-09-30',
};

describe('isVerified', () => {
  it('VERIFIED by a non-AI reviewer only', () => {
    expect(isVerified({ reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER' })).toBe(true);
    expect(isVerified({ reviewStatus: 'VERIFIED', reviewerType: 'AI_DRAFT' })).toBe(false);
    expect(isVerified({ reviewStatus: 'NEEDS_REVIEW', reviewerType: 'VET' })).toBe(false);
    expect(isVerified({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT' })).toBe(false);
  });
});

describe('isRequirementExposable', () => {
  function promoted(opts: { type?: 'ACTIVE' | 'PLANNED'; skip?: 'req' | 'item' | 'profile' } = {}) {
    const b = makeBundle();
    const at = b.animalTypes.find((x) => x.id === 'critter-plain')!;
    at.status = opts.type ?? 'ACTIVE';
    const req = b.supplyRequirements.find((x) => x.careProfileId === 'pf-test' && x.supplyItemId === 'box')!;
    const item = b.supplyItems.find((x) => x.id === 'box')!;
    const profile = b.careProfiles.find((x) => x.id === 'pf-test')!;
    if (opts.skip !== 'req') Object.assign(req, VERIFIED);
    if (opts.skip !== 'item') Object.assign(item, VERIFIED);
    if (opts.skip !== 'profile') Object.assign(profile, VERIFIED);
    const cat = createCatalog(b);
    return { cat, r: resolveRequirement(cat, 'critter-plain', 'box')! };
  }

  it('ACTIVE type + requirement, item, profile all VERIFIED', () => {
    const { cat, r } = promoted();
    expect(isRequirementExposable(cat, r)).toBe(true);
  });

  it.each(['req', 'item', 'profile'] as const)('not when %s is unverified', (skip) => {
    const { cat, r } = promoted({ skip });
    expect(isRequirementExposable(cat, r)).toBe(false);
  });

  it('not when the animal type is PLANNED', () => {
    const { cat, r } = promoted({ type: 'PLANNED' });
    expect(isRequirementExposable(cat, r)).toBe(false);
  });

  it('AI_DRAFT reviewer never exposes even if marked VERIFIED', () => {
    const b = makeBundle();
    for (const x of [...b.supplyRequirements, ...b.supplyItems, ...b.careProfiles]) {
      x.reviewStatus = 'VERIFIED';
      x.reviewerType = 'AI_DRAFT';
    }
    const cat = createCatalog(b);
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'critter-plain', 'box')!)).toBe(false);
  });

  it('DRAFT fixture exposes nothing', () => {
    const cat = createCatalog(makeBundle());
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'critter-plain', 'box')!)).toBe(false);
  });
});

describe('isProductExposable — 규격 → 검수 (불변식 3)', () => {
  const base: CuratedProductRec = {
    id: 'p1',
    supplyItemId: 'box',
    careProfileIds: ['pf-test'],
    title: '상자 A',
    imageAsset: null,
    specValues: {},
    meetsMinSpec: true,
    specVerifiedBy: 'op',
    specVerifiedAt: '2026-09-30',
    status: 'ACTIVE',
    imageLicense: 'NONE',
    contentKind: 'SPEC',
    source: [],
    ...VERIFIED,
  };
  it('ACTIVE ∧ meetsMinSpec ∧ VERIFIED(non-AI)', () => {
    expect(isProductExposable(base)).toBe(true);
    expect(isProductExposable({ ...base, meetsMinSpec: false })).toBe(false);
    expect(isProductExposable({ ...base, meetsMinSpec: null })).toBe(false);
    expect(isProductExposable({ ...base, status: 'REVIEW' })).toBe(false);
    expect(isProductExposable({ ...base, status: 'SLOT' })).toBe(false);
    expect(isProductExposable({ ...base, reviewerType: 'AI_DRAFT' })).toBe(false);
    expect(isProductExposable({ ...base, reviewStatus: 'NEEDS_REVIEW' })).toBe(false);
  });
});

describe('isTestimonialExposable — APPROVED ∧ verifiedUsage', () => {
  const t: TestimonialRec = {
    id: 't1',
    quote: '체크리스트로 준비했어요',
    animalTypeId: 'critter',
    situation: 'FIRST_TIME',
    linkedAction: 'CHECKLIST',
    verifiedUsage: true,
    source: 'BETA_2026_10',
    consentAt: '2026-09-30',
    status: 'APPROVED',
    reviewerImage: null,
    reviewerImageConsent: false,
  };
  it('both required', () => {
    expect(isTestimonialExposable(t)).toBe(true);
    expect(isTestimonialExposable({ ...t, verifiedUsage: false })).toBe(false);
    expect(isTestimonialExposable({ ...t, status: 'SUBMITTED' })).toBe(false);
    expect(isTestimonialExposable({ ...t, status: 'SLOT' })).toBe(false);
  });
});

describe('isVetListed — verification VERIFIED only', () => {
  const v: VetClinicSeedRec = {
    id: 'v1',
    name: '병원',
    region: '서울 마포구',
    treats: ['critter'],
    night: null,
    emergency: null,
    phone: '02-000-0000',
    address: '주소',
    lat: null,
    lng: null,
    verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-30', note: null },
  };
  it('VERIFIED vs others', () => {
    expect(isVetListed(v)).toBe(true);
    for (const status of ['SLOT', 'REPORTED', 'BLINDED'] as const) {
      expect(isVetListed({ ...v, verification: { ...v.verification, status } })).toBe(false);
    }
  });
});
