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

  // body-parser(express.json 등) 클라이언트 오류: 라우터 전용 파서가 next(err) 로 넘긴 경우(R5 반응·제보 라우터).
  //   상한 초과 → 413, 그 밖의 4xx(깨진 JSON·인코딩) → 400. 상세 메시지는 내보내지 않는다.
  const bodyErr = err && typeof err === 'object' ? (err as { type?: unknown; status?: unknown }) : undefined;
  if (bodyErr && typeof bodyErr.type === 'string' && typeof bodyErr.status === 'number') {
    if (bodyErr.type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    if (bodyErr.status >= 400 && bodyErr.status < 500) {
      res.status(400).json({ error: 'bad_body' });
      return;
    }
  }

  res.status(500).json({ error: 'internal' });
};

// 매칭되지 않은 라우트용 404(JSON). 라우터 뒤·에러핸들러 앞에 배치 가능(선택).
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};
