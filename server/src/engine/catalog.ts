// 엔진 카탈로그 — 시드 묶음을 id 인덱스(Map)로. 시드 순서 유지, 입력은 읽기만 한다.
import type { EngineCatalog, SeedBundle, SupplyRequirementRec } from './types.js';

export type CatalogInput = Pick<
  SeedBundle,
  'animalTypes' | 'careProfiles' | 'supplyItems' | 'supplyRequirements' | 'compatibilityRules'
>;

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) if (!m.has(r.id)) m.set(r.id, r); // 중복 id 는 첫 행 우선(validate S02 가 막는다)
  return m;
}

export function createCatalog(b: CatalogInput): EngineCatalog {
  const requirementsByProfile = new Map<string, Map<string, SupplyRequirementRec>>();
  const requirementOrder = new Map<string, number>();
  b.supplyRequirements.forEach((r, i) => {
    let inner = requirementsByProfile.get(r.careProfileId);
    if (!inner) {
      inner = new Map();
      requirementsByProfile.set(r.careProfileId, inner);
    }
    if (!inner.has(r.supplyItemId)) inner.set(r.supplyItemId, r); // (profile,item) 중복은 첫 행(R06)
    if (!requirementOrder.has(r.id)) requirementOrder.set(r.id, i);
  });
  return {
    animalTypes: byId(b.animalTypes),
    careProfiles: byId(b.careProfiles),
    supplyItems: byId(b.supplyItems),
    requirementsByProfile,
    compatibilityRules: [...b.compatibilityRules],
    requirementOrder,
  };
}
