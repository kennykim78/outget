// 도메인 enum 유니온 + 가드 — schema.prisma 의 String enum 컬럼과 1:1.
//   Prisma·Node 의존 없음(클라이언트·프리렌더가 그대로 import 한다, PRD US-021).
//   시드 초안의 SLOT(빈 자리)은 어떤 유니온에도 넣지 않는다 — 로더가 건너뛴다.

function guard<T extends string>(values: readonly T[]): (v: unknown) => v is T {
  return (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v);
}

export const ANIMAL_GROUPS = ['SMALL_MAMMAL', 'PARROT'] as const;
export type AnimalGroup = (typeof ANIMAL_GROUPS)[number];
export const isAnimalGroup = guard(ANIMAL_GROUPS);

export const ANIMAL_TYPE_STATUSES = ['ACTIVE', 'PLANNED'] as const;
export type AnimalTypeStatus = (typeof ANIMAL_TYPE_STATUSES)[number];
export const isAnimalTypeStatus = guard(ANIMAL_TYPE_STATUSES);

export const TAXON_RANKS = ['SPECIES', 'GROUP'] as const;
export type TaxonRank = (typeof TAXON_RANKS)[number];
export const isTaxonRank = guard(TAXON_RANKS);

export const REVIEW_STATUSES = ['DRAFT', 'NEEDS_REVIEW', 'VERIFIED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const isReviewStatus = guard(REVIEW_STATUSES);

// 배열 순서 = 검수 등급(낮음 → 높음, 제품기획 §7.3).
export const REVIEWER_TYPES = [
  'AI_DRAFT',
  'OPERATOR',
  'EXPERIENCED_KEEPER',
  'VET_PUBLISHED_SOURCE',
  'OFFICIAL_SOURCE',
  'VET',
] as const;
export type ReviewerType = (typeof REVIEWER_TYPES)[number];
export const isReviewerType = guard(REVIEWER_TYPES);

/** 검수 등급(0 = AI_DRAFT). 알 수 없는 값은 -1. */
export function reviewerRank(t: string): number {
  return (REVIEWER_TYPES as readonly string[]).indexOf(t);
}

export const CONTENT_KINDS = ['SPEC', 'CARE', 'FOOD', 'HEALTH', 'LEGAL'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];
export const isContentKind = guard(CONTENT_KINDS);

// 제품기획 §5 집합(D-6). 시드 초안 값은 R2 에서 재매핑.
export const SUPPLY_CATEGORIES = [
  'CAGE',
  'WHEEL',
  'BEDDING',
  'FOOD',
  'WATER',
  'HIDE',
  'BATH',
  'TOY',
  'HEALTH',
  'ETC',
] as const;
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];
export const isSupplyCategory = guard(SUPPLY_CATEGORIES);

export const LIFECYCLES = ['DURABLE', 'CONSUMABLE'] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];
export const isLifecycle = guard(LIFECYCLES);

export const PRIORITIES = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'NOT_NOW'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const isPriority = guard(PRIORITIES);

// 제품기획 §5(D-7). 시드 초안의 AFTER_SETTLING 은 R2 에서 AFTER_ADAPTATION 으로 라벨 매핑.
export const ORDER_HINTS = [
  'BEFORE_ARRIVAL',
  'FIRST_WEEK',
  'AFTER_ADAPTATION',
  'AS_NEEDED',
] as const;
export type OrderHint = (typeof ORDER_HINTS)[number];
export const isOrderHint = guard(ORDER_HINTS);

export const BUNDLE_TIERS = ['BUDGET', 'BALANCED', 'USED_MIX'] as const;
export type BundleTier = (typeof BUNDLE_TIERS)[number];
export const isBundleTier = guard(BUNDLE_TIERS);

export const REACTION_TARGETS = ['SUPPLY_ITEM', 'GUIDE', 'BUNDLE', 'PRODUCT'] as const;
export type ReactionTarget = (typeof REACTION_TARGETS)[number];
export const isReactionTarget = guard(REACTION_TARGETS);

export const REACTION_KINDS = ['HELPFUL', 'LIKE', 'RECHECK'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];
export const isReactionKind = guard(REACTION_KINDS);

export const PRODUCT_STATUSES = ['ACTIVE', 'DISCONTINUED', 'REVIEW'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const isProductStatus = guard(PRODUCT_STATUSES);

export const IMAGE_LICENSES = [
  'OWN_PHOTO',
  'SELLER_PERMISSION',
  'AFFILIATE_API',
  'NONE',
] as const;
export type ImageLicense = (typeof IMAGE_LICENSES)[number];
export const isImageLicense = guard(IMAGE_LICENSES);

export const VET_SOURCES = ['SEED', 'USER_REPORT'] as const;
export type VetSource = (typeof VET_SOURCES)[number];
export const isVetSource = guard(VET_SOURCES);

export const VET_STATUSES = ['VERIFIED', 'REPORTED', 'BLINDED'] as const;
export type VetStatus = (typeof VET_STATUSES)[number];
export const isVetStatus = guard(VET_STATUSES);

export const TESTIMONIAL_STATUSES = ['SUBMITTED', 'APPROVED', 'HIDDEN'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];
export const isTestimonialStatus = guard(TESTIMONIAL_STATUSES);

export const SITUATIONS = ['FIRST_TIME', 'ALREADY'] as const;
export type Situation = (typeof SITUATIONS)[number];
export const isSituation = guard(SITUATIONS);

export const LINKED_ACTIONS = ['CHECKLIST', 'SPEC_CHECK', 'SETUP', 'VET'] as const;
export type LinkedAction = (typeof LINKED_ACTIONS)[number];
export const isLinkedAction = guard(LINKED_ACTIONS);

export const VERDICTS = ['OK', 'BELOW_RECOMMENDED', 'BELOW_MIN', 'CHECK'] as const;
export type Verdict = (typeof VERDICTS)[number];
export const isVerdict = guard(VERDICTS);

export const SPEC_OPS = ['gte', 'lte', 'eq', 'in', 'not_in'] as const;
export type SpecOp = (typeof SPEC_OPS)[number];
export const isSpecOp = guard(SPEC_OPS);
