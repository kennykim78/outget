// E9–E12 — specCheck(+호환), checkProfileMinSpec, createEngine, 결정성·불변, 메시지 금지어.
import { describe, expect, it } from 'vitest';
import {
  EngineLookupError,
  checkProfileMinSpec,
  createCatalog,
  createEngine,
  resolveRequirement,
  specCheck,
} from '../engine/index.js';
import type { Reason } from '../engine/index.js';
import { deepFreeze, makeBundle } from './fixtures/engine-catalog.js';
import { realSeed } from './fixtures/prerender-seed.js';

const cat = createCatalog(makeBundle());
const GOOD_SPINNER = { sizeCm: 30, face: 'FLAT', mount: 'FLOOR', quiet: true } as const;

// 불변식 5 금지어(정확 목록) — seed/lint.ts L01 과 동일 집합.
const BANNED: RegExp[] = [
  /괜찮다/,
  /안전하다/,
  /최저가/,
  /판매순/,
  /베스트/,
  /정확도/,
  /전문가\s*\d+\s*명/,
  /회원가입/,
  /구매/,
];
const collected: Reason[] = [];
const keep = <T extends { reasons: Reason[] }>(r: T): T => {
  collected.push(...r.reasons);
  return r;
};

describe('E9 compatibility', () => {
  it('no userContext → compat NONE, product only', () => {
    const r = keep(specCheck(cat, 'critter-plain', 'spinner', GOOD_SPINNER));
    expect(r.compat).toEqual({ verdict: 'NONE', reasons: [], checkedRuleIds: [] });
    expect(r.verdict).toBe('OK');
    expect(r.reasons).toEqual(r.product.reasons);
  });

  it('forward: item is a, context owns b', () => {
    const r = keep(
      specCheck(cat, 'critter-plain', 'spinner', { sizeCm: 22, face: 'FLAT', mount: 'FLOOR', quiet: true }, {
        ownedItems: { box: { type: 'BOX', widthCm: 60, heightCm: 30 } },
      }),
    );
    expect(r.product.verdict).toBe('BELOW_RECOMMENDED');
    expect(r.compat.verdict).toBe('CHECK');
    expect(r.compat.checkedRuleIds).toEqual(['cx-spinner-box']);
    expect(r.compat.reasons.map((x) => x.ruleId)).toEqual(['cx-spinner-box#1']);
    expect(r.compat.reasons[0]).toMatchObject({ stage: 'COMPAT', kind: 'RULE', verdict: 'CHECK' });
    expect(r.verdict).toBe('CHECK');
    expect(r.reasons).toEqual([...r.product.reasons, ...r.compat.reasons]);
  });

  it('reverse: item is b, context owns a', () => {
    const r = keep(
      specCheck(cat, 'critter-plain', 'box', { type: 'BOX', widthCm: 90, heightCm: 30 }, {
        ownedItems: { spinner: { sizeCm: 26, face: 'FLAT', mount: 'FLOOR' } },
      }),
    );
    expect(r.product.verdict).toBe('OK');
    expect(r.compat.verdict).toBe('BELOW_MIN');
    expect(r.compat.reasons.map((x) => x.ruleId)).toEqual(['cx-spinner-box#0', 'cx-spinner-box#1']);
    expect(r.verdict).toBe('BELOW_MIN');
  });

  it('careProfile-scoped rule is skipped for other profiles', () => {
    const r = keep(
      specCheck(cat, 'critter-plain', 'litter', { material: 'P', scented: false }, {
        ownedItems: { box: { type: 'BOX', widthCm: 90, heightCm: 40 } },
      }),
    );
    expect(r.compat.verdict).toBe('NONE');
    expect(r.compat.checkedRuleIds).toEqual([]);
  });

  it('context with unrelated items only → NONE', () => {
    const r = specCheck(cat, 'critter-plain', 'spinner', GOOD_SPINNER, { ownedItems: { litter: { material: 'P' } } });
    expect(r.compat.verdict).toBe('NONE');
  });

  it('UNKNOWN (missing context value) → CHECK even when onFail is BELOW_MIN', () => {
    const r = keep(
      specCheck(cat, 'critter-plain', 'spinner', GOOD_SPINNER, { ownedItems: { box: { type: 'BOX', widthCm: 60 } } }),
    );
    expect(r.compat.verdict).toBe('CHECK');
    expect(r.compat.reasons.map((x) => [x.ruleId, x.verdict])).toEqual([
      ['cx-spinner-box#0', 'CHECK'],
      ['cx-spinner-box#1', 'CHECK'],
    ]);
  });

  it('out-of-schema context value is treated as unknown', () => {
    const r = specCheck(cat, 'critter-plain', 'spinner', GOOD_SPINNER, {
      ownedItems: { box: { type: 'BOX', widthCm: 60, heightCm: 999 } },
    });
    expect(r.compat.reasons[0]).toMatchObject({ ruleId: 'cx-spinner-box#0', verdict: 'CHECK' });
  });

  it('unparseable expr → CHECK (fail-closed), never throws', () => {
    const r = keep(specCheck(cat, 'critter-plain', 'gadget', {}, { ownedItems: { box: { type: 'BOX', widthCm: 60, heightCm: 40 } } }));
    expect(r.compat.verdict).toBe('CHECK');
    expect(r.compat.reasons[0].ruleId).toBe('cx-broken#0');
  });

  it('ternary rule: CLIP mount needs MESH_BOX', () => {
    const clip = { ...GOOD_SPINNER, mount: 'CLIP' };
    const onBox = keep(specCheck(cat, 'critter-plain', 'spinner', clip, { ownedItems: { box: { type: 'BOX', widthCm: 90, heightCm: 50 } } }));
    expect(onBox.compat.reasons.map((x) => x.ruleId)).toEqual(['cx-spinner-box#2']);
    const onMesh = specCheck(cat, 'critter-plain', 'spinner', clip, { ownedItems: { box: { type: 'MESH_BOX', widthCm: 90, heightCm: 50 } } });
    expect(onMesh.compat.verdict).toBe('OK');
    expect(onMesh.verdict).toBe('OK');
  });

  it('uses overrides of the animal type (product stage)', () => {
    const clip = { ...GOOD_SPINNER, mount: 'CLIP' };
    expect(specCheck(cat, 'critter', 'spinner', clip).product.verdict).toBe('BELOW_MIN');
    expect(specCheck(cat, 'critter-plain', 'spinner', clip).product.verdict).toBe('OK');
  });

  it('unknown ids throw EngineLookupError', () => {
    expect(() => specCheck(cat, 'nobody', 'box', {})).toThrow(EngineLookupError);
    expect(() => specCheck(cat, 'critter', 'nothing', {})).toThrow(EngineLookupError);
    expect(() => specCheck(cat, 'ghost', 'box', {})).toThrow(EngineLookupError);
  });

  it('L5 불변(QA186 INFO-2): 실시드 드워프 tubes 안지름 6 × 케이지 h40 → compat OK(보유품 근거 단계는 L5 에 없음)', () => {
    const real = createCatalog(realSeed());
    const ctx = { ownedItems: { cage: { type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 40 } } };
    expect(specCheck(real, 'hamster-dwarf', 'tubes', { innerDiameterCm: 6 }, ctx).compat).toEqual({
      verdict: 'OK',
      reasons: [],
      checkedRuleIds: ['cr-dwarf-tubes-cage'],
    });
  });
});

