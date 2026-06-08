import type { ErrorRequestHandler, RequestHandler } from 'express';

// CORS origin 콜백이 던지는 메시지(app.ts 의 cors() origin 함수와 1:1 일치).
const CORS_REJECT_MESSAGE = 'Not allowed by CORS';

// Express 4-arity 에러핸들러. 모든 라우터·미들웨어 뒤 맨 마지막에 app.use(errorHandler).
//   - CORS 거부 → 403 JSON { error: 'cors_forbidden' }.
//   - 그 외      → 500 JSON { error: 'internal' }(스택/상세 미노출 — 정보 유출 방지).
// 4개 인자를 모두 선언해야 Express 가 에러핸들러로 인식한다(next 미사용이어도 유지).
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // 이미 헤더가 전송됐다면 기본 핸들러에 위임(이중 전송 방지).
  if (res.headersSent) {
    next(err);
    return;
  }

  const message =
    err && typeof err === 'object' && 'message' in err
      ? (err as { message?: unknown }).message
      : undefined;

  if (message === CORS_REJECT_MESSAGE) {
    res.status(403).json({ error: 'cors_forbidden' });
    return;
  }

  res.status(500).json({ error: 'internal' });
};

// 매칭되지 않은 라우트용 404(JSON). 라우터 뒤·에러핸들러 앞에 배치 가능(선택).
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};
