// /auth 아래 매직링크·세션 라우트(계약 C-R5-2, D1·D2·D19·D20).
//   POST /magic/request {email, entry} → 202 {ok:true} | 400 | 415 | 429(이메일 리밋) | 503 {code:'SAVE_UNAVAILABLE'}
//   POST /magic/verify  {token}        → 200 {linked:true, maskedEmail} + Set-Cookie ws_sid | 400 | 401
//     QA95 D-3: 토큰 소비 뒤 같은 계정 삭제(DELETE /api/save·CLI·정리)와 경합해 User 가 사라지면 세션 insert 가
//       FK 위반(Prisma P2003)·대상 없음(P2025)으로 실패한다 → 500 대신 401 {error:'invalid_token'}(다른 401 과 같은 본문).
//       쿠키는 발급하지 않는다. 다른 오류는 그대로 500(next).
//     QA95 D-1: 성공 시 users.touchLastSeen(서울 날짜가 바뀐 경우만 1회 쓰기).
//   GET  /session                      → 200 {linked:true, maskedEmail} | {linked:false}
//     maskedEmail = maskEmail(정규화 이메일) "k***@e***.com" — 원문 이메일은 어떤 응답에도 없다.
//     SEC-3 M-1: 클라이언트가 연결 확인 화면에 "어느 계정과 연결되는지"를 보여 줘 링크 바꿔치기(로그인 CSRF)를 알아채게 한다.
//   DELETE /session                    → 204 + 쿠키 삭제(멱등)
//
// 계정 존재 비노출: request 경로는 사용자 저장소를 아예 조회하지 않는다. 가입·미가입 이메일 모두
//   정규화 → 이메일 리밋 → 32B 난수 → sha256 → 토큰 행 insert → 메일 1통 의 같은 경로를 탄다(존재 분기 0 = 타이밍 동일).
//   User 는 verify 에서 처음 upsert(D20). 이메일 리밋 키는 sha256(정규화 이메일)이라 가입 여부와 무관.
// IP 리밋(5/15분)은 rate-limit.ts(B1-4)에서 이 경로 앞에 건다.
import { Router, type Request, type Response } from 'express';
import type { UserRepository } from '../auth/user.repo.js';
import type { SaveConfig } from './config.js';
import { clearSessionCookie, readSessionId, serializeSessionCookie, SESSION_MAX_AGE_S } from './cookie.js';
import { OPAQUE_RE, randomOpaque, sha256Hex } from './crypto.js';
import { normalizeEmail } from './email.js';
import { maskEmail } from './mail.js';
import type { MagicTokenRepository, SessionRepository } from './save.repo.js';
import {
  currentUserId,
  MAGIC_TOKEN_RETENTION_MS,
  MAX_SESSIONS_PER_USER,
  noStore,
  retentionCutoff,
  SESSION_RETENTION_MS,
  type Clock,
} from './session.js';

export const MAGIC_TTL_MS = 15 * 60 * 1000;
export const MAGIC_ENTRIES = ['home', 'checklist', 'direct'] as const;
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;

const UNAVAILABLE = { code: 'SAVE_UNAVAILABLE' } as const;

export const MAGIC_MAIL_SUBJECT = '위드스몰 저장 연결 링크';

export function magicMailText(link: string): string {
  return [
    '위드스몰에서 준비 상태 저장 연결을 요청했어요.',
    '아래 링크를 15분 안에 열고 「이 기기 연결하기」를 누르면 그 기기와 연결돼요. 링크는 한 번만 쓸 수 있어요.',
    '',
    link,
    '',
    '직접 요청하지 않았다면 이 메일은 그냥 지나쳐 주세요. 아무 일도 일어나지 않아요.',
  ].join('\n');
}

/** sha256(이메일) 키 슬라이딩 창 리밋. 프로세스 메모리에만, 원문 이메일은 키로 쓰지 않는다. */
export class EmailThrottle {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = EMAIL_LIMIT,
    private readonly windowMs = EMAIL_WINDOW_MS,
  ) {}

  /** 허용이면 기록 후 true, 창 안 한도 초과면 false. */
  take(key: string, nowMs: number): boolean {
    const from = nowMs - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.sweep(from);
    return true;
  }

  private sweep(from: number): void {
    for (const [k, ts] of this.hits) if (!ts.some((t) => t > from)) this.hits.delete(k);
  }
}

export interface MagicDeps {
  users: UserRepository;
  tokens: MagicTokenRepository;
  sessions: SessionRepository;
  config: SaveConfig;
  now: Clock;
}

/**
 * ws_sid 삭제 쿠키(Max-Age=0) 발급 — 쿠키 발급 지점은 이 파일 하나(compliance C9-COOKIE).
 *   DELETE /auth/session 과 P3 DELETE /api/save(save.routes.ts)가 같이 쓴다.
 */
