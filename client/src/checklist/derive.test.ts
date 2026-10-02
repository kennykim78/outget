// checklist/derive — PRD US-005 표 테스트: ✓ ! △ ○, 4그룹(NOT_NOW 접힘), 정렬 orderHint → priority, 준비율(REQUIRED ✓ 만, △ 제외).
import type { OrderHint, Priority, PublicRequirement } from '@ws/engine';
import { describe, expect, it } from 'vitest';
import { deriveChecklist } from './derive';
import type { SetupV1 } from './setupStore';

const T = '2026-10-02T00:00:00.000Z';

function req(id: string, priority: Priority, orderHint: OrderHint = 'BEFORE_ARRIVAL'): PublicRequirement {
  return {
    animalTypeId: 'hamster-golden',
    supplyItemId: id,
    priority,
    orderHint,
    notNowReason: priority === 'NOT_NOW' ? '지금은 필요 없어요' : null,
    minSpec: { rules: [] },
    recommendedSpec: { rules: [] },
    why: 'w',
    caution: null,
    avoid: null,
    searchKeyword: 'k',
    searchLinks: [],
    item: { id, name: id, category: 'CAGE', glyph: 'x', specSchema: { fields: [] }, alternativeIds: [] },
    source: [],
    lastVerifiedAt: '2026-09-30',
  };
}

function setup(checks: Record<string, 'OWNED' | 'UNKNOWN' | 'PURCHASED'>): SetupV1 {
  return {
    v: 1,
    firstTime: false,
    owned: Object.entries(checks)
      .filter(([, s]) => s === 'OWNED')
      .map(([id]) => id),
    answeredAt: T,
    startedAt: T,
    checks: Object.fromEntries(Object.entries(checks).map(([id, source]) => [id, { source, at: T }])),
    reached100At: null,
  };
}

const REQS = [
  req('cage', 'REQUIRED'),
  req('bedding', 'REQUIRED', 'FIRST_WEEK'),
  req('wheel', 'REQUIRED'),
  req('chew', 'RECOMMENDED'),
  req('toy', 'OPTIONAL'),
  req('ball', 'NOT_NOW', 'AS_NEEDED'),
];

const stateOf = (v: ReturnType<typeof deriveChecklist>, id: string) =>
  v.groups.flatMap((g) => g.rows).find((r) => r.requirement.supplyItemId === id)?.state;

