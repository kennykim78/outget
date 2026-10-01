// buildSearchKeyword — override 슬롯 + 생성기(PRD US-012). 합성 카탈로그.
import { describe, expect, it } from 'vitest';
import { buildSearchKeyword, createCatalog, resolveRequirement } from '../engine/index.js';
import type { ResolvedRequirement } from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

const cat = createCatalog(makeBundle());
const animal = { displayName: '기본동물' };
const resolved = (itemId: string): ResolvedRequirement => resolveRequirement(cat, 'critter-plain', itemId)!;

describe('override slot', () => {
  it('replaces every {animal} token and collapses whitespace', () => {
    expect(buildSearchKeyword(animal, resolved('box'))).toBe('기본동물 큰 상자 기본동물');
  });

  it('override without {animal} is used verbatim (trimmed)', () => {
    expect(buildSearchKeyword(animal, { ...resolved('box'), searchKeyword: '  소동물   상자 ' })).toBe('소동물 상자');
  });

  it('blank override falls back to the generator', () => {
    expect(buildSearchKeyword(animal, { ...resolved('box'), searchKeyword: '   ' })).toBe('기본동물 상자 80cm 25cm');
  });
});

describe('generator: displayName + item.name + ≤2 conditions (recommended first, one per key)', () => {
  it('number gte → value+unit, boolean true → label without parenthetical', () => {
    expect(buildSearchKeyword(animal, resolved('spinner'))).toBe('기본동물 회전판 25cm 저소음');
  });

  it('caps at two conditions and skips keys already used', () => {
    expect(buildSearchKeyword(animal, { ...resolved('box'), searchKeyword: null })).toBe('기본동물 상자 80cm 25cm');
  });

  it('skips lte, eq false, not_in, multi-value in, and enums without optionLabels', () => {
    expect(buildSearchKeyword(animal, resolved('litter'))).toBe('기본동물 깔개');
  });

  it('enum eq / single-value in use optionLabels', () => {
    const r = resolved('litter');
    expect(
      buildSearchKeyword(animal, {
        ...r,
        recommendedSpec: { rules: [{ key: 'material', op: 'in', value: ['P'], reason: 'x' }] },
      }),
    ).toBe('기본동물 깔개 종이');
    const box = resolved('box');
    expect(
      buildSearchKeyword(animal, {
        ...box,
        searchKeyword: null,
        recommendedSpec: { rules: [{ key: 'type', op: 'eq', value: 'MESH_BOX', reason: 'x' }] },
        minSpec: { rules: [{ key: 'gapMm', op: 'lte', value: 10, reason: 'x' }] },
      }),
    ).toBe('기본동물 상자 망형');
  });

  it('number eq uses unit; unit-less label gives bare number', () => {
    const r = resolved('gadget');
    const withField: ResolvedRequirement = {
      ...r,
      item: { ...r.item, specSchema: { fields: [{ key: 'n', label: '개수', type: 'number', min: 1, max: 9 }] } },
      recommendedSpec: { rules: [{ key: 'n', op: 'eq', value: 3, reason: 'x' }] },
    };
    expect(buildSearchKeyword(animal, withField)).toBe('기본동물 도구 3');
  });

  it('no rules → displayName + item.name', () => {
    expect(buildSearchKeyword(animal, resolved('gadget'))).toBe('기본동물 도구');
  });

  it('is deterministic', () => {
    const r = resolved('spinner');
    expect(buildSearchKeyword(animal, r)).toBe(buildSearchKeyword(animal, r));
  });
});
