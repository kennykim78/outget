// 공개 투영(계획 §6-3, D4·D6) — 시드 묶음 → 노출 행만 담은 사이트 모델. 순수(입력 불변, 시각·난수 없음).
//   노출 판단은 전부 engine 노출 API(isAnimalTypeExposable · isRequirementExposable · orderExposableProducts ·
//   isBundleExposable · isCompatRuleExposable · isVetListed · isTestimonialExposable · isPhotoUsable).
//   요구사항 값은 resolveRequirement 결과만 쓴다(불변식 6). verifiedBy·운영 메모·출처 접근일은 싣지 않는다.
import {
  buildSearchKeyword,
  buildSearchLinks,
  createCatalog,
  isAnimalTypeExposable,
  isBundleExposable,
  isCompatRuleExposable,
  isPhotoUsable,
  isRequirementExposable,
  isTestimonialExposable,
  isVetListed,
  listResolvedRequirements,
  orderExposableProducts,
  type AnimalTypeRec,
  type CareProfileRec,
  type CatalogInput,
  type CompatibilityRuleRec,
  type ContentMeta,
  type EngineCatalog,
  type PhotoRec,
  type PublicAnimalType,
  type PublicBundle,
  type PublicProduct,
  type PublicRequirement,
  type PublicTestimonial,
  type PublicVet,
  type ResolvedRequirement,
  type SeedBundle,
  type SupplyItemRec,
  type SupplyRequirementRec,
} from '../engine/index.js';

export interface RequirementModel {
  /** 기반 SupplyRequirement id(data-ws-id). */
  requirementId: string;
  pub: PublicRequirement;
  item: Pick<SupplyItemRec, 'id' | 'name' | 'category' | 'glyph' | 'specSchema'>;
  /** orderExposableProducts 순서(규격 → 검수 → 시드). */
  products: PublicProduct[];
}

export interface TypeModel {
  id: string;
  slug: string;
  /** 2 세그먼트 slug 의 첫 세그먼트(/hamster). 단일 세그먼트면 null. */
  family: string | null;
  rec: AnimalTypeRec;
  pub: PublicAnimalType;
  requirements: RequirementModel[];
  bundles: PublicBundle[];
  /** 요구사항 순서 → 항목 안 노출 순서. */
  products: PublicProduct[];
  lastmod: string | null;
}

export interface ItemModel {
  id: string;
  name: string;
  category: SupplyItemRec['category'];
  /** 이 항목을 노출하는 타입(시드 순서). */
  typeIds: string[];
  lastmod: string | null;
}

export interface CreditModel {
  id: string;
  scene: string;
  author: string | null;
  license: string;
  source: string;
  sourceUrl: string;
}

export interface SiteModel {
  cat: EngineCatalog;
  types: TypeModel[];
  /** 노출 요구사항이 하나라도 있는 SupplyItem(시드 순서). */
  items: ItemModel[];
  vets: PublicVet[];
  testimonials: PublicTestimonial[];
  /** /credits 대상: 사용 가능 ∧ CC_BY·CC_BY_SA(저작자 표시 의무). */
  credits: CreditModel[];
  catalog: CatalogInput;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** 'YYYY-MM-DD…' → 'YYYY-MM-DD', 아니면 null. */
export function dateOf(v: unknown): string | null {
  return typeof v === 'string' && DATE_RE.test(v) ? v.slice(0, 10) : null;
}

export function maxDate(ds: ReadonlyArray<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const d of ds) if (typeof d === 'string' && (out === null || d > out)) out = d;
  return out;
}

function minDate(ds: ReadonlyArray<string | null | undefined>): string | null {
  let out: string | null = null;
  for (const d of ds) if (typeof d === 'string' && (out === null || d < out)) out = d;
  return out;
}

function sources(m: ContentMeta): Array<{ url: string; title: string }> {
  return Array.isArray(m.source) ? m.source.map((s) => ({ url: String(s.url), title: String(s.title) })) : [];
}

