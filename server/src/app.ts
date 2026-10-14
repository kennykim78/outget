import express, { type Express } from 'express';
import { createAuthRouter } from './auth/auth.routes.js';
import { requireAuth, requireRole } from './auth/auth.middleware.js';
import { makeVetRoutes } from './vet/vet.routes.js';
import { createVetReportRouter } from './vet/vet.report.routes.js';
import { createReactionRouter } from './reaction/reaction.routes.js';
import { makeInMemoryRepos, type Repos } from './db/repos.js';
import { securityHeaders } from './middleware/security-headers.js';
import { errorHandler } from './middleware/error-handler.js';
import { mountSpa } from './middleware/spa.js';
import { makeCors, parseAllowedOrigins } from './middleware/cors.js';
import { makeAppLimiters } from './middleware/rate-limit.js';
import { assertJwtSecrets, parseTrustProxy } from './config/env.js';
import { makeEventsRoutes } from './analytics/events.routes.js';
import { resolveSaveConfig, type SaveConfig } from './save/config.js';
import { createMagicRouter } from './save/magic.routes.js';
import { createSaveRouter } from './save/save.routes.js';
import type { Clock } from './save/session.js';

// 자체 본문 파서를 쓰는 경로는 전역 JSON 파서에서 제외한다(Express 라우팅은 대소문자 무시 — 동일하게 맞춘다).
//   POST /api/events: text/plain sendBeacon + JSON, ≤16KB.  PUT /api/save: JSON 만, ≤32KB(C-R5-2).
//   POST·DELETE /api/reactions: ≤1KB(C-R5-3).  POST /api/vets/reports: ≤2KB(C-R5-4).
//   (전역 파서가 먼저 읽으면 라우터 상한이 우회된다 — 여기서 빼야 각 상한이 실제로 걸린다.)
const SELF_PARSED_PATH = /^\/api\/(events|save|reactions|vets\/reports)\/?$/i;

// thin Express 앱. 모든 영속 결정은 주입된 Repos 한 곳으로 모인다(DI 컴포지션 루트).
//   기본 인자 makeInMemoryRepos() → 테스트가 createApp() 무인자로 인메모리에서 통과.
//   index.ts 만 createApp(makePrismaRepos(prisma)) 로 SQLite 영속 경로를 켠다.
// 결제·정산 코드 없음(불변식 4).
export interface CreateAppOptions {
  /** 지정 시 NODE_ENV 와 무관하게 SPA 정적 서빙을 이 디렉터리로 마운트(테스트용). 기본: production 에서만 기본 경로. */
  clientDist?: string;
  /** 저장(매직링크·세션, C-R5-2). config 미지정 시 process.env 에서 해석 — production 잘못 설정이면 throw(fail-closed). */
  save?: { config?: SaveConfig; now?: Clock };
  /** IP 리미터 on/off. 기본: NODE_ENV !== 'test'. 리미터 테스트는 true 로 켠다. 앱마다 새 인스턴스. */
  rateLimits?: boolean;
  /** 반응 익명 키 시크릿(C-R5-3, K3). 기본: env REACTION_KEY_SECRET·NODE_ENV — production 에서 없거나 32자 미만이면 throw. */
  reaction?: { secret?: string; nodeEnv?: string };
  /** 병원 제보 treats 허용 동물 id(노출 동물). 미지정 = 형식 검사만. index.ts 가 DB 에서 주입. */
  knownTypeIds?: ReadonlySet<string>;
  /** 반응 대상 허용 id(상품·SupplyItem·SetupBundle 합집합, SEC-3 L-7). 미지정 = 형식 검사만. index.ts 가 DB 에서 주입. */
  knownTargetIds?: ReadonlySet<string>;
  /** Express 'trust proxy' 정수 홉 수(SEC-3 M-2). 기본: env TRUST_PROXY(미설정 0) — true·비정수는 기동 throw. */
  trustProxy?: number;
}

