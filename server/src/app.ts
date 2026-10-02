import express, { type Express } from 'express';
import { createAuthRouter } from './auth/auth.routes.js';
import { requireAuth, requireRole } from './auth/auth.middleware.js';
import { createNotificationRouter } from './notification/notification.routes.js';
import { createReportRouter } from './governance/report.routes.js';
import { makeVetRoutes } from './vet/vet.routes.js';
import { makeInMemoryRepos, type Repos } from './db/repos.js';
import { securityHeaders } from './middleware/security-headers.js';
import { errorHandler } from './middleware/error-handler.js';
import { mountSpa } from './middleware/spa.js';
import { makeCors, parseAllowedOrigins } from './middleware/cors.js';
import { authLimiter, writeLimiter, reportLimiter } from './middleware/rate-limit.js';
import { makeEventsLimiter, makeEventsRoutes } from './analytics/events.routes.js';

// POST /api/events 는 자체 본문 파서(text/plain sendBeacon + JSON, ≤16KB)를 쓴다 — 전역 JSON 파서 제외.
const EVENTS_PATH = /^\/api\/events\/?$/i; // Express 라우팅은 대소문자 무시 — 동일하게 맞춘다

// thin Express 앱. 모든 영속 결정은 주입된 Repos 한 곳으로 모인다(DI 컴포지션 루트).
//   기본 인자 makeInMemoryRepos() → 테스트가 createApp() 무인자로 인메모리에서 통과.
//   index.ts 만 createApp(makePrismaRepos(prisma)) 로 SQLite 영속 경로를 켠다.
// 결제·정산 코드 없음(불변식 4).
export interface CreateAppOptions {
  /** 지정 시 NODE_ENV 와 무관하게 SPA 정적 서빙을 이 디렉터리로 마운트(테스트용). 기본: production 에서만 기본 경로. */
  clientDist?: string;
}

export function createApp(repos: Repos = makeInMemoryRepos(), opts: CreateAppOptions = {}): Express {
  const app = express();

  // 보안 헤더는 라우터·CORS 이전 초반에 — 모든 응답(에러 포함)에 일관 적용.
  app.use(securityHeaders);

  const jsonParser = express.json();
  app.use((req, res, next) => {
    if (EVENTS_PATH.test(req.path)) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  // CORS: JSON 엔드포인트에만. Origin 없음·CORS_ORIGIN 허용목록·동일 오리진(Host 원문 기준)만 허용, 그 외 403.
  //   정적 자산·SPA HTML 은 대상 밖 — Vite crossorigin 자산이 CORS_ORIGIN 미설정 배포에서 403 되던 결함(QA S0).
  //   상세 규칙은 middleware/cors.ts.
  app.use(['/api', '/auth', '/admin', '/health'], makeCors(parseAllowedOrigins(process.env.CORS_ORIGIN)));

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // 인증 라우터(register/login/refresh/logout). user repo + refresh 회전 store 주입.
  //   로그인·가입에 authLimiter(자격증명 대입 완화). test env 에서는 no-op.
  app.use(['/auth/login', '/auth/register'], authLimiter);
  app.use('/auth', createAuthRouter(repos.user, repos.refreshStore));

  // 일반 쓰기 throttle: /api 의 변경 메서드(POST/PUT/PATCH/DELETE)에만 writeLimiter 적용.
  //   읽기(GET/HEAD)는 영향 없음. 더 엄격한 reportLimiter 는 해당 경로에 별도 적용.
  //   test env 에서는 writeLimiter 가 no-op 이라 통과.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    writeLimiter(req, res, next);
  });

  // 알림(자사 폴링).
  app.use('/api', createNotificationRouter(repos.notification));

  // 신고→블라인드(notice-and-takedown). 신고 생성에 reportLimiter. test env 에서는 no-op.
  app.post('/api/reports', reportLimiter);
  app.use('/api', createReportRouter(repos.report, repos.notification));

  // 특수동물 진료 병원 — 읽기 전용, VERIFIED 만 노출(불변식 7).
  app.use('/api/vets', makeVetRoutes(repos.vet));

  // 익명 이벤트 수집(PRD US-018) — 쓰기 전용, 204. IP·UA 저장 없음. test env 에서는 리밋 패스스루.
  app.use(
    '/api/events',
    makeEventsRoutes(repos.event, {
      limiter: process.env.NODE_ENV === 'test' ? undefined : makeEventsLimiter(),
    }),
  );

  // 보호 라우트 시연: 로그인 사용자 자신의 클레임.
  app.get('/auth/me', requireAuth, (req, res) => {
    res.status(200).json({ sub: req.user!.sub, role: req.user!.role });
  });

  // 운영자 전용 라우트 시연.
  app.get('/admin/ping', requireAuth, requireRole('OPERATOR'), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // 프로덕션 동일 오리진 배포: 모든 라우터 뒤·errorHandler 직전에 SPA 정적 서빙 마운트.
  //   /api·/auth·/health 는 위에서 라우팅되어 SPA fallback 에 도달하지 않는다.
  //   테스트(non-prod)는 미마운트 → /no-such-route 404·CSP default-src 'none' 동작 보존.
  if (opts.clientDist !== undefined) {
    mountSpa(app, { clientDist: opts.clientDist });
  } else if (process.env.NODE_ENV === 'production') {
    mountSpa(app);
  }

  // 모든 라우터·미들웨어 뒤 맨 마지막: 4-arity 에러핸들러.
  //   CORS 거부 throw → 403 JSON, 그 외 → 500 JSON(스택 미노출).
  app.use(errorHandler);

  return app;
}