describe('E10 alternatives', () => {
  it('only when verdict !== OK; unknown alternative ids skipped', () => {
    expect(specCheck(cat, 'critter-plain', 'spinner', GOOD_SPINNER).alternatives).toEqual([]);
    const r = specCheck(cat, 'critter-plain', 'spinner', { ...GOOD_SPINNER, sizeCm: 10 });
    expect(r.verdict).toBe('BELOW_MIN');
    expect(r.alternatives).toEqual([{ supplyItemId: 'disc', name: '원반' }]);
    expect(specCheck(cat, 'critter-plain', 'box', { type: 'BOX', widthCm: 60 }).alternatives).toEqual([]);
  });

  // 감사 54 #6(M3): 대안은 이 동물의 CareProfile 요구사항에 있는 항목만. 다른 프로필 전용 항목은 0.
  it('profile-scoped: alternatives limited to the animal’s CareProfile requirements', () => {
    const b = makeBundle();
    b.supplyItems.push({ ...b.supplyItems.find((i) => i.id === 'disc')!, id: 'pad', name: '받침' });
    b.supplyRequirements.push({ ...b.supplyRequirements.find((r) => r.careProfileId === 'pf-other')!, id: 'rq-pf-other-pad', supplyItemId: 'pad' });
    for (const it of b.supplyItems) {
      if (it.id === 'spinner') it.compatibleAlternativeIds = ['disc', 'pad', 'nope'];
      if (it.id === 'box') it.compatibleAlternativeIds = ['pad', 'disc'];
    }
    b.animalTypes.push({ ...b.animalTypes.find((a) => a.id === 'critter-plain')!, id: 'critter-other', careProfileId: 'pf-other' });
    const c2 = createCatalog(b);

    // pf-test: disc(같은 프로필) 유지, pad(pf-other 전용) 제외.
    const s = specCheck(c2, 'critter-plain', 'spinner', { ...GOOD_SPINNER, sizeCm: 10 });
    expect(s.verdict).toBe('BELOW_MIN');
    expect(s.alternatives).toEqual([{ supplyItemId: 'disc', name: '원반' }]);
    const bx = specCheck(c2, 'critter-plain', 'box', { type: 'BOX', widthCm: 20, heightCm: 30 });
    expect(bx.verdict).toBe('BELOW_MIN');
    expect(bx.alternatives).toEqual([{ supplyItemId: 'disc', name: '원반' }]);

    // pf-other: pad(같은 프로필) 유지, disc(pf-test 전용) 제외.
    const o = specCheck(c2, 'critter-other', 'box', { type: 'BOX', widthCm: 20, heightCm: 30 });
    expect(o.verdict).toBe('BELOW_MIN');
    expect(o.alternatives).toEqual([{ supplyItemId: 'pad', name: '받침' }]);
  });
});

