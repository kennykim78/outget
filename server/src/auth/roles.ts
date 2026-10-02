// 역할(권한) 정의. 최소 권한 원칙 — 인증 시 sub+role만 토큰에 담는다.
//   R4 D7: 이전 서비스 역할 체계 폐기 → USER | OPERATOR. prisma User.role 기본값 "USER" 와 일치.
//   공개 가입은 항상 USER(auth.routes.ts SELF_REGISTER_ROLE), OPERATOR 는 운영 절차(repo 직접 생성)로만.
export type Role = 'USER' | 'OPERATOR';

export const ROLES: readonly Role[] = ['USER', 'OPERATOR'] as const;

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}
