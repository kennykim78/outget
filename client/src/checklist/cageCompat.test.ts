// F2-3 derive 표: 케이지 호환(엔진 requirementCompat, 최소 규격 제품 기준) BELOW_MIN·CHECK → △, OK·NONE → 영향 0,
//   컨텍스트(케이지) 없음 → 맵 {} · derive 결과가 옵션 없는 것과 같다. 합성 카탈로그(테스트 전용).
import { createCatalog, createEngine, type CatalogInput, type PublicRequirement } from '@ws/engine';
import { describe, expect, it } from 'vitest';
import { toUserContext, type CageV1 } from '../context/cageStore';
import { golden, req } from '../test/fixtures';
import { cageCompatMap } from './cageCompat';
import { deriveChecklist, type ChecklistView } from './derive';
import type { SetupV2 } from './setupStore';

const META = {
  reviewStatus: 'VERIFIED',
  reviewerType: 'EXPERIENCED_KEEPER',
  verifiedBy: null,
  verifiedAt: '2026-09-30',
  contentKind: 'SPEC',
  source: [],
};
const num = (key: string, label: string, min = 1, max = 200) => ({ key, label, type: 'number' as const, min, max });
const CAGE_SCHEMA = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE'], optionLabels: { LIVING_BOX: '리빙박스', WIRE: '철망' } },
    num('floorWcm', '바닥 가로(cm)'),
    num('floorDcm', '바닥 세로(cm)'),
    num('heightCm', '높이(cm)'),
  ],
};
const item = (id: string, fields: unknown[]) => ({
  ...META,
  id,
  name: id,
  category: 'CAGE',
  glyph: 'G',
  lifecycle: 'DURABLE',
  specSchema: { fields },
  compatibleAlternativeIds: [],
  description: 'd',
});
const creq = (id: string, rules: unknown[]) => ({
  ...META,
  id: `r-${id}`,
  careProfileId: golden.careProfileId,
  supplyItemId: id,
  priority: 'REQUIRED',
  orderHint: 'BEFORE_ARRIVAL',
  why: 'w',
  caution: null,
  avoid: null,
  minSpec: { rules },
  recommendedSpec: { rules: [] },
  notNowReason: null,
  searchKeyword: null,
});
const rule = (id: string, a: string, rules: unknown[]) => ({ ...META, id, a, b: 'cage', rules });

const CATALOG = {
  animalTypes: [
    { ...META, id: golden.id, group: 'SMALL_MAMMAL', displayName: '골든햄스터', status: 'ACTIVE', aliases: [], taxonId: null, careProfileId: golden.careProfileId, careOverrides: {} },
  ],
  careProfiles: [{ ...META, id: golden.careProfileId, name: 'p', taxonIds: [], facts: {}, careNotes: [] }],
  supplyItems: [
    item('cage', CAGE_SCHEMA.fields),
    item('wheel', [num('diameterCm', '지름(cm)', 5, 60)]),
    item('water', [num('volumeMl', '용량(ml)', 10, 1000)]),
    item('toy', [num('sizeCm', '크기(cm)', 1, 50)]),
  ],
  supplyRequirements: [
    creq('cage', [{ key: 'heightCm', op: 'gte', value: 30, reason: 'r' }]),
    creq('wheel', [{ key: 'diameterCm', op: 'gte', value: 28, reason: 'r' }]),
    creq('water', [{ key: 'volumeMl', op: 'gte', value: 100, reason: 'r' }]),
    creq('toy', [{ key: 'sizeCm', op: 'gte', value: 5, reason: 'r' }]),
  ],
  compatibilityRules: [
    rule('cr-wheel', 'wheel', [
      { expr: 'a.diameterCm + 4 <= b.heightCm', onFail: 'BELOW_MIN', message: 'm1' },
      { expr: 'a.diameterCm + 15 <= b.heightCm', onFail: 'CHECK', message: 'm2' },
    ]),
    rule('cr-water', 'water', [{ expr: 'a.volumeMl <= b.floorWcm * 10', onFail: 'CHECK', message: 'm3' }]),
  ],
} as unknown as CatalogInput;
const engine = createEngine(createCatalog(CATALOG));

const REQS: PublicRequirement[] = ['cage', 'wheel', 'water', 'toy'].map((id) => req(id, 'REQUIRED'));
const cage = (heightCm: number, floorWcm = 60): CageV1 => ({ v: 1, type: 'LIVING_BOX', floorWcm, floorDcm: 40, heightCm, updatedAt: 'x' });
const setup = (ids: string[]): SetupV2 => ({
  v: 2,
  firstTime: false,
  owned: [],
  answeredAt: 'x',
  startedAt: 'x',
  checks: Object.fromEntries(ids.map((id) => [id, { source: 'OWNED' as const, at: 'x' }])),
  reached100At: null,
  updatedAt: 'x',
});
const stateOf = (v: ChecklistView, id: string) => v.groups.flatMap((g) => g.rows).find((r) => r.requirement.supplyItemId === id)?.state;

