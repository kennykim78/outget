// E7–E8 — resolveRequirement(SupplyItem → SupplyRequirement → careOverrides) 단일 병합 지점.
import { describe, expect, it } from 'vitest';
import { createCatalog, listResolvedRequirements, resolveRequirement } from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

const cat = createCatalog(makeBundle());

describe('E7 resolveRequirement — merge', () => {
  it('no overrides → requirement values, provenance REQUIREMENT', () => {
    const r = resolveRequirement(cat, 'critter-plain', 'spinner');
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      animalTypeId: 'critter-plain',
      careProfileId: 'pf-test',
      supplyItemId: 'spinner',
      priority: 'REQUIRED',
      orderHint: 'BEFORE_ARRIVAL',
      why: 'spinner 이유',
      contentKind: 'SPEC',
    });
    expect(r!.minSpec.rules.map((x) => [x.key, x.op, x.value])).toEqual([
      ['sizeCm', 'gte', 20],
      ['face', 'eq', 'FLAT'],
    ]);
    expect(Object.values(r!.provenance).every((p) => p === 'REQUIREMENT')).toBe(true);
    expect(r!.provenance.minSpec).toBe('REQUIREMENT');
  });

  it('scalar override wins; rules replace by (key, op) and append otherwise', () => {
    const r = resolveRequirement(cat, 'critter', 'spinner')!;
    expect(r.priority).toBe('RECOMMENDED');
    expect(r.why).toBe('덮어쓴 이유');
    expect(r.orderHint).toBe('BEFORE_ARRIVAL');
    expect(r.minSpec.rules.map((x) => [x.key, x.op, x.value, x.reason])).toEqual([
      ['sizeCm', 'gte', 22, '덮어쓴 지름'],
      ['face', 'eq', 'FLAT', '발 끼임 방지'],
      ['mount', 'eq', 'FLOOR', '추가 규칙'],
    ]);
    expect(r.recommendedSpec.rules).toHaveLength(2);
    expect(r.provenance).toMatchObject({
      priority: 'OVERRIDE',
      why: 'OVERRIDE',
      minSpec: 'OVERRIDE',
      orderHint: 'REQUIREMENT',
      recommendedSpec: 'REQUIREMENT',
    });
  });

  it('explicit null override wins over a requirement value', () => {
    const r = resolveRequirement(cat, 'critter', 'disc')!;
    expect(r.orderHint).toBe('FIRST_WEEK');
    expect(r.notNowReason).toBeNull();
    expect(r.provenance.notNowReason).toBe('OVERRIDE');
    expect(resolveRequirement(cat, 'critter-plain', 'disc')!.notNowReason).toBe('적응 후');
  });

  it('item is a narrow pick of the SupplyItem; review metas from 4 layers', () => {
    const r = resolveRequirement(cat, 'critter', 'spinner')!;
    expect(Object.keys(r.item).sort()).toEqual(
      [
        'compatibleAlternativeIds',
        'description',
        'glyph',
        'id',
        'lifecycle',
        'name',
        'specSchema',
        'category',
        'replaceCycleDays',
        'inspectCycleDays',
      ].sort(),
    );
    expect(r.item.replaceCycleDays).toBeNull();
    expect(Object.keys(r.review).sort()).toEqual(['animalType', 'careProfile', 'item', 'requirement']);
    expect(r.review.requirement).toEqual({
      reviewStatus: 'DRAFT',
      reviewerType: 'AI_DRAFT',
      verifiedBy: null,
      verifiedAt: null,
      contentKind: 'SPEC',
      source: [],
    });
  });

  it('null when there is no profile, animal, item or requirement', () => {
    expect(resolveRequirement(cat, 'ghost', 'box')).toBeNull();
    expect(resolveRequirement(cat, 'nobody', 'box')).toBeNull();
    expect(resolveRequirement(cat, 'critter', 'nothing')).toBeNull();
    const b = makeBundle();
    const cat2 = createCatalog({ ...b, supplyRequirements: b.supplyRequirements.filter((x) => x.supplyItemId !== 'gadget') });
    expect(resolveRequirement(cat2, 'critter', 'gadget')).toBeNull();
  });

  it('override for an item without a base requirement is ignored (overrides only modify)', () => {
    const b = makeBundle();
    b.animalTypes[0].careOverrides = { requirements: { ...b.animalTypes[0].careOverrides.requirements, ghostItem: { why: 'x' } } };
    const c = createCatalog(b);
    expect(resolveRequirement(c, 'critter', 'ghostItem')).toBeNull();
    expect(listResolvedRequirements(c, 'critter').map((r) => r.supplyItemId)).not.toContain('ghostItem');
  });

  it('does not read inherited override keys', () => {
    const b = makeBundle();
    b.animalTypes[1].careOverrides = Object.create({ requirements: { box: { why: 'inherited' } } }) as never;
    const c = createCatalog(b);
    expect(resolveRequirement(c, 'critter-plain', 'box')!.why).toBe('box 이유');
  });
});

describe('E8 listResolvedRequirements — orderHint → priority → seed order', () => {
  it('no overrides', () => {
    expect(listResolvedRequirements(cat, 'critter-plain').map((r) => r.supplyItemId)).toEqual([
      'box',
      'spinner',
      'litter',
      'gadget',
      'disc',
    ]);
  });

  it('sorts by resolved (overridden) values', () => {
    expect(listResolvedRequirements(cat, 'critter').map((r) => r.supplyItemId)).toEqual([
      'box',
      'litter',
      'spinner',
      'disc',
      'gadget',
    ]);
  });

  it('empty for unknown or profile-less types', () => {
    expect(listResolvedRequirements(cat, 'ghost')).toEqual([]);
    expect(listResolvedRequirements(cat, 'nobody')).toEqual([]);
  });
});
