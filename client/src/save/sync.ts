// 이메일 연결 동기화(계약 C-R5-2 · C-R5-9 · D5 · D22 · D23).
//   link(token): POST verify → ws.save linked → GET → 병합(merge.ts) → 서버 승 레코드 로컬 import → (로컬이 하나라도 이기면) PUT
//                → save_link_confirm · save_merge{winner} → 구독 시작.
//   resume(): 연결된 기기 부팅·L8 열림 — GET → 병합 → PUT(필요 시) → 구독 시작. 401 = 세션 없음 → 로컬 연결 해제.
//   구독: 조각(setups·cages·reactions·animalType) 변경 → 2초 디바운스 PUT(스냅샷 = 로컬 + 마지막 서버본, 로컬 우선 병합).
//   unlink(): DELETE /auth/session(실패 무시) → ws.save 삭제 → 구독·타이머 해제. 로컬 준비 상태는 그대로.
//   저장하는 것은 ws.save {linked, lastSyncAt} 뿐 — 이메일·토큰·세션 id 0(세션은 HttpOnly 쿠키).
//   하드닝(코드 리뷰 R5):
//   H1 낙관적 동시성 — PUT 에 baseUpdatedAt(마지막으로 본 서버 행 시각). 409 = 다른 기기가 먼저 씀 → 409 본문의 서버본과
//      병합(서버 승 레코드는 로컬에도 씀) 후 1회만 다시 보낸다. 또 409 면 실패로 보고 백오프(다음 시도는 GET 부터).
//   M3 직렬화 — GET·PUT 은 한 줄(serial)로만, 동시에 하나. 진행 중 변경은 대기 PUT 1개로 합친다(그때의 로컬을 싣는다).
//   M5 세대 — 연결·해제(이 탭·다른 탭 ws.save 변화)마다 gen+1. 응답 시 세대가 바뀌었으면 그 응답은 버린다.
//      다른 탭이 해제 → 서버본 폐기·PUT 중지, 다시 연결 → 서버본을 새로 받은 뒤에만 PUT.
//   M6 백오프 — PUT 이 네트워크·409·429·5xx 로 실패하면 5s·10s·20s·40s·80s 최대 5회 재시도(간격 상한 5분). lastSyncAt 은 성공 때만.
//   R6 D1 — buildLocal 은 서버와 같은 검증기(@ws/save-validate)로 레코드 단위 사전 검증(무효 레코드는 버림, merge.ts sanitizeSnapshot).
//      PUT 직전 fitSnapshot 으로 32KB·타입 20 상한에 맞춘다(tombstone → 반응 → 다른 동물 순으로 오래된 것부터). 다 잘라도 넘치면 PUT 0.
//      맞춘 본문이 마지막 서버본과 같으면 보내지 않는다.
//   R6 D2 (SEC-4 L-1(c)) 첫 PUT 보류 — link(verify 성공) 직후엔 GET·병합(서버 승 레코드 로컬 쓰기)까지만 하고 PUT 0,
//      ws.save 도 아직 연결로 쓰지 않는다(구독 0 · 새로고침해도 PUT 0). 결과 {confirm:true} → L8 이 마스킹 주소 확인 화면을 띄우고
//      [이 주소로 저장하기] → confirm() 에서 처음 연결 기록·구독·PUT. 로컬·서버 모두 빈 기기(empty)는 예전대로 바로 연결(PUT 0).
import { track as defaultTrack } from '../events/track';
import { wsStorage, type WsStorage } from '../lib/storage';
import { fetchSaveApi, type SaveApi } from './api';
import type { SaveMergeWinner, SaveStateV1, SaveV1 } from './contract';
import { fitSnapshot, mergeSnapshots, sanitizeSnapshot, type MergeResult } from './merge';
import { defaultSlices, type SaveSlices } from './saveables';
import { SAVE_STATE_KEY, clearSaveState, readSaveState, subscribeSaveState, writeSaveState } from './saveStateStore';

export const SAVE_DEBOUNCE_MS = 2000;
/** M6 재시도: 첫 간격·간격 상한·최대 횟수. */
export const SAVE_RETRY_BASE_MS = 5000;
export const SAVE_RETRY_MAX_MS = 5 * 60 * 1000;
export const SAVE_RETRY_MAX_ATTEMPTS = 5;

