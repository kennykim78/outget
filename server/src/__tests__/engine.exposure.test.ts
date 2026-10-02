// 노출 규칙(불변식 3·7, A-6) — 엔진에서 노출을 판단하는 유일한 모듈.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VET_LISTED_STATUS,
  checkAnimalMinSpec,
  checkProfileMinSpec,
  isAnimalTypeExposable,
  isBundleExposable,
  isCompatRuleExposable,
  isPhotoUsable,
  orderExposableProducts,
  createCatalog,
  isProductExposable,
  isRequirementExposable,
  isTestimonialExposable,
  isVerified,
  isVetListed,
  isVetStatusListed,
  resolveRequirement,
} from '../engine/index.js';
import type {
  AnimalTypeRec,
  CareProfileRec,
  CompatibilityRuleRec,
  ContentMeta,
  CuratedProductRec,
  PhotoRec,
  ReviewerType,
  SetupBundleRec,
  SupplyItemRec,
  SupplyRequirementRec,
  TestimonialRec,
  VetClinicSeedRec,
} from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
const read = <T>(f: string): T[] => JSON.parse(readFileSync(join(SEED, f), 'utf8')) as T[];
function realSeed() {
  return {
    animalTypes: read<AnimalTypeRec>('animal-types.json'),
    careProfiles: read<CareProfileRec>('care-profiles.json'),
    supplyItems: read<SupplyItemRec>('supply-items.json'),
    supplyRequirements: read<SupplyRequirementRec>('supply-requirements.json'),
    compatibilityRules: read<CompatibilityRuleRec>('compatibility-rules.json'),
  };
}

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

  // L3: 허용 목록(rank ≥ OPERATOR) — 블록리스트(≠AI_DRAFT)로 되돌리면 알 수 없는 값이 통과해 실패한다.
  it('fail-closed: unknown / empty / missing reviewer types are never verified', () => {
    for (const t of ['HUMAN', '', undefined, null, 'operator', 'AI_DRAFT ']) {
      expect(isVerified({ reviewStatus: 'VERIFIED', reviewerType: t as unknown as ReviewerType })).toBe(false);
    }
  });

  it('every reviewer type at or above OPERATOR is verified when VERIFIED', () => {
    for (const t of ['OPERATOR', 'EXPERIENCED_KEEPER', 'VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET'] as const) {
      expect(isVerified({ reviewStatus: 'VERIFIED', reviewerType: t })).toBe(true);
    }
    expect(isVerified({ reviewStatus: 'VERIFIED ' as unknown as 'VERIFIED', reviewerType: 'VET' })).toBe(false);
  });
});

type Skip = 'req' | 'item' | 'profile' | 'type';

/** critter-plain × box 체인을 EXPERIENCED_KEEPER 로 승격(skip 은 승격하지 않음). */
function promotedBundle(opts: { type?: 'ACTIVE' | 'PLANNED'; skip?: Skip } = {}) {
  const b = makeBundle();
  const at = b.animalTypes.find((x) => x.id === 'critter-plain')!;
  at.status = opts.type ?? 'ACTIVE';
  const req = b.supplyRequirements.find((x) => x.careProfileId === 'pf-test' && x.supplyItemId === 'box')!;
  const item = b.supplyItems.find((x) => x.id === 'box')!;
  const profile = b.careProfiles.find((x) => x.id === 'pf-test')!;
  if (opts.skip !== 'req') Object.assign(req, VERIFIED);
  if (opts.skip !== 'item') Object.assign(item, VERIFIED);
  if (opts.skip !== 'profile') Object.assign(profile, VERIFIED);
  if (opts.skip !== 'type') Object.assign(at, VERIFIED);
  return b;
}