describe('checkProfileMinSpec (meetsMinSpec source)', () => {
  it('OK and BELOW_RECOMMENDED meet; CHECK and BELOW_MIN do not', () => {
    expect(checkProfileMinSpec(cat, 'pf-test', 'spinner', GOOD_SPINNER)).toMatchObject({ meets: true, verdict: 'OK' });
    expect(checkProfileMinSpec(cat, 'pf-test', 'spinner', { ...GOOD_SPINNER, sizeCm: 22 })).toMatchObject({
      meets: true,
      verdict: 'BELOW_RECOMMENDED',
    });
    expect(checkProfileMinSpec(cat, 'pf-test', 'spinner', { sizeCm: 30, mount: 'FLOOR' })).toMatchObject({
      meets: false,
      verdict: 'CHECK',
    });
    expect(checkProfileMinSpec(cat, 'pf-test', 'spinner', { ...GOOD_SPINNER, face: 'GRID' })).toMatchObject({
      meets: false,
      verdict: 'BELOW_MIN',
    });
  });

  it('uses the base requirement, never animal overrides', () => {
    expect(checkProfileMinSpec(cat, 'pf-test', 'spinner', { ...GOOD_SPINNER, mount: 'CLIP' }).meets).toBe(true);
  });

  it('per profile', () => {
    expect(checkProfileMinSpec(cat, 'pf-other', 'box', { widthCm: 40 }).meets).toBe(true);
    expect(checkProfileMinSpec(cat, 'pf-test', 'box', { type: 'BOX', widthCm: 40, heightCm: 30 }).meets).toBe(false);
  });

  it('missing profile / item / requirement → meets false + CHECK (fail-closed, no throw)', () => {
    for (const [p, i] of [
      ['nope', 'box'],
      ['pf-test', 'nope'],
      ['pf-other', 'spinner'],
    ]) {
      const r = checkProfileMinSpec(cat, p, i, {});
      expect(r.meets).toBe(false);
      expect(r.verdict).toBe('CHECK');
      collected.push(...r.reasons);
    }
  });
});

describe('createEngine (§7.2 signatures)', () => {
  it('binds the catalog', () => {
    const engine = createEngine(cat);
    const ctx = { ownedItems: { box: { type: 'BOX', widthCm: 60, heightCm: 30 } } };
    expect(engine.specCheck('critter-plain', 'spinner', GOOD_SPINNER, ctx)).toEqual(
      specCheck(cat, 'critter-plain', 'spinner', GOOD_SPINNER, ctx),
    );
    const r = engine.resolveRequirement('critter-plain', 'spinner');
    expect(r).toEqual(resolveRequirement(cat, 'critter-plain', 'spinner'));
    expect(engine.buildSearchKeyword('critter-plain', r!)).toBe(engine.buildSearchKeyword({ displayName: '기본동물' }, r!));
    expect(() => engine.buildSearchKeyword('nobody', r!)).toThrow(EngineLookupError);
  });
});

describe('E11 determinism and input immutability', () => {
  it('frozen inputs, identical outputs, no shared rule objects', () => {
    const bundle = deepFreeze(makeBundle());
    const before = JSON.stringify(bundle);
    const c = createCatalog(bundle);
    const ctx = deepFreeze({ ownedItems: { box: { type: 'BOX', widthCm: 60, heightCm: 30 } } });
    const input = deepFreeze({ sizeCm: 22, face: 'FLAT', mount: 'FLOOR' });
    const a = specCheck(c, 'critter', 'spinner', input, ctx);
    const b = specCheck(c, 'critter', 'spinner', input, ctx);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const r = resolveRequirement(c, 'critter-plain', 'spinner')!;
    expect(r.minSpec.rules[0]).not.toBe(bundle.supplyRequirements[4].minSpec.rules[0]);
    r.minSpec.rules.push({ key: 'x', op: 'eq', value: 1, reason: 'mut' });
    expect(resolveRequirement(c, 'critter-plain', 'spinner')!.minSpec.rules).toHaveLength(2);
    expect(JSON.stringify(bundle)).toBe(before);
  });
});

describe('E12 every engine Reason.message passes the banned-word lint', () => {
  it('collected messages', () => {
    // 나머지 케이스에서 모은 사유 + 입력 오류 경로를 추가로 만든다.
    collected.push(
      ...specCheck(cat, 'critter-plain', 'box', { type: 'X', widthCm: 'a' as never, heightCm: 1000, gapMm: 50 }).reasons,
      ...specCheck(cat, 'critter-plain', 'litter', { material: 'R', scented: true }).reasons,
      ...specCheck(cat, 'critter-plain', 'gadget', {}).reasons,
    );
    expect(collected.length).toBeGreaterThan(10);
    for (const reason of collected) {
      expect(reason.message.trim().length).toBeGreaterThan(0);
      for (const re of BANNED) expect(reason.message, `${re} in "${reason.message}"`).not.toMatch(re);
    }
  });
});
