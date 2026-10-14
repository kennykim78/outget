// 세션 판정 공용부: 시계·쿠키 → userId. 라우트(magic·save)가 같이 쓴다.
import type { Request, RequestHandler, Response } from 'express';
import { readSessionId } from './cookie.js';
import { sha256Hex } from './crypto.js';
import type { SessionRepository } from './save.repo.js';

export type Clock = () => Date;

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
