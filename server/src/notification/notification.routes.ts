// Epic 4 알림 라우터.
//   GET /api/notifications (인증) — 자신의 알림만 반환(자사 폴링).
// 외부 fetch 0: 자사 /api 만. 사용자는 자신의 것만 조회한다(타인 알림 노출 0).
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import type { NotificationRepository } from './notification.repo.js';

export function createNotificationRouter(repo: NotificationRepository): Router {
  const router = Router();

  router.get('/notifications', requireAuth, async (req, res) => {
    const items = await repo.listByUser(req.user!.sub);
    res.status(200).json(items);
  });

  return router;
}
