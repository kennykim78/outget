// 공개 투영 타입(계획 §6-3) — 프리렌더 ws-data·공개 카탈로그와 클라이언트 하이드레이션이 공유하는 계약.
//   노출 행만 담는다. 검수자 이름(verifiedBy)·운영 메모(note)·출처 접근일은 싣지 않는다.
//   타입·상수만 있는 순수 모듈(값 계산은 server/src/prerender/project.ts).
import type {
  AnimalGroup,
  BundleTier,
  ImageLicense,
  LinkedAction,
  OrderHint,
  Priority,
  ReviewerType,
  Situation,
  SupplyCategory,
} from './domain.js';
import type { SearchLink } from './search-links.js';
import type { CatalogInput } from './catalog.js';
import type { RuleSet, SpecSchema, SpecValue } from './types.js';

export const ROUTE_KINDS = [
  'HOME',
  'FAMILY',
  'TYPE',
  'SETUP',
  'SUPPLIES',
  'SUPPLY_ITEM',
  'SUPPLY_ITEM_TYPE',
  'VET',
  'VET_REGION',
  'CREDITS',
  'NOT_FOUND',
] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];

/** ws-data `data` 의 키(정확히 이 6개 — compliance C3-OUT-ID). */
export const WS_DATA_KEYS = ['types', 'requirements', 'products', 'bundles', 'vets', 'testimonials'] as const;

export interface PublicReview {
  verifiedAt: string;
  reviewerType: ReviewerType;
}

export interface PublicAnimalType {
  id: string;
  slug: string;
  group: AnimalGroup;
  displayName: string;
  aliases: string[];
  oneLiner: string | null;
  mascot: string | null;
  careProfileId: string;
  review: PublicReview;
}

export interface PublicRequirement {
  animalTypeId: string;
  supplyItemId: string;
  priority: Priority;
  orderHint: OrderHint;
  notNowReason: string | null;
  minSpec: RuleSet;
  recommendedSpec: RuleSet;
  why: string;
  caution: string | null;
  avoid: string | null;
  searchKeyword: string;
  searchLinks: SearchLink[];
  /** glyph: SupplyItem.glyph(이미지 대체 타일·용품 목록, 스펙22 §4-2 G5). */
  item: { id: string; name: string; category: SupplyCategory; glyph: string; specSchema: SpecSchema; alternativeIds: string[] };
  source: Array<{ url: string; title: string }>;
  /** 체인(type·profile·requirement·item) verifiedAt 최솟값. */
  lastVerifiedAt: string;
}

export interface PublicProduct {
  id: string;
  supplyItemId: string;
  title: string;
  imageAsset: string | null;
  imageLicense: ImageLicense;
  specValues: Record<string, SpecValue>;
  verdict: 'OK' | 'BELOW_RECOMMENDED';
  reasonCodes: Array<'SPEC_MET' | 'PROFILE_MATCH'>;
  specVerifiedAt: string | null;
}

export interface PublicBundle {
  id: string;
  tier: BundleTier;
  name: string;
  purpose: string;
  itemIds: string[];
  estimatedRangeText: string | null;
  note: string | null;
}

export interface PublicVet {
  id: string;
  name: string;
  address: string;
  phone: string;
  region: string;
  treats: string[];
  night: boolean | null;
  emergency: boolean | null;
  lat: number | null;
  lng: number | null;
  verifiedAt: string | null;
}

export interface PublicTestimonial {
  id: string;
  quote: string;
  animalTypeId: string;
  situation: Situation;
  linkedAction: LinkedAction;
  reviewerImage: string | null;
}

export type WsLayer =
  | null
  | { kind: 'L4' | 'L5'; typeId: string; itemId: string }
  | { kind: 'L7'; typeId: string; productId: string };

export interface WsRoute {
  kind: RouteKind;
  path: string;
  typeId?: string;
  family?: string;
  itemId?: string;
  region?: string;
}

export interface WsPageData {
  v: 1;
  route: WsRoute;
  layer: WsLayer;
  /** "/data/catalog.v1.<sha8>.json" */
  catalogUrl: string;
  data: {
    types: PublicAnimalType[];
    requirements: PublicRequirement[];
    products: PublicProduct[];
    bundles: PublicBundle[];
    vets: PublicVet[];
    testimonials: PublicTestimonial[];
  };
}

/** 공개 카탈로그 = createCatalog 입력 형태(노출 행만) + 결속값. 클라이언트 specCheck 입력. */
export interface PublicCatalog extends CatalogInput {
  v: 1;
  seedDigest: string;
}
