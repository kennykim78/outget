// Epic 9 공동대행 슬롯 라우터.
//   POST /api/group-slots          (개인대행자/전문대행자) — 개설. agentId=req.user.sub 강제.
//   POST /api/group-slots/:id/join (구매자) — 참여. 정원 초과 시 409.
//   GET  /api/group-slots          (인증) — 슬롯 목록.
//
// 불변식 ②(무금전): 슬롯에 금액·결제·정산 필드 0. join 은 인원 카운트만 증가시킨다.
// 불변식 ⑤: region/scheduleText 는 텍스트만(좌표 수신 0, 검증에서 거부).
// 외부 fetch 0: 자사 리포지토리만.
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type { GroupSlotRepository } from './groupslot.repo.js';
import { validateGroupSlotInput } from './groupslot.validation.js';

export function createGroupSlotRouter(slotRepo: GroupSlotRepository): Router {
  const router = Router();

  // 개설 — 대행자만. agentId 는 토큰 sub 로 강제(클라가 못 정함).
  router.post(
    '/group-slots',
    requireAuth,
    requireRole('개인대행자', '전문대행자'),
    async (req, res) => {
      const result = validateGroupSlotInput(req.body);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      const saved = await slotRepo.create(req.user!.sub, result.value);
      res.status(201).json(saved);
    },
  );

  // 목록 — 인증 전원.
  router.get('/group-slots', requireAuth, async (_req, res) => {
    const all = await slotRepo.listAll();
    res.status(200).json(all);
  });

  // 참여 — 구매자만. 정원 초과/마감이면 409, 없는 슬롯이면 404.
  router.post(
    '/group-slots/:id/join',
    requireAuth,
    requireRole('구매자'),
    async (req, res) => {
      const result = await slotRepo.join(req.params.id);
      if (!result.ok) {
        if (result.reason === '없음') {
          res.status(404).json({ error: '슬롯을 찾을 수 없습니다.' });
          return;
        }
        res.status(409).json({ error: '정원이 마감되었습니다.' });
        return;
      }
      res.status(200).json(result.slot);
    },
  );

  return router;
}