describe('deriveChecklist', () => {
  it.each<[string, Record<string, 'OWNED' | 'UNKNOWN' | 'PURCHASED'>, Record<string, string>]>([
    ['setup 없음(L3 전)', {}, { cage: 'FIRST', chew: 'LATER', toy: 'LATER', ball: 'LATER' }],
    ['OWNED → ✓', { cage: 'OWNED' }, { cage: 'READY', bedding: 'FIRST' }],
    ['UNKNOWN(수동) → ✓', { chew: 'UNKNOWN' }, { chew: 'READY', cage: 'FIRST' }],
    ['PURCHASED → ✓', { ball: 'PURCHASED' }, { ball: 'READY' }],
  ])('상태 표: %s', (_l, checks, expected) => {
    const v = deriveChecklist(REQS, Object.keys(checks).length ? setup(checks) : null);
    for (const [id, st] of Object.entries(expected)) expect(stateOf(v, id)).toBe(st);
  });

  it('readySource 를 행에 싣는다(이벤트용, UI 비노출)', () => {
    const v = deriveChecklist(REQS, setup({ cage: 'OWNED', chew: 'UNKNOWN' }));
    const rows = v.groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.requirement.supplyItemId === 'cage')?.source).toBe('OWNED');
    expect(rows.find((r) => r.requirement.supplyItemId === 'chew')?.source).toBe('UNKNOWN');
    expect(rows.find((r) => r.requirement.supplyItemId === 'toy')?.source).toBeNull();
  });

  it('△: 호환 CHECK/FAIL 은 체크돼 있어도 △, 완료로 세지 않는다(미완료 집계)', () => {
    const v = deriveChecklist(REQS, setup({ cage: 'OWNED', bedding: 'UNKNOWN', wheel: 'UNKNOWN' }), {
      compat: { cage: 'CHECK', toy: 'FAIL', wheel: 'OK' },
    });
    expect(stateOf(v, 'cage')).toBe('CHECK');
    expect(stateOf(v, 'toy')).toBe('CHECK');
    expect(stateOf(v, 'wheel')).toBe('READY');
    expect(v.remainingRequired).toBe(1);
    expect(v.readyPercent).toBe(66);
    expect(v.allRequiredReady).toBe(false);
  });

  it('4그룹 고정 순서, NOT_NOW 만 접힘, 이유 그대로', () => {
    const v = deriveChecklist(REQS, null);
    expect(v.groups.map((g) => g.priority)).toEqual(['REQUIRED', 'RECOMMENDED', 'OPTIONAL', 'NOT_NOW']);
    expect(v.groups.map((g) => g.collapsed)).toEqual([false, false, false, true]);
    expect(v.groups[3].rows[0].requirement.notNowReason).toBe('지금은 필요 없어요');
  });

  it('정렬: 그룹 안 orderHint(입양 전 → 첫 주 → 적응 후 → 필요 시), 같은 값은 입력 순서', () => {
    const reqs = [
      req('d', 'REQUIRED', 'AS_NEEDED'),
      req('c', 'REQUIRED', 'AFTER_ADAPTATION'),
      req('b', 'REQUIRED', 'FIRST_WEEK'),
      req('a1', 'REQUIRED', 'BEFORE_ARRIVAL'),
      req('a2', 'REQUIRED', 'BEFORE_ARRIVAL'),
    ];
    const v = deriveChecklist(reqs, null);
    expect(v.groups[0].rows.map((r) => r.requirement.supplyItemId)).toEqual(['a1', 'a2', 'b', 'c', 'd']);
    expect(reqs.map((r) => r.supplyItemId)).toEqual(['d', 'c', 'b', 'a1', 'a2']); // 입력 불변
  });

  it('준비율 = REQUIRED 중 ✓ 비율(권장·선택·NOT_NOW 무관), 100% 는 전부 ✓ 일 때만', () => {
    expect(deriveChecklist(REQS, setup({ chew: 'UNKNOWN', toy: 'UNKNOWN', ball: 'UNKNOWN' })).readyPercent).toBe(0);
    expect(deriveChecklist(REQS, setup({ cage: 'OWNED' })).readyPercent).toBe(33);
    expect(deriveChecklist(REQS, setup({ cage: 'OWNED', bedding: 'UNKNOWN' })).readyPercent).toBe(66);
    const full = deriveChecklist(REQS, setup({ cage: 'OWNED', bedding: 'UNKNOWN', wheel: 'UNKNOWN' }));
    expect(full.readyPercent).toBe(100);
    expect(full.remainingRequired).toBe(0);
    expect(full.allRequiredReady).toBe(true);
    // 199/200 은 반올림으로 100 이 되지 않는다.
    const many = Array.from({ length: 200 }, (_, i) => req(`r${i}`, 'REQUIRED'));
    const almost = setup(Object.fromEntries(many.slice(0, 199).map((r) => [r.supplyItemId, 'UNKNOWN' as const])));
    expect(deriveChecklist(many, almost).readyPercent).toBe(99);
  });

  it('REQUIRED 0개 → 0%, 완료 아님', () => {
    const v = deriveChecklist([req('chew', 'RECOMMENDED')], setup({ chew: 'UNKNOWN' }));
    expect(v.readyPercent).toBe(0);
    expect(v.remainingRequired).toBe(0);
    expect(v.requiredTotal).toBe(0);
    expect(v.allRequiredReady).toBe(false);
  });

  it('요구사항에 없는 체크 키는 무시', () => {
    const v = deriveChecklist(REQS, setup({ ghost: 'UNKNOWN' }));
    expect(v.groups.flatMap((g) => g.rows)).toHaveLength(REQS.length);
    expect(v.readyPercent).toBe(0);
  });
});
