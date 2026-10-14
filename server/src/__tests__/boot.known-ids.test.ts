// boot/known-ids: 병원 제보 treats·반응 대상 허용 집합(SEC-3 L-7). 판정 = 엔진 isVerified(+ 상품 ACTIVE·meetsMinSpec).
import { describe, expect, it } from 'vitest';
import { knownTargetIdsFrom, knownTypeIdsFrom } from '../boot/known-ids.js';

const V = { reviewStatus: 'VERIFIED', reviewerType: 'OPERATOR' };

describe('knownTypeIdsFrom', () => {
  it('VERIFIED ∧ OPERATOR 이상만, AI_DRAFT·DRAFT 제외', () => {
    const ids = knownTypeIdsFrom([
      { id: 'a', ...V },
      { id: 'b', reviewStatus: 'VERIFIED', reviewerType: 'AI_DRAFT' },
      { id: 'c', reviewStatus: 'DRAFT', reviewerType: 'OPERATOR' },
    ]);
    expect([...ids]).toEqual(['a']);
  });
});

describe('knownTargetIdsFrom', () => {
  it('검수 SupplyItem·Bundle + (ACTIVE ∧ meetsMinSpec ∧ 검수) 상품의 합집합', () => {
    const ids = knownTargetIdsFrom({
      supplyItems: [
        { id: 'wheel', ...V },
        { id: 'draft-item', reviewStatus: 'DRAFT', reviewerType: 'OPERATOR' },
      ],
      bundles: [
        { id: 'starter', ...V },
        { id: 'ai-bundle', reviewStatus: 'VERIFIED', reviewerType: 'AI_DRAFT' },
      ],
      products: [
        { id: 'p-ok', ...V, status: 'ACTIVE', meetsMinSpec: true },
        { id: 'p-below', ...V, status: 'ACTIVE', meetsMinSpec: false },
        { id: 'p-review', ...V, status: 'REVIEW', meetsMinSpec: true },
        { id: 'p-ai', reviewStatus: 'VERIFIED', reviewerType: 'AI_DRAFT', status: 'ACTIVE', meetsMinSpec: true },
      ],
    });
    expect([...ids].sort()).toEqual(['p-ok', 'starter', 'wheel']);
  });

  it('빈 입력 → 빈 집합(fail-closed)', () => {
    expect(knownTargetIdsFrom({ supplyItems: [], bundles: [], products: [] }).size).toBe(0);
  });
});
