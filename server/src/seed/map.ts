// 시드 레코드 → Prisma 행 데이터(순수). 형태 변환은 여기서만(A-3):
//   배열·객체 → JSON 문자열, bundle itemIds → SetupBundleItem 행, vet verification 평탄화,
//   curated note/targetSpecLabel/curationReasons 버림, meetsMinSpec 은 재계산값(A-12).
import type {
  AnimalTypeRec,
  CareProfileRec,
  CompatibilityRuleRec,
  ContentMeta,
  CuratedProductRec,
  SetupBundleRec,
  SupplyItemRec,
  SupplyRequirementRec,
  TaxonRec,
  TestimonialRec,
  VetClinicSeedRec,
} from '../engine/types.js';

export type RowData = Record<string, string | number | boolean | null>;

/** 키를 정렬한 결정적 JSON(행 데이터·digest 공용). */
export function stableJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** 시드 원문의 키 순서를 보존한 JSON(사람이 읽는 값·의미 있는 순서 유지). */
const json = (v: unknown): string => JSON.stringify(v);

function metaRow(m: ContentMeta): RowData {
  return {
    reviewStatus: m.reviewStatus,
    reviewerType: m.reviewerType,
    verifiedBy: m.verifiedBy ?? null,
    verifiedAt: m.verifiedAt ?? null,
    contentKind: m.contentKind,
    source: json(m.source ?? []),
  };
}

export function mapTaxon(r: TaxonRec): RowData {
  return {
    id: r.id,
    scientificName: r.scientificName,
    koreanName: r.koreanName,
    rank: 'SPECIES',
    legal: json(r.legal ?? {}),
    revisionOf: r.revisionOf ?? null,
    ...metaRow(r),
  };
}

export function mapCareProfile(r: CareProfileRec): RowData {
  return {
    id: r.id,
    name: r.name,
    taxonIds: json(r.taxonIds ?? []),
    axes: null,
    facts: json(r.facts ?? {}),
    careNotes: json(r.careNotes ?? []),
    seasonal: null,
    ...metaRow(r),
  };
}

export function mapAnimalType(r: AnimalTypeRec): RowData {
  return {
    id: r.id,
    slug: r.slug ?? null,
    group: r.group,
    displayName: r.displayName,
    aliases: json(r.aliases ?? []),
    parentTypeId: null,
    taxonId: r.taxonId ?? null,
    careProfileId: r.careProfileId ?? null,
    careOverrides: json(r.careOverrides ?? {}),
    mascot: r.mascot ?? null,
    oneLiner: r.oneLiner ?? null,
    seoTitle: r.seoTitle ?? null,
    seoDescription: r.seoDescription ?? null,
    status: r.status,
    ...metaRow(r),
  };
}

export function mapSupplyItem(r: SupplyItemRec): RowData {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    glyph: r.glyph ?? null,
    description: r.description ?? null,
    lifecycle: r.lifecycle,
    replaceCycleDays: r.replaceCycleDays ?? null,
    inspectCycleDays: r.inspectCycleDays ?? null,
    compatibleAlternativeIds: json(r.compatibleAlternativeIds ?? []),
    specSchema: json(r.specSchema),
    ...metaRow(r),
  };
}

export function mapSupplyRequirement(r: SupplyRequirementRec): RowData {
  return {
    id: r.id,
    careProfileId: r.careProfileId,
    supplyItemId: r.supplyItemId,
    priority: r.priority,
    notNowReason: r.notNowReason ?? null,
    orderHint: r.orderHint,
    minSpec: json(r.minSpec),
    recommendedSpec: json(r.recommendedSpec ?? { rules: [] }),
    why: r.why,
    // D9 ②: 시드 키 부재 = 미작성 → DB NULL(시드에는 null 을 쓰지 않는다 — S03).
    whyShort: typeof r.whyShort === 'string' ? r.whyShort : null,
    caution: r.caution ?? null,
    avoid: r.avoid ?? null,
    searchKeyword: r.searchKeyword ?? null,
    ...metaRow(r),
  };
}

export function mapCompatibilityRule(r: CompatibilityRuleRec): RowData {
  return {
    id: r.id,
    careProfileId: r.careProfileId ?? null,
    a: r.a,
    b: r.b,
    rules: json(r.rules),
    ...metaRow(r),
  };
}

export function mapSetupBundle(r: SetupBundleRec): RowData {
  return {
    id: r.id,
    careProfileId: r.careProfileId,
    tier: r.tier,
    name: r.name,
    glyph: r.glyph ?? null,
    purpose: r.purpose ?? null,
    note: r.note ?? null,
    estimatedRangeText: r.estimatedRangeText ?? null,
    ...metaRow(r),
  };
}

/** itemIds → SetupBundleItem 행. position = 시드 배열 순서(0부터). */
export function mapSetupBundleItems(r: SetupBundleRec): RowData[] {
  return r.itemIds.map((supplyItemId, position) => ({ bundleId: r.id, supplyItemId, position, note: null }));
}

/** meetsMinSpec 은 시드 값이 아니라 재계산값(불변식 3). */
export function mapCuratedProduct(r: CuratedProductRec, meetsMinSpec: boolean): RowData {
  return {
    id: r.id,
    supplyItemId: r.supplyItemId,
    careProfileIds: json(r.careProfileIds ?? []),
    title: r.title,
    imageAsset: r.imageAsset ?? null,
    imageLicense: r.imageLicense,
    specValues: json(r.specValues ?? {}),
    meetsMinSpec,
    eligibility: null,
    specVerifiedBy: r.specVerifiedBy ?? null,
    specVerifiedAt: r.specVerifiedAt ?? null,
    status: r.status,
    sponsored: false,
    disclosure: false,
    ...metaRow(r),
  };
}

/** 병원 좌표는 병원 주소 기준 핀(옵셔널) — 사용자 위치 아님(불변식 8). */
export function mapVetClinic(r: VetClinicSeedRec): RowData {
  const pin = { lat: r.lat ?? null, lng: r.lng ?? null };
  return {
    id: r.id,
    name: r.name,
    region: r.region,
    address: r.address,
    phone: r.phone,
    ...pin,
    treats: json(r.treats ?? []),
    hours: null,
    night: r.night ?? null,
    emergency: r.emergency ?? null,
    source: 'SEED',
    status: r.verification.status,
    verificationMethod: r.verification.method ?? null,
    verifiedAt: r.verification.verifiedAt ?? null,
    verificationNote: r.verification.note ?? null,
  };
}

export function mapTestimonial(r: TestimonialRec): RowData {
  return {
    id: r.id,
    quote: r.quote,
    animalTypeId: r.animalTypeId,
    situation: r.situation,
    linkedAction: r.linkedAction,
    verifiedUsage: r.verifiedUsage === true,
    source: r.source,
    consentAt: r.consentAt ?? null,
    status: r.status,
    reviewerImage: r.reviewerImage ?? null,
    reviewerImageConsent: r.reviewerImageConsent === true,
    createdAt: '',
  };
}