/** ContentMeta 공개형: 검수자 이름 제거. */
function publicMeta(m: ContentMeta): ContentMeta {
  return {
    reviewStatus: m.reviewStatus,
    reviewerType: m.reviewerType,
    verifiedBy: null,
    verifiedAt: m.verifiedAt,
    contentKind: m.contentKind,
    // 키 허용목록(보안 L-2): SourceRef 의 url·title·accessedAt 만 — 시드에 덧붙은 메모 키가 카탈로그로 새지 않게.
    source: Array.isArray(m.source)
      ? m.source.map((s) => ({ url: String(s.url), title: String(s.title), accessedAt: String(s.accessedAt) }))
      : [],
  };
}

function projectRequirement(
  at: AnimalTypeRec,
  r: ResolvedRequirement,
  exposedItemIds: ReadonlySet<string>,
): PublicRequirement {
  const keyword = buildSearchKeyword(at, r);
  const lastVerifiedAt =
    minDate([
      dateOf(r.review.animalType.verifiedAt),
      dateOf(r.review.careProfile.verifiedAt),
      dateOf(r.review.requirement.verifiedAt),
      dateOf(r.review.item.verifiedAt),
    ]) ?? '';
  return {
    animalTypeId: r.animalTypeId,
    supplyItemId: r.supplyItemId,
    priority: r.priority,
    orderHint: r.orderHint,
    notNowReason: r.notNowReason,
    minSpec: r.minSpec,
    recommendedSpec: r.recommendedSpec,
    why: r.why,
    caution: r.caution,
    avoid: r.avoid,
    searchKeyword: keyword,
    searchLinks: buildSearchLinks(keyword),
    item: {
      id: r.item.id,
      name: r.item.name,
      category: r.item.category,
      specSchema: r.item.specSchema,
      alternativeIds: r.item.compatibleAlternativeIds.filter((id) => id !== r.item.id && exposedItemIds.has(id)),
    },
    source: sources(r.review.requirement),
    lastVerifiedAt,
  };
}

function projectType(at: AnimalTypeRec, slug: string, careProfileId: string): PublicAnimalType {
  return {
    id: at.id,
    slug,
    group: at.group,
    displayName: at.displayName,
    aliases: [...at.aliases],
    oneLiner: at.oneLiner ?? null,
    mascot: at.mascot ?? null,
    careProfileId,
    review: { verifiedAt: dateOf(at.verifiedAt) ?? '', reviewerType: at.reviewerType },
  };
}

