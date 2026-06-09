import express, { type Express } from 'express';
import cors from 'cors';
import { createAuthRouter } from './auth/auth.routes.js';
import { requireAuth, requireRole } from './auth/auth.middleware.js';
import { createListingsRouter } from './board/listings.routes.js';
import { InMemoryListingsRepository } from './board/listings.repo.js';
import { createAgentRouter } from './agent/agent.routes.js';
import { createRequestRouter } from './request/request.routes.js';
import { createNotificationRouter } from './notification/notification.routes.js';
import { createChatRouter } from './chat/chat.routes.js';
import { GuidancePaymentRail } from './payment/guidance.rail.js';
import { createPaymentRouter } from './payment/payment.routes.js';
import { createDiscountRouter } from './board/discount.routes.js';
import { NaverShoppingPriceAdapter } from './shopping/naver.shopping.adapter.js';
import { NoopShoppingPriceAdapter } from './shopping/noop.shopping.adapter.js';
import type { ShoppingPriceRail } from './shopping/shopping.port.js';
import { createReportRouter } from './governance/report.routes.js';
import { createIdentityRouter } from './governance/identity.routes.js';
import { createBountyRouter } from './bounty/bounty.routes.js';
import { createGroupSlotRouter } from './groupslot/groupslot.routes.js';
import { makeInMemoryRepos, type Repos } from './db/repos.js';
import { securityHeaders } from './middleware/security-headers.js';
import { errorHandler } from './middleware/error-handler.js';
import { mountSpa } from './middleware/spa.js';
import {
  authLimiter,
  writeLimiter,
  reportLimiter,
  submitLimiter,
} from './middleware/rate-limit.js';

