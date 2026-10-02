// localStorage 어댑터(계약 C-1). 사용자 상태(선택 동물·준비 상태·세션 키)는 이 모듈을 거쳐서만 저장한다.
//   - 키는 접두사 `ws.` 만(다른 키는 throw — 이전 서비스 키·임의 키 혼입 방지).
//   - localStorage 접근·쓰기가 한 번이라도 실패하면(시크릿 모드·차단·용량) 그 세션은 메모리로 동작하고,
//     onUnavailable 구독자에게 세션 전체에서 정확히 1회 알린다(PRD US-005 "저장 불가 안내 1회").
//   - 불변식 ⑧: JSON 값 안에 좌표·지역·이메일·토큰·자유 질의 키가 있으면 쓰기를 거부한다(throw).

const PREFIX = 'ws.';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 저장 키에 넣을 수 있는 id(typeId·supplyItemId) — 이벤트 계약 slug 와 같은 형태. */
export function isWsId(x: unknown): x is string {
  return typeof x === 'string' && ID_RE.test(x);
}

/** 어떤 저장 값에도 들어갈 수 없는 키(대소문자 무시). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'coords',
  'coordinates',
  'location',
  'region',
  'address',
  'email',
  'phone',
  'token',
  'accesstoken',
  'refreshtoken',
  'query',
]);

/** 값(파싱된 JSON) 안 어디든 금지 키가 있으면 true. */
export function hasForbiddenKey(x: unknown): boolean {
  if (Array.isArray(x)) return x.some(hasForbiddenKey);
  if (x === null || typeof x !== 'object') return false;
  for (const [k, v] of Object.entries(x)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) return true;
    if (hasForbiddenKey(v)) return true;
  }
  return false;
}

export interface WsStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** true = 이 세션은 메모리에만 저장 중. */
  isMemoryOnly(): boolean;
  /** 저장 불가 안내 구독. 이미 실패했고 아직 안내 전이면 즉시 호출. 세션 전체 1회. 반환 = 해제. */
  onUnavailable(cb: () => void): () => void;
}

function assertKey(key: string): void {
  if (typeof key !== 'string' || !key.startsWith(PREFIX) || key.length === PREFIX.length) {
    throw new Error(`storage: 허용되지 않는 키(접두사 ${PREFIX} 만): ${String(key)}`);
  }
}

function assertValue(value: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return; // JSON 이 아닌 원시 문자열(ws.animalType 등)
  }
  if (hasForbiddenKey(parsed)) throw new Error('storage: 저장 금지 키(좌표·지역·이메일·토큰·질의)가 들어 있어요');
}

/** backend 는 지연 접근(접근 자체가 throw 할 수 있다). 테스트는 가짜 Storage 를 넘긴다. */
export function createStorage(backend: () => Storage): WsStorage {
  let memoryOnly = false;
  let noticePending = false;
  let noticeDelivered = false;
  // 메모리 모드의 값. null = 삭제됨(백엔드의 옛 값을 가린다).
  const memory = new Map<string, string | null>();
  const listeners = new Set<() => void>();

  function deliver(): void {
    if (noticeDelivered || !noticePending || listeners.size === 0) return;
    noticeDelivered = true;
    noticePending = false;
    for (const cb of [...listeners]) cb();
  }

  function fail(): void {
    if (!memoryOnly) {
      memoryOnly = true;
      noticePending = true;
    }
    deliver();
  }

  return {
    get(key) {
      assertKey(key);
      if (memory.has(key)) return memory.get(key) ?? null;
      try {
        return backend().getItem(key);
      } catch {
        fail();
        return null;
      }
    },
    set(key, value) {
      assertKey(key);
      assertValue(value);
      if (!memoryOnly) {
        try {
          backend().setItem(key, value);
          return;
        } catch {
          fail();
        }
      }
      memory.set(key, value);
    },
    remove(key) {
      assertKey(key);
      if (!memoryOnly) {
        try {
          backend().removeItem(key);
          return;
        } catch {
          fail();
        }
      }
      memory.set(key, null);
    },
    isMemoryOnly: () => memoryOnly,
    onUnavailable(cb) {
      listeners.add(cb);
      deliver();
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/** 앱 전역 저장소(브라우저 localStorage). */
export const wsStorage: WsStorage = createStorage(() => window.localStorage);
