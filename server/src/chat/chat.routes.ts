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
import type { ReportRepository } from '../governance/report.repo.js';
import { validateMessageInput } from './message.validation.js';

// 블라인드된 메시지 본문을 가리는 대체 문구(증거는 보존, 본문만 차단).
const BLINDED_BODY = '[신고로 블라인드된 메시지입니다]';

export function createChatRouter(
  matchRepo: MatchRepository,
  messageRepo: MessageRepository,
  reportRepo: ReportRepository,
): Router {
  const router = Router();

  // 메시지 조회 — 당사자만. 신고로 블라인드된 메시지는 본문을 대체 문구로 가린다(불변식 ③).
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
    const out = [];
    for (const m of messages) {
      const blinded = await reportRepo.isBlinded('message', m.id);
      out.push(blinded ? { ...m, body: BLINDED_BODY } : m);
    }
    res.status(200).json(out);
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
