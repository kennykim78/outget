import { Router } from 'express';
import { signAccess, signRefresh, verifyRefresh } from './jwt.js';
import { isRole } from './roles.js';
import {
  InMemoryUserRepository,
  hashPassword,
  verifyPassword,
  type UserRepository,
} from './user.repo.js';

// 간단한 이메일 형식 검증(서버측 최소 검증). 정교한 RFC 검증은 후속.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

// 라우터 팩토리 — repo 주입 가능(테스트/후속 영속성 교체).
export function createAuthRouter(repo: UserRepository = new InMemoryUserRepository()): Router {
  const router = Router();

  // POST /auth/register
  router.post('/register', async (req, res) => {
    const { email, password, role } = (req.body ?? {}) as Record<string, unknown>;

    if (!isNonEmptyString(email) || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    if (!isNonEmptyString(password)) {
      res.status(400).json({ error: 'invalid_password' });
      return;
    }
    if (!isRole(role)) {
      res.status(400).json({ error: 'invalid_role' });
      return;
    }

    const existing = await repo.findByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'email_taken' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await repo.create(email, passwordHash, role);

    res.status(201).json({
      accessToken: signAccess({ sub: user.id, role: user.role }),
      refreshToken: signRefresh({ sub: user.id }),
      role: user.role,
    });
  });

  // POST /auth/login
  router.post('/login', async (req, res) => {
    const { email, password } = (req.body ?? {}) as Record<string, unknown>;

    if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
      res.status(400).json({ error: 'missing_credentials' });
      return;
    }

    const user = await repo.findByEmail(email);
    // 사용자 없음·비번 불일치 모두 401(계정 존재 여부 노출 금지).
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    res.status(200).json({
      accessToken: signAccess({ sub: user.id, role: user.role }),
      refreshToken: signRefresh({ sub: user.id }),
      role: user.role,
    });
  });

  // POST /auth/refresh
  router.post('/refresh', async (req, res) => {
    const { refreshToken } = (req.body ?? {}) as Record<string, unknown>;

    if (!isNonEmptyString(refreshToken)) {
      res.status(400).json({ error: 'missing_refresh_token' });
      return;
    }

    let sub: string;
    try {
      ({ sub } = verifyRefresh(refreshToken));
    } catch {
      res.status(401).json({ error: 'invalid_refresh_token' });
      return;
    }

    // sub로 현재 role 재조회(역할 변경 반영).
    const user = await repo.findById(sub);
    if (!user) {
      res.status(401).json({ error: 'invalid_refresh_token' });
      return;
    }

    res.status(200).json({
      accessToken: signAccess({ sub: user.id, role: user.role }),
    });
  });

  return router;
}