describe('isRequirementExposable', () => {
  function promoted(opts: { type?: 'ACTIVE' | 'PLANNED'; skip?: Skip } = {}) {
    const cat = createCatalog(promotedBundle(opts));
    return { cat, r: resolveRequirement(cat, 'critter-plain', 'box')! };
  }

  it('ACTIVE type + type, requirement, item, profile all VERIFIED', () => {
    const { cat, r } = promoted();
    expect(isRequirementExposable(cat, r)).toBe(true);
  });

  it.each(['req', 'item', 'profile', 'type'] as const)('not when %s is unverified', (skip) => {
    const { cat, r } = promoted({ skip });
    expect(isRequirementExposable(cat, r)).toBe(false);
  });

  it('not when the animal type is PLANNED', () => {
    const { cat, r } = promoted({ type: 'PLANNED' });
    expect(isRequirementExposable(cat, r)).toBe(false);
  });

  it('AI_DRAFT reviewer never exposes even if marked VERIFIED', () => {
    const b = makeBundle();
    for (const x of [...b.supplyRequirements, ...b.supplyItems, ...b.careProfiles, ...b.animalTypes]) {
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

describe('isAnimalTypeExposable (M1)', () => {
  it('ACTIVE ∧ type VERIFIED ∧ profile VERIFIED ∧ ≥1 exposable requirement', () => {
    expect(isAnimalTypeExposable(createCatalog(promotedBundle()), 'critter-plain')).toBe(true);
  });

  it('type alone left DRAFT → false (everything else VERIFIED)', () => {
    expect(isAnimalTypeExposable(createCatalog(promotedBundle({ skip: 'type' })), 'critter-plain')).toBe(false);
  });

  it.each(['req', 'item', 'profile'] as const)('false when %s is unverified (no exposable requirement / profile)', (skip) => {
    expect(isAnimalTypeExposable(createCatalog(promotedBundle({ skip })), 'critter-plain')).toBe(false);
  });

  it('PLANNED → false; unknown id → false; type without profile → false', () => {
    expect(isAnimalTypeExposable(createCatalog(promotedBundle({ type: 'PLANNED' })), 'critter-plain')).toBe(false);
    const cat = createCatalog(promotedBundle());
    expect(isAnimalTypeExposable(cat, 'nope')).toBe(false);
    expect(isAnimalTypeExposable(cat, 'ghost')).toBe(false);
  });

  it('AI_DRAFT type marked VERIFIED → false', () => {
    const b = promotedBundle();
    Object.assign(b.animalTypes.find((x) => x.id === 'critter-plain')!, { reviewerType: 'AI_DRAFT' });
    expect(isAnimalTypeExposable(createCatalog(b), 'critter-plain')).toBe(false);
  });

  it('real seed: hamster-golden is not exposable (all DRAFT)', () => {
    const cat = createCatalog(realSeed());
    expect(isAnimalTypeExposable(cat, 'hamster-golden')).toBe(false);
    for (const at of realSeed().animalTypes) expect(isAnimalTypeExposable(cat, at.id)).toBe(false);
  });
});

/** 합성 카탈로그 전체를 EXPERIENCED_KEEPER 로 승격(PLANNED·프로필 없는 ghost 는 그대로). */
function allVerified() {
  const b = makeBundle();
  for (const x of [...b.supplyRequirements, ...b.supplyItems, ...b.careProfiles, ...b.animalTypes, ...b.compatibilityRules]) {
    Object.assign(x, VERIFIED);
  }
  return b;
}
type Bundle = ReturnType<typeof allVerified>;

// critter: spinner override(min sizeCm ≥ 22, mount FLOOR) · critter-plain: 프로필 기본(min sizeCm ≥ 20, face FLAT).
//   recommended: sizeCm ≥ 25, quiet true.
const SPIN_21 = { sizeCm: 21, face: 'FLAT', mount: 'FLOOR', quiet: true };
const SPIN_OK = { sizeCm: 26, face: 'FLAT', mount: 'FLOOR', quiet: true };
const SPIN_BR = { sizeCm: 23, face: 'FLAT', mount: 'FLOOR', quiet: true };

function product(id: string, extra: Partial<CuratedProductRec> = {}): CuratedProductRec {
  return {
    id,
    supplyItemId: 'spinner',
    careProfileIds: ['pf-test'],
    title: `회전판 ${id}`,
    imageAsset: null,
    specValues: SPIN_OK,
    meetsMinSpec: true,
    specVerifiedBy: 'op',
    specVerifiedAt: '2026-09-30',
    status: 'ACTIVE',
    imageLicense: 'NONE',
    contentKind: 'SPEC',
    source: [],
    ...VERIFIED,
    ...extra,
  };
}

describe('checkAnimalMinSpec (M3 — override 반영, 제품 단계)', () => {
  const cat = createCatalog(allVerified());
  it('override tightens min: plain meets, override type does not', () => {
    expect(checkAnimalMinSpec(cat, 'critter-plain', 'spinner', SPIN_21)).toMatchObject({ meets: true });
    expect(checkAnimalMinSpec(cat, 'critter', 'spinner', SPIN_21)).toMatchObject({ meets: false, verdict: 'BELOW_MIN' });
    // 프로필 기준(checkProfileMinSpec)은 override 를 보지 않는다 — 그래서 노출엔 checkAnimalMinSpec 이 필요하다.
    expect(checkProfileMinSpec(cat, 'pf-test', 'spinner', SPIN_21).meets).toBe(true);
  });
  it('verdict OK vs BELOW_RECOMMENDED both meet', () => {
    expect(checkAnimalMinSpec(cat, 'critter', 'spinner', SPIN_OK)).toMatchObject({ meets: true, verdict: 'OK' });
    expect(checkAnimalMinSpec(cat, 'critter', 'spinner', SPIN_BR)).toMatchObject({
      meets: true,
      verdict: 'BELOW_RECOMMENDED',
    });
  });
  it('missing key → CHECK → false', () => {
    expect(checkAnimalMinSpec(cat, 'critter', 'spinner', { sizeCm: 30, face: 'FLAT' })).toMatchObject({
      meets: false,
      verdict: 'CHECK',
    });
  });
  it('unknown type / item / profile-less type → CHECK, false (no throw)', () => {
    for (const [t, i] of [
      ['nope', 'spinner'],
      ['critter', 'nope'],
      ['ghost', 'spinner'],
    ] as const) {
      const r = checkAnimalMinSpec(cat, t, i, SPIN_OK);
      expect(r.meets).toBe(false);
      expect(r.verdict).toBe('CHECK');
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe('isProductExposable(cat, animalTypeId, p) — 규격 → 검수 (불변식 3, M2·M3)', () => {
  const cat = createCatalog(allVerified());
  it('ACTIVE ∧ meetsMinSpec ∧ VERIFIED(non-AI) ∧ profile ∧ requirement exposed ∧ animal min spec', () => {
    const base = product('p1');
    expect(isProductExposable(cat, 'critter', base)).toBe(true);
    expect(isProductExposable(cat, 'critter', { ...base, meetsMinSpec: false })).toBe(false);
    expect(isProductExposable(cat, 'critter', { ...base, meetsMinSpec: null })).toBe(false);
    expect(isProductExposable(cat, 'critter', { ...base, status: 'REVIEW' })).toBe(false);
    expect(isProductExposable(cat, 'critter', { ...base, status: 'SLOT' })).toBe(false);
    expect(isProductExposable(cat, 'critter', { ...base, status: 'DISCONTINUED' })).toBe(false);
    expect(isProductExposable(cat, 'critter', { ...base, reviewerType: 'AI_DRAFT' })).toBe(false);
    expect(isProductExposable(cat, 'critter', { ...base, reviewStatus: 'NEEDS_REVIEW' })).toBe(false);
  });

  it('override tightening min: exposed for plain type, hidden for override type', () => {
    const p = product('p21', { specValues: SPIN_21 });
    expect(isProductExposable(cat, 'critter-plain', p)).toBe(true);
    expect(isProductExposable(cat, 'critter', p)).toBe(false);
  });

  it('care profile mismatch → false', () => {
    expect(isProductExposable(cat, 'critter', product('px', { careProfileIds: ['pf-other'] }))).toBe(false);
    expect(isProductExposable(cat, 'critter', product('py', { careProfileIds: [] }))).toBe(false);
  });

  const mutations: Array<[string, (b: Bundle) => void]> = [
    ['requirement DRAFT', (b) => void Object.assign(b.supplyRequirements.find((x) => x.id === 'rq-pf-test-spinner')!, { reviewStatus: 'DRAFT' })],
    ['item DRAFT', (b) => void Object.assign(b.supplyItems.find((x) => x.id === 'spinner')!, { reviewStatus: 'DRAFT' })],
    ['profile DRAFT', (b) => void Object.assign(b.careProfiles.find((x) => x.id === 'pf-test')!, { reviewStatus: 'DRAFT' })],
    ['type DRAFT', (b) => void Object.assign(b.animalTypes.find((x) => x.id === 'critter')!, { reviewStatus: 'DRAFT' })],
    ['type PLANNED', (b) => void Object.assign(b.animalTypes.find((x) => x.id === 'critter')!, { status: 'PLANNED' })],
  ];
  it.each(mutations)('%s → false', (_name, mutate) => {
    const b = allVerified();
    mutate(b);
    const cat = createCatalog(b);
    expect(isProductExposable(cat, 'critter', product('p1'))).toBe(false);
  });

  it('unknown type, item without requirement, missing spec key → false', () => {
    expect(isProductExposable(cat, 'nope', product('p1'))).toBe(false);
    expect(isProductExposable(cat, 'critter', product('p1', { supplyItemId: 'nope' }))).toBe(false);
    expect(isProductExposable(cat, 'critter', product('p1', { specValues: { sizeCm: 30, face: 'FLAT' } }))).toBe(false);
  });

  it('DRAFT fixture exposes no product', () => {
    const cat = createCatalog(makeBundle());
    expect(isProductExposable(cat, 'critter', product('p1'))).toBe(false);
  });
});

describe('orderExposableProducts — OK → BELOW_RECOMMENDED → specVerifiedAt desc → 시드 순서', () => {
  const cat = createCatalog(allVerified());
  const rows = [
    product('br-new', { specValues: SPIN_BR, specVerifiedAt: '2026-09-30' }),
    product('ok-old', { specVerifiedAt: '2026-01-01' }),
    product('hidden', { specValues: SPIN_21 }), // critter override 미달 → 제외
    product('ok-mid-1', { specVerifiedAt: '2026-05-01' }),
    product('ok-null', { specVerifiedAt: null }),
    product('ok-mid-2', { specVerifiedAt: '2026-05-01' }),
    product('ai', { reviewerType: 'AI_DRAFT' }),
  ];
  it('filters non-exposable and orders by verdict, date desc, seed order', () => {
    const out = orderExposableProducts(cat, 'critter', rows);
    expect(out.map((x) => x.product.id)).toEqual(['ok-mid-1', 'ok-mid-2', 'ok-old', 'ok-null', 'br-new']);
    expect(out.map((x) => x.verdict)).toEqual(['OK', 'OK', 'OK', 'OK', 'BELOW_RECOMMENDED']);
    expect(out[0].product).toBe(rows[3]);
  });
  it('per animal type: plain type keeps the override-failing product', () => {
    expect(orderExposableProducts(cat, 'critter-plain', rows).map((x) => x.product.id)).toContain('hidden');
  });
  it('does not mutate input and is deterministic', () => {
    const copy = JSON.stringify(rows);
    const a = orderExposableProducts(cat, 'critter', rows);
    const b = orderExposableProducts(cat, 'critter', [...rows]);
    expect(JSON.stringify(rows)).toBe(copy);
    expect(a.map((x) => x.product.id)).toEqual(b.map((x) => x.product.id));
  });
  it('real seed: nothing exposable for hamster-golden', () => {
    const products = read<CuratedProductRec>('curated-products.json');
    const cat = createCatalog(realSeed());
    expect(orderExposableProducts(cat, 'hamster-golden', products)).toEqual([]);
    for (const p of products) expect(isProductExposable(cat, 'hamster-golden', p)).toBe(false);
  });
});

describe('isBundleExposable(cat, typeId, b) — VERIFIED ∧ 프로필 일치 ∧ 모든 항목 노출', () => {
  const bundle: SetupBundleRec = {
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
    ...VERIFIED,
  };
  const cat = createCatalog(allVerified());
  it('true when all conditions hold', () => {
    expect(isBundleExposable(cat, 'critter', bundle)).toBe(true);
  });
  it('false: bundle unverified / AI_DRAFT / unknown reviewer', () => {
    expect(isBundleExposable(cat, 'critter', { ...bundle, reviewStatus: 'DRAFT' })).toBe(false);
    expect(isBundleExposable(cat, 'critter', { ...bundle, reviewerType: 'AI_DRAFT' })).toBe(false);
    expect(isBundleExposable(cat, 'critter', { ...bundle, reviewerType: 'HUMAN' as unknown as ReviewerType })).toBe(false);
  });
  it('false: profile mismatch, unknown type, empty or unknown items', () => {
    expect(isBundleExposable(cat, 'critter', { ...bundle, careProfileId: 'pf-other' })).toBe(false);
    expect(isBundleExposable(cat, 'nope', bundle)).toBe(false);
    expect(isBundleExposable(cat, 'critter', { ...bundle, itemIds: [] })).toBe(false);
    expect(isBundleExposable(cat, 'critter', { ...bundle, itemIds: ['box', 'nope'] })).toBe(false);
  });
  it('false when any item requirement is not exposed', () => {
    const b = allVerified();
    Object.assign(b.supplyRequirements.find((x) => x.id === 'rq-pf-test-spinner')!, { reviewStatus: 'NEEDS_REVIEW' });
    const c = createCatalog(b);
    expect(isBundleExposable(c, 'critter', bundle)).toBe(false);
    expect(isBundleExposable(c, 'critter', { ...bundle, itemIds: ['box'] })).toBe(true);
  });
  it('false when the animal type itself is not verified', () => {
    const b = allVerified();
    Object.assign(b.animalTypes.find((x) => x.id === 'critter')!, { reviewStatus: 'DRAFT' });
    expect(isBundleExposable(createCatalog(b), 'critter', bundle)).toBe(false);
  });
});

describe('isCompatRuleExposable — VERIFIED(rank ≥ OPERATOR) only', () => {
  const rule = allVerified().compatibilityRules[0];
  it('both directions', () => {
    expect(isCompatRuleExposable(rule)).toBe(true);
    expect(isCompatRuleExposable({ ...rule, reviewStatus: 'NEEDS_REVIEW' })).toBe(false);
    expect(isCompatRuleExposable({ ...rule, reviewerType: 'AI_DRAFT' })).toBe(false);
  });
});

describe('isPhotoUsable — 비SLOT ∧ 사용권 기록(I01·C6)', () => {
  const photo: PhotoRec = {
    id: 'ph-x',
    scene: '장면',
    slot: 'intro-1',
    query: 'q',
    source: 'WIKIMEDIA',
    license: 'CC_BY',
    author: '작성자',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
    downloadedAt: '2026-09-30',
    modified: false,
    status: 'READY',
  };
  it('complete record → true; CC0 without author → true', () => {
    expect(isPhotoUsable(photo)).toBe(true);
    expect(isPhotoUsable({ ...photo, license: 'CC0', author: null })).toBe(true);
  });
  it.each<[string, Partial<PhotoRec>]>([
    ['SLOT', { status: 'SLOT' }],
    ['no license', { license: null }],
    ['unknown license', { license: 'ALL_RIGHTS_RESERVED' }],
    ['no source', { source: null }],
    ['blank source', { source: ' ' }],
    ['no sourceUrl', { sourceUrl: null }],
    ['http sourceUrl', { sourceUrl: 'http://example.com/x.jpg' }],
    ['non-url sourceUrl', { sourceUrl: 'example.com/x.jpg' }],
    ['no downloadedAt', { downloadedAt: null }],
    ['bad downloadedAt', { downloadedAt: '2026/09/30' }],
    ['CC_BY without author', { author: null }],
    ['CC_BY_SA blank author', { license: 'CC_BY_SA', author: '' }],
  ])('%s → false', (_n, patch) => {
    expect(isPhotoUsable({ ...photo, ...patch })).toBe(false);
  });
  it('real seed photos: none usable (all SLOT)', () => {
    for (const p of read<PhotoRec>('photos.json')) expect(isPhotoUsable(p)).toBe(false);
  });
});

describe('VET_LISTED_STATUS / isVetStatusListed — 병원 목록 상태 단일 소스', () => {
  it('only VERIFIED is listed', () => {
    expect(VET_LISTED_STATUS).toBe('VERIFIED');
    expect(isVetStatusListed('VERIFIED')).toBe(true);
    for (const s of ['REPORTED', 'BLINDED', 'SLOT', '', 'verified', null, undefined, 1]) {
      expect(isVetStatusListed(s)).toBe(false);
    }
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
