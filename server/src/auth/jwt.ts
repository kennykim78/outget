import jwt from 'jsonwebtoken';
import { isRole, type Role } from './roles.js';
import { isProdLike, JWT_SECRET_MIN } from '../config/env.js';

// 시크릿은 env 전용. 하드코딩 금지 — 미설정 시 부팅 시점에 명확히 throw.
function requireSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`[auth] ${name} 환경변수가 설정되지 않았습니다. (하드코딩 금지)`);
  }
  // SEC-3 L-5: 운영(development·test 외)에서는 최소 길이. 기동 시점 검사는 app.ts assertJwtSecrets.
  if (isProdLike() && v.length < JWT_SECRET_MIN) {
    throw new Error(`[auth] ${name} 는 운영에서 ${JWT_SECRET_MIN}자 이상이어야 합니다.`);
  }
  return v;
}

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
export const REFRESH_TTL_S = 7 * 24 * 60 * 60;

// L-I: 알고리즘 고정. 서명·검증 모두 HS256 만(alg none·HS512·RS* 혼동 공격 차단).
const ALG = 'HS256' as const;
const VERIFY_OPTS: jwt.VerifyOptions = { algorithms: [ALG] };

export interface AccessClaims {
  sub: string;
  role: Role;
}

export interface RefreshClaims {
  sub: string;
  jti: string; // 토큰 고유 식별자 — 회전(rotation)·재사용 탐지의 키.
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign({ role: claims.role }, requireSecret('JWT_ACCESS_SECRET'), {
    subject: claims.sub,
    expiresIn: ACCESS_TTL,
    algorithm: ALG,
  });
}

export function signRefresh(claims: RefreshClaims): string {
  // jti(jwtid) 를 토큰에 박아 회전·재사용 탐지(store 가 단건 활성 여부 추적).
  return jwt.sign({}, requireSecret('JWT_REFRESH_SECRET'), {
    subject: claims.sub,
    jwtid: claims.jti,
    expiresIn: REFRESH_TTL,
    algorithm: ALG,
  });
}

// 서명·만료 검증. 실패(만료·위조·구조 불일치) 시 throw.
export function verifyAccess(token: string): AccessClaims {
  const decoded = jwt.verify(token, requireSecret('JWT_ACCESS_SECRET'), VERIFY_OPTS);
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('[auth] invalid access token payload');
  }
  const { sub, role } = decoded as jwt.JwtPayload & { role?: unknown };
  if (typeof sub !== 'string' || !isRole(role)) {
    throw new Error('[auth] invalid access token claims');
  }
  return { sub, role };
}

export function verifyRefresh(token: string): RefreshClaims {
  const decoded = jwt.verify(token, requireSecret('JWT_REFRESH_SECRET'), VERIFY_OPTS);
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('[auth] invalid refresh token payload');
  }
  const { sub, jti } = decoded as jwt.JwtPayload;
  if (typeof sub !== 'string' || typeof jti !== 'string') {
    throw new Error('[auth] invalid refresh token claims');
  }
  return { sub, jti };
}
