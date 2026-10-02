// events/track — 계약 C-3: validateEvent 선검증(실패 drop + dev 경고), 큐 10건/5초 flush, pagehide → 전송,
//   sessionKey ws.session 30일 회전, StrictMode 중복 제거, 페이로드에 브라우저 식별 문자열·IP·이메일·좌표 0.
import { MAX_BATCH, validateBatch, type TrackEvent } from '@ws/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type WsStorage } from '../lib/storage';
import {
  SESSION_KEY,
  SESSION_TTL_MS,
  beaconTransport,
  createTracker,
  getSessionKey,
  type EventTransport,
  type Tracker,
} from './track';

const NOW = Date.UTC(2026, 9, 2, 0, 0, 0);
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

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

interface Sent {
  events: TrackEvent[];
  unloading: boolean;
}

let backend: Storage;
let storage: WsStorage;
let sent: Sent[];
let warn: ReturnType<typeof vi.fn>;
let clock: number;
let uuids: string[];
let tracker: Tracker;

function make(): Tracker {
  const transport: EventTransport = { send: (events, o) => void sent.push({ events, unloading: o.unloading }) };
  return createTracker({
    transport,
    storage,
    now: () => clock,
    uuid: () => uuids.shift() ?? UUID_B,
    dev: true,
    warn,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  backend = memBackend();
  storage = createStorage(() => backend);
  sent = [];
  warn = vi.fn();
  clock = NOW;
  uuids = [UUID_A];
  tracker = make();
});

afterEach(() => {
  tracker.dispose();
  vi.useRealTimers();
});

const sel = (id = 'hamster-golden') => ({ animalTypeId: id, group: 'SMALL_MAMMAL', via: 'picker' }) as const;

describe('검증', () => {
  it('13종 외 이름·허용목록 밖 키·필수 누락 → drop + dev 경고, 전송 0', () => {
    tracker.track('page_viewed' as never, {});
    tracker.track('species_selected', { ...sel(), extra: 'x' });
    tracker.track('species_selected', { animalTypeId: 'hamster-golden' });
    tracker.track('unknown_species_clicked', { query: 'a@b.co' });
    tracker.flush();
    expect(sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('props > 1KB → drop', () => {
    tracker.track('unknown_species_clicked', { query: '가'.repeat(400) });
    tracker.flush();
    expect(sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('좌표·이메일 키는 허용목록 밖이라 drop', () => {
    tracker.track('species_selected', { ...sel(), lat: 37.5 } as never);
    tracker.track('species_selected', { ...sel(), email: 'x' } as never);
    tracker.flush();
    expect(sent).toHaveLength(0);
  });

  it('유효 이벤트: 봉투 키 정확, ts 정수 epoch ms, sessionKey UUID, animalTypeId 승격, 서버 validateBatch 통과', () => {
    tracker.track('species_selected', sel());
    tracker.track('setup_started', { animalTypeId: 'hamster-golden', firstTime: true, ownedCount: 2 });
    tracker.track('unknown_species_clicked', { query: '사막다람쥐' });
    tracker.flush();
    expect(sent).toHaveLength(1);
    const evs = sent[0].events;
    expect(evs).toHaveLength(3);
    for (const e of evs) {
      for (const k of Object.keys(e)) expect(['name', 'ts', 'animalTypeId', 'props', 'sessionKey']).toContain(k);
      expect(e.ts).toBe(NOW);
      expect(e.sessionKey).toBe(UUID_A);
    }
    expect(evs[0].animalTypeId).toBe('hamster-golden');
    expect('animalTypeId' in evs[2]).toBe(false);
    expect(validateBatch({ events: evs }).ok).toBe(true);
  });

  it('페이로드에 브라우저 식별 문자열·IP·이메일·좌표 0', () => {
    tracker.track('species_selected', sel());
    tracker.track('item_checked', {
      animalTypeId: 'hamster-golden',
      supplyItemId: 'cage',
      priority: 'REQUIRED',
      readySource: 'UNKNOWN',
    });
    tracker.flush();
    const json = JSON.stringify({ events: sent[0].events });
    expect(json).not.toMatch(/jsdom|Mozilla|AppleWebKit|Chrome/);
    expect(json).not.toMatch(/"(ip|ua|lat|lng|latitude|longitude|coords|email|phone|headers)"/i);
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});

describe('큐·flush', () => {
  it('10건이 차면 즉시 전송', () => {
    for (let i = 0; i < 9; i++) {
      clock += 2000; // 중복 창 밖
      tracker.track('species_selected', sel());
    }
    expect(sent).toHaveLength(0);
    clock += 2000;
    tracker.track('species_selected', sel());
    expect(sent).toHaveLength(1);
    expect(sent[0].events).toHaveLength(10);
    expect(sent[0].unloading).toBe(false);
  });

  it('5초 타이머로 전송', () => {
    tracker.track('species_selected', sel());
    vi.advanceTimersByTime(4999);
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
  });

  it('pagehide → unloading 전송, 빈 큐면 전송 0', () => {
    tracker.track('species_selected', sel());
    window.dispatchEvent(new Event('pagehide'));
    expect(sent).toEqual([expect.objectContaining({ unloading: true })]);
    window.dispatchEvent(new Event('pagehide'));
    expect(sent).toHaveLength(1);
  });

  it('flush 는 MAX_BATCH 단위로 나눈다', () => {
    const t = createTracker({
      transport: { send: (events, o) => void sent.push({ events, unloading: o.unloading }) },
      storage,
      now: () => clock,
      uuid: () => UUID_A,
      dev: false,
      warn,
      flushAt: 1000,
    });
    for (let i = 0; i < MAX_BATCH + 5; i++) {
      clock += 2000;
      t.track('species_selected', sel());
    }
    t.flush();
    expect(sent.map((s) => s.events.length)).toEqual([MAX_BATCH, 5]);
    t.dispose();
  });

  it('전송 실패(throw)는 UI 로 새지 않는다', () => {
    const t = createTracker({
      transport: {
        send: () => {
          throw new Error('offline');
        },
      },
      storage,
      now: () => clock,
      uuid: () => UUID_A,
      dev: false,
      warn,
    });
    t.track('species_selected', sel());
    expect(() => t.flush()).not.toThrow();
    t.dispose();
  });
});

describe('StrictMode 중복 제거', () => {
  it('같은 이름·props 가 1초 안에 다시 오면 버린다(A,B,A,B 교차 포함), 1초 뒤엔 허용', () => {
    tracker.track('species_selected', sel('a'));
    tracker.track('species_selected', sel('b'));
    tracker.track('species_selected', sel('a'));
    tracker.track('species_selected', sel('b'));
    clock += 1000;
    tracker.track('species_selected', sel('a'));
    tracker.flush();
    expect(sent[0].events.map((e) => e.props.animalTypeId)).toEqual(['a', 'b', 'a']);
  });
});

describe('sessionKey (ws.session)', () => {
  it('없으면 생성·저장 {v:1,key,createdAt}', () => {
    expect(getSessionKey(storage, NOW, () => UUID_A)).toBe(UUID_A);
    const rec = JSON.parse(backend.getItem(SESSION_KEY) as string);
    expect(rec).toEqual({ v: 1, key: UUID_A, createdAt: new Date(NOW).toISOString() });
  });

  it('30일 안이면 유지, 30일 지나면 회전', () => {
    getSessionKey(storage, NOW, () => UUID_A);
    expect(getSessionKey(storage, NOW + SESSION_TTL_MS - 1, () => UUID_B)).toBe(UUID_A);
    expect(getSessionKey(storage, NOW + SESSION_TTL_MS, () => UUID_B)).toBe(UUID_B);
    expect(JSON.parse(backend.getItem(SESSION_KEY) as string).key).toBe(UUID_B);
  });

  it('깨진 기록·v 다름·UUID 아님·미래 createdAt → 새 키', () => {
    for (const bad of [
      '{',
      JSON.stringify({ v: 2, key: UUID_A, createdAt: new Date(NOW).toISOString() }),
      JSON.stringify({ v: 1, key: 'not-a-uuid', createdAt: new Date(NOW).toISOString() }),
      JSON.stringify({ v: 1, key: UUID_A, createdAt: new Date(NOW + 86_400_000).toISOString() }),
    ]) {
      backend.setItem(SESSION_KEY, bad);
      expect(getSessionKey(storage, NOW, () => UUID_B)).toBe(UUID_B);
    }
  });

  it('저장 불가여도 세션 동안 같은 키', () => {
    const broken = createStorage(() => {
      throw new Error('blocked');
    });
    const k1 = getSessionKey(broken, NOW, () => UUID_A);
    const k2 = getSessionKey(broken, NOW + 1000, () => UUID_B);
    expect(k1).toBe(UUID_A);
    expect(k2).toBe(UUID_A);
  });

  it('추적기는 이벤트마다 회전을 확인한다', () => {
    uuids = [UUID_A, UUID_B];
    tracker.track('species_selected', sel());
    clock += SESSION_TTL_MS + 1;
    tracker.track('species_selected', sel());
    tracker.flush();
    expect(sent[0].events.map((e) => e.sessionKey)).toEqual([UUID_A, UUID_B]);
  });
});

describe('beaconTransport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sendBeacon 로 동일 출처 /api/events 에 text/plain {events}', async () => {
    const beacon = vi.fn<(url: string, body: Blob) => boolean>(() => true);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    const ev: TrackEvent = { name: 'species_selected', ts: NOW, props: sel(), sessionKey: UUID_A };
    beaconTransport().send([ev], { unloading: true });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0];
    expect(url).toBe('/api/events');
    expect(body.type).toMatch(/^text\/plain/);
    expect(JSON.parse(await body.text())).toEqual({ events: [ev] });
  });

  it('sendBeacon 거부(false)·없음 → 동일 출처 fetch keepalive', () => {
    const f = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', f);
    vi.stubGlobal('navigator', { sendBeacon: () => false });
    const ev: TrackEvent = { name: 'species_selected', ts: NOW, props: sel(), sessionKey: UUID_A };
    beaconTransport().send([ev], { unloading: false });
    vi.stubGlobal('navigator', {});
    beaconTransport().send([ev], { unloading: false });
    expect(f).toHaveBeenCalledTimes(2);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin' });
  });
});
