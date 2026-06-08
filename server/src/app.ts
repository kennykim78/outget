import express, { type Express } from 'express';
import cors from 'cors';
import { createAuthRouter } from './auth/auth.routes.js';
import { requireAuth, requireRole } from './auth/auth.middleware.js';
import { createListingsRouter } from './board/listings.routes.js';
import { InMemoryListingsRepository } from './board/listings.repo.js';

// thin Express 앱. auth(역할 기반 JWT)는 Story 1.3, 결제 로직은 없음(Epic 5 외부 비수탁).
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // CORS: env 화이트리스트만. 미설정 시 허용 오리진 없음(closed by default).
  const allowed = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, callback) {
        // origin 없음 = same-origin/curl 등 → 허용
        if (!origin || allowed.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // 인증 라우터(register/login/refresh).
  app.use('/auth', createAuthRouter());

  // 읽기 전용 보드(대행자/역경매요청/할인소식) — Epic 2.
  app.use('/api', createListingsRouter(new InMemoryListingsRepository()));

  // 보호 라우트 시연: 로그인 사용자 자신의 클레임.
  app.get('/auth/me', requireAuth, (req, res) => {
    res.status(200).json({ sub: req.user!.sub, role: req.user!.role });
  });

  // 운영자 전용 라우트 시연.
  app.get('/admin/ping', requireAuth, requireRole('운영자'), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return app;
}
