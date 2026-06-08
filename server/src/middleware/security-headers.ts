import type { RequestHandler } from 'express';

// 수동 보안 헤더 미들웨어(API 전용, 정적 자산·HTML 미서빙).
//   - X-Content-Type-Options: nosniff      → MIME 스니핑 차단.
//   - Referrer-Policy: no-referrer         → 리퍼러 유출 차단.
//   - X-Frame-Options: DENY                → 클릭재킹 차단(프레임 금지).
//   - Content-Security-Policy: default-src 'none'
//       JSON API 만 응답하므로 어떤 리소스 출처도 필요 없음(최소 권한).
//   HSTS 는 TLS 종단 프록시(리버스 프록시/로드밸런서)가 담당 — 여기서 설정하지 않는다.
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
};
