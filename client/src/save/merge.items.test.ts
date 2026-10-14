// save/merge — 레인 F 항목 단위 병합(SetupV3). P2 D2 MAJOR 재현: 두 기기가 같은 동물의 다른 항목을 교대로 바꾸면
//   레코드 LWW 로는 한쪽이 조용히 되돌려졌다. 항목마다 max(checks[id].at, uncheckedAt[id]) 승, 동률 로컬.
import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  applyReached100,
  applyToggle,
  migrateSetup,
  tidySetup,
  TOMBSTONE_MAX,
  TOMBSTONE_MAX_AGE_MS,
} from '../checklist/setupStore';
import type { SaveV1, SetupV2, SetupV3 } from './contract';
import { emptyReactions, mergeSetup, mergeSnapshots } from './merge';

const ID = 'hamster-golden';
const at = (min: number): string => new Date(Date.UTC(2026, 9, 10, 0, min)).toISOString();

function snap(s: SetupV3 | SetupV2 | null): SaveV1 {
  return { v: 1, animalTypeId: null, setups: s ? { [ID]: s as SetupV3 } : {}, cages: {}, reactions: emptyReactions() };
}

/** 기기 하나 — 로컬 레코드 + 마지막으로 본 서버본. */
interface Device {
  local: SetupV3 | null;
}

/** sync.ts 의 409 경로와 같은 순서: 서버본과 병합 → toLocal 은 로컬에 쓰고 merged 를 서버에 PUT. */
function syncWith(d: Device, server: { s: SetupV3 | null }): void {
  const m = mergeSnapshots(snap(d.local), snap(server.s));
  if (m.toLocal.setups[ID]) d.local = m.toLocal.setups[ID];
  if (m.pushNeeded) server.s = m.merged.setups[ID] ?? null;
}

const checked = (s: SetupV3 | null): string[] => Object.keys(s?.checks ?? {}).sort();

