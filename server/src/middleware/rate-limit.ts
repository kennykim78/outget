import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';

// 테스트 환경에서는 limiter 를 패스스루(no-op)로 — 다수의 빠른 요청이 429 로 깨지는 것을 방지.
//   (기존 190 테스트 보호: vitest 는 NODE_ENV='test' 로 실행됨.)
const isTest = process.env.NODE_ENV === 'test';

const passthrough: RequestHandler = (_req, _res, next) => {
  next();
};

// 공통 limiter 기본값: 표준 RateLimit 헤더 노출, 레거시 헤더 비활성, 초과 시 429 JSON.
function makeLimiter(opts: Partial<Options>): RequestHandler {
  if (isTest) {
    return passthrough;
  }
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ error: 'rate_limited' });
    },
    ...opts,
  });
}

const MINUTE = 60 * 1000;

// 로그인·가입 — 자격증명 대입(brute force) 완화. 분당 10회/ IP.
export const authLimiter = makeLimiter({
  windowMs: MINUTE,
  limit: 10,
});

// 일반 쓰기 POST — 스팸/대량 등록 완화. 분당 60회/ IP.
export const writeLimiter = makeLimiter({
  windowMs: MINUTE,
  limit: 60,
});

// 신고 — 신고 폭주/괴롭힘 완화. 분당 20회/ IP.
export const reportLimiter = makeLimiter({
  windowMs: MINUTE,
  limit: 20,
});

// 바운티 제출 — 제출 도배 완화. 분당 20회/ IP.
export const submitLimiter = makeLimiter({
  windowMs: MINUTE,
  limit: 20,
});

// 네이버쇼핑 검색 — 외부 오픈API 호출(서버 경유) 남용/쿼터 소진 완화. 분당 30회/ IP.
//   test env 에서는 passthrough(no-op).
export const searchLimiter = makeLimiter({
  windowMs: MINUTE,
  limit: 30,
});
