import jwt from 'jsonwebtoken';
import { isRole, type Role } from './roles.js';

// 시크릿은 env 전용. 하드코딩 금지 — 미설정 시 부팅 시점에 명확히 throw.
function requireSecret(name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET'): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`[auth] ${name} 환경변수가 설정되지 않았습니다. (하드코딩 금지)`);
  }
  return v;
}

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

export interface AccessClaims {
  sub: string;
  role: Role;
}

export interface RefreshClaims {
  sub: string;
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign({ role: claims.role }, requireSecret('JWT_ACCESS_SECRET'), {
    subject: claims.sub,
    expiresIn: ACCESS_TTL,
  });
}

export function signRefresh(claims: RefreshClaims): string {
  return jwt.sign({}, requireSecret('JWT_REFRESH_SECRET'), {
    subject: claims.sub,
    expiresIn: REFRESH_TTL,
  });
}

// 서명·만료 검증. 실패(만료·위조·구조 불일치) 시 throw.
export function verifyAccess(token: string): AccessClaims {
  const decoded = jwt.verify(token, requireSecret('JWT_ACCESS_SECRET'));
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
  const decoded = jwt.verify(token, requireSecret('JWT_REFRESH_SECRET'));
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('[auth] invalid refresh token payload');
  }
  const { sub } = decoded as jwt.JwtPayload;
  if (typeof sub !== 'string') {
    throw new Error('[auth] invalid refresh token claims');
  }
  return { sub };
}
