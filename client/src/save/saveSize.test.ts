// R6 D1 — 보내기 전 검증·크기 맞춤(merge.ts sanitizeSnapshot · fitSnapshot) + sync 소비.
//   근거: SEC-5 32KB(52) · 다동물 감사 #15(54: 6타입 + 반응 최대에서 32KB 초과 → 서버 400 → 동기화 조용히 정지).
//   정책(결정적): ⓪ 타입 20 · ① tombstone 오래된 것부터 · ② 반응 오래된 것부터 · ③ 선택하지 않은 동물 레코드(오래된 동물부터).
import { MAX_REACTIONS, SAVE_MAX_BYTES, utf8ByteLength, validateSaveV1 } from '@ws/save-validate';
import { describe, expect, it, vi } from 'vitest';
import { createStorage } from '../lib/storage';
import type { SaveApi } from './api';
import type { CageV1, Saveable, SaveReactions, SaveV1, SetupV3 } from './contract';
import { fitSnapshot, sanitizeSnapshot } from './merge';
import { createSaveSync } from './sync';

const BASE = Date.parse('2026-06-01T00:00:00.000Z');
const at = (sec: number): string => new Date(BASE + sec * 1000).toISOString();
const size = (s: unknown): number => utf8ByteLength(JSON.stringify(s));
/** 실제 시드와 비슷한 길이의 항목 id(20~24자). */
const itemId = (i: number): string => `supply-item-${String(i).padStart(4, '0')}-x`;
const TYPES = ['hamster-golden', 'hamster-dwarf', 'gerbil-mongolian', 'budgie', 'cockatiel', 'lovebird'];

function setupRec(t0: number, checks: number, tombs: number): SetupV3 {
  return {
    v: 3,
    firstTime: true,
    owned: [],
    answeredAt: at(t0),
    startedAt: at(t0),
    checks: Object.fromEntries(Array.from({ length: checks }, (_, i) => [itemId(i), { source: 'UNKNOWN' as const, at: at(t0 + i) }])),
    uncheckedAt: Object.fromEntries(Array.from({ length: tombs }, (_, i) => [itemId(1000 + i), at(t0 + 10 + i)])),
    reached100At: null,
    updatedAt: at(t0 + 5000),
  };
}

function cage(t: number): CageV1 {
  return { v: 1, type: 'WIRE', floorWcm: 80, floorDcm: 50, heightCm: 45, barGapMm: 9, updatedAt: at(t) };
}

function reactions(n: number, t0: number, helpful = n): SaveReactions {
  return {
    like: Object.fromEntries(Array.from({ length: n }, (_, i) => [`product-${String(i).padStart(4, '0')}`, at(t0 + i)])),
    helpful: Object.fromEntries(Array.from({ length: helpful }, (_, i) => [`SUPPLY_ITEM:${itemId(i)}`, at(t0 + i)])),
    updatedAt: at(t0 + n),
  };
}

function snap(over: Partial<SaveV1> = {}): SaveV1 {
  return { v: 1, animalTypeId: 'hamster-golden', setups: {}, cages: {}, reactions: { like: {}, helpful: {}, updatedAt: at(0) }, ...over };
}

function tombCount(s: SaveV1): number {
  return Object.values(s.setups).reduce((n, r) => n + Object.keys(r.uncheckedAt).length, 0);
}