/** 다시 시도할 만한 PUT·GET 실패(네트워크 0 · 경합 409 · 429 · 5xx). 400·413·415·428 은 같은 본문으로 다시 보내도 같다. */
function retryable(status: number): boolean {
  return status === 0 || status === 409 || status === 429 || status >= 500;
}

/** 저장 대상 0 — 동물 미선택 · setups·cages 없음 · 반응 키 없음(한 번도 바뀌지 않음). */
function isEmptySnapshot(s: SaveV1): boolean {
  const r = s.reactions;
  const rt = r && typeof r.updatedAt === 'string' ? Date.parse(r.updatedAt) : Number.NaN;
  const reactionsEmpty =
    !r || (Object.keys(r.like ?? {}).length === 0 && Object.keys(r.helpful ?? {}).length === 0 && !(Number.isFinite(rt) && rt > 0));
  return s.animalTypeId === null && Object.keys(s.setups ?? {}).length === 0 && Object.keys(s.cages ?? {}).length === 0 && reactionsEmpty;
}

/** 키 순서와 무관한 깊은 비교(JSON 값). */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * link 결과. linked.empty = 로컬·서버 모두 비어 있어 PUT 하지 않음(P1 MAJOR-1 — 확인 화면은 connectedEmpty).
 * linked.confirm = 첫 PUT 보류 중(R6 D2) — confirm() 전까지 연결 기록·구독·PUT 0.
 */
export type LinkOutcome =
  | { kind: 'linked'; winner: SaveMergeWinner | null; maskedEmail?: string; empty?: true; confirm?: true }
  | { kind: 'expired' }
  | { kind: 'error' };

/**
 * 89 스펙 저장 정보 지우기 결과. erased.wiped = 이 기기 ws.* 도 지움 · reauth = 401(이 기기 연결 기록만 해제)
 *   · limited = 429 · failed = 5xx·0·400·403·413·415(로컬 변경 0).
 */
export type ConfirmOutcome = 'saved' | 'failed' | 'expired';

export type EraseOutcome = { kind: 'erased'; wiped: boolean } | { kind: 'reauth' } | { kind: 'limited' } | { kind: 'failed' };

/** 이 기기 정보 지우기 결과. logoutPending = 로그아웃이 서버에 닿지 않아 ws.save {linked:false, pendingLogout:true} 만 남김. */
export interface WipeOutcome {
  logoutPending: boolean;
}

/** 서버 세션 확인 결과. null = 모름(네트워크·서버 오류). maskedEmail 은 표시 전용(저장 0). */
export type SessionProbe = { linked: boolean; maskedEmail?: string } | null;

export interface SaveSyncDeps {
  api: SaveApi;
  storage: WsStorage;
  slices: SaveSlices;
  track(name: 'save_link_confirm' | 'save_merge', props: Record<string, string>): void;
  now(): string;
  debounceMs?: number;
}

