// 세션 판정 공용부: 시계·쿠키 → userId. 라우트(magic·save)가 같이 쓴다.
import type { Request, RequestHandler, Response } from 'express';
import { readSessionId } from './cookie.js';
import { sha256Hex } from './crypto.js';
import type { SessionRepository } from './save.repo.js';

export type Clock = () => Date;

// R6 C2 정리·상한(스키마 변경 없음). 값은 상수 — 보존 기간은 Kenny 결정 K4 대기(_workspace/decisions.md).
/** 사용자당 동시 활성 세션 상한. 새 연결로 넘치면 가장 오래된 활성 세션부터 폐기. */
export const MAX_SESSIONS_PER_USER = 10;
/** K4 대기: 매직 토큰 만료 후 보존 기간. 0 = 만료 즉시 삭제 대상(이메일 담긴 행 최소 보존 기본값). 발급(request) 때 정리. */
export const MAGIC_TOKEN_RETENTION_MS = 0;
/** K4 대기: 세션 만료·폐기 후 보존 기간. 0 = 즉시 삭제 대상. 세션 발급(verify) 때 정리. */
export const SESSION_RETENTION_MS = 0;

/** 정리 기준 시각(ISO) = now − 보존 기간. */
export function retentionCutoff(now: Date, retentionMs: number): string {
  return new Date(now.getTime() - retentionMs).toISOString();
}

export async function currentUserId(req: Request, sessions: SessionRepository, now: Clock): Promise<string | null> {
  const sid = readSessionId(req);
  if (sid === null) return null;
  return sessions.findActiveUserId(sha256Hex(sid), now().toISOString());
}

/** 세션 필수. 통과 시 res.locals.saveUserId. 없으면 401 {error:'no_session'}. */
export function requireSession(sessions: SessionRepository, now: Clock): RequestHandler {
  return (req, res, next) => {
    currentUserId(req, sessions, now).then((userId) => {
      if (userId === null) {
        res.status(401).json({ error: 'no_session' });
        return;
      }
      res.locals.saveUserId = userId;
      next();
    }, next);
  };
}

export function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}
