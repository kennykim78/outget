// 운영자 비밀번호 인증(R5 B1-4, D3). 일반 사용자는 매직링크 세션(save/)만 쓴다.
//   POST /login   {email,password} → 200 {accessToken, role} + Set-Cookie ws_op_rt | 400 | 401 | 403(USER)
//   POST /refresh (쿠키 ws_op_rt)  → 200 {accessToken} + 회전된 쿠키 | 401
//   POST /logout  (쿠키 ws_op_rt)  → 204 + 쿠키 삭제(멱등)
//   - /register 없음(D3, SEC-1 M-C). OPERATOR 는 운영 절차(repo 직접 생성)로만.
//   - refresh 토큰은 HttpOnly·SameSite=Strict·Path=/auth 쿠키로만 오간다 — 응답 본문·요청 본문 미사용(L-H).
//   - 역할은 자격 확인(비밀번호 일치) 뒤에만 드러난다: 미지·틀림·비밀번호 없음 = 401, 맞는 USER = 403.
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { REFRESH_TTL_S, signAccess, signRefresh, verifyRefresh } from './jwt.js';
import {
  burnPasswordCheck,
  InMemoryUserRepository,
  verifyPassword,
  type User,
  type UserRepository,
} from './user.repo.js';
import { InMemoryRefreshTokenStore, type RefreshTokenStore } from './refresh.store.js';

export const REFRESH_COOKIE = 'ws_op_rt';
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export interface AuthRouterOptions {
  /** production → Secure 쿠키. */
  secureCookie?: boolean;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function refreshCookie(token: string, secure: boolean): string {
  return `${REFRESH_COOKIE}=${token}; Max-Age=${REFRESH_TTL_S}; Path=/auth; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function clearRefreshCookie(secure: boolean): string {
  return `${REFRESH_COOKIE}=; Max-Age=0; Path=/auth; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

function readRefreshCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    const v = part.slice(eq + 1).trim();
    return JWT_RE.test(v) ? v : null;
  }
  return null;
}

function noStore(res: Response): void {
  res.set('Cache-Control', 'no-store');
}

// 발급 1쌍: access 는 본문, refresh(jti 활성 기록)는 쿠키.
async function issue(user: User, store: RefreshTokenStore, res: Response, secure: boolean): Promise<string> {
  const jti = randomUUID();
  await store.issue(jti, user.id, new Date(Date.now() + REFRESH_TTL_S * 1000));
  res.setHeader('Set-Cookie', refreshCookie(signRefresh({ sub: user.id, jti }), secure));
  return signAccess({ sub: user.id, role: user.role });
}

export function createAuthRouter(
  repo: UserRepository = new InMemoryUserRepository(),
  refreshStore: RefreshTokenStore = new InMemoryRefreshTokenStore(),
  opts: AuthRouterOptions = {},
): Router {
  const secure = opts.secureCookie ?? false;
  const router = Router();

  router.post('/login', async (req, res, next) => {
    try {
      noStore(res);
      const { email, password } = (req.body ?? {}) as Record<string, unknown>;
      if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
        res.status(400).json({ error: 'missing_credentials' });
        return;
      }
      const user = await repo.findByEmail(email);
      // L-4: 계정 없음·비밀번호 없는(매직링크) 계정도 bcrypt 비교 1회 — 존재 여부가 응답 시간으로 드러나지 않게.
      if (!user || user.passwordHash === null) {
        await burnPasswordCheck(password);
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        res.status(401).json({ error: 'invalid_credentials' });
        return;
      }
      if (user.role !== 'OPERATOR') {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      const accessToken = await issue(user, refreshStore, res, secure);
      res.status(200).json({ accessToken, role: user.role });
    } catch (err) {
      next(err);
    }
  });

  // 회전: 쿠키 jti 활성 확인 → OPERATOR 재확인 → 새 쌍 발급 → 이전 jti 폐기. 재사용(폐기된 jti)은 401.
  router.post('/refresh', async (req, res, next) => {
    try {
      noStore(res);
      const token = readRefreshCookie(req);
      let sub: string;
      let jti: string;
      try {
        if (token === null) throw new Error('no cookie');
        ({ sub, jti } = verifyRefresh(token));
      } catch {
        res.status(401).json({ error: 'invalid_refresh_token' });
        return;
      }
      if (!(await refreshStore.isActive(jti))) {
        res.status(401).json({ error: 'invalid_refresh_token' });
        return;
      }
      const user = await repo.findById(sub);
      if (!user || user.role !== 'OPERATOR') {
        await refreshStore.revoke(jti);
        res.status(401).json({ error: 'invalid_refresh_token' });
        return;
      }
      const accessToken = await issue(user, refreshStore, res, secure);
      await refreshStore.revoke(jti);
      res.status(200).json({ accessToken });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      noStore(res);
      const token = readRefreshCookie(req);
      if (token !== null) {
        try {
          await refreshStore.revoke(verifyRefresh(token).jti);
        } catch {
          // 위조·만료 토큰은 조용히 통과(로그아웃은 멱등).
        }
      }
      res.setHeader('Set-Cookie', clearRefreshCookie(secure));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
