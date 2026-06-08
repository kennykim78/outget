import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express, type RequestHandler } from 'express';

// SPA(클라이언트 빌드) 정적 서빙 — 동일 오리진 단일 컨테이너 배포 전용.
//   app.ts 에서 NODE_ENV==='production' 일 때만 mountSpa(app) 으로 마운트한다.
//   테스트(non-prod)는 미마운트 → hardening.test 의 404·CSP default-src 'none' 동작 보존.
//
// 불변식 ①(무크롤링·외부출처 최소): SPA HTML 응답 CSP 의 외부 허용 출처는
//   네이버 지도(oapi.map.naver.com / *.map.naver.com / *.pstatic.net) 뿐이다.
//   API/auth/health 응답은 securityHeaders 의 default-src 'none' 을 그대로 유지한다.

// client/dist 경로를 실행 위치에 견고하게 해석한다(ESM: import.meta.dirname / __dirname 대체).
//   - 로컬 prod: server/dist/middleware/spa.js → ../../../client/dist
//   - 도커 runtime: 복사 레이아웃에 맞춰 후보를 순차 탐색한다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveClientDist(): string {
  const candidates = [
    // 로컬: server/dist/middleware → repo/client/dist
    path.resolve(HERE, '../../../client/dist'),
    // server 작업 디렉터리 기준(npm -w server start)
    path.resolve(process.cwd(), '../client/dist'),
    // 도커 runtime: /app/client/dist (server dist 와 형제로 복사)
    path.resolve(HERE, '../../client/dist'),
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), './client/dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  // 못 찾으면 첫 후보를 반환(자산 없으면 fallback 핸들러가 처리).
  return candidates[0];
}

// SPA(HTML) 응답 전용 CSP — securityHeaders 의 default-src 'none' 을 덮어쓴다.
//   네이버 지도 JS SDK(script) + 지도 타일/이미지(img) + SDK 통신(connect)만 외부 허용.
const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self' https://oapi.map.naver.com 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.map.naver.com https://*.pstatic.net",
  "connect-src 'self' https://*.map.naver.com",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

// 정적 자산이 아닌, SPA 라우팅 대상이 되는 HTML GET 요청인지 판별.
//   /api·/auth·/health 는 app.ts 에서 이미 라우팅되어 여기(fallback)에 도달하지 않지만,
//   방어적으로 prefix 를 제외한다(혹시 라우터 미스 시에도 SPA HTML 을 API 경로에 주지 않음).
function isSpaHtmlRequest(reqPath: string): boolean {
  if (reqPath.startsWith('/api')) return false;
  if (reqPath.startsWith('/auth')) return false;
  if (reqPath.startsWith('/health')) return false;
  return true;
}

export function mountSpa(app: Express): void {
  const clientDist = resolveClientDist();
  const indexHtml = path.join(clientDist, 'index.html');

  // 정적 자산 서빙. index:false → 디렉터리 요청에 자동 index.html 응답 금지(아래 fallback 이 CSP 와 함께 처리).
  app.use(express.static(clientDist, { index: false }));

  // SPA fallback: 자산에 매칭되지 않은 GET(HTML 진입) → index.html + SPA 전용 CSP.
  const fallback: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (!isSpaHtmlRequest(req.path)) {
      next();
      return;
    }
    if (!fs.existsSync(indexHtml)) {
      next();
      return;
    }
    // securityHeaders 의 default-src 'none' 을 SPA CSP 로 덮어쓴다.
    res.setHeader('Content-Security-Policy', SPA_CSP);
    res.sendFile(indexHtml);
  };

  app.use(fallback);
}
