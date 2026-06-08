// Epic 7 신원정보 최소 제공(통신판매중개 최소 의무) 라우터.
//   POST /api/disputes/:matchId/identity-request  (당사자) — 상대 당사자 최소 신원정보 + 감사기록.
//
// 통신판매중개 최소 의무: 분쟁 시 거래 당사자에게 상대의 최소 신원정보를 제공한다.
//   전문 대행자 = 상호/사업자번호/연락처(공개 정보), 개인 = 표시명/연락채널 마스킹.
//   직접거래 계약 이행은 추적하지 않는다(자금/완료 추적 0, 불변식 ②).
// 불변식 ⑤: 좌표 0(신원정보에 위경도 없음). 외부 fetch 0(자사 리포지토리만).
// 인가: requireAuth + 당사자(isParticipant)만. 제3자는 403(fail-closed).
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { isParticipant, type MatchRepository } from '../agent/match.repo.js';
import type { AgentProfileRepository } from '../agent/agent.repo.js';
import type { DisputeRepository } from './dispute.repo.js';

// 개인 신원 마스킹 — 연락채널/식별자를 부분 마스킹한다(전체 노출 금지).
function maskTail(value: string): string {
  const v = value.trim();
  if (v.length <= 2) return '**';
  return v.slice(0, 2) + '*'.repeat(Math.max(2, v.length - 2));
}

export function createIdentityRouter(
  matchRepo: MatchRepository,
  agentRepo: AgentProfileRepository,
  disputeRepo: DisputeRepository,
): Router {
  const router = Router();

  router.post(
    '/disputes/:matchId/identity-request',
    requireAuth,
    async (req, res) => {
      const match = await matchRepo.findById(req.params.matchId);
      if (!match) {
        res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
        return;
      }
      // 당사자만(요청자가 buyer/agent 중 하나여야 한다). 아니면 403.
      if (!isParticipant(match, req.user!.sub)) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      // 상대 당사자 식별.
      const counterpartId =
        match.buyerId === req.user!.sub ? match.agentId : match.buyerId;

      // 상대가 전문 대행자 프로필을 가졌으면 사업자 정보(공개), 아니면 개인 마스킹.
      const profile = await agentRepo.findByOwner(counterpartId);
      let identity: Record<string, string>;
      if (profile && profile.status === '전문') {
        identity = {
          kind: '전문',
          bizName: profile.bizName ?? '',
          bizNo: profile.bizNo ?? '',
          contact: profile.contact ?? '',
        };
      } else {
        // 개인(비사업자) — 표시명/연락채널 마스킹.
        identity = {
          kind: '개인',
          displayName: maskTail(counterpartId),
          contact: profile?.contact ? maskTail(profile.contact) : '채팅(인앱)',
        };
      }

      // 감사기록(누가 누구의 신원을 어떤 맥락에서 요청했는지). 개인정보 본문은 남기지 않는다.
      await disputeRepo.appendAudit(
        match.id,
        req.user!.sub,
        '신원정보요청',
        `요청자 ${maskTail(req.user!.sub)} → 상대(${identity.kind}) 최소 신원정보 제공`,
      );

      res.status(200).json(identity);
    },
  );

  return router;
}
