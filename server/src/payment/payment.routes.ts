// Epic 5 거래방식·외부 안전결제 안내 라우터(자금 미경유).
//   POST /api/matches/:id/deal-method      (당사자) — 거래방식 라벨 설정.
//   GET  /api/matches/:id/payment-guidance (당사자) — 안내 텍스트 조회.
//
// 인가: requireAuth + **당사자 인가**(buyer/agent 만). 없는 매칭이면 404, 비당사자면 403.
// 불변식 ②(생존조건): 금액 0 · 자금 0 · 정산/예치 처리 0. dealMethod 는 라벨일 뿐이다.
//   payment-guidance 는 PaymentRail 의 **안내 텍스트**만 반환한다(딥링크/URL 아님).
// 외부 fetch 0: GuidancePaymentRail 은 외부 호출/키 없이 고정 안내만 반환한다.
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { isParticipant, type MatchRepository } from '../agent/match.repo.js';
import type { PaymentRail } from './payment.rail.js';
import type { DealMethod } from './payment.types.js';

const DEAL_METHODS: readonly DealMethod[] = ['직접', '안전결제'];

function isDealMethod(x: unknown): x is DealMethod {
  return typeof x === 'string' && (DEAL_METHODS as readonly string[]).includes(x);
}

export function createPaymentRouter(
  matchRepo: MatchRepository,
  rail: PaymentRail,
): Router {
  const router = Router();

  // 거래방식 라벨 설정 — 당사자만. 자금 흐름 아님(라벨 저장만).
  router.post('/matches/:id/deal-method', requireAuth, async (req, res) => {
    const match = await matchRepo.findById(req.params.id);
    if (!match) {
      res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
      return;
    }
    if (!isParticipant(match, req.user!.sub)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const dealMethod = (req.body as { dealMethod?: unknown })?.dealMethod;
    if (!isDealMethod(dealMethod)) {
      res.status(400).json({ error: "dealMethod 는 '직접' 또는 '안전결제' 여야 합니다." });
      return;
    }
    const updated = await matchRepo.setDealMethod(match.id, dealMethod);
    if (!updated) {
      res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
      return;
    }
    res.status(200).json({ id: updated.id, dealMethod: updated.dealMethod });
  });

  // 결제 안내 — 당사자만. 안내 텍스트만(자금 미경유, 딥링크 아님).
  router.get('/matches/:id/payment-guidance', requireAuth, async (req, res) => {
    const match = await matchRepo.findById(req.params.id);
    if (!match) {
      res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
      return;
    }
    if (!isParticipant(match, req.user!.sub)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const guidance = await rail.createCheckoutLink({ matchId: match.id });
    res.status(200).json(guidance);
  });

  return router;
}
