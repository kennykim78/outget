import type { NextFunction, Request, Response } from 'express';
import { verifyAccess } from './jwt.js';
import type { Role } from './roles.js';

// req.user 주입 타입(모듈 보강).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { sub: string; role: Role };
    }
  }
}

// Authorization: Bearer <token> 검증. 없거나 무효 → 401.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const claims = verifyAccess(token);
    req.user = { sub: claims.sub, role: claims.role };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

// req.user.role 불일치 → 403. (requireAuth 이후에 사용)
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
