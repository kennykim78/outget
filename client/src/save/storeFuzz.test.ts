// 퍼즈(F2-1, 불변식 ⑧): setupStore·cageStore·ws.save 에 무작위 연산(이메일·좌표·토큰 키를 섞은 import·입력 포함)을
//   반복한 뒤, 모든 ws.* 값에 이메일 모양 문자열 0 · 금지 키 0 · cage 값은 스키마 범위 안.
import { describe, expect, it } from 'vitest';
import type { SpecSchema } from '@ws/engine';
import { FORBIDDEN_KEYS, createStorage } from '../lib/storage';
import {
  applyAnswer,
  applyPurchased,
  applyReached100,
  applyToggle,
  createSetupSaveable,
  readSetup,
  writeSetup,
} from '../checklist/setupStore';
import { createCageSaveable, readCage, removeCage, writeCage } from '../context/cageStore';
import { writeSaveState } from './saveStateStore';

const SCHEMA: SpecSchema = {
  fields: [
    { key: 'type', label: '형태', type: 'enum', options: ['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER'] },
    { key: 'floorWcm', label: '바닥 가로(cm)', type: 'number', min: 20, max: 200 },
    { key: 'floorDcm', label: '바닥 세로(cm)', type: 'number', min: 20, max: 120 },
    { key: 'heightCm', label: '높이(cm)', type: 'number', min: 15, max: 100 },
    { key: 'barGapMm', label: '철망 간격(mm)', type: 'number', min: 3, max: 30, optional: true },
  ],
};
const RANGE: Record<string, [number, number]> = {
  floorWcm: [20, 200],
  floorDcm: [20, 120],
  heightCm: [15, 100],
  barGapMm: [3, 30],
};

// mulberry32 — 결정론 PRNG(실패 재현용 시드 고정).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

const TYPES = ['hamster-golden', 'gerbil-mongolian', 'budgie'];
const ITEMS = ['cage', 'wheel', 'bedding', 'water', 'q', 'zip', 'email', 'lat', '../x', 'sid'];
const POISON: Record<string, unknown> = {
  email: 'kenny@example.com',
  lat: 37.5665,
  lng: 126.978,
  coords: [37.5, 127],
  latitude: 37.4,
  longitude: 127.1,
  region: '서울 강남구',
  sigungu: '강남구',
  token: 'tok',
  sid: 'abc',
  password: 'pw',
  refresh: 'r',
  gps: { lat: 1 },
  geo: 'x',
  position: { x: 1 },
  q: '검색',
  search: '케이지',
  zip: '06000',
  postcode: '06000',
  address: '서울',
  phone: '010',
  query: 'x',
};
const POISON_KEYS = Object.keys(POISON);
const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;

