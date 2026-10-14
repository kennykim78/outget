// F2-3: animalType Saveable(C-R5-9) + cage import 퍼즈(스키마 없음 — 카탈로그 로드 전 import 경로).
//   스키마가 없어도 import 후 남는 ws.context.*.cage 는 형태가 맞는 값만(형태 4종·양수 유한 숫자·barGapMm 은 WIRE 만),
//   알려진 키만, 이메일·좌표·토큰 0(불변식 ⑧).
import { describe, expect, it, vi } from 'vitest';
import { ANIMAL_TYPE_KEY } from '../animal/selection';
import { FORBIDDEN_KEYS, createStorage } from '../lib/storage';
import { createAnimalTypeSaveable } from './animalTypeSaveable';
import { CAGE_TYPES, createCageSaveable } from './cageStore';

function memBackend(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  } as Storage;
}

describe('animalType Saveable', () => {
  it('export: 형식 맞는 typeId 또는 null', () => {
    const backend = memBackend();
    const s = createStorage(() => backend);
    const sv = createAnimalTypeSaveable(s);
    expect(sv.key).toBe('animalType');
    expect(sv.export()).toBeNull();
    s.set(ANIMAL_TYPE_KEY, 'hamster-golden');
    expect(sv.export()).toBe('hamster-golden');
    backend.setItem(ANIMAL_TYPE_KEY, 'Not A Slug!');
    expect(sv.export()).toBeNull();
  });

  it('import: 형식 맞을 때만 쓰고 구독자에 알림, null·깨진 값 → 그대로', () => {
    const backend = memBackend();
    const s = createStorage(() => backend);
    const sv = createAnimalTypeSaveable(s);
    const fn = vi.fn();
    const off = sv.subscribe(fn);
    sv.import('hamster-golden');
    expect(s.get(ANIMAL_TYPE_KEY)).toBe('hamster-golden');
    expect(fn).toHaveBeenCalledTimes(1);
    for (const bad of [null, '', 'a@b.com', '../x', 'X Y', 42 as unknown as string]) sv.import(bad);
    expect(s.get(ANIMAL_TYPE_KEY)).toBe('hamster-golden');
    sv.import('hamster-golden'); // 같은 값 → 알림 없음
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    sv.import('parrot-budgie');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// 결정적 의사난수(재현 가능).
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

const JUNK: unknown[] = [
  null,
  undefined,
  0,
  -5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1e9,
  '60',
  'a@b.com',
  true,
  [],
  {},
  { lat: 37.5, lng: 127 },
  'LIVING_BOX',
  'WIRE',
  'GLASS',
  37.5665,
  9,
  45,
];

describe('cage import 퍼즈(스키마 없음)', () => {
  it('무작위 import 400회 후 남은 모든 cage 레코드는 형태가 맞고, 금지 키·이메일·좌표 0', () => {
    const backend = memBackend();
    const s = createStorage(() => backend);
    const sv = createCageSaveable(s, () => null);
    const r = rng(20261012);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const ids = ['hamster-golden', 'parrot-budgie', 'Bad Id', '../x', 'a@b.com'];
    const extraKeys = ['lat', 'lng', 'email', 'token', 'region', 'note', 'barGapMm', 'v', 'updatedAt'];

    for (let i = 0; i < 400; i++) {
      const rec: Record<string, unknown> = {
        v: r() < 0.85 ? 1 : pick([2, '1', null]),
        type: r() < 0.7 ? pick(CAGE_TYPES) : pick(JUNK),
        floorWcm: r() < 0.7 ? Math.round(r() * 250) : pick(JUNK),
        floorDcm: r() < 0.7 ? Math.round(r() * 150) : pick(JUNK),
        heightCm: r() < 0.7 ? Math.round(r() * 120) : pick(JUNK),
        updatedAt: r() < 0.9 ? new Date(Date.UTC(2026, 9, 1 + (i % 20))).toISOString() : pick(JUNK),
      };
      if (r() < 0.5) rec.barGapMm = r() < 0.7 ? Math.round(r() * 40) : pick(JUNK);
      if (r() < 0.3) rec[pick(extraKeys)] = pick(JUNK);
      const payload = r() < 0.1 ? pick(JUNK) : { [pick(ids)]: rec };
      try {
        sv.import(payload as never);
      } catch {
        // 금지 키 거부(storage throw)는 허용 — 아무것도 쓰이지 않는다
      }
    }

    let seen = 0;
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i) as string;
      const raw = backend.getItem(k) as string;
      expect(raw).not.toMatch(/@/);
      if (!/^ws\.context\.[^.]+\.cage$/.test(k)) continue;
      seen++;
      const v = JSON.parse(raw) as Record<string, unknown>;
      const keys = Object.keys(v);
      for (const key of keys) {
        expect(['v', 'type', 'floorWcm', 'floorDcm', 'heightCm', 'barGapMm', 'updatedAt']).toContain(key);
        expect(FORBIDDEN_KEYS.has(key)).toBe(false);
      }
      expect(v.v).toBe(1);
      expect(CAGE_TYPES).toContain(v.type);
      for (const nk of ['floorWcm', 'floorDcm', 'heightCm']) {
        expect(typeof v[nk]).toBe('number');
        expect(Number.isFinite(v[nk] as number) && (v[nk] as number) > 0).toBe(true);
      }
      if ('barGapMm' in v) {
        expect(v.type).toBe('WIRE');
        expect((v.barGapMm as number) > 0).toBe(true);
      }
      expect(v.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
      expect(k).toMatch(/^ws\.context\.(hamster-golden|parrot-budgie)\.cage$/);
    }
    expect(seen).toBeGreaterThan(0);
    // export 왕복도 같은 규칙
    for (const c of Object.values(sv.export())) expect(CAGE_TYPES).toContain(c.type);
  });
});
