// ws_sid 세션 쿠키(계약 C-R5-2, D2): 불투명 base64url 32B, HttpOnly·SameSite=Lax·Path=/·Max-Age=90일[·Secure].
//   cookie-parser 의존성 없이 Cookie 헤더에서 ws_sid 만 읽는다(형식 불일치 값은 없는 것으로).
import type { Request } from 'express';
import { OPAQUE_RE } from './crypto.js';

export const SESSION_COOKIE = 'ws_sid';
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60; // 7776000

export function serializeSessionCookie(sid: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${sid}; Max-Age=${SESSION_MAX_AGE_S}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function readSessionId(req: Request): string | null {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return OPAQUE_RE.test(value) ? value : null;
  }
  return null;
}
