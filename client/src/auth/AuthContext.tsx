// 인증 컨텍스트 — 신규 라이브러리 0(React Context + useState).
// 상태/액션 정의만. Provider 구현은 AuthProvider.tsx, 소비는 useAuth().
import { createContext, useContext } from 'react';
import type { AuthMe, Role } from './authApi';

// 부팅 단계 구분 — booting(세션 복구 중)/anon(미로그인)/authed(로그인).
export type AuthStatus = 'booting' | 'anon' | 'authed';

export interface AuthState {
  /** 현재 사용자(미로그인이면 null). */
  user: AuthMe | null;
  /** 부팅/인증 상태. */
  status: AuthStatus;
}

export interface AuthContextValue extends AuthState {
  /** 로그인 → 토큰 저장 → /auth/me 로 사용자 확정. */
  login: (email: string, password: string) => Promise<void>;
  /** 회원가입 → 토큰 저장 → /auth/me 로 사용자 확정. */
  register: (email: string, password: string, role: Role) => Promise<void>;
  /** 로그아웃 — 토큰 제거 + 상태 anon. */
  logout: () => void;
  /** 로그인 여부(편의). */
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** 인증 컨텍스트 소비 훅. Provider 밖에서 호출하면 throw. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