describe('sanitizeSnapshot — 레코드 단위 사전 검증(무효만 버린다)', () => {
  it('전부 유효 → 그대로, dropped 0', () => {
    const s = snap({ setups: { 'hamster-golden': setupRec(0, 3, 1) }, cages: { 'hamster-golden': cage(1) } });
    const r = sanitizeSnapshot(s);
    expect(r.dropped).toBe(0);
    expect(r.value).toEqual(s);
  });

  it('무효 setups·cages 레코드·반응 키·animalTypeId 만 빠지고 나머지는 남아 서버 검증기를 통과', () => {
    const bad = { ...setupRec(0, 2, 0), checks: { cage: { source: 'STOLEN', at: at(1) } } } as unknown as SetupV3;
    const badCage = { ...cage(1), type: 'LIVING_BOX' } as CageV1; // barGapMm 는 WIRE 만(D7)
    const s = snap({
      animalTypeId: 'Not A Slug',
      setups: { 'hamster-golden': setupRec(0, 3, 1), 'hamster-dwarf': bad },
      cages: { 'hamster-golden': cage(2), 'hamster-dwarf': badCage },
      reactions: { like: { p1: at(1), 'BAD KEY': at(1) }, helpful: { 'SUPPLY_ITEM:wheel': at(2), wheel: at(2) }, updatedAt: at(3) },
    });
    expect(validateSaveV1(s).ok).toBe(false);
    const r = sanitizeSnapshot(s);
    expect(r.dropped).toBe(5);
    expect(r.value.animalTypeId).toBeNull();
    expect(Object.keys(r.value.setups)).toEqual(['hamster-golden']);
    expect(Object.keys(r.value.cages)).toEqual(['hamster-golden']);
    expect(r.value.reactions).toEqual({ like: { p1: at(1) }, helpful: { 'SUPPLY_ITEM:wheel': at(2) }, updatedAt: at(3) });
    expect(validateSaveV1(r.value).ok).toBe(true);
  });

  it(`반응이 ${MAX_REACTIONS} 초과면 시각 새것부터 ${MAX_REACTIONS}`, () => {
    const r = sanitizeSnapshot(snap({ reactions: { ...reactions(MAX_REACTIONS + 3, 0), helpful: {} } }));
    expect(Object.keys(r.value.reactions.like)).toHaveLength(MAX_REACTIONS);
    expect(r.value.reactions.like['product-0000']).toBeUndefined();
    expect(r.value.reactions.like[`product-${String(MAX_REACTIONS + 2).padStart(4, '0')}`]).toBeDefined();
  });
});

