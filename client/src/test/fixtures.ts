// 합성 ws-data fixture(D12 — 시드 아님, 실제 데이터 아님). 홈 A/B·F8 테스트 공용.
import type {
  PublicAnimalType,
  PublicBundle,
  PublicProduct,
  PublicRequirement,
  PublicTestimonial,
  RouteKind,
  WsLayer,
  WsPageData,
} from '@ws/engine';
import type { Priority } from '@ws/engine';

export const golden: PublicAnimalType = {
  id: 'hamster-golden',
  slug: 'hamster/golden',
  group: 'SMALL_MAMMAL',
  displayName: '골든햄스터',
  aliases: ['시리안햄스터'],
  oneLiner: '혼자 지내는 걸 좋아하는 친구',
  mascot: 'hamster-golden',
  careProfileId: 'cp-syrian',
  review: { verifiedAt: '2026-09-01', reviewerType: 'EXPERIENCED_KEEPER' },
};

// 두 번째 합성 타입(다동물 격리 테스트용 — 실제 데이터 아님, 드워프 사실 창작 없음).
export const second: PublicAnimalType = {
  id: 'fixture-second',
  slug: 'hamster/fixture',
  group: 'SMALL_MAMMAL',
  displayName: '픽스처햄스터',
  aliases: [],
  oneLiner: '합성 두 번째 타입',
  mascot: 'hamster-golden',
  careProfileId: 'cp-fixture-second',
  review: { verifiedAt: '2026-09-01', reviewerType: 'EXPERIENCED_KEEPER' },
};

export function req(id: string, priority: Priority, name = id): PublicRequirement {
  return {
    requirementId: `req-${id}`,
    animalTypeId: golden.id,
    supplyItemId: id,
    priority,
    orderHint: 'BEFORE_ARRIVAL',
    notNowReason: null,
    minSpec: { rules: [] },
    recommendedSpec: { rules: [] },
    why: 'w',
    caution: null,
    avoid: null,
    searchKeyword: 'k',
    searchLinks: [],
    item: { id, name, category: 'CAGE', glyph: 'G', specSchema: { fields: [] }, alternativeIds: [] },
    source: [],
    lastVerifiedAt: '2026-09-30',
  };
}

/** second 타입의 요구사항 — 골든 req 를 animalTypeId·requirementId 만 바꿔 복제. */
export function secondReq(id: string, priority: Priority, name = id): PublicRequirement {
  return { ...req(id, priority, name), requirementId: `req-${second.id}-${id}`, animalTypeId: second.id };
}

export const secondRequirements: PublicRequirement[] = [
  secondReq('cage', 'REQUIRED', '픽스처케이지'),
  secondReq('wheel', 'REQUIRED', '픽스처바퀴'),
  secondReq('bath', 'REQUIRED', '픽스처목욕통'),
];

export function product(id: string, supplyItemId: string, title = `상품 ${id}`): PublicProduct {
  return {
    id,
    supplyItemId,
    title,
    imageAsset: null,
    imageLicense: 'NONE',
    specValues: {},
    verdict: 'OK',
    reasonCodes: ['SPEC_MET'],
    specVerifiedAt: '2026-09-30',
  };
}

export function bundle(id: string, tier: PublicBundle['tier'], itemIds: string[]): PublicBundle {
  return { id, tier, name: `구성 ${id}`, purpose: '목적', itemIds, estimatedRangeText: '5만~8만', note: null };
}

export function testimonial(i: number): PublicTestimonial {
  return {
    id: `t${i}`,
    quote: `후기 문장 ${i}`,
    animalTypeId: golden.id,
    situation: i % 2 ? 'FIRST_TIME' : 'ALREADY',
    linkedAction: (['CHECKLIST', 'SPEC_CHECK', 'SETUP', 'VET'] as const)[i % 4],
    reviewerImage: null,
  };
}

export function pageOf(kind: RouteKind, over: Partial<WsPageData['data']> = {}, extra: { typeId?: string; layer?: WsLayer; path?: string } = {}): WsPageData {
  return {
    v: 1,
    route: { kind, path: extra.path ?? '/', ...(extra.typeId ? { typeId: extra.typeId } : {}) },
    layer: extra.layer ?? null,
    catalogUrl: '/data/catalog.v1.0123abcd.json',
    data: { types: [golden], requirements: [], products: [], bundles: [], vets: [], testimonials: [], ...over },
  };
}
