import express, { type Express } from 'express';
import cors from 'cors';
import { createAuthRouter } from './auth/auth.routes.js';
import { requireAuth, requireRole } from './auth/auth.middleware.js';
import { createListingsRouter } from './board/listings.routes.js';
import { InMemoryListingsRepository } from './board/listings.repo.js';
import { createAgentRouter } from './agent/agent.routes.js';
import { InMemoryAgentProfileRepository } from './agent/agent.repo.js';
import { InMemoryMatchRepository } from './agent/match.repo.js';
import { InMemoryRequestRepository } from './request/request.repo.js';
import { createRequestRouter } from './request/request.routes.js';
import { InMemoryNotificationRepository } from './notification/notification.repo.js';
import { createNotificationRouter } from './notification/notification.routes.js';
import { InMemoryMessageRepository } from './chat/message.repo.js';
import { createChatRouter } from './chat/chat.routes.js';
import { GuidancePaymentRail } from './payment/guidance.rail.js';
import { createPaymentRouter } from './payment/payment.routes.js';
import { InMemoryDiscountRepository } from './board/discount.repo.js';
import { createDiscountRouter } from './board/discount.routes.js';
import { InMemoryReportRepository } from './governance/report.repo.js';
import { createReportRouter } from './governance/report.routes.js';
import { InMemoryDisputeRepository } from './governance/dispute.repo.js';
import { createIdentityRouter } from './governance/identity.routes.js';
import { InMemoryBadgeRepository } from './badge/badge.repo.js';
import { InMemoryBountyRepository } from './bounty/bounty.repo.js';
import { createBountyRouter } from './bounty/bounty.routes.js';
import { InMemoryGroupSlotRepository } from './groupslot/groupslot.repo.js';
import { createGroupSlotRouter } from './groupslot/groupslot.routes.js';

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

  // Epic 3·4 쓰기 리포지토리(인메모리). 보드 읽기와 같은 인스턴스를 공유해 병합한다.
  const agentRepo = new InMemoryAgentProfileRepository();
  const matchRepo = new InMemoryMatchRepository();
  const requestRepo = new InMemoryRequestRepository();
  const notificationRepo = new InMemoryNotificationRepository();
  // Epic 5 채팅 메시지(인메모리) + 결제 안내 레일(안내 모드, 자금 미경유).
  const messageRepo = new InMemoryMessageRepository();
  const paymentRail = new GuidancePaymentRail();
  // Epic 6·7 할인소식(UGC) 쓰기 + 거버넌스(신고/블라인드/분쟁) 인메모리 리포지토리.
  const discountRepo = new InMemoryDiscountRepository();
  const reportRepo = new InMemoryReportRepository();
  const disputeRepo = new InMemoryDisputeRepository();
  // Epic 8 무금전 바운티·뱃지(평판은 agentRepo 누계) + Epic 9 공동대행 슬롯 인메모리 리포지토리.
  const badgeRepo = new InMemoryBadgeRepository();
  const bountyRepo = new InMemoryBountyRepository();
  const groupSlotRepo = new InMemoryGroupSlotRepository();

  // 읽기 전용 보드(대행자/역경매요청/할인소식) — Epic 2.
  // 동일 agentRepo·requestRepo 주입 → GET /api/agents·/api/requests 에서 시드 + 등록분 병합.
  app.use(
    '/api',
    createListingsRouter(
      new InMemoryListingsRepository(
        undefined,
        undefined,
        undefined,
        agentRepo,
        requestRepo,
        discountRepo,
        badgeRepo,
      ),
    ),
  );

  // Epic 3 대행자 프로필 쓰기 + 매칭 진입(자금 미경유, 채팅 본체 Epic 5). 뱃지 노출 포함.
  app.use('/api', createAgentRouter(agentRepo, matchRepo, badgeRepo));

  // Epic 4 역경매 요청 쓰기/채택/확인가/거절 + 알림(자금 미경유, 자사 폴링).
  app.use('/api', createRequestRouter(requestRepo, matchRepo, notificationRepo));
  app.use('/api', createNotificationRouter(notificationRepo));

  // Epic 5 채팅(당사자 인가, 블라인드 메시지 가림) + 거래방식/결제 안내(자금 미경유).
  app.use('/api', createChatRouter(matchRepo, messageRepo, reportRepo));
  app.use('/api', createPaymentRouter(matchRepo, paymentRail));

  // Epic 6 할인소식(UGC) 쓰기(소식알림자/대행자/운영자) — 목록 GET 은 보드 라우터가 담당.
  app.use('/api', createDiscountRouter(discountRepo));

  // Epic 7 신고→블라인드(notice-and-takedown) + 신원정보 제공(통신판매중개 최소 의무).
  app.use('/api', createReportRouter(reportRepo, discountRepo, notificationRepo));
  app.use('/api', createIdentityRouter(matchRepo, agentRepo, disputeRepo));

  // Epic 8 무금전 바운티(제출→뱃지·평판만, 결제 코드 호출 0) + Epic 9 공동대행 슬롯(금액 0).
  app.use(
    '/api',
    createBountyRouter(bountyRepo, badgeRepo, agentRepo, notificationRepo),
  );
  app.use('/api', createGroupSlotRouter(groupSlotRepo));

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
