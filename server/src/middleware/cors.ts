// CORS — JSON 엔드포인트(/api·/auth·/admin·/health)에만 건다(app.ts). 정적 자산·SPA HTML 은 대상 밖:
//   Vite 빌드의 <script type=module crossorigin> 은 동일 오리진에서도 Origin 헤더를 보내므로,
//   여기에 걸면 CORS_ORIGIN 미설정 배포에서 /assets/* 가 403 → 빈 화면이 된다(QA S0).
//   CORS 미들웨어가 없는 경로는 ACAO 헤더가 없으니 교차 오리진 읽기는 브라우저가 그대로 막는다.
//
// 허용 규칙(fail-closed):
//   ① Origin 없음(동일 오리진 GET·curl) → 허용
//   ② Origin ∈ CORS_ORIGIN 허용목록 → 허용
//   ③ 동일 오리진: Origin 의 host[:port] == 요청 Host 헤더(원문, X-Forwarded-Host 미사용) 이고
//      scheme == req.protocol(trust proxy 미설정이면 X-Forwarded-Proto 무시) 또는 Origin=https·req.protocol=http
//      (TLS 종단 프록시 뒤). 브라우저는 교차 오리진 요청에 Host 를 대상 서버로, Origin 을 원 페이지로 채우므로
//      둘이 같다는 것은 동일 오리진 요청이라는 뜻이다(브라우저가 아닌 클라이언트는 CORS 대상이 아님).
//   그 외 → Error('Not allowed by CORS') → errorHandler 403 cors_forbidden(기존 의미 유지).
import cors from 'cors';
import type { Request, RequestHandler } from 'express';

export const CORS_REJECT_MESSAGE = 'Not allowed by CORS';

export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Origin 이 이 요청 자신의 오리진인가(Host 헤더 원문 + req.protocol 기준). */
export function isSameOrigin(req: Request, origin: string): boolean {
  const host = req.get('host');
  if (!host) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false; // 경로·자격증명 등이 붙은 비정상 Origin 거부
  if (u.host.toLowerCase() !== host.toLowerCase()) return false;
  const scheme = u.protocol.replace(/:$/, '');
  return scheme === req.protocol || (scheme === 'https' && req.protocol === 'http');
}

export function makeCors(allowed: readonly string[]): RequestHandler {
  return cors((req, callback) => {
    const origin = req.headers.origin;
    if (!origin || allowed.includes(origin) || isSameOrigin(req as Request, origin)) {
      callback(null, { origin: true });
      return;
    }
    callback(new Error(CORS_REJECT_MESSAGE));
  });
}
