// 공개 투영 타입(계획 §6-3) — 프리렌더 ws-data·공개 카탈로그와 클라이언트 하이드레이션이 공유하는 계약.
//   노출 행만 담는다. 검수자 이름(verifiedBy)·운영 메모(상품 note·병원 verification.note)는 어디에도 싣지 않는다
//   (SetupBundle.note 는 운영 메모가 아니라 공개 설명 문구라 bundles[].note 로 싣는다).
//   출처 접근일(source[].accessedAt): ws-data(PublicRequirement.source = {url,title})에는 없고, 공개 카탈로그(PublicCatalog —
//   createCatalog 입력 형태, project.ts publicMeta 키 허용목록 url·title·accessedAt)에는 있다(보안 79 L-5).
//   타입·상수만 있는 순수 모듈(값 계산은 server/src/prerender/project.ts).
import type {
  AnimalGroup,
  BundleTier,
  ContentKind,
  ImageLicense,
  LinkedAction,
  OrderHint,
  Priority,
  ReviewerType,
  ReviewStatus,
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
  // 301(Kenny 2026-11-22): /{slug}/tips — 저렴 대체 팁(REFERENCE). 노출 팁 ≥ 1 일 때만. 클라이언트는 정적 본문(StaticMain).
  'TIPS',
  'SUPPLIES',
  'SUPPLY_ITEM',
  'SUPPLY_ITEM_TYPE',
  'VET',
  'VET_REGION',
  'CREDITS',
  // 계획 86 P8: /privacy — 개인정보 처리방침(항상, 색인·sitemap 포함). 클라이언트는 정적 본문(StaticMain).
  'PRIVACY',
  // R5 C-R5-6(D11): /save — 홈 셸 + L8(이메일 저장) 정적 본문, noindex·sitemap 제외·robots Disallow.
  'SAVE',
  // K1(51 레인 A): /pick — 홈 셸 + L1(친구 선택) 정적 본문, noindex·sitemap 제외, canonical /.
  'PICK',
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
  /**
   * 검수 기록(VERIFIED 타입만). 356 M11: 타입 자기 메타가 GENERAL_INFO(일반 참고 정보, 코드 고정 6종)면 키 자체가 없다 —
   *   검수가 아니므로 검수일·검수자 유형을 싣지 않는다(reviewerType AI_DRAFT 문자열이 ws-data 에 나가지 않게).
   */
  review?: PublicReview;
  /**
   * 356 M11: 이 타입 페이지에 GENERAL_INFO 체인(타입·케어프로필·노출 요구사항의 type·profile·requirement·item 메타)이
   *   하나라도 있으면 true — 종 페이지 고지(「일반 참고 정보」) 대상. 전부 VERIFIED 면 키 자체가 없다(기존 ws-data 바이트 불변).
   */
  generalInfo?: true;
  /**
   * R6 G3b — 홈(HOME·PICK·SAVE) ws-data 에서만: 이 타입의 "규격 확인 가능한 첫 항목" SupplyItem id
   *   (노출 요구사항 중 item.specSchema.fields.length > 0, 엔진 순서 orderHint → priority → 시드 순 첫 항목, 불변식 7).
   *   후기 행동 SPEC_CHECK → /{slug}/check/{id}. 해당 항목이 없거나 홈이 아닌 페이지면 키 자체가 없다.
   */
  specCheckItemId?: string;
  /**
   * 286 U3b — 홈(HOME·PICK·SAVE) ws-data 에서만: 이 타입에 /{slug}/setup(구성안) 페이지가 있으면 true
   *   (routes.ts 와 같은 조건 = 노출 구성안 1개 이상). 시작 카드 「구성안」 대상·노출 판정. 없거나 홈이 아닌 페이지면 키 자체가 없다.
   */
  setupAvailable?: true;
  /**
   * 286 U3c·U3d — 홈(HOME·PICK·SAVE) ws-data 에서만, 대표 타입(노출 타입 시드 순 첫 번째, D11 ①)에만: 홈 A 설명 섹션 데이터
   *   (engine home-a.ts homeAExplainOf — 노출 요구사항의 시드 값 그대로). 숫자·이름이 하나도 없거나 홈이 아닌 페이지면 키 자체가 없다.
   */
  homeExplain?: HomeAExplain;
  /**
   * 359(감사 356r M2, D-2): 이 종의 종 자리 사진(engine resolvePhoto → publicPhotoOf). 사용 가능(usable ∧ asset) 자리만 키,
   *   하나도 없으면 키 자체가 없다(SLOT 동안 ws-data 바이트 불변). 사진 고르기는 엔진 한 곳 — 클라이언트는 재판정하지 않는다.
   */
  photos?: PublicTypePhotos;
  /**
   * 359 D-3 — 홈(HOME·PICK·SAVE) ws-data 에서만, 대표 타입에만, 그 타입이 장면 행 허용 종(engine SCENE_PHOTO_TYPE_IDS)일 때만:
   *   홈 A 시작 카드·설명 장면 사진. 사용 가능 장면이 없거나 홈이 아닌 페이지면 키 자체가 없다.
   */
  homeScenes?: PublicHomeScenes;
}