describe('fitSnapshot — 32KB 최악치(감사 #15: 다동물 × tombstone · 반응 500)', () => {
  it('반응 상한만으로도 넘친다(실측: like 500 ≈ 21KB + helpful 500 ≈ 30KB) — 서버 상한 500 과 32KB 가 서로 맞지 않음', () => {
    const r = reactions(MAX_REACTIONS, 0);
    expect(size(r.like)).toBeGreaterThan(20000);
    expect(size(r.helpful)).toBeGreaterThan(29000);
    const s = snap({ reactions: r });
    expect(validateSaveV1(s).ok).toBe(false);
    const f = fitSnapshot(s) as SaveV1;
    expect(validateSaveV1(f).ok).toBe(true);
    expect(Object.keys(f.reactions.helpful).length + Object.keys(f.reactions.like).length).toBeLessThan(2 * MAX_REACTIONS);
  });

  it('6 타입 × (체크 10 + tombstone 200) + 반응 like 500(≈21KB, 감사 #15 조합) → 32KB 초과 실측 → tombstone 만 오래된 것부터 잘려 통과', () => {
    const setups = Object.fromEntries(TYPES.map((t, k) => [t, setupRec(k * 10000, 10, 200)]));
    const cages = Object.fromEntries(TYPES.map((t, k) => [t, cage(k)]));
    const s = snap({ setups, cages, reactions: reactions(MAX_REACTIONS, 100000, 0) });
    const before = size(s);
    expect(before).toBeGreaterThan(SAVE_MAX_BYTES); // 감사 실측과 같은 방향: 이 조합은 넘는다
    expect(validateSaveV1(s).ok).toBe(false);

    const f = fitSnapshot(s) as SaveV1;
    expect(f).not.toBeNull();
    expect(validateSaveV1(f).ok).toBe(true);
    expect(size(f)).toBeLessThanOrEqual(SAVE_MAX_BYTES);
    // ① 만으로 충분 — 모든 체크·케이지·반응·타입 보존, tombstone 일부만 남음
    for (const t of TYPES) expect(f.setups[t].checks).toEqual(s.setups[t].checks);
    expect(f.cages).toEqual(s.cages);
    expect(f.reactions).toEqual(s.reactions);
    const kept = tombCount(f);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(tombCount(s));
    // 오래된 것부터: 남은 tombstone 중 가장 옛것 ≥ 지운 것 중 가장 새것
    const keptTimes: number[] = [];
    const goneTimes: number[] = [];
    for (const t of TYPES) {
      for (const [id, ts] of Object.entries(s.setups[t].uncheckedAt)) (f.setups[t].uncheckedAt[id] ? keptTimes : goneTimes).push(Date.parse(ts));
    }
    expect(Math.min(...keptTimes)).toBeGreaterThanOrEqual(Math.max(...goneTimes));
    // 최소한만 자른다: 지운 것 중 가장 새것 하나를 되돌리면 넘친다
    expect(fitSnapshot(f)).toBe(f);
    // 원본은 바뀌지 않는다(보내는 사본만 자름)
    expect(tombCount(s)).toBe(TYPES.length * 200);
  });

  it('tombstone 을 다 지워도 넘치면 ② 반응을 오래된 것부터', () => {
    const setups = Object.fromEntries(TYPES.map((t, k) => [t, setupRec(k * 10000, 60, 50)]));
    const s = snap({ setups, reactions: reactions(MAX_REACTIONS, 100000) });
    expect(size(s)).toBeGreaterThan(SAVE_MAX_BYTES);
    const f = fitSnapshot(s) as SaveV1;
    expect(validateSaveV1(f).ok).toBe(true);
    expect(tombCount(f)).toBe(0);
    for (const t of TYPES) expect(f.setups[t].checks).toEqual(s.setups[t].checks);
    const keptLike = Object.keys(f.reactions.like).length + Object.keys(f.reactions.helpful).length;
    expect(keptLike).toBeGreaterThan(0);
    expect(keptLike).toBeLessThan(2 * MAX_REACTIONS);
    expect(f.reactions.like['product-0000']).toBeUndefined(); // 가장 옛것부터
    expect(f.reactions.like[`product-${String(MAX_REACTIONS - 1).padStart(4, '0')}`]).toBeDefined();
  });

  it('반응까지 다 지워도 넘치면 ③ 선택하지 않은 동물 레코드를 오래된 동물부터 통째로 — 선택 동물은 남는다', () => {
    // 선택 동물(hamster-golden)이 가장 오래됐어도 지우지 않는다.
    const setups = Object.fromEntries(TYPES.map((t, k) => [t, setupRec(k * 10000, 200, 0)]));
    const cages = Object.fromEntries(TYPES.map((t, k) => [t, cage(k)]));
    const s = snap({ setups, cages, reactions: reactions(50, 100000) });
    const f = fitSnapshot(s) as SaveV1;
    expect(validateSaveV1(f).ok).toBe(true);
    expect(f.setups['hamster-golden']).toEqual(s.setups['hamster-golden']);
    expect(f.cages['hamster-golden']).toEqual(s.cages['hamster-golden']);
    const keptTypes = Object.keys(f.setups);
    expect(keptTypes.length).toBeLessThan(TYPES.length);
    // 지워진 것은 (선택 동물 제외) 오래된 동물부터 — 가장 최근 동물(lovebird)은 남는다
    expect(keptTypes).toContain('lovebird');
    expect(keptTypes).not.toContain('hamster-dwarf');
    expect(Object.keys(f.reactions.like)).toHaveLength(0);
  });

  it('⓪ 타입 21 개 → 선택 동물 + 최근 19 개(20 개)', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `type-${String(i).padStart(2, '0')}`);
    const setups = Object.fromEntries(ids.map((t, k) => [t, setupRec(k * 10, 1, 0)]));
    const f = fitSnapshot(snap({ animalTypeId: 'type-00', setups })) as SaveV1;
    expect(Object.keys(f.setups)).toHaveLength(20);
    expect(f.setups['type-00']).toBeDefined(); // 가장 오래됐지만 선택 동물
    expect(f.setups['type-01']).toBeUndefined(); // 선택 외 가장 오래된 것
    expect(validateSaveV1(f).ok).toBe(true);
  });

  it('선택 동물 혼자서 넘치면 null(보내지 않음)', () => {
    const long = (i: number): string => `x${String(i).padStart(4, '0')}${'a'.repeat(58)}`; // 63자 slug
    const rec: SetupV3 = {
      ...setupRec(0, 0, 0),
      checks: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [long(i), { source: 'PURCHASED' as const, at: at(i) }])),
      owned: Array.from({ length: 200 }, (_, i) => long(i)),
    };
    const s = snap({ setups: { 'hamster-golden': rec } });
    expect(size(s)).toBeGreaterThan(SAVE_MAX_BYTES);
    expect(fitSnapshot(s)).toBeNull();
  });
});