export function projectSite(seed: SeedBundle): SiteModel {
  const cat = createCatalog(seed);
  const types: TypeModel[] = [];
  const reqRowById = new Map<string, SupplyRequirementRec>();
  for (const r of seed.supplyRequirements) if (!reqRowById.has(r.id)) reqRowById.set(r.id, r);

  for (const at of cat.animalTypes.values()) {
    if (!isAnimalTypeExposable(cat, at.id)) continue;
    if (typeof at.slug !== 'string' || !at.careProfileId) continue; // validate SL00 가 막는다 — fail-closed
    const exposed = listResolvedRequirements(cat, at.id).filter((r) => isRequirementExposable(cat, r));
    const exposedItemIds = new Set(exposed.map((r) => r.supplyItemId));
    const profile = cat.careProfiles.get(at.careProfileId) as CareProfileRec;

    const requirements: RequirementModel[] = exposed.map((r) => {
      const base = cat.requirementsByProfile.get(r.careProfileId)?.get(r.supplyItemId) as SupplyRequirementRec;
      const ordered = orderExposableProducts(
        cat,
        at.id,
        seed.curatedProducts.filter((p) => p.supplyItemId === r.supplyItemId),
      );
      const products: PublicProduct[] = ordered.map(({ product: p, verdict }) => ({
        id: p.id,
        supplyItemId: p.supplyItemId,
        title: p.title,
        imageAsset: p.imageLicense !== 'NONE' && typeof p.imageAsset === 'string' ? p.imageAsset : null,
        imageLicense: p.imageLicense,
        specValues: { ...p.specValues },
        verdict,
        reasonCodes: ['SPEC_MET', 'PROFILE_MATCH'],
        specVerifiedAt: dateOf(p.specVerifiedAt),
      }));
      return {
        requirementId: base.id,
        pub: projectRequirement(at, r, exposedItemIds),
        item: {
          id: r.item.id,
          name: r.item.name,
          category: r.item.category,
          glyph: r.item.glyph,
          specSchema: r.item.specSchema,
        },
        products,
      };
    });

    const bundleRows = seed.setupBundles.filter((b) => isBundleExposable(cat, at.id, b));
    const bundles: PublicBundle[] = bundleRows.map((b) => ({
      id: b.id,
      tier: b.tier,
      name: b.name,
      purpose: b.purpose,
      itemIds: [...b.itemIds],
      estimatedRangeText: b.estimatedRangeText,
      note: b.note,
    }));
    const products = requirements.flatMap((r) => r.products);
    const productRows = seed.curatedProducts.filter((p) => products.some((x) => x.id === p.id));

    const segs = at.slug.split('/');
    types.push({
      id: at.id,
      slug: at.slug,
      family: segs.length === 2 ? segs[0] : null,
      rec: at,
      pub: projectType(at, at.slug, at.careProfileId),
      requirements,
      bundles,
      products,
      lastmod: maxDate([
        dateOf(at.verifiedAt),
        dateOf(profile.verifiedAt),
        ...exposed.map((r) => dateOf(r.review.requirement.verifiedAt)),
        ...exposed.map((r) => dateOf(r.review.item.verifiedAt)),
        ...bundleRows.map((b) => dateOf(b.verifiedAt)),
        ...productRows.map((p) => dateOf(p.verifiedAt)),
      ]),
    });
  }

  // 항목(용품으로 찾기) — 노출 타입 중 하나 이상에서 노출되는 SupplyItem.
  const items: ItemModel[] = [];
  for (const it of cat.supplyItems.values()) {
    const typeIds = types.filter((t) => t.requirements.some((r) => r.item.id === it.id)).map((t) => t.id);
    if (typeIds.length === 0) continue;
    const reqDates = types.flatMap((t) =>
      t.requirements.filter((r) => r.item.id === it.id).map((r) => dateOf(reqRowById.get(r.requirementId)?.verifiedAt)),
    );
    items.push({
      id: it.id,
      name: it.name,
      category: it.category,
      typeIds,
      lastmod: maxDate([dateOf(it.verifiedAt), ...reqDates]),
    });
  }

  const vets: PublicVet[] = seed.vetClinics.filter(isVetListed).map((v) => ({
    id: v.id,
    name: v.name,
    address: v.address,
    phone: v.phone,
    region: v.region,
    treats: [...v.treats],
    night: v.night,
    emergency: v.emergency,
    lat: typeof v.lat === 'number' ? v.lat : null,
    lng: typeof v.lng === 'number' ? v.lng : null,
    verifiedAt: dateOf(v.verification.verifiedAt),
  }));

  const testimonials: PublicTestimonial[] = seed.testimonials.filter(isTestimonialExposable).map((t) => ({
    id: t.id,
    quote: t.quote,
    animalTypeId: t.animalTypeId,
    situation: t.situation,
    linkedAction: t.linkedAction,
    reviewerImage: t.reviewerImageConsent === true && typeof t.reviewerImage === 'string' ? t.reviewerImage : null,
  }));

  const credits: CreditModel[] = seed.photos
    .filter((p: PhotoRec) => isPhotoUsable(p) && (p.license === 'CC_BY' || p.license === 'CC_BY_SA'))
    .map((p) => ({
      id: p.id,
      scene: p.scene,
      author: p.author,
      license: p.license as string,
      source: p.source as string,
      sourceUrl: p.sourceUrl as string,
    }));

  return { cat, types, items, vets, testimonials, credits, catalog: projectCatalog(cat, seed, types) };
}

