// QA95 D-2: 삭제 직후 비동기 VACUUM(SQLite 삭제 페이지 잔존 제거 — 처리방침 '지체 없이 파기' 문구 유지).
//   DELETE /api/save 가 204 를 보낸 다음 request() 를 부른다 — 응답 지연 0(실행은 setImmediate 뒤).
//   합치기: 실행 중에 들어온 요청은 몇 개든 "끝난 뒤 1회 더"로 합친다(그 사이 삭제분 페이지도 지운다). 대기 중 요청도 1회로 합친다.
//   실패는 오류 이름(·코드)만 로그 — 다음 요청 또는 정리 작업(24h, retention.ts)의 VACUUM 이 다시 지운다.
import { stdoutLog, type PrivacyLog } from './erase.js';

export interface CompactScheduler {
  /** 실행 예약(즉시 반환). */
  request(): void;
  /** 테스트 관찰: 예약·실행 중인 작업이 모두 끝나면 resolve. */
  idle(): Promise<void>;
}

export function compactFailLine(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown } | null;
  const name = String(e?.name ?? 'Error');
  return `[privacy] vacuum failed (${name}${e?.code !== undefined ? ` ${String(e.code)}` : ''})`;
}

/** compact 가 없으면(인메모리 등) request 는 아무것도 하지 않는다. */
export function createCompactScheduler(
  compact: (() => Promise<void>) | undefined,
  opts: { log?: PrivacyLog; defer?: (fn: () => void) => void } = {},
): CompactScheduler {
  const log = opts.log ?? stdoutLog;
  const defer = opts.defer ?? ((fn) => void setImmediate(fn));
  let scheduled = false;
  let running = false;
  let pending = false;
  let waiters: Array<() => void> = [];

  const settle = (): void => {
    if (scheduled || running) return;
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };

  const run = async (): Promise<void> => {
    scheduled = false;
    running = true;
    try {
      await compact!();
    } catch (err) {
      log(compactFailLine(err));
    } finally {
      running = false;
    }
    if (pending) {
      pending = false;
      schedule();
      return;
    }
    settle();
  };

  const schedule = (): void => {
    scheduled = true;
    defer(() => void run());
  };

  return {
    request() {
      if (compact === undefined) return;
      if (running) {
        pending = true;
        return;
      }
      if (scheduled) return; // 아직 시작 전 — 같은 1회에 합친다
      schedule();
    },
    idle() {
      if (!scheduled && !running) return Promise.resolve();
      return new Promise((r) => waiters.push(r));
    },
  };
}
