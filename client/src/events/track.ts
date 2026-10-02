// 이벤트 기록(계약 C-3, 단일 소스 @ws/events). PRD US-018.
//   - 보내기 전에 서버와 같은 validateEvent 로 검증 → 실패는 버리고 dev 에서만 경고(UI 로 예외를 내지 않는다).
//   - 메모리 큐: 10건이 차거나 5초가 지나면 전송, pagehide·숨김 전환 시 남은 것 전송. 배치는 MAX_BATCH 단위.
//   - 전송은 동일 출처 /api/events 만(sendBeacon text/plain → 실패 시 fetch keepalive). 외부 호스트 0.
//   - sessionKey = 랜덤 UUID(ws.session {v:1,key,createdAt}, 30일 회전). 개인 식별 목적 없음.
//   - 불변식 ⑧: 봉투는 name·ts·animalTypeId·props·sessionKey 뿐. 브라우저 식별 문자열·IP·이메일·좌표를 싣지 않는다
//     (props 는 이벤트별 허용목록 — 좌표·이메일 키는 계약상 거부).
//   - StrictMode 이중 실행 방지: 같은 이름·props 가 1초 안에 다시 오면 버린다.
import { MAX_BATCH, validateEvent, type EventName, type TrackEvent } from '@ws/events';
import { wsStorage, type WsStorage } from '../lib/storage';

export type EventProps = Record<string, string | number | boolean>;

const EVENTS_ENDPOINT = '/api/events';
export const SESSION_KEY = 'ws.session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FLUSH_AT = 10;
const FLUSH_DELAY_MS = 5000;
const DEDUPE_MS = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface EventTransport {
  send(events: TrackEvent[], opts: { unloading: boolean }): void;
}

/** 동일 출처 POST(fetch keepalive). */
function postJson(endpoint: string, body: string): void {
  if (typeof fetch !== 'function') return;
  void fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => undefined);
}

/** 기본 전송: sendBeacon(text/plain — 사전 요청 없음) → 거부·미지원이면 fetch keepalive. */
export function beaconTransport(endpoint: string = EVENTS_ENDPOINT): EventTransport {
  return {
    send(events) {
      const body = JSON.stringify({ events });
      const nav: Partial<Navigator> | undefined = typeof navigator === 'undefined' ? undefined : navigator;
      if (typeof nav?.sendBeacon === 'function') {
        const ok = nav.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
        if (ok) return;
      }
      postJson(endpoint, body);
    },
  };
}

const noopTransport: EventTransport = { send: () => undefined };

/** crypto.randomUUID → (비보안 출처) getRandomValues 로 v4 조립. */
function randomUuid(): string {
  const c: Crypto | undefined = typeof crypto === 'undefined' ? undefined : crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** ws.session 읽기 — 없거나 깨졌거나 30일 지났거나 미래 시각이면 새 키를 만들어 저장. */
export function getSessionKey(storage: WsStorage, nowMs: number, uuid: () => string = randomUuid): string {
  const raw = storage.get(SESSION_KEY);
  if (raw !== null) {
    try {
      const rec: unknown = JSON.parse(raw);
      if (rec !== null && typeof rec === 'object') {
        const { v, key, createdAt } = rec as Record<string, unknown>;
        const created = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
        const age = nowMs - created;
        if (v === 1 && typeof key === 'string' && UUID_RE.test(key) && age >= 0 && age < SESSION_TTL_MS) {
          return key;
        }
      }
    } catch {
      // 깨진 기록 → 새 키
    }
  }
  const key = uuid();
  storage.set(SESSION_KEY, JSON.stringify({ v: 1, key, createdAt: new Date(nowMs).toISOString() }));
  return key;
}

export interface TrackerDeps {
  transport: EventTransport;
  storage: WsStorage;
  now: () => number;
  uuid: () => string;
  /** true 면 검증 실패를 warn 으로 알린다. */
  dev: boolean;
  warn: (msg: string) => void;
  /** 큐가 이만큼 차면 즉시 전송(기본 10). */
  flushAt?: number;
}

export interface Tracker {
  track(name: EventName, props: EventProps): void;
  flush(opts?: { unloading?: boolean }): void;
  /** 리스너·타이머 해제(남은 큐는 버린다). */
  dispose(): void;
}

export function createTracker(deps: TrackerDeps): Tracker {
  const flushAt = deps.flushAt ?? FLUSH_AT;
  let queue: TrackEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let listening = false;
  const recent = new Map<string, number>();

  const onPageHide = (): void => flush({ unloading: true });
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') flush({ unloading: true });
  };

  function listen(): void {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush(opts: { unloading?: boolean } = {}): void {
    clearTimer();
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += MAX_BATCH) {
      try {
        deps.transport.send(batch.slice(i, i + MAX_BATCH), { unloading: Boolean(opts.unloading) });
      } catch {
        // 전송 실패는 버린다(오프라인 영속은 O6).
      }
    }
  }

  function isDuplicate(name: string, props: EventProps, now: number): boolean {
    for (const [k, t] of recent) if (now - t >= DEDUPE_MS) recent.delete(k);
    let sig: string;
    try {
      sig = `${name}\u0000${JSON.stringify(props)}`;
    } catch {
      return false;
    }
    if (recent.has(sig)) return true;
    recent.set(sig, now);
    return false;
  }

  function track(name: EventName, props: EventProps): void {
    try {
      const ts = deps.now();
      const candidate: Record<string, unknown> = { name, ts, props, sessionKey: getSessionKey(deps.storage, ts, deps.uuid) };
      if (typeof props?.animalTypeId === 'string') candidate.animalTypeId = props.animalTypeId;
      const r = validateEvent(candidate);
      if (!r.ok) {
        if (deps.dev) deps.warn(`[track] ${String(name)} 버림: ${r.error}`);
        return;
      }
      if (isDuplicate(name, r.event.props, ts)) return;
      listen();
      queue.push(r.event);
      if (queue.length >= flushAt) flush();
      else if (timer === null) timer = setTimeout(() => flush(), FLUSH_DELAY_MS);
    } catch (e) {
      if (deps.dev) deps.warn(`[track] ${String(name)} 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    track,
    flush,
    dispose() {
      clearTimer();
      queue = [];
      recent.clear();
      if (listening) {
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibility);
        listening = false;
      }
    },
  };
}

function defaultTracker(): Tracker {
  return createTracker({
    // vitest(MODE=test)에서는 네트워크 0.
    transport: import.meta.env.MODE === 'test' ? noopTransport : beaconTransport(),
    storage: wsStorage,
    now: () => Date.now(),
    uuid: randomUuid,
    dev: Boolean(import.meta.env.DEV),
    // eslint-disable-next-line no-console
    warn: (m) => console.warn(m),
  });
}

let active: Tracker | null = null;

/** 앱 전역 기록 함수(공유 인터페이스). 실패해도 throw 하지 않는다. */
export function track(name: EventName, props: EventProps): void {
  if (!active) active = defaultTracker();
  active.track(name, props);
}

/** 테스트 전용: 전역 추적기 교체(null = 기본으로 되돌림). 이전 추적기는 정리한다. */
export function setTrackerForTest(t: Tracker | null): void {
  active?.dispose();
  active = t;
}