export interface SaveSync {
  link(token: string): Promise<LinkOutcome>;
  /**
   * R6 D2: 보류한 첫 저장을 사용자가 확인([이 주소로 저장하기]) — 연결 기록 → 구독 → PUT(필요 시). 반환 = 끝난 뒤 연결 상태.
   * 보류 중이 아니면 네트워크 0, 지금 연결 상태만 돌려준다.
   */
  confirm(): Promise<boolean>;
  /**
   * confirm 과 같되 저장 결과를 구분한다(연결 여부 ≠ 저장 결과): saved = PUT 성공(또는 서버에 이미 같은 내용) · failed = 연결은 됐으나 PUT·GET 실패
   * (다시 호출하면 재시도) · expired = 세션이 끊김/보류 아님+미연결.
   */
  confirmSave(): Promise<ConfirmOutcome>;
  /** 첫 저장 확인을 기다리는 중인지. */
  isAwaitingConfirm(): boolean;
  resume(): Promise<void>;
  /** 부팅 1회: (이 기기가 연결 기록을 가질 때만) GET /auth/session → 연결이면 resume, 서버가 아니라 하면 로컬 해제. */
  boot(): Promise<void>;
  /**
   * L8 열 때 1회: 미전송 로그아웃(pendingLogout)이 있으면 그것부터 다시 보내고 {linked:false}.
   * 아니면 GET /auth/session — 서버가 연결 아님이면 로컬 연결도 해제(요청 시작·응답 시 모두 로컬 연결일 때만).
   * 요청 중 로컬이 미연결→연결로 바뀌었으면 응답을 stale 로 보고 null(로컬 그대로).
   */
  probe(): Promise<SessionProbe>;
  /** 이 브라우저에 서버 세션이 살아 있고 로컬 기록만 없을 때 "이 기기 연결하기" — 로컬 연결 + resume(verify 없음). */
  adopt(): Promise<void>;
  /** 로컬 연결 해제 → DELETE /auth/session. 서버에 닿지 않으면 ws.save {pendingLogout:true} 로 남겨 부팅·L8 에서 재시도(SEC-3 L-3). */
  unlink(): Promise<void>;
  /**
   * 89 스펙 ①~④·⑦·⑧ — 저장한 정보 지우기(DELETE /api/save). 요청 전 자동 저장 정지(stopSync), 서버가 먼저·로컬은 성공 뒤:
   *   204 → ws.save 미연결(DELETE /auth/session 0 · pendingLogout 0), wipeDevice 면 ws.* 전부 삭제. 401 → 이 기기 연결 기록만 해제.
   *   그 밖 실패 → 로컬 0 변경, 연결 중이었으면 자동 저장 재개. 이벤트 0. 레이어를 닫아도 끝까지 적용된다.
   */
  erase(opts: { wipeDevice: boolean }): Promise<EraseOutcome>;
  /**
   * 89 스펙 ⑤ — 이 기기 정보 지우기. 연결 중(또는 unlink:true — 서버 세션만 살아 있는 기기)이면 로그아웃 먼저,
   *   그 뒤 ws.* 전부 삭제(storage.keys('ws.') 열거). 로그아웃이 서버에 닿지 않으면 ws.save {linked:false, pendingLogout:true} 만 남긴다.
   */
  wipeDevice(opts?: { unlink?: boolean }): Promise<WipeOutcome>;
  /** 대기 중인 디바운스 PUT 을 바로 보낸다. */
  flush(): Promise<void>;
  /** 구독 중인지(테스트·진단). */
  isRunning(): boolean;
  stop(): void;
}

