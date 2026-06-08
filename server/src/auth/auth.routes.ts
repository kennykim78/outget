import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { signAccess, signRefresh, verifyRefresh } from './jwt.js';
import { isRole } from './roles.js';
import {
  InMemoryUserRepository,
  hashPassword,
  verifyPassword,
  type User,
  type UserRepository,
} from './user.repo.js';
import {
  InMemoryRefreshTokenStore,
  type RefreshTokenStore,
} from './refresh.store.js';

// 간단한 이메일 형식 검증(서버측 최소 검증). 정교한 RFC 검증은 후속.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// refresh TTL(7d) 과 일치하는 만료 시각 계산(store 기록용).
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function refreshExpiry(): Date {
  return new Date(Date.now() + REFRESH_TTL_MS);
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

// 발급 1쌍(access + 회전형 refresh). refresh jti 를 store 에 활성으로 기록한다.
async function issueTokens(
  user: User,
  refreshStore: RefreshTokenStore,
): Promise<{ accessToken: string; refreshToken: string }> {
  const jti = randomUUID();
  await refreshStore.issue(jti, user.id, refreshExpiry());
  return {
    accessToken: signAccess({ sub: user.id, role: user.role }),
    refreshToken: signRefresh({ sub: user.id, jti }),
  };
}

// 라우터 팩토리 — userRepo + refreshStore 주입(테스트/영속성 교체).
//   기본 인자는 인메모리 — 직접 호출 시에도 동작(주 진입점 createApp 은 명시 주입).
export function createAuthRouter(
  repo: UserRepository = new InMemoryUserRepository(),
  refreshStore: RefreshTokenStore = new InMemoryRefreshTokenStore(),
): Router {
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
    const tokens = await issueTokens(user, refreshStore);

    res.status(201).json({ ...tokens, role: user.role });
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

    const tokens = await issueTokens(user, refreshStore);
    res.status(200).json({ ...tokens, role: user.role });
  });

  // POST /auth/refresh — 회전: 활성 확인 → 새 access+refresh 발급 → 이전 jti revoke.
  //   재사용(이미 revoke 된 jti)은 401(탐지). 응답에 새 refreshToken 동반.
  router.post('/refresh', async (req, res) => {
    const { refreshToken } = (req.body ?? {}) as Record<string, unknown>;

    if (!isNonEmptyString(refreshToken)) {
      res.status(400).json({ error: 'missing_refresh_token' });
      return;
    }

    let sub: string;
    let jti: string;
    try {
      ({ sub, jti } = verifyRefresh(refreshToken));
    } catch {
      res.status(401).json({ error: 'invalid_refresh_token' });
      return;
    }

    // 회전 핵심: 제출된 jti 가 현재 활성이어야 한다(재사용/폐기 토큰 거부).
    if (!(await refreshStore.isActive(jti))) {
      res.status(401).json({ error: 'invalid_refresh_token' });
      return;
    }

    // sub로 현재 role 재조회(역할 변경 반영).
    const user = await repo.findById(sub);
    if (!user) {
      res.status(401).json({ error: 'invalid_refresh_token' });
      return;
    }

    // 새 토큰 1쌍 발급 후 이전 jti 폐기(회전 완료).
    const tokens = await issueTokens(user, refreshStore);
    await refreshStore.revoke(jti);

    res.status(200).json(tokens);
  });

  // POST /auth/logout — 제출된 refresh jti 를 폐기(이후 회전 불가).
  router.post('/logout', async (req, res) => {
    const { refreshToken } = (req.body ?? {}) as Record<string, unknown>;

    if (!isNonEmptyString(refreshToken)) {
      res.status(400).json({ error: 'missing_refresh_token' });
      return;
    }

    try {
      const { jti } = verifyRefresh(refreshToken);
      await refreshStore.revoke(jti);
    } catch {
      // 위조/만료 토큰은 조용히 통과(로그아웃은 멱등 — 항상 204).
    }

    res.status(204).end();
  });

  return router;
}
