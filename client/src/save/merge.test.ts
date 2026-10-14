// save/merge — 계약 C-R5-2 병합 표(cages·reactions 레코드마다 updatedAt 큰 쪽, 동률 로컬, animalTypeId 로컬 우선) + winner·pushNeeded.
//   setups 는 항목 단위(F 계약) — 상세는 merge.items.test.ts.
import { describe, expect, it } from 'vitest';
import type { CageV1, SaveV1, SetupV3 } from './contract';
import { emptyReactions, mergeSnapshots } from './merge';

const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';
const T3 = '2026-10-03T00:00:00.000Z';

function setup(updatedAt: string, checked: string[] = []): SetupV3 {
  return {
    v: 3,
    firstTime: true,
    owned: [],
    answeredAt: T1,
    startedAt: T1,
    checks: Object.fromEntries(checked.map((id) => [id, { source: 'OWNED' as const, at: updatedAt }])),
    uncheckedAt: {},
    reached100At: null,
    updatedAt,
  };
}

function cage(updatedAt: string, w = 60): CageV1 {
  return { v: 1, type: 'LIVING_BOX', floorWcm: w, floorDcm: 40, heightCm: 35, updatedAt };
}

function snap(over: Partial<SaveV1> = {}): SaveV1 {
  return { v: 1, animalTypeId: null, setups: {}, cages: {}, reactions: emptyReactions(), ...over };
}

describe('mergeSnapshots — 병합 표 5케이스', () => {
  it.each([
    {
      name: '1. 서버본 없음 + 로컬 기록 → local, PUT',
      local: snap({ animalTypeId: 'hamster-golden', setups: { 'hamster-golden': setup(T2, ['cage']) } }),
      server: null,
      winner: 'local',
      push: true,
      setupFrom: 'local',
    },
    {
      name: '2. 로컬 비어 있음 + 서버 기록 → server, PUT 없음, 로컬에 씀',
      local: snap(),
      server: snap({ animalTypeId: 'hamster-golden', setups: { 'hamster-golden': setup(T2, ['cage']) } }),
      winner: 'server',
      push: false,
      setupFrom: 'server',
    },
    {
      name: '3. 같은 레코드 서버가 더 새것 → server',
      local: snap({ setups: { 'hamster-golden': setup(T1) } }),
      server: snap({ setups: { 'hamster-golden': setup(T3, ['wheel']) } }),
      winner: 'server',
      push: false,
      setupFrom: 'server',
    },
    {
      name: '5. 레코드마다 다른 승자(setup 로컬 새것, cage 서버 새것) → mixed',
      local: snap({ setups: { 'hamster-golden': setup(T3, ['cage']) }, cages: { 'hamster-golden': cage(T1, 60) } }),
      server: snap({ setups: { 'hamster-golden': setup(T1) }, cages: { 'hamster-golden': cage(T3, 80) } }),
      winner: 'mixed',
      push: true,
      setupFrom: 'local',
    },
  ])('$name', ({ local, server, winner, push, setupFrom }) => {
    const m = mergeSnapshots(local, server);
    expect(m.winner).toBe(winner);
    expect(m.pushNeeded).toBe(push);
    const expected = (setupFrom === 'local' ? local : server)?.setups['hamster-golden'];
    expect(m.merged.setups['hamster-golden']).toEqual(expected);
    if (setupFrom === 'server') expect(m.toLocal.setups['hamster-golden']).toEqual(expected);
    else expect(m.toLocal.setups['hamster-golden']).toBeUndefined();
  });

  it('4. 같은 레코드에 서로 다른 항목 체크 → 항목 단위로 둘 다(mixed, 로컬에도 쓰고 PUT)', () => {
    const m = mergeSnapshots(
      snap({ setups: { 'hamster-golden': setup(T2, ['cage']) } }),
      snap({ setups: { 'hamster-golden': setup(T2, ['wheel']) } }),
    );
    expect(m.winner).toBe('mixed');
    expect(m.pushNeeded).toBe(true);
    expect(Object.keys(m.merged.setups['hamster-golden'].checks).sort()).toEqual(['cage', 'wheel']);
    expect(m.toLocal.setups['hamster-golden']).toEqual(m.merged.setups['hamster-golden']);
  });

  it('5′. mixed — cage 는 서버본이 로컬로 내려온다', () => {
    const m = mergeSnapshots(
      snap({ setups: { a: setup(T3) }, cages: { a: cage(T1, 60) } }),
      snap({ setups: { a: setup(T1) }, cages: { a: cage(T3, 80) } }),
    );
    expect(m.toLocal.cages.a.floorWcm).toBe(80);
    expect(m.merged.cages.a.floorWcm).toBe(80);
  });

  it('완전히 같으면 none · PUT 없음 · 로컬 쓰기 0', () => {
    const s = snap({ animalTypeId: 'a', setups: { a: setup(T2) }, cages: { a: cage(T2) } });
    const m = mergeSnapshots(structuredClone(s), structuredClone(s));
    expect(m.winner).toBe('none');
    expect(m.pushNeeded).toBe(false);
    expect(m.toLocal).toEqual({ setups: {}, cages: {}, reactions: null, animalTypeId: null });
  });

  it('둘 다 비었으면 none', () => {
    expect(mergeSnapshots(snap(), null).winner).toBe('none');
    expect(mergeSnapshots(snap(), snap()).winner).toBe('none');
  });

  it('animalTypeId — 로컬 우선, 로컬이 없을 때만 서버 값', () => {
    const a = mergeSnapshots(snap({ animalTypeId: 'gerbil' }), snap({ animalTypeId: 'hamster-golden' }));
    expect(a.merged.animalTypeId).toBe('gerbil');
    expect(a.toLocal.animalTypeId).toBeNull();
    expect(a.winner).toBe('local');
    const b = mergeSnapshots(snap({ animalTypeId: null }), snap({ animalTypeId: 'hamster-golden' }));
    expect(b.merged.animalTypeId).toBe('hamster-golden');
    expect(b.toLocal.animalTypeId).toBe('hamster-golden');
    expect(b.winner).toBe('server');
  });

  it('반응 — 한 레코드, updatedAt 큰 쪽(동률 로컬), 서버 updatedAt null 허용', () => {
    const lr = { like: { p1: T1 }, helpful: {}, updatedAt: T1 };
    const sr = { like: { p2: T2 }, helpful: { 'SUPPLY_ITEM:wheel': T2 }, updatedAt: T2 };
    const m = mergeSnapshots(snap({ reactions: lr }), snap({ reactions: sr }));
    expect(m.merged.reactions).toEqual(sr);
    expect(m.toLocal.reactions).toEqual(sr);
    const n = mergeSnapshots(snap({ reactions: lr }), snap({ reactions: { like: { p9: T1 }, helpful: {}, updatedAt: null as never } }));
    expect(n.merged.reactions).toEqual(lr);
    expect(n.winner).toBe('local');
  });

  it('서버에만 있는 다른 타입 레코드는 살린다(local 승과 함께)', () => {
    const m = mergeSnapshots(snap({ setups: { a: setup(T2) } }), snap({ setups: { b: setup(T1) } }));
    expect(Object.keys(m.merged.setups).sort()).toEqual(['a', 'b']);
    expect(m.winner).toBe('mixed');
    expect(m.toLocal.setups.b).toBeDefined();
  });
});
