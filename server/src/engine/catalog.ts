// 엔진 카탈로그 — 시드 묶음을 id 인덱스(Map)로. 시드 순서 유지, 입력은 읽기만 한다.
import type { EngineCatalog, SeedBundle, SupplyRequirementRec } from './types.js';

/**
 * taxa 는 선택(K-4, R7 A6): 노출 판정(exposure.ts)만 쓴다. 클라 공개 카탈로그(규격 확인 전용)는 taxa 를 싣지 않으므로
 *   생략 가능 — 생략하면 빈 Map 이고 모든 타입이 비노출이다(fail-closed). 서버 호출자는 SeedBundle 전체를 넘긴다.
 */
export type CatalogInput = Pick<
  SeedBundle,
  'animalTypes' | 'careProfiles' | 'supplyItems' | 'supplyRequirements' | 'compatibilityRules'
> &
  Partial<Pick<SeedBundle, 'taxa'>>;

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
    taxa: byId(Array.isArray(b.taxa) ? b.taxa : []),
    careProfiles: byId(b.careProfiles),
    supplyItems: byId(b.supplyItems),
    requirementsByProfile,
    compatibilityRules: [...b.compatibilityRules],
    requirementOrder,
  };
}
