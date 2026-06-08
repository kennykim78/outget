// 역할(권한) 정의. 최소 권한 원칙 — 인증 시 sub+role만 토큰에 담는다.
export type Role = '구매자' | '개인대행자' | '전문대행자' | '소식알림자' | '운영자';

export const ROLES: readonly Role[] = [
  '구매자',
  '개인대행자',
  '전문대행자',
  '소식알림자',
  '운영자',
] as const;

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}
