// lib/storage — 계약 C-1 어댑터: 접두사 ws.만, 예외 → 메모리 폴백 + 안내 1회, 금지 키(좌표·이메일·토큰) 쓰기 거부.
import { describe, expect, it, vi } from 'vitest';
import { createStorage, hasForbiddenKey } from './storage';

function fakeBackend(overrides: Partial<Storage> = {}): Storage {
  const m = new Map<string, string>();
  const base = {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
  return Object.assign(base, overrides) as Storage;
}

describe('createStorage', () => {
  it('정상 백엔드: 읽기·쓰기·삭제, 메모리 모드 아님', () => {
    const backend = fakeBackend();
    const s = createStorage(() => backend);
    expect(s.get('ws.animalType')).toBeNull();
    s.set('ws.animalType', 'hamster-golden');
    expect(backend.getItem('ws.animalType')).toBe('hamster-golden');
    expect(s.get('ws.animalType')).toBe('hamster-golden');
    s.remove('ws.animalType');
    expect(s.get('ws.animalType')).toBeNull();
    expect(s.isMemoryOnly()).toBe(false);
  });

  it('접두사 ws. 이 아닌 키는 거부(throw)', () => {
    const s = createStorage(() => fakeBackend());
    expect(() => s.set('legacy.refresh', 'x')).toThrow();
    expect(() => s.get('token')).toThrow();
    expect(() => s.remove('animalType')).toThrow();
  });

  it('setItem throw → 메모리 폴백(값 유지) + onUnavailable 정확히 1회', () => {
    const backend = fakeBackend({
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    });
    const s = createStorage(() => backend);
    const cb = vi.fn();
    s.onUnavailable(cb);
    s.set('ws.setup.hamster-golden', '{"v":1}');
    s.set('ws.animalType', 'hamster-golden');
    expect(s.get('ws.setup.hamster-golden')).toBe('{"v":1}');
    expect(s.get('ws.animalType')).toBe('hamster-golden');
    expect(s.isMemoryOnly()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    // 메모리 모드 삭제는 백엔드의 옛 값을 되살리지 않는다.
    s.remove('ws.animalType');
    expect(s.get('ws.animalType')).toBeNull();
  });

  it('localStorage 접근 자체가 throw(시크릿·차단) → 메모리, 늦게 구독해도 안내 1회', () => {
    const s = createStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(s.get('ws.animalType')).toBeNull();
    s.set('ws.animalType', 'gerbil');
    expect(s.get('ws.animalType')).toBe('gerbil');
    const late = vi.fn();
    s.onUnavailable(late);
    expect(late).toHaveBeenCalledTimes(1);
    const later = vi.fn();
    s.onUnavailable(later);
    expect(later).not.toHaveBeenCalled(); // 안내는 세션 전체 1회
    s.set('ws.animalType', 'x');
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('구독 해제 후에는 호출되지 않는다', () => {
    const backend = fakeBackend({
      setItem: () => {
        throw new Error('nope');
      },
    });
    const s = createStorage(() => backend);
    const cb = vi.fn();
    const off = s.onUnavailable(cb);
    off();
    s.set('ws.animalType', 'a');
    expect(cb).not.toHaveBeenCalled();
  });

  it('불변식 ⑧: JSON 값 안에 좌표·지역·이메일·토큰 키가 있으면 쓰기 거부', () => {
    const backend = fakeBackend();
    const s = createStorage(() => backend);
    for (const k of ['lat', 'lng', 'coords', 'latitude', 'longitude', 'region', 'email', 'token', 'Lat', 'Email']) {
      expect(() => s.set('ws.setup.a', JSON.stringify({ v: 1, nested: { [k]: 1 } }))).toThrow();
    }
    expect(() => s.set('ws.setup.a', JSON.stringify({ v: 1, list: [{ lng: 2 }] }))).toThrow();
    expect(backend.length).toBe(0);
    // 값이 아니라 키만 본다 — 평문 문자열은 통과.
    s.set('ws.animalType', 'region-like-slug');
    expect(s.get('ws.animalType')).toBe('region-like-slug');
  });
});

describe('hasForbiddenKey', () => {
  it('깊은 키 탐색', () => {
    expect(hasForbiddenKey({ a: { b: [{ c: 1 }] } })).toBe(false);
    expect(hasForbiddenKey({ a: { b: [{ latitude: 1 }] } })).toBe(true);
    expect(hasForbiddenKey('lat')).toBe(false);
    expect(hasForbiddenKey(null)).toBe(false);
  });
});