describe('mergeSetup — 항목 단위', () => {
  it('A 가 X 체크, B 가 Y 해제(교대) → 병합 결과에 둘 다 반영', () => {
    const start = applyToggle(applyToggle(null, 'cage', at(0)), 'water', at(0)); // {cage, water}
    const server = { s: start as SetupV3 | null };
    const A: Device = { local: start };
    const B: Device = { local: start };
    A.local = applyToggle(A.local, 'wheel', at(1)); // A: X=wheel 체크
    B.local = applyToggle(B.local, 'water', at(2)); // B: Y=water 해제
    syncWith(A, server);
    syncWith(B, server); // B 가 409 → A 의 서버본과 병합
    syncWith(A, server);
    expect(checked(server.s)).toEqual(['cage', 'wheel']);
    expect(checked(A.local)).toEqual(['cage', 'wheel']);
    expect(checked(B.local)).toEqual(['cage', 'wheel']);
    expect(server.s?.uncheckedAt).toEqual({ water: at(2) });
  });

  it('P2 재현: A wheel 체크 → cage 해제, B wheel 해제, 교대 409 병합 → 최종 체크 없음', () => {
    const start = applyToggle(null, 'cage', at(0)); // {cage}
    const server = { s: start as SetupV3 | null };
    const A: Device = { local: start };
    const B: Device = { local: start };
    A.local = applyToggle(A.local, 'wheel', at(1)); // A: wheel ✓
    syncWith(A, server); // 서버 {cage, wheel}
    syncWith(B, server); // B 가 wheel 을 받는다
    expect(checked(B.local)).toEqual(['cage', 'wheel']);
    B.local = applyToggle(B.local, 'wheel', at(2)); // B: wheel 해제
    A.local = applyToggle(A.local, 'cage', at(3)); // A: cage 해제(B 의 해제를 아직 모름)
    syncWith(B, server); // 서버 {cage}, tomb wheel
    syncWith(A, server); // 409 → 병합: wheel tomb(2) > ✓(1), cage tomb(3) > ✓(0)
    syncWith(B, server);
    expect(checked(server.s)).toEqual([]);
    expect(checked(A.local)).toEqual([]);
    expect(checked(B.local)).toEqual([]);
    expect(server.s?.uncheckedAt).toEqual({ cage: at(3), wheel: at(2) });
  });

  it('동률 = 로컬: 같은 시각의 체크(로컬)와 해제(서버) → 체크, 반대면 해제', () => {
    const t = at(5);
    const chk = applyToggle(null, 'wheel', t);
    const un: SetupV3 = { ...chk, checks: {}, uncheckedAt: { wheel: t } };
    expect(checked(mergeSetup(chk, un))).toEqual(['wheel']);
    expect(mergeSetup(un, chk).uncheckedAt).toEqual({ wheel: t });
    expect(checked(mergeSetup(un, chk))).toEqual([]);
  });

  it('답(firstTime·owned·answeredAt) = answeredAt LWW, startedAt·reached100At = 최솟값, updatedAt = 최댓값', () => {
    const l = applyReached100(applyAnswer(applyToggle(null, 'bedding', at(1)), { firstTime: true, owned: ['cage'] }, at(4)), at(9));
    const s0 = applyAnswer(applyToggle(null, 'water', at(0)), { firstTime: false, owned: ['wheel'] }, at(6));
    const s = applyReached100(s0, at(7));
    const m = mergeSetup(l, s);
    expect(m.firstTime).toBe(false);
    expect(m.owned).toEqual(['wheel']);
    expect(m.answeredAt).toBe(at(6));
    expect(m.startedAt).toBe(at(0));
    expect(m.reached100At).toBe(at(7));
    expect(m.updatedAt).toBe(at(6)); // l.updatedAt = at(4)(reached100 은 updatedAt 불변)
    // 항목: bedding(l), cage OWNED(l), water·wheel(s) — 서로 다른 항목이라 전부 남는다.
    expect(checked(m)).toEqual(['bedding', 'cage', 'water', 'wheel']);
    // reached100At 한쪽 null → 다른 쪽 값.
    expect(mergeSetup({ ...l, reached100At: null }, s).reached100At).toBe(at(7));
    expect(mergeSetup({ ...l, reached100At: null }, { ...s, reached100At: null }).reached100At).toBeNull();
  });

  it('L3 재답변으로 빠진 OWNED ✓ 의 tombstone 은 다른 기기의 옛 OWNED ✓ 를 이긴다', () => {
    const both = applyAnswer(null, { firstTime: false, owned: ['cage', 'wheel'] }, at(0));
    const A = applyAnswer(both, { firstTime: false, owned: ['cage'] }, at(3)); // wheel 빠짐 → tomb(3)
    const B = applyToggle(both, 'bedding', at(2));
    const m = mergeSetup(B, A);
    expect(checked(m)).toEqual(['bedding', 'cage']);
    expect(m.owned).toEqual(['cage']);
    expect(m.uncheckedAt).toEqual({ wheel: at(3) });
  });
});

describe('reached100 은 updatedAt 을 바꾸지 않는다', () => {
  it('applyReached100 만으로 updatedAt 불변 → 병합에서 다른 기기의 새 변경을 가리지 않는다', () => {
    const base = applyToggle(null, 'cage', at(0));
    const opened = applyReached100(base, at(10)); // 나중에 L2 를 열기만 함
    expect(opened.updatedAt).toBe(at(0));
    const other = applyToggle(base, 'cage', at(5)); // 다른 기기가 at(5) 에 cage 해제
    const m = mergeSnapshots(snap(opened), snap(other));
    expect(checked(m.merged.setups[ID])).toEqual([]);
    expect(m.merged.setups[ID].reached100At).toBe(at(10));
    expect(m.merged.setups[ID].updatedAt).toBe(at(5));
  });
});

