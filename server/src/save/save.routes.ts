// /api/save(계약 C-R5-2, D5): 세션 필수.
//   GET → 200 {snapshot: SaveV1|null, updatedAt: iso|null}
//   PUT {snapshot, baseUpdatedAt: iso|null} → 200 {updatedAt} | 400 forbidden_key·invalid_snapshot·invalid_base·bad_body
//        | 401 | 409 {error:'conflict', snapshot, updatedAt}(지금 서버본) | 413 | 415 | 428 precondition_required(baseUpdatedAt 없음)
//   H1 낙관적 동시성: baseUpdatedAt = 클라가 마지막으로 본 행의 updatedAt(행 없음 = null). 지금 행과 다르면 409 —
//     다른 기기의 새 레코드를 옛 스냅샷으로 지우지 않는다. 클라는 409 본문의 서버본과 병합 후 다시 보낸다.
//     새 updatedAt 은 항상 base 보다 크다(같은 ms 두 번 써도 같은 값이 나오지 않게 — ABA 방지).
//   DELETE {"confirm":"ERASE"} → 204 + Set-Cookie ws_sid 삭제(Max-Age=0) | 400 confirm_required·bad_body | 401 no_session
//        | 413 | 415 | 429 rate_limited(erase 5/15분/IP + /api write 60/분 — app.ts) | 403(교차 오리진, app.ts CORS)
//     P3(처리방침 86, PRD US-025 보완): 연결된 저장 전부 삭제 = privacy/erase.ts eraseAccount(channel=SELF) —
//     같은 트랜잭션에서 그 이메일 매직 토큰 전부 → User(모든 기기 세션·스냅샷 Cascade) → Badge·Notification·RefreshToken + 묘비.
//     다른 기기의 세션도 같이 지워져 이후 401. 본문은 정확히 {"confirm":"ERASE"} 한 키만(오조작 방지).
//     이 기기의 localStorage(ws.*) 지우기는 클라 몫. 응답 본문 없음.
//   QA95 D-1: GET·PUT 성공 경로에서 users.touchLastSeen(하루 1회 쓰기) — 자동 파기 '마지막으로 쓴 날' 근거.
//     갱신 실패는 응답을 막지 않는다(오류 이름만 로그). DELETE 는 갱신하지 않는다(어차피 삭제).
//   QA95 D-2: DELETE 204 응답을 보낸 뒤 비동기 VACUUM 1회(privacy/compact.ts — 합치기·실패 로그만, 응답 지연 0).
//   본문 파서는 이 라우터 전용(≤32KB, application/json 만) — app.ts 전역 JSON 파서에서 제외된다.
//   교차 오리진 변경은 app.ts 의 CORS(/api) 가 403 으로 먼저 막는다. 병합은 하지 않는다(클라 몫).
import express, { Router, type RequestHandler } from 'express';
import type { SaveSnapshotRepository, SaveSnapshotRow, SessionRepository } from './save.repo.js';
import { noStore, requireSession, type Clock } from './session.js';
import { expireSessionCookie } from './magic.routes.js';
import { eraseAccount, stdoutLog, type ErasureStore, type PrivacyLog } from '../privacy/erase.js';
import { createCompactScheduler, type CompactScheduler } from '../privacy/compact.js';
import type { UserRepository } from '../auth/user.repo.js';
import { SAVE_MAX_BYTES, findForbiddenKey, isIsoTime, validateSaveV1 } from '../shared/save-validate.js';

/** 새 행 시각: 지금, 단 base 이하이면 base+1ms(단조 증가). */
function nextUpdatedAt(nowIso: string, base: string | null): string {
  if (base === null || nowIso > base) return nowIso;
  return new Date(Date.parse(base) + 1).toISOString();
}

function snapshotBody(row: SaveSnapshotRow | null): { snapshot: unknown; updatedAt: string | null } {
  return row ? { snapshot: JSON.parse(row.payload) as unknown, updatedAt: row.updatedAt } : { snapshot: null, updatedAt: null };
}

export interface SaveRouteDeps {
  sessions: SessionRepository;
  snapshots: SaveSnapshotRepository;
  now: Clock;
  /** P3 DELETE — 삭제 저장소. compact 가 있으면 삭제 뒤 비동기 VACUUM(D-2). */
  erasure: ErasureStore;
  /** QA95 D-1: lastSeenAt 갱신. */
  users: Pick<UserRepository, 'touchLastSeen'>;
  /** 테스트 주입(기본 createCompactScheduler(erasure.compact)). */
  compact?: CompactScheduler;
  /** 삭제 쿠키의 Secure 속성(magic 라우터와 같은 값). */
  secureCookie: boolean;
  /** 채널 로그(기본 stdout). */
  log?: PrivacyLog;
}