// ── sync 소비 ──
function memStore() {
  const m = new Map<string, string>();
  const b = {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
  return createStorage(() => b);
}

function slice<P>(key: Saveable<P>['key'], value: P): Saveable<P> {
  return { key, export: () => value, import: () => undefined, subscribe: () => () => undefined };
}

function api(server: SaveV1 | null = null) {
  const puts: SaveV1[] = [];
  const a: SaveApi = {
    requestMagic: vi.fn(async () => ({ status: 202 })),
    verify: vi.fn(async () => ({ status: 200 })),
    session: vi.fn(async () => ({ status: 200, linked: true })),
    logout: vi.fn(async () => ({ status: 204 })),
    getSave: vi.fn(async () => ({ status: 200, body: { snapshot: server, updatedAt: server ? at(1) : null } })),
    putSave: vi.fn(async (s: SaveV1) => {
      puts.push(structuredClone(s));
      // 실제 서버처럼 검증 — 통과 못 하면 400
      return validateSaveV1(s).ok ? { status: 200, updatedAt: at(2) } : { status: 400 };
    }),
  };
  return { a, puts };
}

describe('sync — buildLocal 사전 검증 · PUT 전 크기 맞춤', () => {
  it('무효 레코드 1개가 있어도 PUT 은 400 이 아니다(그 레코드만 빠짐)', async () => {
    const { a, puts } = api();
    const bad = { ...setupRec(0, 1, 0), checks: { cage: { source: 'STOLEN', at: at(1) } } } as unknown as SetupV3;
    const sync = createSaveSync({
      api: a,
      storage: memStore(),
      slices: {
        setups: slice('setups', { 'hamster-golden': setupRec(0, 2, 0), 'hamster-dwarf': bad }),
        cages: slice('cages', {}),
        reactions: slice('reactions', { like: {}, helpful: {}, updatedAt: at(0) }),
        animalType: slice('animalType', 'hamster-golden'),
      },
      track: () => undefined,
      now: () => at(3),
    });
    const r = await sync.link('Q'.repeat(43));
    expect(r).toMatchObject({ kind: 'linked', confirm: true });
    await sync.confirm();
    expect(puts).toHaveLength(1);
    expect(Object.keys(puts[0].setups)).toEqual(['hamster-golden']);
    expect(validateSaveV1(puts[0]).ok).toBe(true);
    sync.stop();
  });

  it('최악치 로컬(6 타입 × tombstone 200 + 반응 500·500) → PUT 본문 ≤ 32KB 로 맞춰 200(동기화 정지 0)', async () => {
    const { a, puts } = api();
    const setups = Object.fromEntries(TYPES.map((t, k) => [t, setupRec(k * 10000, 10, 200)]));
    const sync = createSaveSync({
      api: a,
      storage: memStore(),
      slices: {
        setups: slice('setups', setups),
        cages: slice('cages', {}),
        reactions: slice('reactions', reactions(MAX_REACTIONS, 100000)),
        animalType: slice('animalType', 'hamster-golden'),
      },
      track: () => undefined,
      now: () => at(3),
    });
    await sync.link('Q'.repeat(43));
    expect(await sync.confirm()).toBe(true);
    expect(puts).toHaveLength(1);
    expect(size(puts[0])).toBeLessThanOrEqual(SAVE_MAX_BYTES);
    expect(validateSaveV1(puts[0]).ok).toBe(true);
    expect(await (a.putSave as ReturnType<typeof vi.fn>).mock.results[0].value).toMatchObject({ status: 200 });
    sync.stop();
  });
});
