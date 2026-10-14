// IP 리미터(express-rate-limit, 프로세스 메모리 창 — IP 는 영속하지 않는다).
//   createApp 마다 makeAppLimiters() 로 새 인스턴스를 만든다(앱 간 카운터 공유 없음 — 테스트·다중 앱 안전).
//   test env 기본은 꺼짐(패스스루) — 빠른 다수 요청 테스트 보호. 리미터 자체 테스트는 enabled=true 로 켠다.
//   (R5 B1-4: Outget 잔재 search·submit·report 리미터 삭제, magic·save·reaction·vetReport 추가.)
//   IP 키 = ipKey(req.ip): IPv4 그대로, IPv6 는 /56 접두(R6 B3, SEC-4 L-3 — 가정용 위임 단위가 흔히 /56 이라 한 가입자가
//   /64 여러 개를 돌려 쓰는 우회 차단), IPv4-mapped 는 IPv4. 키는 프로세스 메모리 창에만 있다(영속 0).
//   req.ip 는 app.ts 의 'trust proxy' 정수 홉 수(TRUST_PROXY, 기본 0)로 정해진다(SEC-3 M-2).
//   express-rate-limit 7.5 에는 ipKeyGenerator 가 없어(8.x 부터) 작은 헬퍼를 둔다.
import { isIPv4, isIPv6 } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

/** IPv6 → 8개 16비트 그룹(소문자 4자리). 잘못된 값이면 null. */
function expandIPv6(addr: string): string[] | null {
  let a = addr.split('%')[0].toLowerCase(); // 존 id 제거
  // 끝의 IPv4 표기(::ffff:1.2.3.4, 64:ff9b::1.2.3.4) → 두 그룹
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    a = a.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

/** IPv6 리미터 접두 길이(비트). 4번째 그룹의 상위 8비트까지. */
export const IPV6_LIMIT_PREFIX = 56;

/** 리미터 키: IPv4 원문, IPv4-mapped IPv6 → IPv4, IPv6 → "/56 접두::/56"(4번째 그룹 하위 8비트 0), 그 밖(없음·이상값) → 원문 또는 'unknown'. */
export function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return ip;
  const g = expandIPv6(ip);
  if (!g) return ip;
  if (g.slice(0, 5).every((x) => x === '0000') && g[5] === 'ffff') {
    const n = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2), 16)];
    return [...n(g[6]), ...n(g[7])].join('.');
  }
  const g3 = `${g[3].slice(0, 2)}00`; // /56 = 48비트(그룹 0~2) + 그룹 3 상위 8비트
  return `${g.slice(0, 3).join(':')}:${g3}::/${IPV6_LIMIT_PREFIX}`;
}

const keyGenerator = (req: Request): string => ipKey(req.ip);

const MINUTE = 60 * 1000;

export interface LimitSpec {
  windowMs: number;
  limit: number;
}

export const LIMITS = {
  /** 운영자 로그인·refresh — 자격증명 대입 완화. */
  auth: { windowMs: MINUTE, limit: 10 },
  /** /api 변경 메서드 공통 상한. */
  write: { windowMs: MINUTE, limit: 60 },
  /** 매직링크 요청(C-R5-2: IP 5/15분). 이메일별 3/시간은 magic.routes 의 EmailThrottle. */
  magic: { windowMs: 15 * MINUTE, limit: 5 },
  /** 매직링크 verify — 토큰 대입 완화(32B 난수라 실익은 낮지만 비용 상한). */
  magicVerify: { windowMs: 15 * MINUTE, limit: 20 },
  /** PUT /api/save — 클라 2s 디바운스 = 탭당 ≤30/분. */
  save: { windowMs: MINUTE, limit: 30 },
  /** 반응(C-R5-3: 분당 20/IP). */
  reaction: { windowMs: MINUTE, limit: 20 },
  /** 병원 제보(C-R5-4: IP 5/시간). */
  vetReport: { windowMs: 60 * MINUTE, limit: 5 },
  /** 가벼운 읽기(SEC-3 L-7): GET /api/reactions/counts·/api/save·/auth/session. */
  read: { windowMs: MINUTE, limit: 120 },
  /** 익명 이벤트(PRD US-018) — 기존 makeEventsLimiter 기본값과 같다. */
  events: { windowMs: MINUTE, limit: 30 },
} as const satisfies Record<string, LimitSpec>;

export type LimiterName = keyof typeof LIMITS;
export type AppLimiters = Record<LimiterName, RequestHandler>;

const passthrough: RequestHandler = (_req, _res, next) => {
  next();
};

/** 초과 시 429 {error:'rate_limited'}(본문 동일 — 계정·대상 존재 여부 비노출). */
export function makeLimiter(spec: LimitSpec, enabled: boolean): RequestHandler {
  if (!enabled) return passthrough;
  return rateLimit({
    windowMs: spec.windowMs,
    limit: spec.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    handler(_req, res) {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}

export function makeAppLimiters(enabled: boolean = process.env.NODE_ENV !== 'test'): AppLimiters {
  const out = {} as AppLimiters;
  for (const name of Object.keys(LIMITS) as LimiterName[]) out[name] = makeLimiter(LIMITS[name], enabled);
  return out;
}
