// Epic 4 역경매 요청 쓰기/채택/확인가/거절 라우터.
//   POST /api/requests                 (구매자) — 요청 작성(status='대기' 서버 강제).
//   GET  /api/requests/me              (구매자) — 내 요청 목록(ownerUserId 미노출).
//   POST /api/requests/:id/adopt       (대행자) — 선착 채택 → 매칭 진입 + 알림.
//   POST /api/requests/:id/verified-price (대행자) — 현장 확인가 입력 + 알림.
//   POST /api/requests/:id/reject      (대행자) — 거절 알림(상태 유지).
//
// 불변식 ②(자금 미보유): 결제·자금 흐름 필드 0. 채택은 chatThreadId 발급까지만 —
//   소비자 → 외부 안전결제 → 대행자 직행이며 서버는 자금을 경유/추적하지 않는다.
// 불변식 ④: 확인가는 agentId·verifiedAt 동반(대행자 책임). platformPrice/ourPrice 0.
// 불변식 ⑤: 위치는 region 텍스트만(좌표 수신 0). 외부 fetch 0(자사 /api 만).
// 응답에서 ownerUserId 는 절대 노출하지 않는다(toPublicRequest).
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type { RequestRepository } from './request.repo.js';
import type { MatchRepository } from '../agent/match.repo.js';
import type { NotificationRepository } from '../notification/notification.repo.js';
import type { StoredRequest, VerifiedPrice } from './request.types.js';
import { validateRequestInput, validateVerifiedPrice } from './request.validation.js';

// 응답용으로 ownerUserId 를 제거(노출 금지).
function toPublicRequest(r: StoredRequest): Omit<StoredRequest, 'ownerUserId'> {
  const { ownerUserId: _omit, ...pub } = r;
  void _omit;
  return pub;
}

export function createRequestRouter(
  requestRepo: RequestRepository,
  matchRepo: MatchRepository,
  notificationRepo: NotificationRepository,
): Router {
  const router = Router();

  // 요청 작성 — 구매자만. status='대기' 는 리포지토리가 강제.
  router.post('/requests', requireAuth, requireRole('구매자'), async (req, res) => {
    const result = validateRequestInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const saved = await requestRepo.create(req.user!.sub, result.value);
    res.status(201).json(toPublicRequest(saved));
  });

  // 내 요청 목록 — 구매자만, 자신 것만. ownerUserId 미노출.
  router.get('/requests/me', requireAuth, requireRole('구매자'), async (req, res) => {
    const mine = await requestRepo.listByOwner(req.user!.sub);
    res.status(200).json(mine.map(toPublicRequest));
  });

  // 채택 — 대행자(개인/전문)만. 선착 1채택 → 매칭 진입 + 작성자 알림.
  router.post(
    '/requests/:id/adopt',
    requireAuth,
    requireRole('개인대행자', '전문대행자'),
    async (req, res) => {
      const found = await requestRepo.findById(req.params.id);
      if (!found) {
        res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        return;
      }
      // 매칭 레코드 발급(agentId=대행자 sub, buyerId=작성자, requestId 동반).
      const match = await matchRepo.createMatch(
        req.user!.sub,
        found.ownerUserId,
        found.id,
      );
      const adopted = await requestRepo.adopt(found.id, req.user!.sub, match.id);
      if (!adopted) {
        // 선착 경쟁에서 밀림(이미 비대기 상태) → 409.
        res.status(409).json({ error: '이미 채택된 요청입니다.' });
        return;
      }
      // 작성자에게 채택 알림(채팅 본체는 Epic 5).
      await notificationRepo.append(
        found.ownerUserId,
        '채택',
        found.id,
        '요청이 채택되었습니다. 채팅은 곧 제공됩니다(Epic5).',
      );
      res.status(200).json({
        matchId: match.id,
        chatThreadId: match.chatThreadId,
        status: adopted.status,
      });
    },
  );

  // 현장 확인가 — 대행자만. agentId·verifiedAt 동반(책임). 작성자 알림.
  router.post(
    '/requests/:id/verified-price',
    requireAuth,
    requireRole('개인대행자', '전문대행자'),
    async (req, res) => {
      const result = validateVerifiedPrice(req.body);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      const found = await requestRepo.findById(req.params.id);
      if (!found) {
        res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        return;
      }
      const vp: VerifiedPrice = {
        ...result.value,
        agentId: req.user!.sub,
        verifiedAt: new Date().toISOString(),
      };
      const updated = await requestRepo.setVerifiedPrice(found.id, vp);
      if (!updated) {
        res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        return;
      }
      await notificationRepo.append(
        found.ownerUserId,
        '확인가',
        found.id,
        '대행자가 현장 확인가를 입력했습니다.',
      );
      res.status(200).json(toPublicRequest(updated));
    },
  );

  // 거절 — 대행자만. 상태 유지(대기). 작성자 알림만.
  router.post(
    '/requests/:id/reject',
    requireAuth,
    requireRole('개인대행자', '전문대행자'),
    async (req, res) => {
      const found = await requestRepo.findById(req.params.id);
      if (!found) {
        res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
        return;
      }
      await requestRepo.reject(found.id);
      await notificationRepo.append(
        found.ownerUserId,
        '거절',
        found.id,
        '대행자가 요청을 거절했습니다.',
      );
      res.status(200).json(toPublicRequest(found));
    },
  );

  return router;
}