// thin Express 앱. 모든 영속 결정은 주입된 Repos 한 곳으로 모인다(DI 컴포지션 루트).
//   기본 인자 makeInMemoryRepos() → 테스트가 createApp() 무인자로 인메모리에서 통과.
//   index.ts 만 createApp(makePrismaRepos(prisma)) 로 SQLite 영속 경로를 켠다.
// auth(역할 기반 JWT)는 Story 1.3, 결제 로직은 없음(Epic 5 외부 비수탁).
export function createApp(repos: Repos = makeInMemoryRepos()): Express {
  const app = express();

  // 보안 헤더는 라우터·CORS 이전 초반에 — 모든 응답(에러 포함)에 일관 적용.
  app.use(securityHeaders);

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

  // 인증 라우터(register/login/refresh/logout). user repo + refresh 회전 store 주입.
  //   로그인/회원가입에 authLimiter(자격증명 대입 완화). test env 에서는 no-op.
  app.use(['/auth/login', '/auth/register'], authLimiter);
  app.use('/auth', createAuthRouter(repos.user, repos.refreshStore));

  // 일반 쓰기 throttle: /api 의 변경 메서드(POST/PUT/PATCH/DELETE)에만 writeLimiter 적용.
  //   읽기(GET/HEAD)는 영향 없음. 더 엄격한 reportLimiter/submitLimiter 는 위에서 선행 적용됨.
  //   test env 에서는 writeLimiter 가 no-op 이라 통과.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    writeLimiter(req, res, next);
  });

  // 읽기 전용 보드(대행자/역경매요청/할인소식) — Epic 2.
  //   동일 agent/request/discount/badge repo 주입 → GET /api/agents·/api/requests 에서
  //   시드 + 등록분 병합(별도 Prisma listings 클래스 없음 — 어댑터 재사용).
  app.use(
    '/api',
    createListingsRouter(
      new InMemoryListingsRepository(
        undefined,
        undefined,
        undefined,
        repos.agent,
        repos.request,
        repos.discount,
        repos.badge,
      ),
    ),
  );

  // Epic 3 대행자 프로필 쓰기 + 매칭 진입(자금 미경유, 채팅 본체 Epic 5). 뱃지 노출 포함.
  app.use('/api', createAgentRouter(repos.agent, repos.match, repos.badge));

  // Epic 4 역경매 요청 쓰기/채택/확인가/거절 + 알림(자금 미경유, 자사 폴링).
  app.use('/api', createRequestRouter(repos.request, repos.match, repos.notification));
  app.use('/api', createNotificationRouter(repos.notification));

  // Epic 5 채팅(당사자 인가, 블라인드 메시지 가림) + 거래방식/결제 안내(자금 미경유).
  //   결제 안내 레일(안내 모드)은 repo 가 아니므로 app 에서 직접 생성한다.
  const paymentRail = new GuidancePaymentRail();
  app.use('/api', createChatRouter(repos.match, repos.message, repos.report));
  app.use('/api', createPaymentRouter(repos.match, paymentRail));

  // Epic 6 할인소식(UGC) 쓰기(소식알림자/대행자/운영자) + 네이버쇼핑 검색(GET /api/shopping/search,
  //   searchLimiter 는 라우터 내부에서 부착) — 목록 GET 은 보드 라우터가 담당.
  //   네이버쇼핑 참고가 레일(불변식 ①·④): 두 env 키 존재 시 Naver 실어댑터(유일한 외부 fetch
  //   지점, search+confirm), 없으면 Noop(search→[]·confirm→null → 기존 '기준가 미확인' 폴백).
  //   대화형 검색→사용자 선택(productId)→서버 confirm 으로 두 가격 스탬프. paymentRail 선례대로
  //   app 에서 직접 생성한다(Repos 비포함 — 외부 호출 레일이지 영속 리포지토리가 아님).
  //   키는 서버 전용 env(VITE_ 접두사 금지 — 브라우저 노출 방지).
  const shoppingId = process.env.NAVER_SHOPPING_CLIENT_ID;
  const shoppingSecret = process.env.NAVER_SHOPPING_CLIENT_SECRET;
  const shoppingPort: ShoppingPriceRail =
    shoppingId && shoppingSecret
      ? new NaverShoppingPriceAdapter(shoppingId, shoppingSecret)
      : new NoopShoppingPriceAdapter();
  app.use('/api', createDiscountRouter(repos.discount, shoppingPort));

  // Epic 7 신고→블라인드(notice-and-takedown) + 신원정보 제공(통신판매중개 최소 의무).
  //   신고 생성에 reportLimiter(신고 폭주/괴롭힘 완화). test env 에서는 no-op.
  app.post('/api/reports', reportLimiter);
  app.use('/api', createReportRouter(repos.report, repos.discount, repos.notification));
  app.use('/api', createIdentityRouter(repos.match, repos.agent, repos.dispute));

  // Epic 8 무금전 바운티(제출→뱃지·평판만, 결제 코드 호출 0) + Epic 9 공동대행 슬롯(금액 0).
  //   바운티 제출에 submitLimiter(제출 도배 완화). test env 에서는 no-op.
  app.post('/api/bounties/:id/submissions', submitLimiter);
  app.use(
    '/api',
    createBountyRouter(repos.bounty, repos.badge, repos.agent, repos.notification),
  );
  app.use('/api', createGroupSlotRouter(repos.groupSlot));

  // 보호 라우트 시연: 로그인 사용자 자신의 클레임.
  app.get('/auth/me', requireAuth, (req, res) => {
    res.status(200).json({ sub: req.user!.sub, role: req.user!.role });
  });

  // 운영자 전용 라우트 시연.
  app.get('/admin/ping', requireAuth, requireRole('운영자'), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // 프로덕션 동일 오리진 배포: 모든 라우터 뒤·errorHandler 직전에 SPA 정적 서빙 마운트.
  //   /api·/auth·/health 는 위에서 라우팅되어 SPA fallback 에 도달하지 않는다.
  //   테스트(non-prod)는 미마운트 → /no-such-route 404·CSP default-src 'none' 동작 보존.
  if (process.env.NODE_ENV === 'production') {
    mountSpa(app);
  }

  // 모든 라우터·미들웨어 뒤 맨 마지막: 4-arity 에러핸들러.
  //   CORS 거부 throw → 403 JSON, 그 외 → 500 JSON(스택 미노출).
  app.use(errorHandler);

  return app;
}