describe('v2 ↔ v3 호환', () => {
  const v2: SetupV2 = {
    v: 2,
    firstTime: true,
    owned: [],
    answeredAt: at(0),
    startedAt: at(0),
    checks: { cage: { source: 'OWNED', at: at(0) } },
    reached100At: null,
    updatedAt: at(0),
  };

  it('서버 v2 레코드 + 로컬 v3 → 병합 결과 v3(uncheckedAt 포함)', () => {
    const local = applyToggle(migrateSetup(v2), 'cage', at(1)); // 로컬에서 cage 해제
    const m = mergeSnapshots(snap(local), snap(v2));
    const out = m.merged.setups[ID];
    expect(out.v).toBe(3);
    expect(out.uncheckedAt).toEqual({ cage: at(1) });
    expect(checked(out)).toEqual([]);
    expect(m.pushNeeded).toBe(true);
    expect(m.toLocal.setups[ID]).toBeUndefined(); // 로컬과 같다
  });

  it('승격만 다른 같은 내용(v2 서버 · v3 로컬) → none(쓰기·PUT 0)', () => {
    const m = mergeSnapshots(snap(migrateSetup(v2)), snap(v2));
    expect(m.winner).toBe('none');
    expect(m.pushNeeded).toBe(false);
  });

  it('서버에만 v2 레코드 → 로컬엔 v3 로 내려간다', () => {
    const m = mergeSnapshots(snap(null), snap(v2));
    expect(m.toLocal.setups[ID]).toEqual({ ...v2, v: 3, uncheckedAt: {} });
    expect(m.winner).toBe('server');
  });

  it('서버 레코드가 무효 → 없는 것으로 보고 로컬로 덮는다(push)', () => {
    const local = applyToggle(null, 'cage', at(1));
    const m = mergeSnapshots(snap(local), snap({ v: 99 } as never));
    expect(m.merged.setups[ID]).toEqual(local);
    expect(m.pushNeeded).toBe(true);
  });
});

describe('tombstone 정리(쓰기 시)', () => {
  it('같은 id 의 더 새 체크가 있으면 tombstone 제거, 해제가 같거나 새것이면 체크 제거', () => {
    const s = applyToggle(null, 'x', at(0));
    expect(tidySetup({ ...s, checks: { a: { source: 'UNKNOWN', at: at(5) } }, uncheckedAt: { a: at(4) } }).uncheckedAt).toEqual({});
    const t = tidySetup({ ...s, checks: { a: { source: 'UNKNOWN', at: at(4) } }, uncheckedAt: { a: at(4) } });
    expect(t.checks).toEqual({});
    expect(t.uncheckedAt).toEqual({ a: at(4) });
  });

  it('90일 초과 tombstone 은 쓰기 시 제거(경계 = 정확히 90일은 남는다)', () => {
    const now = at(0);
    const old = new Date(Date.parse(now) - TOMBSTONE_MAX_AGE_MS - 1).toISOString();
    const edge = new Date(Date.parse(now) - TOMBSTONE_MAX_AGE_MS).toISOString();
    const s = applyToggle(null, 'x', now);
    const next = applyToggle({ ...s, uncheckedAt: { old1: old, edge1: edge } }, 'y', now);
    expect(next.uncheckedAt).toEqual({ edge1: edge });
    // 병합은 시각 무관(결정적) — 90일 정리를 하지 않는다.
    expect(mergeSetup({ ...s, uncheckedAt: { old1: old } }, s).uncheckedAt).toEqual({ old1: old });
  });

  it(`상한 ${TOMBSTONE_MAX} 초과 시 오래된 것부터 버린다`, () => {
    const s = applyToggle(null, 'x', at(0));
    const many: Record<string, string> = {};
    for (let i = 0; i < TOMBSTONE_MAX + 5; i++) many[`i${i}`] = new Date(Date.parse(at(0)) - (TOMBSTONE_MAX + 5 - i) * 1000).toISOString();
    const t = tidySetup({ ...s, uncheckedAt: many });
    expect(Object.keys(t.uncheckedAt)).toHaveLength(TOMBSTONE_MAX);
    for (let i = 0; i < 5; i++) expect(t.uncheckedAt[`i${i}`]).toBeUndefined();
    expect(t.uncheckedAt[`i${TOMBSTONE_MAX + 4}`]).toBeDefined();
    // 병합 결과에도 상한 적용
    expect(Object.keys(mergeSetup({ ...s, uncheckedAt: many }, s).uncheckedAt)).toHaveLength(TOMBSTONE_MAX);
  });
});