describe('퍼즈: 모든 ws.* 값 — 이메일·좌표·금지 키 0', () => {
  it.each([1, 7, 42, 2026, 31337])('seed %i · 400 연산', (seed) => {
    const r = rng(seed);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const backend = memBackend();
    const store = createStorage(() => backend);
    const setups = createSetupSaveable(store);
    // 스키마를 아는 경로만(스키마 미상 import 는 형태 검사만 — 범위 단언 대상 아님, cageStore.test 참고).
    const cages = createCageSaveable(store, () => SCHEMA);
    const poison = (o: Record<string, unknown>): Record<string, unknown> => {
      const out = { ...o };
      const n = Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const k = pick(POISON_KEYS);
        out[k] = POISON[k];
      }
      return out;
    };
    const num = (): unknown => pick([r() * 250 - 20, 37.5665, 126.978, 60, 80, 9, Number.NaN, '80', null, undefined]);
    const now = (): string => new Date(Date.UTC(2026, 9, 2, 0, Math.floor(r() * 600))).toISOString();

    for (let i = 0; i < 400; i++) {
      const t = pick(TYPES);
      const op = Math.floor(r() * 9);
      expect(() => {
        switch (op) {
          case 0:
            writeSetup(store, t, applyToggle(readSetup(store, t), pick(ITEMS.filter((x) => /^[a-z]/.test(x) && !['q', 'zip', 'email', 'lat', 'sid'].includes(x))), now()));
            break;
          case 1:
            writeSetup(store, t, applyAnswer(readSetup(store, t), { firstTime: r() < 0.5, owned: [pick(ITEMS), pick(ITEMS)] }, now()));
            break;
          case 2: {
            const s = readSetup(store, t);
            if (s) writeSetup(store, t, applyReached100(applyPurchased(s, 'wheel', now()), now()));
            break;
          }
          case 3: {
            // 서버 스냅샷 흉내 — 레코드·check 행에 금지 키를 섞는다.
            const s = applyToggle(null, 'cage', now());
            setups.import({
              [t]: poison({
                ...s,
                checks: { cage: poison({ ...s.checks.cage }), [pick(ITEMS)]: { source: 'OWNED', at: now() } },
                // F: tombstone 맵에도 금지 키·이메일 값을 섞는다.
                uncheckedAt: poison({ [pick(ITEMS)]: now(), [pick(ITEMS)]: 'kenny@example.com' }),
              }) as never,
            });
            break;
          }
          case 4:
            writeCage(
              store,
              t,
              poison({ type: pick(['LIVING_BOX', 'WIRE', 'ACRYLIC', 'OTHER', 'GLASS']), floorWcm: num(), floorDcm: num(), heightCm: num(), barGapMm: num() }),
              SCHEMA,
              now(),
            );
            break;
          case 5:
            cages.import({
              [pick([...TYPES, '../x'])]: poison({ v: 1, type: pick(['WIRE', 'OTHER']), floorWcm: num(), floorDcm: num(), heightCm: num(), barGapMm: num(), updatedAt: now() }) as never,
            });
            break;
          case 6:
            if (r() < 0.3) removeCage(store, t);
            else void readCage(store, t, SCHEMA);
            break;
          case 7:
            writeSaveState(store, poison({ linked: r() < 0.5, lastSyncAt: r() < 0.5 ? null : now() }) as never);
            break;
          case 8:
            void setups.export();
            void cages.export();
            break;
        }
      }).not.toThrow();
    }

    // 스캔: 모든 ws.* 값.
    const keys = store.keys();
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const raw = backend.getItem(k) as string;
      expect(raw, k).not.toMatch(EMAIL_RE);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const seen: string[] = [];
      JSON.parse(raw, (key, v) => {
        seen.push(key.toLowerCase());
        return v;
      });
      for (const key of seen) expect(FORBIDDEN_KEYS.has(key), `${k} → ${key}`).toBe(false);
      if (/^ws\.setup\.[a-z0-9-]+$/.test(k)) {
        // F 계약: 쓰기는 항상 v3, tombstone = slug → Z ISO, ≤200, 같은 id 가 체크와 동시에 남지 않는다(쓰기 시 정리).
        const s = parsed as { v: number; checks: Record<string, unknown>; uncheckedAt: Record<string, string> };
        expect(s.v, k).toBe(3);
        const tombs = Object.entries(s.uncheckedAt);
        expect(tombs.length, k).toBeLessThanOrEqual(200);
        for (const [id, at] of tombs) {
          expect(id, k).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
          expect(at, `${k}.${id}`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
          expect(Object.prototype.hasOwnProperty.call(s.checks, id), `${k}.${id} 체크·해제 동시`).toBe(false);
        }
      }
      if (/^ws\.context\.[a-z0-9-]+\.cage$/.test(k)) {
        const c = parsed as Record<string, unknown>;
        for (const [f, [lo, hi]] of Object.entries(RANGE)) {
          if (c[f] === undefined) continue;
          expect(typeof c[f], `${k}.${f}`).toBe('number');
          expect(c[f] as number, `${k}.${f}`).toBeGreaterThanOrEqual(lo);
          expect(c[f] as number, `${k}.${f}`).toBeLessThanOrEqual(hi);
        }
        if (c.type !== 'WIRE') expect(c.barGapMm, k).toBeUndefined();
      }
    }
  });
});

// D4: 금지 키 전수 — 목록을 모듈에서 읽지 않고 하드코딩한다(모듈에서 하나라도 빠지면 이 테스트가 실패).
const EXPECTED_FORBIDDEN = [
  'gps', 'geo', 'position', 'sigungu', 'postcode', 'zip', 'password', 'refresh', 'search', 'q', 'sid',
  'lat', 'lng', 'latitude', 'longitude', 'coords', 'coordinates', 'location', 'region', 'address',
  'email', 'phone', 'token', 'accesstoken', 'refreshtoken', 'query',
  // R-1: 서버와 단일 소스로 합치며 추가된 4개
  'sessionid', 'ws_sid', 'ip', 'useragent',
];

describe('퍼즈: 금지 키 전수 거부 (하드코딩 목록)', () => {
  it.each(EXPECTED_FORBIDDEN)('금지 키 %s — 최상위·중첩·배열·대문자 쓰기 거부', (key) => {
    const backend = memBackend();
    const store = createStorage(() => backend);
    const variants: unknown[] = [
      { [key]: 1 },
      { ok: { deep: { [key]: 'x' } } },
      { list: [{ [key]: 'x' }] },
      { [key.toUpperCase()]: 1 },
    ];
    variants.forEach((v, i) => {
      expect(() => store.set(`ws.fuzz.${i}`, JSON.stringify(v)), `${key} #${i}`).toThrow();
      expect(store.get(`ws.fuzz.${i}`), `${key} #${i} 저장됨`).toBeNull();
    });
    expect(FORBIDDEN_KEYS.has(key), `FORBIDDEN_KEYS 에 ${key} 없음`).toBe(true);
  });
});
