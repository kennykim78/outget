// /api/save(계약 C-R5-2, D5): 세션 필수.
//   GET → 200 {snapshot: SaveV1|null, updatedAt: iso|null}
//   PUT {snapshot, baseUpdatedAt: iso|null} → 200 {updatedAt} | 400 forbidden_key·invalid_snapshot·invalid_base·bad_body
//        | 401 | 409 {error:'conflict', snapshot, updatedAt}(지금 서버본) | 413 | 415 | 428 precondition_required(baseUpdatedAt 없음)
//   H1 낙관적 동시성: baseUpdatedAt = 클라가 마지막으로 본 행의 updatedAt(행 없음 = null). 지금 행과 다르면 409 —
//     다른 기기의 새 레코드를 옛 스냅샷으로 지우지 않는다. 클라는 409 본문의 서버본과 병합 후 다시 보낸다.
//     새 updatedAt 은 항상 base 보다 크다(같은 ms 두 번 써도 같은 값이 나오지 않게 — ABA 방지).
//   본문 파서는 이 라우터 전용(≤32KB, application/json 만) — app.ts 전역 JSON 파서에서 제외된다.
//   교차 오리진 변경은 app.ts 의 CORS(/api) 가 403 으로 먼저 막는다. 병합은 하지 않는다(클라 몫).
import express, { Router, type RequestHandler } from 'express';
import type { SaveSnapshotRepository, SaveSnapshotRow, SessionRepository } from './save.repo.js';
import { noStore, requireSession, type Clock } from './session.js';
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
}

export function createSaveRouter(deps: SaveRouteDeps): Router {
  const { sessions, snapshots, now } = deps;
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
      const row = await snapshots.get(String(res.locals.saveUserId));
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
        res.status(409).json({ error: 'conflict', ...snapshotBody(w.current) });
        return;
      }
      res.status(200).json({ updatedAt });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
