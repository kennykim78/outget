// 엔진·시드 계약 타입 (R2 계획 §C.1 — 이름 binding).
//   순수 타입 모듈: Prisma·Node 의존 없음. 클라이언트·프리렌더·시드 검증이 공용으로 import 한다.
//   *Rec 인터페이스 = server/seed/*.json 실제 형태(A-4 라벨 편집 후). 형태 변환은 로더(map.ts)에서만.
import type {
  Verdict,
  SpecOp,
  ReviewStatus,
  ReviewerType,
  ContentKind,
  Priority,
  OrderHint,
  AnimalGroup,
  AnimalTypeStatus,
  SupplyCategory,
  Lifecycle,
  BundleTier,
  ImageLicense,
  ProductStatus,
  TestimonialStatus,
  Situation,
  LinkedAction,
} from './domain.js';

// ── 규격(부록 A) ──────────────────────────────────────────────
export type SpecValue = number | boolean | string;
export type SpecValues = Readonly<Record<string, SpecValue | undefined>>;

export type SpecField =
  | { key: string; label: string; type: 'number'; min: number; max: number; optional?: boolean }
  | { key: string; label: string; type: 'boolean'; optional?: boolean }
  | {
      key: string;
      label: string;
      type: 'enum';
      options: string[];
      optional?: boolean;
      optionLabels?: Record<string, string>;
    };

export interface SpecSchema {
  fields: SpecField[];
}

export interface RuleCond {
  key: string;
  op: SpecOp;
  value: SpecValue | SpecValue[];
}

export interface SpecRule extends RuleCond {
  reason: string;
  /** A-17: 모든 조건이 참일 때만 규칙 적용(AND). 거짓 → 규칙 n/a, 키 누락 → CHECK. */
  when?: RuleCond[];
}

export interface RuleSet {
  rules: SpecRule[];
}

export type CompatOnFail = 'BELOW_MIN' | 'CHECK';
export type CompatVerdict = 'OK' | 'CHECK' | 'BELOW_MIN' | 'NONE';

export interface UserContext {
  /** supplyItemId → 사용자가 이미 가진 용품의 규격 값. */
  ownedItems: Readonly<Record<string, SpecValues>>;
}

export interface Reason {
  stage: 'PRODUCT' | 'COMPAT';
  kind: 'MIN' | 'RECOMMENDED' | 'INPUT' | 'RULE' | 'NO_CRITERIA';
  verdict: Verdict;
  key?: string;
  /** `${compatRuleId}#${index}` */
  ruleId?: string;
  expected?: SpecValue | SpecValue[];
  actual?: SpecValue;
  message: string;
}

export interface Alternative {
  supplyItemId: string;
  name: string;
}

export interface SpecCheckResult {
  /** worst(product, compat≠NONE) */
  verdict: Verdict;
  product: { verdict: Verdict; reasons: Reason[] };
  compat: { verdict: CompatVerdict; reasons: Reason[]; checkedRuleIds: string[] };
  /** product ++ compat */
  reasons: Reason[];
  /** compatibleAlternativeIds, verdict !== 'OK' 일 때만 */
  alternatives: Alternative[];
}

// ── 콘텐츠 메타(부록 B) ───────────────────────────────────────
export interface SourceRef {
  url: string;
  title: string;
  accessedAt: string;
}

export interface ContentMeta {
  reviewStatus: ReviewStatus;
  reviewerType: ReviewerType;
  verifiedBy: string | null;
  verifiedAt: string | null;
  contentKind: ContentKind;
  source: SourceRef[];
}

// ── careOverrides(A-11) ───────────────────────────────────────
export interface RequirementOverride {
  priority?: Priority;
  orderHint?: OrderHint;
  notNowReason?: string | null;
  why?: string;
  caution?: string | null;
  avoid?: string | null;
  searchKeyword?: string | null;
  minSpec?: RuleSet;
  recommendedSpec?: RuleSet;
}

export interface CareOverrides {
  /** supplyItemId → 기본 요구사항 위에 덮어쓸 값(기존 요구사항이 있는 항목만). */
  requirements?: Record<string, RequirementOverride>;
}

// ── 시드 레코드(server/seed/*.json) ───────────────────────────
export interface AnimalTypeRec extends ContentMeta {
  id: string;
  group: AnimalGroup;
  displayName: string;
  status: AnimalTypeStatus;
  aliases: string[];
  taxonId: string | null;
  careProfileId: string | null;
  careOverrides: CareOverrides;
  mascot?: string | null;
  oneLiner?: string | null;
  /** A-16: 라우트 세그먼트 /{slug}(1~2개, D3). 형태·예약어·충돌은 seed/validate-slug.ts SL00~SL05. */
  slug?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
}