/** 공개 카탈로그(D6): createCatalog 입력 형태, 노출 행만, 검수자 이름 제거, override·대안은 노출 항목으로 한정. */
function projectCatalog(cat: EngineCatalog, seed: SeedBundle, types: readonly TypeModel[]): CatalogInput {
  const itemsByType = new Map(types.map((t) => [t.id, new Set(t.requirements.map((r) => r.item.id))]));
  const exposedItems = new Set(types.flatMap((t) => t.requirements.map((r) => r.item.id)));
  const exposedReqIds = new Set(types.flatMap((t) => t.requirements.map((r) => r.requirementId)));
  const profileIds = new Set(types.map((t) => t.rec.careProfileId as string));

  const animalTypes: AnimalTypeRec[] = types.map((t) => {
    const allowed = itemsByType.get(t.id) as Set<string>;
    const reqs = t.rec.careOverrides?.requirements ?? {};
    const kept = Object.fromEntries(Object.entries(reqs).filter(([itemId]) => allowed.has(itemId)));
    return {
      ...publicMeta(t.rec),
      id: t.rec.id,
      group: t.rec.group,
      displayName: t.rec.displayName,
      status: t.rec.status,
      aliases: [...t.rec.aliases],
      taxonId: t.rec.taxonId,
      careProfileId: t.rec.careProfileId,
      careOverrides: Object.keys(kept).length > 0 ? { requirements: kept } : {},
      mascot: t.rec.mascot ?? null,
      oneLiner: t.rec.oneLiner ?? null,
      slug: t.slug,
      seoTitle: t.rec.seoTitle ?? null,
      seoDescription: t.rec.seoDescription ?? null,
    };
  });
  const careProfiles: CareProfileRec[] = [...cat.careProfiles.values()]
    .filter((p) => profileIds.has(p.id))
    .map((p) => ({ ...publicMeta(p), id: p.id, name: p.name, taxonIds: [...p.taxonIds], facts: p.facts, careNotes: [...p.careNotes] }));
  const supplyItems: SupplyItemRec[] = [...cat.supplyItems.values()]
    .filter((i) => exposedItems.has(i.id))
    .map((i) => ({
      ...publicMeta(i),
      id: i.id,
      name: i.name,
      category: i.category,
      glyph: i.glyph,
      lifecycle: i.lifecycle,
      specSchema: i.specSchema,
      compatibleAlternativeIds: i.compatibleAlternativeIds.filter((a) => exposedItems.has(a)),
      description: i.description,
      replaceCycleDays: i.replaceCycleDays ?? null,
      inspectCycleDays: i.inspectCycleDays ?? null,
    }));
  const supplyRequirements: SupplyRequirementRec[] = seed.supplyRequirements
    .filter((r) => exposedReqIds.has(r.id))
    .map((r) => ({
      ...publicMeta(r),
      id: r.id,
      careProfileId: r.careProfileId,
      supplyItemId: r.supplyItemId,
      priority: r.priority,
      orderHint: r.orderHint,
      why: r.why,
      caution: r.caution,
      avoid: r.avoid,
      minSpec: r.minSpec,
      recommendedSpec: r.recommendedSpec,
      notNowReason: r.notNowReason,
      searchKeyword: r.searchKeyword,
    }));
  const compatibilityRules: CompatibilityRuleRec[] = cat.compatibilityRules
    .filter((c) => isCompatRuleExposable(c) && exposedItems.has(c.a) && exposedItems.has(c.b))
    .map((c) => ({
      ...publicMeta(c),
      id: c.id,
      a: c.a,
      b: c.b,
      careProfileId: c.careProfileId ?? null,
      rules: c.rules.map((x) => ({ expr: x.expr, onFail: x.onFail, message: x.message })),
    }));
  return { animalTypes, careProfiles, supplyItems, supplyRequirements, compatibilityRules };
}
