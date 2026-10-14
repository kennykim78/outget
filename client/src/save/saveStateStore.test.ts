// save/saveStateStore — 계약 C-R5-1 ws.save v1 = {v:1, linked, lastSyncAt}. 이메일·토큰·세션 id 자리 없음(불변식 ⑧).
import { beforeEach, describe, expect, it } from 'vitest';
import { createStorage, type WsStorage } from '../lib/storage';
import { SAVE_STATE_KEY, clearSaveState, parseSaveState, readSaveState, writeSaveState } from './saveStateStore';

const T0 = '2026-10-02T00:00:00.000Z';

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

let backend: Storage;
let store: WsStorage;
beforeEach(() => {
  backend = memBackend();
  store = createStorage(() => backend);
});

describe('ws.save', () => {
  it('없으면 기본값(연결 안 됨)', () => {
    expect(SAVE_STATE_KEY).toBe('ws.save');
    expect(readSaveState(store)).toEqual({ v: 1, linked: false, lastSyncAt: null });
  });

  it('왕복 — 알려진 필드만 쓴다(이메일·토큰·sid 를 넘겨도 저장 0)', () => {
    writeSaveState(store, { linked: true, lastSyncAt: T0, email: 'a@b.c', sid: 'x', token: 't' } as never);
    const raw = backend.getItem('ws.save') as string;
    expect(JSON.parse(raw)).toEqual({ v: 1, linked: true, lastSyncAt: T0 });
    expect(raw).not.toMatch(/@|sid|token/);
    expect(readSaveState(store)).toEqual({ v: 1, linked: true, lastSyncAt: T0 });
  });

  it.each([
    ['깨진 JSON', '{'],
    ['v=99', JSON.stringify({ v: 99, linked: true, lastSyncAt: null })],
    ['linked 문자열', JSON.stringify({ v: 1, linked: 'yes', lastSyncAt: null })],
    ['lastSyncAt 숫자', JSON.stringify({ v: 1, linked: true, lastSyncAt: 5 })],
  ])('%s → 기본값', (_l, raw) => {
    expect(parseSaveState(raw)).toBeNull();
    backend.setItem('ws.save', raw);
    expect(readSaveState(store)).toEqual({ v: 1, linked: false, lastSyncAt: null });
  });

  it('잘못된 값으로 쓰기 → throw, 저장 0', () => {
    expect(() => writeSaveState(store, { linked: 'x' as never, lastSyncAt: null })).toThrow();
    expect(() => writeSaveState(store, { linked: true, lastSyncAt: 1 as never })).toThrow();
    expect(backend.length).toBe(0);
  });

  it('clear = 키 삭제("이 기기에서 연결 해제")', () => {
    writeSaveState(store, { linked: true, lastSyncAt: T0 });
    clearSaveState(store);
    expect(backend.getItem('ws.save')).toBeNull();
  });
});
