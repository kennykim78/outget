// 익명 반응 API(C-R5-3) — 마운트는 BE1(app.ts, '/api/reactions', 분당 20/IP 리미터).
//   POST   /            {targetType, targetId, kind} → 204(중복도 204)
//   DELETE /            같은 본문 → 204(없어도 204)
//   GET    /counts?targetType=PRODUCT&ids=a,b(≤20) → {counts:{[id]: number|null}} — LIKE 만, 10 미만 null(D9)
//   HELPFUL·RECHECK 수는 어떤 경로로도 내보내지 않는다. 변경 메서드는 Content-Type application/json 만(교차 출처 단순 요청 차단).
import { randomUUID } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import { createAnonKeyer, type AnonKeyerOptions } from './anon-key.js';
import type { ReactionRepository } from './reaction.repo.js';
import {
  KIND_TARGETS,
  LIKE_PUBLIC_THRESHOLD,
  MAX_COUNT_IDS,
  REACTION_KINDS,
  REACTION_TARGETS,
  TARGET_ID_RE,
  type ReactionKind,
  type ReactionTarget,
} from './reaction.types.js';

export interface ReactionRouterOptions extends AnonKeyerOptions {
  /** 변경 메서드(POST·DELETE) 리미터. 마운트하는 쪽(BE1)이 넘긴다. */
  limiter?: RequestHandler;
  /**
   * SEC-3 L-7: 주면 POST·DELETE 의 targetId 가 이 집합 밖이면 400(없는 대상에 행을 쌓지 않는다).
   *   모든 targetType 에 같은 집합을 쓴다 — 노출 상품 id 뿐 아니라 👍·⚠ 대상(노출 SupplyItem·Bundle id)도 넣어야 한다.
   */
  knownTargetIds?: ReadonlySet<string>;
}

type Body = { targetType: ReactionTarget; targetId: string; kind: ReactionKind };

function parseBody(x: unknown): Body | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || !['targetType', 'targetId', 'kind'].every((k) => keys.includes(k))) return null;
  const { targetType, targetId, kind } = o;
  if (typeof targetType !== 'string' || !(REACTION_TARGETS as readonly string[]).includes(targetType)) return null;
  if (typeof kind !== 'string' || !(REACTION_KINDS as readonly string[]).includes(kind)) return null;
  if (typeof targetId !== 'string' || !TARGET_ID_RE.test(targetId)) return null;
  if (!KIND_TARGETS[kind as ReactionKind].includes(targetType as ReactionTarget)) return null;
  return { targetType: targetType as ReactionTarget, targetId, kind: kind as ReactionKind };
}

function isJson(req: express.Request): boolean {
  return req.is('application/json') === 'application/json';
}

export function createReactionRouter(repo: ReactionRepository, opts: ReactionRouterOptions = {}): Router {
  const keyer = createAnonKeyer(opts);
  const router = Router();
  const json = express.json({ limit: '1kb' });
  const limit: RequestHandler = opts.limiter ?? ((_req, _res, next) => next());

  const now = opts.now ?? (() => new Date());
  const known = opts.knownTargetIds;

  const mutate = (op: 'add' | 'remove'): RequestHandler => async (req, res) => {
    if (!isJson(req)) {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    const b = parseBody(req.body);
    if (!b || (known !== undefined && !known.has(b.targetId))) {
      res.status(400).json({ error: 'bad_reaction' });
      return;
    }
    try {
      // M-3: 키 = HMAC(서울일자|IP 프리픽스), UA 제외. 창(400일) 안의 키로 중복 판정·취소 — 며칠 뒤 취소도 지운다.
      const ip = req.ip ?? '';
      const windowKeys = keyer.window(ip);
      if (op === 'add') {
        if (!(await repo.existsAny(windowKeys, b))) {
          await repo.add({ anonKey: keyer.today(ip), ...b, id: randomUUID(), createdAt: now().toISOString() });
        }
      } else await repo.removeAny(windowKeys, b);
      res.status(204).end();
    } catch {
      res.status(500).json({ error: 'reaction_failed' });
    }
  };

  router.post('/', limit, json, mutate('add'));
  router.delete('/', limit, json, mutate('remove'));

  router.get('/counts', async (req, res) => {
    const { targetType, ids } = req.query;
    if (targetType !== 'PRODUCT' || typeof ids !== 'string') {
      res.status(400).json({ error: 'bad_query' });
      return;
    }
    const list = [...new Set(ids.split(','))];
    if (list.length === 0 || list.length > MAX_COUNT_IDS || !list.every((id) => TARGET_ID_RE.test(id))) {
      res.status(400).json({ error: 'bad_query' });
      return;
    }
    try {
      const raw = await repo.count('PRODUCT', 'LIKE', list);
      const counts: Record<string, number | null> = {};
      for (const id of list) {
        const n = raw[id] ?? 0;
        counts[id] = n >= LIKE_PUBLIC_THRESHOLD ? n : null;
      }
      res.status(200).json({ counts });
    } catch {
      res.status(500).json({ error: 'reaction_failed' });
    }
  });

  return router;
}