/**
 * 359 공개 사진(ws-data) — 자리 하나의 고른 결과. id 키 이름은 photoId(C3-OUT-ID 의 타입 id 검사와 섞이지 않게).
 *   speciesCheck(사람 이름)·promptPath·source·author 는 싣지 않는다. aiGenerated 는 「생성 이미지 · 임시」 표기 대상일 때만 키.
 */
export interface PublicPhoto {
  photoId: string;
  asset: string;
  aiGenerated?: true;
}

/** 종 자리 3개(habitat·now-lead·spec) — 있을 때만 키. */
export interface PublicTypePhotos {
  habitat?: PublicPhoto;
  nowLead?: PublicPhoto;
  spec?: PublicPhoto;
}

/** 홈 A 장면 자리(engine HOME_A_SCENE_PHOTOS 키와 같다) — 있을 때만 키. */
export interface PublicHomeScenes {
  startChecklist?: PublicPhoto;
  startSpecCheck?: PublicPhoto;
  startSetup?: PublicPhoto;
  explainNeed?: PublicPhoto;
  explainFigures?: PublicPhoto;
}

/** 홈 A 설명 섹션 데이터(286 U3c·U3d) — 값은 노출 요구사항의 시드 값 그대로(minSpecFigure·item.name). */
export interface HomeAExplain {
  /** 「숫자로 알려 드려요」 행 — values·unit·base = 엔진 minSpecFigure 결과. */
  figures: Array<{ requirementId: string; itemId: string; itemName: string; values: number[]; unit: string; base: string | null }>;
  /** 「필요해요」 열(REQUIRED 앞 N) — notNow 와 함께 둘 다 있거나 둘 다 []. */
  need: Array<{ requirementId: string; name: string }>;
  /** 「지금은 필요 없어요」 열(NOT_NOW 시드 레코드 앞 N). */
  notNow: Array<{ requirementId: string; name: string }>;
}

export interface PublicRequirement {
  /** SupplyRequirement id(R5 계약 확장) — 클라이언트 L4/L5 가 data-ws-id="supplyRequirements#…" 를 달 때 쓴다. 노출 요구사항만. */
  requirementId: string;
  animalTypeId: string;
  supplyItemId: string;
  priority: Priority;
  orderHint: OrderHint;
  notNowReason: string | null;
  minSpec: RuleSet;
  recommendedSpec: RuleSet;
  why: string;
  /**
   * D9 ②: 이유 한 줄(resolveRequirement 최종값). 값이 있을 때만 키 — 없으면 키 자체가 없다(null 을 싣지 않는다).
   *   화면은 engine reasonLine(whyShort ?? firstSentence(why)). 와이어(ws-wire) 는 이 키를 그대로 통과(버전 불변).
   */
  whyShort?: string;
  caution: string | null;
  avoid: string | null;
  searchKeyword: string;
  searchLinks: SearchLink[];
  /** glyph: SupplyItem.glyph(이미지 대체 타일·용품 목록, 스펙22 §4-2 G5). */
  item: { id: string; name: string; category: SupplyCategory; glyph: string; specSchema: SpecSchema; alternativeIds: string[] };
  source: Array<{ url: string; title: string }>;
  /**
   * 체인(type·profile·requirement·item) verifiedAt 최솟값. 356 M11: 체인에 GENERAL_INFO 가 있으면 '' —
   *   검수하지 않은 칸이 섞인 행에 검수일(「마지막 검수」)을 붙이지 않는다(화면은 yearMonth('') = null → 표기 0).
   */
  lastVerifiedAt: string;
  /** 356 M11: 체인 메타 중 GENERAL_INFO 가 하나라도 있으면 true(lastVerifiedAt 뒤). 없으면 키 자체가 없다. */
  generalInfo?: true;
  /** 359 D-2: 품목 자리 사진(engine resolvePhoto use=item → publicPhotoOf). 사용 가능할 때만 키(맨 뒤). */
  photo?: PublicPhoto;
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

/**
 * 공개 카탈로그 행 메타의 런타임 형태(356 단계 10, 총괄 결정): 검수자 이름 없음(verifiedBy null).
 *   - GENERAL_INFO 행: reviewerType 키 없음 + generalInfo: true(검수 기록이 아니다 — `"reviewerType":"AI_DRAFT"` 미노출).
 *   - 그 밖 행: reviewerType 있음, generalInfo 키 없음.
 *   compliance C3-OUT-REVIEWMETA 가 산출물 카탈로그에서 이 형태를 검사한다(scripts/lib/rules-output.mjs checkCatalogMeta).
 *   PublicCatalog 의 정적 타입은 CatalogInput 호환(클라 createCatalog 입력)이라 reviewerType 이 필수로 보이지만,
 *   카탈로그 소비처(규격 판정)는 reviewerType 을 읽지 않는다 — 노출 재판정에 쓰면 안 된다.
 */
export type PublicCatalogMeta = {
  verifiedBy: null;
  verifiedAt: string | null;
  contentKind: ContentKind;
  source: Array<{ url: string; title: string; accessedAt: string }>;
} & ({ reviewStatus: 'GENERAL_INFO'; generalInfo: true } | { reviewStatus: ReviewStatus; reviewerType: ReviewerType });

/** 공개 카탈로그 = createCatalog 입력 형태(노출 행만) + 결속값. 클라이언트 specCheck 입력. 행 메타 런타임 형태는 PublicCatalogMeta. */
export interface PublicCatalog extends CatalogInput {
  v: 1;
  seedDigest: string;
}
