// 매직링크 토큰·세션 id: 32B 난수 base64url(43자). 저장은 sha256 hex 만(원문 저장 0).
import { createHash, randomBytes } from 'node:crypto';

export const OPAQUE_RE = /^[A-Za-z0-9_-]{43}$/;

export function randomOpaque(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
