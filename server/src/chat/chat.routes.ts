// Epic 5 인앱 채팅 라우터 — 증빙·고지·신고 동선의 허브.
//   GET  /api/matches/:id/messages  (당사자) — 스레드 메시지 조회.
//   POST /api/matches/:id/messages  (당사자) — 메시지 작성(senderId 서버 강제).
//
// 인가: requireAuth + **당사자 인가**. match.findById 없으면 404,
//   req.user.sub 가 buyerId/agentId 가 아니면 403. senderId 는 서버가 강제한다.
// 불변식 ②: 메시지에 금액·결제 필드 0(검증에서 거부). 불변식 ⑤: 좌표 키 0.
// 외부 fetch 0: 자사 인메모리 리포지토리만 사용한다.
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { isParticipant, type MatchRepository } from '../agent/match.repo.js';
import type { MessageRepository } from './message.repo.js';
import { validateMessageInput } from './message.validation.js';

export function createChatRouter(
  matchRepo: MatchRepository,
  messageRepo: MessageRepository,
): Router {
  const router = Router();

  // 메시지 조회 — 당사자만.
  router.get('/matches/:id/messages', requireAuth, async (req, res) => {
    const match = await matchRepo.findById(req.params.id);
    if (!match) {
      res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
      return;
    }
    if (!isParticipant(match, req.user!.sub)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const messages = await messageRepo.listByThread(match.chatThreadId);
    res.status(200).json(messages);
  });

  // 메시지 작성 — 당사자만. senderId 는 JWT sub 로 서버 강제(클라가 정하지 못한다).
  router.post('/matches/:id/messages', requireAuth, async (req, res) => {
    const match = await matchRepo.findById(req.params.id);
    if (!match) {
      res.status(404).json({ error: '매칭을 찾을 수 없습니다.' });
      return;
    }
    if (!isParticipant(match, req.user!.sub)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const result = validateMessageInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const saved = await messageRepo.append(
      match.chatThreadId,
      req.user!.sub, // senderId 서버 강제.
      result.value.body,
    );
    res.status(201).json(saved);
  });

  return router;
}
