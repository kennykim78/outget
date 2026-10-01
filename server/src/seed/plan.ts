// planSeedWrites — 검증된 시드 묶음 → 결정적 쓰기 연산 목록(순수, A-14).
//   1) 잎 테이블 prune(자식 먼저): SetupBundleItem 전부 → SetupBundle·CuratedProduct·CompatibilityRule·
//      SupplyRequirement·Testimonial(IN_APP 제외)·VetClinic(source='SEED' 만) 중 시드에 없는 id
//   2) upsert: taxa → careProfiles → animalTypes → supplyItems → requirements → compat → bundles(+items 재삽입)
//      → curated → vets → testimonials. SLOT 행은 건너뛴다.
//   3) 부모 테이블 prune(참조가 시드 행으로 옮겨진 뒤): AnimalType → SupplyItem → CareProfile → Taxon
//   ReactionSignal·TaxonLegalRevision 은 건드리지 않는다. prune=false 면 1)·3) 생략(시드 번들의 항목만 지우고 재삽입).
import type { SeedBundle } from '../engine/types.js';
import {
  mapAnimalType,
  mapCareProfile,
  mapCompatibilityRule,
  mapCuratedProduct,
  mapSetupBundle,
  mapSetupBundleItems,
  mapSupplyItem,
  mapSupplyRequirement,
  mapTaxon,
  mapTestimonial,
  mapVetClinic,
  type RowData,
} from './map.js';

export const SEED_MODELS = [
  'taxon',
  'careProfile',
  'animalType',
  'supplyItem',
  'supplyRequirement',
  'compatibilityRule',
  'setupBundle',
  'setupBundleItem',
  'curatedProduct',
  'vetClinic',
  'testimonial',
] as const;
export type SeedModel = (typeof SEED_MODELS)[number];

/** Prisma 모델 이름(카운트 출력용). */
export const MODEL_NAMES: Record<SeedModel, string> = {
  taxon: 'Taxon',
  careProfile: 'CareProfile',
  animalType: 'AnimalType',
  supplyItem: 'SupplyItem',
  supplyRequirement: 'SupplyRequirement',
  compatibilityRule: 'CompatibilityRule',
  setupBundle: 'SetupBundle',
  setupBundleItem: 'SetupBundleItem',
  curatedProduct: 'CuratedProduct',
  vetClinic: 'VetClinic',
  testimonial: 'Testimonial',
};

export type WhereClause = Record<string, unknown>;

export type WriteOp =
  | { op: 'deleteMany'; model: SeedModel; where: WhereClause }
  | { op: 'upsert'; model: SeedModel; id: string; data: RowData }
  | { op: 'insertMany'; model: 'setupBundleItem'; rows: RowData[] };

/** (careProfileId, supplyItemId, specValues) → meetsMinSpec. 호출자가 engine.checkProfileMinSpec 로 만든다. */
export type MeetsMinSpecRecompute = (
  careProfileId: string,
  supplyItemId: string,
  specValues: Readonly<Record<string, unknown>>,
) => boolean;

export interface PlanOptions {
  prune?: boolean;
}

const isSlotStatus = (s: unknown): boolean => s === 'SLOT';

export function planSeedWrites(
  bundle: SeedBundle,
  recompute: MeetsMinSpecRecompute,
  opts: PlanOptions = {},
): WriteOp[] {
  const prune = opts.prune !== false;
  const products = bundle.curatedProducts.filter((p) => !isSlotStatus(p.status));
  const vets = bundle.vetClinics.filter((v) => !isSlotStatus(v.verification?.status));
  const testimonials = bundle.testimonials.filter((t) => !isSlotStatus(t.status));
  const ids = <T extends { id: string }>(rows: readonly T[]): string[] => rows.map((r) => r.id);
  const keep = (model: SeedModel, keepIds: string[], extra: WhereClause = {}): WriteOp => ({
    op: 'deleteMany',
    model,
    where: { ...extra, id: { notIn: keepIds } },
  });

  const ops: WriteOp[] = [];

  // 1) 잎 prune — 번들 항목은 항상 전부 지우고 재삽입(position 순서 결정적).
  ops.push({
    op: 'deleteMany',
    model: 'setupBundleItem',
    where: prune ? {} : { bundleId: { in: ids(bundle.setupBundles) } },
  });
  if (prune) {
    ops.push(keep('setupBundle', ids(bundle.setupBundles)));
    ops.push(keep('curatedProduct', ids(products)));
    ops.push(keep('compatibilityRule', ids(bundle.compatibilityRules)));
    ops.push(keep('supplyRequirement', ids(bundle.supplyRequirements)));
    ops.push(keep('testimonial', ids(testimonials), { source: { not: 'IN_APP' } }));
    ops.push(keep('vetClinic', ids(vets), { source: 'SEED' }));
  }

  // 2) upsert(고정 순서, 시드 순서)
  const up = (model: SeedModel, rows: RowData[]): void => {
    for (const data of rows) ops.push({ op: 'upsert', model, id: String(data.id), data });
  };
  up('taxon', bundle.taxa.map(mapTaxon));
  up('careProfile', bundle.careProfiles.map(mapCareProfile));
  up('animalType', bundle.animalTypes.map(mapAnimalType));
  up('supplyItem', bundle.supplyItems.map(mapSupplyItem));
  up('supplyRequirement', bundle.supplyRequirements.map(mapSupplyRequirement));
  up('compatibilityRule', bundle.compatibilityRules.map(mapCompatibilityRule));
  up('setupBundle', bundle.setupBundles.map(mapSetupBundle));
  const bundleItems = bundle.setupBundles.flatMap(mapSetupBundleItems);
  if (bundleItems.length > 0) ops.push({ op: 'insertMany', model: 'setupBundleItem', rows: bundleItems });
  up(
    'curatedProduct',
    products.map((p) =>
      mapCuratedProduct(
        p,
        p.careProfileIds.length > 0 && p.careProfileIds.every((cp) => recompute(cp, p.supplyItemId, p.specValues)),
      ),
    ),
  );
  up('vetClinic', vets.map(mapVetClinic));
  up('testimonial', testimonials.map(mapTestimonial));

  // 3) 부모 prune
  if (prune) {
    ops.push(keep('animalType', ids(bundle.animalTypes)));
    ops.push(keep('supplyItem', ids(bundle.supplyItems)));
    ops.push(keep('careProfile', ids(bundle.careProfiles)));
    ops.push(keep('taxon', ids(bundle.taxa)));
  }
  return ops;
}