export function createApp(repos: Repos = makeInMemoryRepos(), opts: CreateAppOptions = {}): Express {
  // 기동 시 1회: PUBLIC_ORIGIN·MAIL_TRANSPORT 해석. production 에서 PUBLIC_ORIGIN 없음·console 메일이면 여기서 throw.
  const saveConfig = opts.save?.config ?? resolveSaveConfig(process.env);
  const now: Clock = opts.save?.now ?? (() => new Date());
  const rateLimits = opts.rateLimits ?? process.env.NODE_ENV !== 'test';
  const limiters = makeAppLimiters(rateLimits);

  const app = express();

  // 프록시 홉 수만큼만 X-Forwarded-For 를 믿는다(0 = 무시). req.ip → 리미터·반응 익명 키의 IP.
  app.set('trust proxy', opts.trustProxy ?? parseTrustProxy(process.env));

  // 보안 헤더는 라우터·CORS 이전 초반에 — 모든 응답(에러 포함)에 일관 적용.
  app.use(securityHeaders);

  const jsonParser = express.json();
  app.use((req, res, next) => {
    if (SELF_PARSED_PATH.test(req.path)) {
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

  // 운영자 비밀번호 인증(login/refresh/logout, OPERATOR 전용 — D3). /auth/register 없음(M-C).
  //   refresh 는 HttpOnly 쿠키(L-H), JWT HS256 고정(L-I). 자격증명 대입 완화 auth 리미터.
  app.post(['/auth/login', '/auth/refresh'], limiters.auth);
  // 가벼운 읽기 리미터(SEC-3 L-7) — 세션 조회·저장 조회·반응 수.
  app.get(['/auth/session', '/api/save', '/api/reactions/counts'], limiters.read);
  app.use('/auth', createAuthRouter(repos.user, repos.refreshStore, { secureCookie: saveConfig.secureCookie }));

  // 저장 연결(매직링크 → 불투명 세션 쿠키, D1·D2·D19·D20). 결제·위치 없음(불변식 ④⑧).
  //   IP 리밋: request 5/15분(C-R5-2), verify 20/15분. 이메일별 3/시간은 라우터 안(EmailThrottle).
  app.post('/auth/magic/request', limiters.magic);
  app.post('/auth/magic/verify', limiters.magicVerify);
  app.use(
    '/auth',
    createMagicRouter({
      users: repos.user,
      tokens: repos.magicToken,
      sessions: repos.session,
      config: saveConfig,
      now,
    }),
  );

  // 일반 쓰기 throttle: /api 의 변경 메서드(POST/PUT/PATCH/DELETE)에만 write 리미터.
  //   읽기(GET/HEAD)는 영향 없음. 경로별로 더 엄격한 리미터는 각 마운트 지점에서 추가.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    limiters.write(req, res, next);
  });

  // R5 D4: Outget 알림(/api/notifications)·신고(/api/reports) 라우터 언마운트 — 소스·모델은 유지(재사용 판단은 후속).

  // 저장 스냅샷(세션 필수, 검증된 SaveV1 만, 병합 없음 — D5). 좌표·지역·이메일·토큰 키 거부(불변식 ⑧).
  app.put('/api/save', limiters.save);
  app.use('/api/save', createSaveRouter({ sessions: repos.session, snapshots: repos.saveSnapshot, now }));

  // 익명 반응(C-R5-3, D8·D9, SEC-3 M-3): anonKey = HMAC(시크릿, 서울 날짜|IP 접두) — 접두는 IPv4 /24·IPv6 /64,
  //   UA 미사용, 400일 창. 원문 IP 저장 0. 변경 분당 20/IP. LIKE 만 10 이상 수 공개.
  //   대상은 knownTargetIds(노출 상품·SupplyItem·Bundle 상위집합) 밖이면 400(L-7). 노출·정렬·엔진은 반응을 읽지 않는다(불변식 ③).
  app.use(
    '/api/reactions',
    createReactionRouter(repos.reaction, {
      limiter: limiters.reaction,
      secret: opts.reaction?.secret ?? process.env.REACTION_KEY_SECRET,
      nodeEnv: opts.reaction?.nodeEnv ?? process.env.NODE_ENV,
      knownTargetIds: opts.knownTargetIds,
    }),
  );

  // 병원 제보(C-R5-4, D15): 저장만(REPORTED·USER_REPORT·좌표 없음), 비노출. 시간당 5/IP.
  //   /api/vets 읽기 라우터(/:id)보다 먼저 마운트한다.
  app.use(
    '/api/vets/reports',
    createVetReportRouter(repos.vet, { limiter: limiters.vetReport, knownTypeIds: opts.knownTypeIds }),
  );

  // 특수동물 진료 병원 — 읽기 전용, VERIFIED 만 노출(불변식 7).
  app.use('/api/vets', makeVetRoutes(repos.vet));

  // 익명 이벤트 수집(PRD US-018) — 쓰기 전용, 204. IP·UA 저장 없음. test env 에서는 리밋 패스스루.
  app.use(
    '/api/events',
    makeEventsRoutes(repos.event, {
      limiter: rateLimits ? limiters.events : undefined,
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

  // SEC-3 L-5: 운영(development·test 외)에서 JWT 시크릿 32자 미만이면 기동 실패. 라우터 구성 뒤(다른 fail-closed 검사 우선).
  assertJwtSecrets(process.env);

  // 모든 라우터·미들웨어 뒤 맨 마지막: 4-arity 에러핸들러.
  //   CORS 거부 throw → 403 JSON, 그 외 → 500 JSON(스택 미노출).
  app.use(errorHandler);

  return app;
}
