// POST /api/events (PRD US-018, R4 계약 C-3) — 익명 이벤트 배치 수집. 응답 204, 읽기 경로 없음.
//   검증은 shared/event-contract.ts 단일 소스(클라이언트와 동일). 하나라도 무효면 전체 400.
//   본문: application/json 또는 text/plain(navigator.sendBeacon) — 둘 다 원문 텍스트로 받아 직접 JSON.parse, ≤16KB.
//   저장: EventLog 필드만. IP·User-Agent·요청 헤더·좌표는 읽지도 저장하지도 않는다(불변식 8).
//   레이트 리밋 키(IP)는 express-rate-limit 메모리 창 안에서만 쓰이고 영속되지 않는다.
import express, { Router, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { MAX_BODY_BYTES, validateBatch, type TrackEvent } from '../shared/event-contract.js';
import type { DailyCap, DailyCapTake } from '../middleware/daily-cap.js';
import type { EventRepository, EventRow } from './event.repo.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 수신 일자(Asia/Seoul, DST 없음). */
export function seoulDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 검증 통과 이벤트 → EventLog 행. */
export function toEventRows(
  events: readonly TrackEvent[],
  now: Date,
  newId: () => string = () => `evt-${randomUUID()}`,
): EventRow[] {
  const receivedDate = seoulDate(now);
  return events.map((e) => ({
    id: newId(),
    name: e.name,
    ts: new Date(e.ts).toISOString(),
    animalTypeId: e.animalTypeId ?? null,
    props: JSON.stringify(e.props),
    sessionKey: e.sessionKey,
    receivedDate,
  }));
}

/** 이벤트 전용 리밋(기본 분당 30회). 테스트 env 패스스루 여부는 호출자(app.ts)가 정한다. */
export function makeEventsLimiter(opts: { limit?: number; windowMs?: number } = {}): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs ?? 60 * 1000,
    limit: opts.limit ?? 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}

export interface EventsRouteOptions {
  limiter?: RequestHandler;
  now?: () => Date;
  /**
   * 일일 전역 저장 상한(264, security 257 3c). 넘친 이벤트는 저장하지 않고 응답은 그대로 204(클라이언트 변화 0).
   *   배치가 남은 자리보다 크면 앞에서부터 남은 수만 저장. 미지정 = 상한 없음(단위 시험용 — app.ts 는 늘 넘긴다).
   */
  cap?: DailyCap;
}

const ACCEPTED_TYPES = ['text/plain', 'application/json'];

export function makeEventsRoutes(repo: EventRepository, opts: EventsRouteOptions = {}): Router {
  const router = Router();
  const now = opts.now ?? (() => new Date());
  const textBody = express.text({ type: ACCEPTED_TYPES, limit: MAX_BODY_BYTES });

  const readBody: RequestHandler = (req, res, next) => {
    if (!req.is(ACCEPTED_TYPES)) {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    textBody(req, res, (err?: unknown) => {
      if (err) {
        const status = (err as { status?: unknown }).status === 413 ? 413 : 400;
        res.status(status).json({ error: status === 413 ? 'payload_too_large' : 'bad_body' });
        return;
      }
      next();
    });
  };

  const handlers: RequestHandler[] = opts.limiter ? [opts.limiter, readBody] : [readBody];

  router.post('/', ...handlers, async (req, res) => {
    const raw: unknown = req.body;
    if (typeof raw !== 'string') {
      res.status(415).json({ error: 'unsupported_media_type' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: 'bad_json' });
      return;
    }
    const result = validateBatch(parsed);
    if (!result.ok) {
      res.status(400).json(result.index === undefined ? { error: result.error } : { error: result.error, index: result.index });
      return;
    }
    const at = now();
    let taken: DailyCapTake | undefined;
    try {
      let events = result.events;
      if (opts.cap) {
        taken = await opts.cap.take(events.length, at);
        events = events.slice(0, taken.allowed);
      }
      if (events.length > 0) await repo.append(toEventRows(events, at));
    } catch {
      if (opts.cap && taken) opts.cap.release(taken);
      res.status(500).json({ error: 'internal' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
