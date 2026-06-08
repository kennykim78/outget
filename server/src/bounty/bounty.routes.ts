// Epic 8 바운티(무금전) 라우터.
//   POST /api/bounties                  (구매자/운영자) — 바운티 발주. status='모집' 서버 강제.
//   POST /api/bounties/:id/submissions  (인증 전원) — 제출. 자기 바운티 제출 차단.
//   GET  /api/bounties                  (인증) — 바운티 목록(requesterId 미노출).
//   GET  /api/bounties/me               (인증) — 내가 발주한 바운티 목록.
//
// 불변식 ②(무금전·핵심): 제출 보상은 **뱃지·평판뿐**이다.
//   결제·정산·금전 코드 호출 0 — incrementReputation(+1)·badge.grant·notification 만 부른다.
// 불변식 ①: 외부 fetch 0(자사 리포지토리만). photo 외부 URL 은 검증에서 차단.
// 불변식 ⑤: 좌표 수신 0(검증에서 거부).
// 응답에서 requesterId·solverId 는 절대 노출하지 않는다(toPublic*).
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type { BountyRepository } from './bounty.repo.js';
import type { Bounty, BountySubmission } from './bounty.types.js';
import type { BadgeRepository } from '../badge/badge.repo.js';
import type { AgentProfileRepository } from '../agent/agent.repo.js';
import type { NotificationRepository } from '../notification/notification.repo.js';
import { validateBountyInput, validateSubmissionInput } from './bounty.validation.js';

// 무금전 기여 뱃지 종류(현장 확인 기여).
const BADGE_TYPE = '확인러';

// 응답용으로 requesterId 를 제거(노출 금지).
function toPublicBounty(b: Bounty): Omit<Bounty, 'requesterId'> {
  const { requesterId: _r, ...pub } = b;
  void _r;
  return pub;
}

// 응답용으로 solverId 를 제거(노출 금지).
function toPublicSubmission(s: BountySubmission): Omit<BountySubmission, 'solverId'> {
  const { solverId: _s, ...pub } = s;
  void _s;
  return pub;
}

export function createBountyRouter(
  bountyRepo: BountyRepository,
  badgeRepo: BadgeRepository,
  agentRepo: AgentProfileRepository,
  notificationRepo: NotificationRepository,
): Router {
  const router = Router();

  // 발주 — 구매자/운영자. status='모집' 은 리포지토리가 강제.
  router.post(
    '/bounties',
    requireAuth,
    requireRole('구매자', '운영자'),
    async (req, res) => {
      const result = validateBountyInput(req.body);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      const saved = await bountyRepo.create(req.user!.sub, result.value);
      res.status(201).json(toPublicBounty(saved));
    },
  );

  // 내가 발주한 바운티 — 본인 것만(requesterId 미노출).
  router.get('/bounties/me', requireAuth, async (req, res) => {
    const mine = await bountyRepo.listByRequester(req.user!.sub);
    res.status(200).json(mine.map(toPublicBounty));
  });

  // 바운티 목록 — 인증 전원. requesterId 미노출.
  router.get('/bounties', requireAuth, async (_req, res) => {
    const all = await bountyRepo.listAll();
    res.status(200).json(all.map(toPublicBounty));
  });

  // 제출 — 인증 전원. 자기 바운티 제출은 차단. 보상은 뱃지·평판뿐(무금전).
  router.post('/bounties/:id/submissions', requireAuth, async (req, res) => {
    const bounty = await bountyRepo.findById(req.params.id);
    if (!bounty) {
      res.status(404).json({ error: '바운티를 찾을 수 없습니다.' });
      return;
    }
    // 자기 바운티 자가 제출 차단(자기 평판/뱃지 셀프 부여 방지).
    if (bounty.requesterId === req.user!.sub) {
      res.status(403).json({ error: '자신이 발주한 바운티에는 제출할 수 없습니다.' });
      return;
    }
    const result = validateSubmissionInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    const solverSub = req.user!.sub;
    // 무금전 보상: 제출 시 항상 뱃지 부여(멱등)·기여 알림. 금전 처리 0.
    const submission = await bountyRepo.addSubmission(
      bounty.id,
      solverSub,
      result.value.photo,
      true,
    );
    await badgeRepo.grant(solverSub, BADGE_TYPE);
    // 제출자가 대행자 프로필을 보유하면 무금전 평판 +1(없으면 노옵).
    await agentRepo.incrementReputation(solverSub, 1);
    await notificationRepo.append(
      solverSub,
      'bounty_submission',
      bounty.id,
      `바운티 제출이 접수되어 '${BADGE_TYPE}' 뱃지를 받았습니다(무금전 보상).`,
    );

    res.status(201).json(toPublicSubmission(submission));
  });

  return router;
}