/** A-8: 시드 키 유지(§5 키 매핑은 후속 마이그레이션). */
export interface TaxonLegalRec {
  animalProtectionAct6?: boolean | null;
  cites?: boolean | null;
  designatedWildlifeWhitelist?: boolean | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface TaxonRec extends ContentMeta {
  id: string;
  scientificName: string;
  koreanName: string;
  legal: TaxonLegalRec;
  revisionOf: string | null;
}

export interface CareProfileRec extends ContentMeta {
  id: string;
  name: string;
  taxonIds: string[];
  facts: Record<string, unknown>;
  careNotes: string[];
}

export interface SupplyItemRec extends ContentMeta {
  id: string;
  name: string;
  category: SupplyCategory;
  glyph: string;
  lifecycle: Lifecycle;
  specSchema: SpecSchema;
  compatibleAlternativeIds: string[];
  description: string;
  /** 시드엔 아직 없음(§5 선택 필드). */
  replaceCycleDays?: number | null;
  inspectCycleDays?: number | null;
}

export interface SupplyRequirementRec extends ContentMeta {
  id: string;
  careProfileId: string;
  supplyItemId: string;
  priority: Priority;
  orderHint: OrderHint;
  why: string;
  caution: string | null;
  avoid: string | null;
  minSpec: RuleSet;
  recommendedSpec: RuleSet;
  notNowReason: string | null;
  /** A-5: override 슬롯. `{animal}` → AnimalType.displayName. 비어 있으면 생성기. */
  searchKeyword: string | null;
}

export interface CompatRuleEntry {
  /** a=왼쪽 항목, b=오른쪽 항목 참조(expr.ts 화이트리스트 문법). */
  expr: string;
  onFail: CompatOnFail;
  message: string;
}

export interface CompatibilityRuleRec extends ContentMeta {
  id: string;
  a: string;
  b: string;
  careProfileId?: string | null;
  rules: CompatRuleEntry[];
}

export interface SetupBundleRec extends ContentMeta {
  id: string;
  careProfileId: string;
  tier: BundleTier;
  name: string;
  glyph: string;
  purpose: string;
  itemIds: string[];
  estimatedRangeText: string | null;
  note: string | null;
}

export interface CuratedProductRec extends ContentMeta {
  id: string;
  supplyItemId: string;
  careProfileIds: string[];
  title: string;
  imageAsset: string | null;
  specValues: Record<string, SpecValue>;
  /** 시드 초안 메모 — 로더가 버린다(A-3). */
  targetSpecLabel?: string | null;
  meetsMinSpec: boolean | null;
  specVerifiedBy: string | null;
  specVerifiedAt: string | null;
  status: ProductStatus | 'SLOT';
  imageLicense: ImageLicense;
  /** 시드 초안 — 비어 있어야 함(S08). 로더가 버린다. */
  curationReasons?: string[];
  note?: string | null;
}

export interface TestimonialRec {
  id: string;
  quote: string;
  animalTypeId: string;
  situation: Situation;
  linkedAction: LinkedAction;
  verifiedUsage: boolean;
  /** A-18: 평문 라벨(BETA_YYYY_MM | IN_APP). */
  source: string;
  consentAt: string | null;
  status: TestimonialStatus | 'SLOT';
  reviewerImage: string | null;
  reviewerImageConsent: boolean;
}

export interface VetVerificationRec {
  status: 'VERIFIED' | 'REPORTED' | 'BLINDED' | 'SLOT';
  method: string;
  verifiedAt: string | null;
  note: string | null;
}

export interface VetClinicSeedRec {
  id: string;
  name: string;
  region: string;
  treats: string[];
  night: boolean | null;
  emergency: boolean | null;
  phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
  verification: VetVerificationRec;
}

export interface PhotoRec {
  id: string;
  scene: string;
  slot: string;
  query: string;
  source: string | null;
  license: string | null;
  author: string | null;
  sourceUrl: string | null;
  /** R4 A2(S1 M-3): 라이선스 증서 URL — CC_BY·CC_BY_SA 필수(https://creativecommons.org/licenses/by|by-sa/N.N/). */
  licenseUrl?: string | null;
  downloadedAt: string | null;
  modified: boolean;
  status: string;
}

export interface SeedBundle {
  animalTypes: AnimalTypeRec[];
  taxa: TaxonRec[];
  careProfiles: CareProfileRec[];
  supplyItems: SupplyItemRec[];
  supplyRequirements: SupplyRequirementRec[];
  compatibilityRules: CompatibilityRuleRec[];
  setupBundles: SetupBundleRec[];
  curatedProducts: CuratedProductRec[];
  testimonials: TestimonialRec[];
  vetClinics: VetClinicSeedRec[];
  photos: PhotoRec[];
}

// ── 엔진 카탈로그 ─────────────────────────────────────────────
export interface EngineCatalog {
  readonly animalTypes: ReadonlyMap<string, AnimalTypeRec>;
  /** Taxon 참조·법 정보 공개 판정용(isTaxonExposable). 타입 노출은 보지 않는다(Kenny 2026-10-24 K-4 되돌림). 입력에 없으면 빈 Map. */
  readonly taxa: ReadonlyMap<string, TaxonRec>;
  readonly careProfiles: ReadonlyMap<string, CareProfileRec>;
  readonly supplyItems: ReadonlyMap<string, SupplyItemRec>;
  /** careProfileId → (supplyItemId → requirement), 시드 순서 유지. */
  readonly requirementsByProfile: ReadonlyMap<string, ReadonlyMap<string, SupplyRequirementRec>>;
  readonly compatibilityRules: readonly CompatibilityRuleRec[];
  /** requirement id → 시드 내 위치(정렬 tie-break). */
  readonly requirementOrder: ReadonlyMap<string, number>;
}

export interface ResolvedRequirement {
  animalTypeId: string;
  careProfileId: string;
  supplyItemId: string;
  item: Pick<
    SupplyItemRec,
    | 'id'
    | 'name'
    | 'category'
    | 'glyph'
    | 'description'
    | 'lifecycle'
    | 'specSchema'
    | 'compatibleAlternativeIds'
    | 'replaceCycleDays'
    | 'inspectCycleDays'
  >;
  priority: Priority;
  orderHint: OrderHint;
  notNowReason: string | null;
  minSpec: RuleSet;
  recommendedSpec: RuleSet;
  why: string;
  caution: string | null;
  avoid: string | null;
  searchKeyword: string | null;
  contentKind: ContentKind;
  review: {
    requirement: ContentMeta;
    item: ContentMeta;
    careProfile: ContentMeta;
    animalType: ContentMeta;
  };
  provenance: Partial<Record<keyof RequirementOverride, 'REQUIREMENT' | 'OVERRIDE'>>;
}