/** P3 삭제 확인 문구 — 본문 {"confirm": ERASE_CONFIRM} 정확히 한 키. */
export const ERASE_CONFIRM = 'ERASE';
/** P3 DELETE /api/save IP 리미터(app.ts 마운트). */
export const SAVE_ERASE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 5 } as const;

export function createSaveRouter(deps: SaveRouteDeps): Router {
  const { sessions, snapshots, now, erasure, secureCookie, users } = deps;
  const log = deps.log ?? stdoutLog;
  const compact = deps.compact ?? createCompactScheduler(erasure.compact ? () => erasure.compact!() : undefined, { log });
  /** D-1 best-effort: 실패해도 저장 응답은 그대로(오류 이름만 로그 — 식별자 0). */
  const touch = async (userId: string): Promise<void> => {
    try {
      await users.touchLastSeen(userId, now());
    } catch (err) {
      log(`[privacy] lastSeen touch failed (${String((err as { name?: unknown } | null)?.name ?? 'Error')})`);
    }
  };
  const router = Router();
  const auth = requireSession(sessions, now);
  const jsonBody = express.json({ limit: SAVE_MAX_BYTES, strict: true, type: 'application/json' });

  const readJson: RequestHandler = (req, res, next) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    jsonBody(req, res, (err?: unknown) => {
      if (err) {
        const tooLarge = (err as { status?: unknown }).status === 413;
        res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'payload_too_large' : 'bad_body' });
        return;
      }
      next();
    });
  };

  router.use((_req, res, next) => {
    noStore(res);
    next();
  });

  router.get('/', auth, async (_req, res, next) => {
    try {
      const userId = String(res.locals.saveUserId);
      const row = await snapshots.get(userId);
      await touch(userId);
      res.status(200).json(snapshotBody(row));
    } catch (err) {
      next(err);
    }
  });

  router.put('/', auth, readJson, async (req, res, next) => {
    try {
      const body: unknown = req.body;
      const forbidden = findForbiddenKey(body);
      if (forbidden !== null && forbidden !== '<depth>') {
        res.status(400).json({ error: 'forbidden_key' });
        return;
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        res.status(400).json({ error: 'invalid_snapshot' });
        return;
      }
      const keys = Object.keys(body);
      if (!keys.includes('snapshot') || keys.some((k) => k !== 'snapshot' && k !== 'baseUpdatedAt')) {
        res.status(400).json({ error: 'invalid_snapshot' });
        return;
      }
      const r = validateSaveV1((body as { snapshot: unknown }).snapshot);
      if (!r.ok) {
        res.status(400).json({ error: r.error });
        return;
      }
      // 기준 시각 없는 PUT(옛 클라)은 무조건 덮어쓰기가 되므로 받지 않는다 — 428(다음 GET 후 새 클라가 다시 보냄).
      if (!keys.includes('baseUpdatedAt')) {
        res.status(428).json({ error: 'precondition_required' });
        return;
      }
      const base = (body as { baseUpdatedAt: unknown }).baseUpdatedAt;
      if (base !== null && !isIsoTime(base)) {
        res.status(400).json({ error: 'invalid_base' });
        return;
      }
      const userId = String(res.locals.saveUserId);
      const updatedAt = nextUpdatedAt(now().toISOString(), base);
      const w = await snapshots.putIfMatch({ userId, v: r.value.v, payload: JSON.stringify(r.value), updatedAt }, base);
      if (!w.ok) {
        await touch(userId);
        res.status(409).json({ error: 'conflict', ...snapshotBody(w.current) });
        return;
      }
      await touch(userId);
      res.status(200).json({ updatedAt });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/', auth, readJson, async (req, res, next) => {
    try {
      const body: unknown = req.body;
      const ok =
        body !== null &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        (body as { confirm?: unknown }).confirm === ERASE_CONFIRM;
      if (!ok) {
        res.status(400).json({ error: 'confirm_required' });
        return;
      }
      await eraseAccount(erasure, { userId: String(res.locals.saveUserId) }, 'SELF', now(), log);
      expireSessionCookie(res, secureCookie);
      res.status(204).end();
      compact.request(); // 응답 뒤 예약만(실행은 setImmediate 이후)
    } catch (err) {
      next(err);
    }
  });

  return router;
}
