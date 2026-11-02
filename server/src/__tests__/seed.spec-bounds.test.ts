// 271 보안 LOW #9 — specSchema number 필드의 입력 허용 범위(min/max)가 최소 규격 기준값과 같으면 실패.
//   입력 범위 = 폼이 받는 값의 한계일 뿐 복지 기준이 아니다. 경계가 기준값과 겹치면 "범위 밖 값은 버림"(sanitize)과
//   "기준 미달"이 구분되지 않는다(예: min 이 gte 기준과 같으면 기준 미달 값을 입력할 수 없어 BELOW_MIN 이 나오지 않는다).
//   대상: 실시드 SupplyRequirement 행 + AnimalType.careOverrides 해석 후(listResolvedRequirements) minSpec·recommendedSpec 의 규칙 값.
import { describe, expect, it } from 'vitest';
import { createCatalog, listResolvedRequirements, type RuleSet, type SpecSchema } from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';

/** 규칙 집합에서 number 필드 기준값이 그 필드의 min·max 와 같은 항목. */
export function boundCollisions(schema: SpecSchema, ...sets: RuleSet[]): string[] {
  const out: string[] = [];
  for (const set of sets) {
    for (const r of Array.isArray(set?.rules) ? set.rules : []) {
      const f = schema.fields.find((x) => x.key === r.key);
      if (!f || f.type !== 'number' || typeof r.value !== 'number') continue;
      if (r.value === f.min || r.value === f.max) out.push(`${r.key}=${r.value}(min ${f.min}·max ${f.max})`);
    }
  }
  return out;
}

describe('specSchema 입력 범위 ≠ 규격 기준값(LOW #9)', () => {
  it('판정 함수: min·max 와 같은 기준값만 잡는다', () => {
    const schema: SpecSchema = { fields: [{ key: 'h', label: '높이(cm)', type: 'number', min: 20, max: 300 }] };
    expect(boundCollisions(schema, { rules: [{ key: 'h', op: 'gte', value: 20, reason: 'r' }] })).toEqual(['h=20(min 20·max 300)']);
    expect(boundCollisions(schema, { rules: [{ key: 'h', op: 'lte', value: 300, reason: 'r' }] })).toEqual(['h=300(min 20·max 300)']);
    expect(boundCollisions(schema, { rules: [{ key: 'h', op: 'gte', value: 21, reason: 'r' }] })).toEqual([]);
  });

  it('실시드: 요구사항 행 · 타입별 해석 후 규칙 모두 충돌 0', () => {
    const seed = realSeed();
    const schemaOf = new Map(seed.supplyItems.map((i) => [i.id, i.specSchema]));
    const hits: string[] = [];
    for (const r of seed.supplyRequirements) {
      const schema = schemaOf.get(r.supplyItemId);
      if (schema) for (const h of boundCollisions(schema, r.minSpec, r.recommendedSpec)) hits.push(`${r.id} ${h}`);
    }
    const cat = createCatalog(seed);
    for (const at of seed.animalTypes) {
      for (const r of listResolvedRequirements(cat, at.id)) {
        for (const h of boundCollisions(r.item.specSchema, r.minSpec, r.recommendedSpec)) hits.push(`${at.id}/${r.supplyItemId} ${h}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