describe('cageCompatMap → deriveChecklist(△)', () => {
  it.each([
    // [케이지 높이·가로, wheel 맵, wheel 미체크 상태, wheel 체크 상태]
    ['높이 30 — 28+4 > 30 → BELOW_MIN', cage(30), 'FAIL', 'CHECK', 'CHECK'],
    ['높이 40 — 28+15 > 40 → CHECK', cage(40), 'CHECK', 'CHECK', 'CHECK'],
    ['높이 50 — 모두 통과 → OK', cage(50), 'OK', 'FIRST', 'READY'],
  ])('%s', (_l, c, mapped, unchecked, checked) => {
    const map = cageCompatMap(engine, golden.id, REQS, toUserContext(c));
    expect(map.wheel).toBe(mapped);
    expect(stateOf(deriveChecklist(REQS, setup([]), { compat: map }), 'wheel')).toBe(unchecked);
    expect(stateOf(deriveChecklist(REQS, setup(['wheel']), { compat: map }), 'wheel')).toBe(checked);
  });

  it('규칙 없는 항목(toy)·케이지 자신은 맵에 없음(NONE → 영향 0)', () => {
    const map = cageCompatMap(engine, golden.id, REQS, toUserContext(cage(30)));
    expect(Object.keys(map).sort()).toEqual(['water', 'wheel']);
    expect(map.water).toBe('OK'); // 100 <= 600
    expect(cageCompatMap(engine, golden.id, REQS, toUserContext(cage(30, 5))).water).toBe('CHECK');
  });

  it('△ 는 체크돼 있어도 완료로 세지 않는다', () => {
    const map = cageCompatMap(engine, golden.id, REQS, toUserContext(cage(40)));
    const v = deriveChecklist(REQS, setup(['cage', 'wheel', 'water', 'toy']), { compat: map });
    expect(v.allRequiredReady).toBe(false);
    expect(v.remainingRequired).toBe(1);
  });

  it('컨텍스트 없음 → 맵 {} · derive 결과 = 옵션 없음과 동일(영향 0)', () => {
    const map = cageCompatMap(engine, golden.id, REQS, toUserContext(null));
    expect(map).toEqual({});
    for (const s of [null, setup([]), setup(['wheel', 'cage'])]) {
      expect(deriveChecklist(REQS, s, { compat: map })).toEqual(deriveChecklist(REQS, s));
    }
  });

  it('등록 케이지 자기 규격(arch-23 ③): 최소 미달(높이 29 < 30)만 SPEC_FAIL, 충족은 cage 키 없음', () => {
    expect(cageCompatMap(engine, golden.id, REQS, toUserContext(cage(29))).cage).toBe('SPEC_FAIL');
    expect('cage' in cageCompatMap(engine, golden.id, REQS, toUserContext(cage(30)))).toBe(false);
    const v = deriveChecklist(REQS, setup(['cage']), { compat: cageCompatMap(engine, golden.id, REQS, toUserContext(cage(29))) });
    expect(stateOf(v, 'cage')).toBe('CHECK');
    expect(v.groups.flatMap((g) => g.rows).find((r) => r.requirement.supplyItemId === 'cage')?.compat).toBe('SPEC_FAIL');
    expect(v.allRequiredReady).toBe(false);
  });

  it('케이지 판정은 사용자 컨텍스트 없이 호출(userContext 미전달), 컨텍스트 없음 → {}', () => {
    const calls: unknown[][] = [];
    const spy = {
      requirementCompat: engine.requirementCompat,
      specCheck: (...a: unknown[]) => {
        calls.push(a);
        return { product: { verdict: 'BELOW_MIN' } } as never;
      },
    };
    const map = cageCompatMap(spy, golden.id, [req('cage', 'REQUIRED')], toUserContext(cage(40)));
    expect(map.cage).toBe('SPEC_FAIL');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(3); // (typeId, 'cage', ownedItems.cage) — 4번째 인자 없음
    expect(calls[0]![1]).toBe('cage');
    expect(cageCompatMap(spy, golden.id, REQS, undefined)).toEqual({});
  });

  it('권장 미만·값 누락(CHECK)·기준 없음·판정 throw → 케이지 행 영향 0', () => {
    for (const verdict of ['BELOW_RECOMMENDED', 'CHECK', 'OK']) {
      const e = { requirementCompat: engine.requirementCompat, specCheck: () => ({ product: { verdict } }) as never };
      expect('cage' in cageCompatMap(e, golden.id, [req('cage', 'REQUIRED')], toUserContext(cage(29)))).toBe(false);
    }
    const boom = {
      requirementCompat: engine.requirementCompat,
      specCheck: () => {
        throw new Error('x');
      },
    };
    expect(cageCompatMap(boom, golden.id, [req('cage', 'REQUIRED')], toUserContext(cage(29)))).toEqual({});
  });

  it('카탈로그에 없는 요구사항은 건너뛴다(throw 0)', () => {
    const map = cageCompatMap(engine, golden.id, [...REQS, req('ghost', 'REQUIRED')], toUserContext(cage(30)));
    expect(map.ghost).toBeUndefined();
  });
});