export function createSaveSync(deps: SaveSyncDeps): SaveSync {
  const debounceMs = deps.debounceMs ?? SAVE_DEBOUNCE_MS;
  const { api, storage, slices } = deps;
  let unsubs: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastServer: SaveV1 | null = null;
  /** H1: lastServer 의 서버 행 시각(행 없음 null) — 다음 PUT 의 baseUpdatedAt. */
  let lastServerAt: string | null = null;
  /** 이번 연결에서 서버본을 한 번이라도 받았는지 — 받기 전엔 PUT 으로 서버본을 덮지 않는다. */
  let pulled = false;
  const inflightLinks = new Map<string, Promise<LinkOutcome>>();
  let resuming: Promise<void> | null = null;
  /** M5: 연결 세대. 요청 시작 때 값과 응답 때 값이 다르면 그 응답은 옛 연결 것 — 버린다. */
  let gen = 0;
  /** M5: 마지막으로 본 ws.save.linked(이 탭의 쓰기는 쓰기 전에 갱신 → 전이로 보지 않는다). */
  let knownLinked = readSaveState(storage).linked;
  let unwatch: (() => void) | null = null;
  /** 다른 탭 해제로 멈췄다 — 다시 연결되면 (새 서버본을 받은 뒤) 자동 저장을 다시 켠다. */
  let resumeOnRelink = false;
  /** M3: GET·PUT 한 줄. */
  let chain: Promise<unknown> = Promise.resolve();
  /** M3: 아직 시작 안 한 대기 PUT(있으면 새 요청은 여기에 합친다). */
  let queuedPush: Promise<void> | null = null;
  /** M6: 백오프 재시도 타이머·지금까지 재시도 횟수. */
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  /** P1 MAJOR-1: 마지막 pullMerge 의 병합본이 비어 있었는지(로컬·서버 모두 저장 대상 0) — link 결과 표시용. */
  let lastPullEmpty = false;
  /** R6 D2: 첫 PUT 보류 중(verify 성공 → 확인 화면 → confirm 전). */
  let awaitingConfirm = false;
  /** confirm 의 첫 저장이 실패해 사용자 재시도를 기다린다. */
  let confirmFailed = false;
  /** 마지막 pullMerge 의 저장 결과(GET 실패·PUT 실패 = fail). */
  let lastPullResult: 'ok' | 'fail' = 'fail';

  /** 로컬 스냅샷 — 서버 검증기로 레코드 단위 사전 검증(무효 레코드는 버림 — 동기화 정지 방지, R6 D1). */
  function buildLocal(): SaveV1 {
    return sanitizeSnapshot({
      v: 1,
      animalTypeId: slices.animalType.export(),
      setups: slices.setups.export(),
      cages: slices.cages.export(),
      reactions: slices.reactions.export(),
    }).value;
  }

  /** 병합 옵션 — 이 기기의 케이지 삭제 tombstone(서버 병합이 지운 케이지를 되살리지 않게). */
  function mergeOpts(): { cageTombstones: Record<string, string> } {
    return { cageTombstones: slices.cages.tombstones?.() ?? {} };
  }

  function markSynced(): void {
    if (readSaveState(storage).linked) writeSaveState(storage, { linked: true, lastSyncAt: deps.now() });
  }

  /** 이 탭이 ws.save 를 쓴다 — 전이 감지(M5)가 자기 쓰기를 다른 탭 변화로 오인하지 않게 먼저 기록. */
  function writeOwn(s: Pick<SaveStateV1, 'linked' | 'lastSyncAt' | 'pendingLogout'>): void {
    knownLinked = s.linked;
    writeSaveState(storage, s);
  }

  /** 새 연결 세대 — 들고 있던 서버본·기준 시각을 버린다(진행 중 응답은 세대 불일치로 버려진다). */
  function newGeneration(): void {
    gen++;
    lastServer = null;
    lastServerAt = null;
    pulled = false;
  }

  function localUnlink(): void {
    stopSync();
    newGeneration();
    awaitingConfirm = false;
    confirmFailed = false;
    knownLinked = false;
    clearSaveState(storage);
  }

  /** M3: GET·PUT 을 한 줄로. 앞 작업이 실패해도 다음 작업은 돈다. */
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const p = chain.then(job);
    chain = p.catch(() => undefined);
    return p;
  }

  /** 서버본을 받아 병합 — 서버 승 레코드는 로컬에 쓰고, 이 서버본·시각을 다음 PUT 의 기준으로 삼는다. */
  function applyServer(server: SaveV1 | null, serverAt: string | null): MergeResult {
    const m = mergeSnapshots(buildLocal(), server, mergeOpts());
    const t = m.toLocal;
    if (Object.keys(t.setups).length > 0) slices.setups.import(t.setups);
    if (Object.keys(t.cages).length > 0) slices.cages.import(t.cages);
    if (t.reactions) slices.reactions.import(t.reactions);
    if (t.animalTypeId !== null) slices.animalType.import(t.animalTypeId);
    lastServer = server ?? null;
    lastServerAt = serverAt;
    pulled = true;
    return m;
  }

  function succeeded(): void {
    failures = 0;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    markSynced();
  }

  /** M6: 다시 시도할 만한 실패면 지수 백오프로 1회 예약(최대 횟수 넘으면 포기 — 다음 로컬 변경 때 처음부터). */
  function failed(status: number): void {
    if (!retryable(status) || failures >= SAVE_RETRY_MAX_ATTEMPTS || !readSaveState(storage).linked) {
      failures = 0;
      return;
    }
    const delay = Math.min(SAVE_RETRY_BASE_MS * 2 ** failures, SAVE_RETRY_MAX_MS);
    failures++;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void requestPush();
    }, delay);
  }

  type PutOutcome = 'ok' | 'fail' | 'gone' | 'stale';

  /** H1: 기준 시각을 실어 PUT. 409 → 서버본과 병합 후 1회만 다시. 세대가 바뀌면 결과를 버린다. */
  async function putWithBase(g: number, first: SaveV1): Promise<PutOutcome> {
    let snapshot = first;
    for (let attempt = 0; ; attempt++) {
      // R6 D1: 32KB·타입 상한에 맞춘 사본만 보낸다. 다 잘라도 넘치면 보내지 않는다(같은 본문은 서버도 거절 — 재시도 0).
      const fitted = fitSnapshot(snapshot);
      if (fitted === null) {
        failures = 0;
        return 'fail';
      }
      snapshot = fitted;
      // 맞춘 본문이 이미 서버에 있는 것과 같으면(잘린 부분만 다름) 보내지 않는다.
      if (lastServer && sameJson(snapshot, lastServer)) {
        succeeded();
        return 'ok';
      }
      const res = await api.putSave(snapshot, lastServerAt);
      if (g !== gen) return 'stale';
      if (res.status === 401) {
        localUnlink();
        return 'gone';
      }
      if (res.status >= 200 && res.status < 300) {
        lastServer = snapshot;
        lastServerAt = res.updatedAt ?? null;
        succeeded();
        return 'ok';
      }
      if (res.status === 409 && res.current && attempt === 0) {
        const m = applyServer(res.current.snapshot, res.current.updatedAt);
        if (!m.pushNeeded) {
          succeeded(); // 서버본이 이미 로컬 것을 다 갖고 있다
          return 'ok';
        }
        snapshot = m.merged;
        continue;
      }
      // 409 를 또 받았거나 서버본이 없다 → 다음 시도는 GET 부터.
      if (res.status === 409) pulled = false;
      failed(res.status);
      return 'fail';
    }
  }

  /**
   * GET → 병합 → 로컬 쓰기 → PUT(필요 시). null = 실패(네트워크·서버) 또는 그새 연결이 바뀜.
   * push=false(R6 D2 첫 PUT 보류) = GET·병합·로컬 쓰기까지만.
   */
  async function pullMerge(retryOnFail: boolean, push = true): Promise<SaveMergeWinner | null> {
    const g = gen;
    lastPullResult = 'fail';
    const got = await api.getSave();
    if (g !== gen) return null;
    if (got.status === 401) {
      localUnlink();
      return null;
    }
    if (got.status !== 200 || !got.body) {
      if (retryOnFail) failed(got.status);
      return null;
    }
    const m = applyServer(got.body.snapshot, got.body.updatedAt);
    // P1 MAJOR-1: 로컬·서버 모두 비어 있음(병합본 = 빈 스냅샷) → PUT 0(빈 행 생성 금지). 첫 로컬 변경 때 디바운스 PUT 이 행을 만든다.
    lastPullEmpty = isEmptySnapshot(m.merged);
    if (!push) {
      lastPullResult = 'ok';
      return m.winner;
    }
    if (m.pushNeeded && !lastPullEmpty) {
      const o = await putWithBase(g, m.merged);
      lastPullResult = o === 'ok' ? 'ok' : 'fail';
      return o === 'gone' || o === 'stale' ? null : m.winner;
    }
    lastPullResult = 'ok';
    succeeded();
    return m.winner;
  }

  async function pushNow(): Promise<void> {
    if (!readSaveState(storage).linked) return;
    const g = gen;
    if (!pulled) {
      const winner = await pullMerge(true);
      if (winner !== null && g === gen) deps.track('save_merge', { winner });
      return;
    }
    // 로컬 우선 병합: 서버 전용 레코드(다른 기기분)는 살리고, 같은 레코드는 시각이 같거나 로컬이 새것.
    const merged = mergeSnapshots(buildLocal(), lastServer, mergeOpts()).merged;
    // NIT-2: 동기화 자신의 import(409 병합 등)가 건 디바운스 — 서버에 이미 있는 본문이면 보내지 않는다(크기 맞춤 후 비교는 putWithBase).
    if (lastServer && sameJson(merged, lastServer)) return;
    await putWithBase(g, merged);
  }

  /** M3: 대기 PUT 이 이미 있으면 거기에 합친다(시작할 때의 로컬을 싣는다). 진행 중 PUT 뒤에 정확히 1개만 더. */
  function requestPush(): Promise<void> {
    if (queuedPush) return queuedPush;
    const p = serial(async () => {
      queuedPush = null;
      await pushNow();
    });
    queuedPush = p;
    return p;
  }

  function schedule(): void {
    // 백오프 대기 중이면 디바운스로 앞당기지 않는다 — 예약된 재시도가 그때의 로컬을 싣는다(429 존중).
    if (retryTimer !== null) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void requestPush();
    }, debounceMs);
  }

  /** M5: ws.save 변화 구독(같은 탭 + 다른 탭 storage 이벤트). 인스턴스 수명 동안 1개. */
  function watch(): void {
    if (unwatch) return;
    knownLinked = readSaveState(storage).linked;
    unwatch = subscribeSaveState(onSaveState);
  }

  function onSaveState(): void {
    const linked = readSaveState(storage).linked;
    if (linked === knownLinked) return;
    knownLinked = linked;
    if (!linked) {
      // 다른 탭이 해제 — 옛 서버본 폐기·PUT 중지(ws.save 는 이미 바뀌었다). 다른 계정으로 옛 스냅샷을 보내지 않는다.
      resumeOnRelink = resumeOnRelink || unsubs.length > 0;
      stopSync();
      newGeneration();
      return;
    }
    // 다시 연결(다른 계정일 수 있다) — 서버본을 새로 받기 전엔 PUT 0.
    newGeneration();
    if (resumeOnRelink) {
      resumeOnRelink = false;
      void self.resume();
    }
  }

  function start(): void {
    watch();
    if (unsubs.length > 0) return;
    unsubs = [slices.setups, slices.cages, slices.reactions, slices.animalType].map((s) => s.subscribe(schedule));
  }

  /** 구독·타이머 해제(ws.save 구독은 유지 — 다른 탭 재연결을 봐야 한다). */
  function stopSync(): void {
    for (const u of unsubs) u();
    unsubs = [];
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    failures = 0;
  }

  async function doLink(token: string): Promise<LinkOutcome> {
    const v = await api.verify(token);
    // 진짜 만료·사용됨·형식 오류만 expired. 네트워크(0)·429·5xx 등은 error — 토큰을 버리지 않고 다시 누를 수 있다(M4).
    if (v.status === 400 || v.status === 401 || v.status === 410) return { kind: 'expired' };
    if (v.status !== 200) return { kind: 'error' };
    watch();
    newGeneration();
    awaitingConfirm = false;
    confirmFailed = false;
    deps.track('save_link_confirm', {});
    lastPullEmpty = false;
    const g = gen;
    // R6 D2: GET·병합·서버 승 레코드 로컬 쓰기까지만 — PUT·연결 기록·구독은 확인(confirm) 뒤.
    const winner = await serial(() => pullMerge(false, false));
    if (g !== gen) return { kind: 'error' }; // GET 401(세션 없음) 또는 그새 다른 탭 연결·해제
    if (winner !== null) deps.track('save_merge', { winner });
    const out: Extract<LinkOutcome, { kind: 'linked' }> = { kind: 'linked', winner };
    if (v.maskedEmail) out.maskedEmail = v.maskedEmail;
    if (winner !== null && lastPullEmpty) {
      // P1 MAJOR-1 빈 기기: 보낼 것이 없다 — 예전대로 바로 연결(PUT 0, 첫 로컬 변경 때 디바운스 PUT).
      writeOwn({ linked: true, lastSyncAt: readSaveState(storage).lastSyncAt });
      markSynced();
      start();
      out.empty = true;
      return out;
    }
    awaitingConfirm = true;
    out.confirm = true;
    return out;
  }

  async function doConfirm(): Promise<ConfirmOutcome> {
    if (!awaitingConfirm && !confirmFailed) return readSaveState(storage).linked ? 'saved' : 'expired';
    awaitingConfirm = false;
    confirmFailed = false;
    if (!readSaveState(storage).linked) writeOwn({ linked: true, lastSyncAt: readSaveState(storage).lastSyncAt });
    start();
    let ok = false;
    // 서버본을 받았으면 link 때와 같은 판정(로컬 기여 pushNeeded · 빈 병합본 PUT 0)으로 첫 PUT, 못 받았으면(GET 실패) GET 부터.
    await serial(async () => {
      if (!readSaveState(storage).linked) return;
      const g = gen;
      if (!pulled) {
        const winner = await pullMerge(true);
        if (winner !== null && g === gen) deps.track('save_merge', { winner });
        ok = lastPullResult === 'ok';
        return;
      }
      const m = mergeSnapshots(buildLocal(), lastServer, mergeOpts());
      if (m.pushNeeded && !isEmptySnapshot(m.merged)) ok = (await putWithBase(g, m.merged)) === 'ok';
      else {
        succeeded();
        ok = true;
      }
    });
    if (!readSaveState(storage).linked) return 'expired';
    if (!ok) confirmFailed = true;
    return ok ? 'saved' : 'failed';
  }

  /** 미전송 로그아웃 재시도. 서버가 받았거나(2xx) 이미 세션 없음(401)이면 기록 삭제. true = 끝남. */
  async function retryLogout(): Promise<boolean> {
    const r = await api.logout();
    const done = (r.status >= 200 && r.status < 300) || r.status === 401;
    const st = readSaveState(storage);
    if (done && st.pendingLogout && !st.linked) clearSaveState(storage);
    return done;
  }

  /** ws.* 전부 삭제(키는 래퍼가 열거 — 하드코딩 0). keep 은 남길 키. 끝나면 ws.save 구독자에게 알린다(SaveDot·다른 탭은 storage 이벤트). */
  function wipeLocal(keep: ReadonlySet<string> = new Set()): void {
    for (const k of storage.keys('ws.')) if (!keep.has(k)) storage.remove(k);
    if (!keep.has(SAVE_STATE_KEY)) clearSaveState(storage);
  }

  /** 연결을 끊는 모든 지우기의 공통 정리 — 구독·타이머·서버본·보류 확인을 버린다(ws.save 는 호출부). */
  function dropConnection(): void {
    stopSync();
    newGeneration();
    resumeOnRelink = false;
    awaitingConfirm = false;
    confirmFailed = false;
  }

  async function doErase(wipeDevice: boolean): Promise<EraseOutcome> {
    const wasRunning = unsubs.length > 0;
    const hadPending = timer !== null || retryTimer !== null;
    stopSync();
    // 진행 중 GET·PUT 뒤에 한 줄로 — 지운 뒤 옛 PUT 이 행을 되살리지 않게(그 뒤 PUT 은 세션 없음 401).
    const res = await serial(() => api.erase());
    if (res.status >= 200 && res.status < 300) {
      dropConnection();
      knownLinked = false;
      if (wipeDevice) wipeLocal();
      else clearSaveState(storage);
      return { kind: 'erased', wiped: wipeDevice };
    }
    if (res.status === 401) {
      localUnlink();
      return { kind: 'reauth' };
    }
    // 실패: 로컬 0 변경. 연결 중이었으면 자동 저장을 다시 켠다(정지 사이 변경이 있었으면 디바운스 PUT).
    if (wasRunning && readSaveState(storage).linked) {
      start();
      if (hadPending) schedule();
    }
    return { kind: res.status === 429 ? 'limited' : 'failed' };
  }

  async function doWipeDevice(unlinkServer: boolean): Promise<WipeOutcome> {
    const st = readSaveState(storage);
    const logout = st.linked || st.pendingLogout === true || unlinkServer;
    dropConnection();
    let pending = false;
    if (logout) {
      // unlink 와 같은 순서 — "해제 중" 기록 먼저(탭이 닫혀도 다음 부팅에 다시 보낸다).
      writeOwn({ linked: false, lastSyncAt: null, pendingLogout: true });
      pending = !(await retryLogout());
    }
    knownLinked = false;
    wipeLocal(pending ? new Set([SAVE_STATE_KEY]) : new Set());
    if (pending) writeOwn({ linked: false, lastSyncAt: null, pendingLogout: true });
    return { logoutPending: pending };
  }

  const self: SaveSync = {
    link(token) {
      // StrictMode 이중 effect 에서 같은 1회용 토큰을 두 번 보내지 않는다(진행 중·연결 성공만 캐시).
      //   M4: 'linked' 가 아닌 결과(error·expired)·예외는 캐시에서 뺀다 — 네트워크 오류 뒤 다시 누르면 실제로 다시 보낸다.
      const existing = inflightLinks.get(token);
      if (existing) return existing;
      const p = doLink(token).then(
        (r) => {
          if (r.kind !== 'linked') inflightLinks.delete(token);
          return r;
        },
        (err: unknown) => {
          inflightLinks.delete(token);
          throw err;
        },
      );
      inflightLinks.set(token, p);
      return p;
    },
    confirm: async () => {
      await doConfirm();
      return readSaveState(storage).linked;
    },
    confirmSave: () => doConfirm(),
    isAwaitingConfirm: () => awaitingConfirm,
    resume() {
      if (!readSaveState(storage).linked) return Promise.resolve();
      if (unsubs.length > 0) return Promise.resolve();
      if (resuming) return resuming;
      resuming = (async () => {
        try {
          watch();
          const winner = await serial(() => pullMerge(false));
          if (winner !== null) deps.track('save_merge', { winner });
          // 그새 다른 탭이 해제했으면 켜지 않는다. 해제→재연결이었으면 pulled=false 라 첫 변경 때 GET 부터.
          if (readSaveState(storage).linked) start();
        } finally {
          resuming = null;
        }
      })();
      return resuming;
    },
    async boot() {
      const st = readSaveState(storage);
      if (st.pendingLogout) {
        await retryLogout();
        return;
      }
      // 연결 기록이 없는 기기(콜드 방문 대부분)는 네트워크 0 — 세션 확인은 연결된 기기만.
      if (!st.linked) return;
      const p = await self.probe();
      // linked → 병합·자동 저장. 모름(네트워크·서버 오류) → 로컬 연결 기록을 믿고 resume(실패해도 무해).
      if (p === null || p.linked) await self.resume();
    },
    async probe() {
      if (readSaveState(storage).pendingLogout) {
        await retryLogout();
        return { linked: false };
      }
      // 요청 시작 시 로컬 연결 여부 스냅샷 — 응답 대기 중 다른 탭·이 탭이 연결(unlinked→linked)했으면
      //   오래된 "연결 아님" 응답으로 방금 연결을 되돌리지 않는다(결과는 stale → 모름 null).
      //   + 세대(M5): 대기 중 해제→재연결(다시 linked)이면 wasLinked·nowLinked 둘 다 true 여도 응답은 옛 연결 것 → null.
      watch();
      const wasLinked = readSaveState(storage).linked;
      const g = gen;
      const s = await api.session();
      if (s.status === 401 || (s.status === 200 && !s.linked)) {
        const nowLinked = readSaveState(storage).linked;
        if (!wasLinked && nowLinked) return null;
        if (wasLinked && nowLinked) {
          if (g !== gen) return null;
          localUnlink();
        }
        return { linked: false };
      }
      if (s.status !== 200) return null;
      return s.maskedEmail ? { linked: true, maskedEmail: s.maskedEmail } : { linked: true };
    },
    async adopt() {
      watch();
      newGeneration();
      awaitingConfirm = false; confirmFailed = false; // [이 기기 연결하기] 클릭 = 사용자 확인
      writeOwn({ linked: true, lastSyncAt: null });
      await self.resume();
    },
    async unlink() {
      stopSync();
      newGeneration();
      resumeOnRelink = false;
      awaitingConfirm = false;
      confirmFailed = false;
      // 먼저 "해제 중" 기록(이메일·토큰 0) — 요청이 실패하거나 탭이 닫혀도 다음 부팅에 다시 보낸다.
      writeOwn({ linked: false, lastSyncAt: null, pendingLogout: true });
      await retryLogout();
    },
    erase: (opts) => doErase(opts.wipeDevice),
    wipeDevice: (opts) => doWipeDevice(opts?.unlink === true),
    async flush() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      await requestPush();
    },
    isRunning: () => unsubs.length > 0,
    stop() {
      stopSync();
      unwatch?.();
      unwatch = null;
    },
  };
  return self;
}

let singleton: SaveSync | null = null;

/** 앱 전역 동기화(브라우저 localStorage·동일 출처 API). */
export function getSaveSync(): SaveSync {
  if (!singleton) {
    singleton = createSaveSync({
      api: fetchSaveApi,
      storage: wsStorage,
      slices: defaultSlices(wsStorage),
      track: (name, props) => defaultTrack(name, props),
      now: () => new Date().toISOString(),
    });
  }
  return singleton;
}

let booted: Promise<void> | null = null;

/** 부팅 1회(F3-3 SaveDot): GET /auth/session 1회 → 연결돼 있으면 서버본과 병합하고 자동 저장을 켠다. 재호출은 같은 Promise. */
export function bootSaveSync(): Promise<void> {
  if (!booted) booted = getSaveSync().boot().catch(() => undefined);
  return booted;
}

/** 테스트 전용: 전역 동기화를 멈추고 버린다. */
export function resetSaveSyncForTest(): void {
  singleton?.stop();
  singleton = null;
  booted = null;
}
