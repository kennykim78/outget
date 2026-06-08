// Epic 3 대행자 프로필 쓰기 + 매칭 진입 라우터.
//   POST/PUT /api/agent-profile (개인대행자/전문대행자) — 지위 분기 검증 후 upsert.
//   GET  /api/agent-profile/me  (인증) — 자신의 프로필 조회.
//   POST /api/matches           (구매자) — 매칭 레코드 + 채팅 진입(placeholder).
//
// 불변식 ②(자금 미보유): 매칭은 chatThreadId 발급까지만 — 자금 흐름 미경유.
// 불변식 ⑤: 사용자 위경도 수신/추적 0. lat/lng 는 선택 매장 앵커일 뿐.
// 외부 fetch 0: 사업자번호는 형식만 검증(진위 API 호출 없음).
// 응답에서 ownerUserId 는 절대 노출하지 않는다(toPublicProfile).
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type { AgentProfileRepository } from './agent.repo.js';
import type { MatchRepository } from './match.repo.js';
import { toPublicProfile, validateAgentInput } from './agent.validation.js';

export function createAgentRouter(
  agentRepo: AgentProfileRepository,
  matchRepo: MatchRepository,
): Router {
  const router = Router();

  // 작성/수정 공통 핸들러(upsertByOwner 가 신규/갱신을 함께 처리).
  const upsert = [
    requireAuth,
    requireRole('개인대행자', '전문대행자'),
    async (req: import('express').Request, res: import('express').Response) => {
      const result = validateAgentInput(req.body, req.user!.role);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      const saved = await agentRepo.upsertByOwner(req.user!.sub, result.value);
      res.status(200).json(toPublicProfile(saved));
    },
  ] as const;

  router.post('/agent-profile', ...upsert);
  router.put('/agent-profile', ...upsert);

  router.get('/agent-profile/me', requireAuth, async (req, res) => {
    const found = await agentRepo.findByOwner(req.user!.sub);
    if (!found) {
      res.status(404).json({ error: '프로필이 없습니다.' });
      return;
    }
    res.status(200).json(toPublicProfile(found));
  });

  // 매칭 진입 — 구매자만. 채팅 본체는 Epic 5(여기선 thread 식별자만 발급).
  router.post('/matches', requireAuth, requireRole('구매자'), async (req, res) => {
    const agentId = (req.body as { agentId?: unknown })?.agentId;
    if (typeof agentId !== 'string' || agentId.trim().length === 0) {
      res.status(400).json({ error: 'agentId 가 필요합니다.' });
      return;
    }
    const match = await matchRepo.createMatch(agentId.trim(), req.user!.sub);
    res.status(201).json({
      id: match.id,
      chatThreadId: match.chatThreadId,
      status: match.status,
    });
  });

  return router;
}