export function expireSessionCookie(res: Response, secure: boolean): void {
  res.setHeader('Set-Cookie', clearSessionCookie(secure));
}

function requireJson(req: Request, res: Response): boolean {
  if (req.is('application/json')) return true;
  res.status(415).json({ error: 'unsupported_media_type' });
  return false;
}

function body(req: Request): Record<string, unknown> {
  const b: unknown = req.body;
  return b !== null && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** QA95 D-3: 삭제 경합으로 사용자가 사라진 경우의 Prisma 오류 코드. */
const ERASED_DURING_VERIFY = new Set(['P2003', 'P2025']);

export function isErasedDuringVerify(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && ERASED_DURING_VERIFY.has(code);
}

export function createMagicRouter(deps: MagicDeps): Router {
  const { users, tokens, sessions, config, now } = deps;
  const throttle = new EmailThrottle();
  const router = Router();

  router.post('/magic/request', async (req, res, next) => {
    try {
      noStore(res);
      if (!requireJson(req, res)) return;
      if (config.transport === null) {
        res.status(503).json(UNAVAILABLE);
        return;
      }
      const { email: rawEmail, entry } = body(req);
      const email = normalizeEmail(rawEmail);
      if (email === null || typeof entry !== 'string' || !(MAGIC_ENTRIES as readonly string[]).includes(entry)) {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }
      const t = now();
      if (!throttle.take(sha256Hex(email), t.getTime())) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      // R6 C2: 발급할 때마다 만료 토큰 정리(이메일과 무관한 같은 작업 — 존재 분기 0 유지).
      await tokens.deleteExpired(retentionCutoff(t, MAGIC_TOKEN_RETENTION_MS));
      const token = randomOpaque();
      await tokens.insert({
        tokenHash: sha256Hex(token),
        email,
        createdAt: t.toISOString(),
        expiresAt: new Date(t.getTime() + MAGIC_TTL_MS).toISOString(),
        consumedAt: null,
      });
      const link = `${config.publicOrigin}/save#t=${token}`;
      try {
        await config.transport.send({ to: email, subject: MAGIC_MAIL_SUBJECT, text: magicMailText(link) });
      } catch {
        res.status(503).json(UNAVAILABLE);
        return;
      }
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/magic/verify', async (req, res, next) => {
    try {
      noStore(res);
      if (!requireJson(req, res)) return;
      const { token } = body(req);
      if (token === undefined || token === null || token === '') {
        res.status(400).json({ error: 'missing_token' });
        return;
      }
      if (typeof token !== 'string' || !OPAQUE_RE.test(token)) {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      const t = now();
      const nowIso = t.toISOString();
      const email = await tokens.consume(sha256Hex(token), nowIso);
      if (email === null) {
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      // 이 브라우저의 이전 세션이 있으면 폐기(쿠키 1개 = 세션 1개).
      const prev = readSessionId(req);
      if (prev !== null) await sessions.revoke(sha256Hex(prev), nowIso);
      const sid = randomOpaque();
      const sidHash = sha256Hex(sid);
      let user;
      try {
        user = await users.upsertByEmail(email);
        await sessions.insert({
          sidHash,
          userId: user.id,
          createdAt: nowIso,
          expiresAt: new Date(t.getTime() + SESSION_MAX_AGE_S * 1000).toISOString(),
          revokedAt: null,
        });
      } catch (err) {
        if (!isErasedDuringVerify(err)) throw err;
        res.status(401).json({ error: 'invalid_token' });
        return;
      }
      await users.touchLastSeen(user.id, t);
      // R6 C2: 사용자별 활성 세션 상한(새 세션 제외 가장 오래된 것부터 폐기) → 만료·폐기 행 정리.
      await sessions.enforceCap(user.id, sidHash, MAX_SESSIONS_PER_USER, nowIso);
      await sessions.deleteInactive(retentionCutoff(t, SESSION_RETENTION_MS));
      res.setHeader('Set-Cookie', serializeSessionCookie(sid, config.secureCookie));
      res.status(200).json({ linked: true, maskedEmail: maskEmail(user.email) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/session', async (req, res, next) => {
    try {
      noStore(res);
      const userId = await currentUserId(req, sessions, now);
      const user = userId === null ? undefined : await users.findById(userId);
      res.status(200).json(user ? { linked: true, maskedEmail: maskEmail(user.email) } : { linked: false });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/session', async (req, res, next) => {
    try {
      noStore(res);
      const sid = readSessionId(req);
      if (sid !== null) await sessions.revoke(sha256Hex(sid), now().toISOString());
      expireSessionCookie(res, config.secureCookie);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
