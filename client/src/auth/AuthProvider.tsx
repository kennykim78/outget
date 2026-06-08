// 인증 Provider — 신규 라이브러리 0(Context + useState).
// 흐름:
//   - 부팅: refresh 토큰 있으면 authApi.refresh → access(메모리) → authApi.me → user.
//     없거나 실패하면 토큰 정리 후 anon.
//   - login/register: authApi 호출 → 토큰 저장 → authApi.me 로 sub 확정 → authed.
//   - logout: clearTokens + anon.
//   - apiFetch 의 onAuthFailure 를 logout 에 배선(보호 호출의 최종 인증 실패 시 세션 종료).
import { useCallback, useEffect, useRef, useState } from 'react';
import * as authApi from './authApi';
import type { AuthMe, Role } from './authApi';
import { setOnAuthFailure } from './apiFetch';
import {
  clearTokens,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './tokenStorage';
import { AuthContext, type AuthStatus } from './AuthContext';

export default function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<AuthMe | null>(null);
  const [status, setStatus] = useState<AuthStatus>('booting');

  const logout = useCallback((): void => {
    clearTokens();
    setUser(null);
    setStatus('anon');
  }, []);

  // apiFetch 인증 최종 실패 → logout 배선(1회). 최신 logout 참조 유지.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  useEffect(() => {
    setOnAuthFailure(() => logoutRef.current());
    return () => setOnAuthFailure(null);
  }, []);

  // 부팅 세션 복구 — refresh 토큰으로 access 재발급 후 /auth/me.
  useEffect(() => {
    let cancelled = false;
    const boot = async (): Promise<void> => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        if (!cancelled) setStatus('anon');
        return;
      }
      try {
        const { accessToken } = await authApi.refresh(refreshToken);
        setAccessToken(accessToken);
        const me = await authApi.me(accessToken);
        if (cancelled) return;
        setUser(me);
        setStatus('authed');
      } catch {
        // refresh 만료/거부 — 세션 정리 후 anon.
        clearTokens();
        if (cancelled) return;
        setUser(null);
        setStatus('anon');
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  // 토큰 저장 + /auth/me 로 사용자 확정(login/register 공통).
  const finishAuth = useCallback(
    async (tokens: authApi.AuthTokens): Promise<void> => {
      setAccessToken(tokens.accessToken);
      setRefreshToken(tokens.refreshToken);
      const me = await authApi.me(tokens.accessToken);
      setUser(me);
      setStatus('authed');
    },
    [],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const tokens = await authApi.login(email, password);
      await finishAuth(tokens);
    },
    [finishAuth],
  );

  const register = useCallback(
    async (email: string, password: string, role: Role): Promise<void> => {
      const tokens = await authApi.register(email, password, role);
      await finishAuth(tokens);
    },
    [finishAuth],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        login,
        register,
        logout,
        isAuthenticated: status === 'authed',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
