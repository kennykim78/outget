// 로그인/회원가입 화면 — 신규 라이브러리 0.
// 로그인 ↔ 회원가입 토글. 가입 시 역할 5종 선택. 에러 상태 매핑(401/409/400).
// 성공 시 onDone() 으로 보드 전환(App 이 authed 헤더로 갱신).
import { useState } from 'react';
import { useAuth } from './AuthContext';
import { AuthError, type Role } from './authApi';
import './auth.css';

// 역할 5종(가입 시 선택). 서버 권위 — 표시·전송용.
const ROLES: Role[] = [
  '구매자',
  '개인대행자',
  '전문대행자',
  '소식알림자',
  '운영자',
];

type Mode = 'login' | 'register';

interface LoginViewProps {
  /** 인증 성공 시(보드 전환). */
  onDone: () => void;
  /** 화면 닫고 보드로(미로그인 조회 유지). */
  onBack: () => void;
}

// HTTP 상태 → 사용자 카피. ("환불"·"보증+링크" 카피 금지 — 인증 문구는 무관.)
function mapError(e: unknown, mode: Mode): string {
  if (e instanceof AuthError) {
    if (e.status === 401) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (e.status === 409) return '이미 가입된 이메일입니다.';
    if (e.status === 400) return '입력값을 확인해 주세요.';
    if (e.status === 403) return '허용되지 않은 요청입니다.';
  }
  return mode === 'login'
    ? '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.'
    : '회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

export default function LoginView({ onDone, onBack }: LoginViewProps) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('구매자');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, role);
      }
      onDone();
    } catch (err: unknown) {
      setError(mapError(err, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-view">
      <h1 className="auth-view__title">
        {mode === 'login' ? '로그인' : '회원가입'}
      </h1>

      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={
            'auth-tabs__btn' + (mode === 'login' ? ' auth-tabs__btn--active' : '')
          }
          onClick={() => {
            setMode('login');
            setError(null);
          }}
        >
          로그인
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={
            'auth-tabs__btn' +
            (mode === 'register' ? ' auth-tabs__btn--active' : '')
          }
          onClick={() => {
            setMode('register');
            setError(null);
          }}
        >
          회원가입
        </button>
      </div>

      <form className="auth-form" onSubmit={submit}>
        <div className="auth-field">
          <label className="auth-field__label" htmlFor="auth-email">
            이메일
          </label>
          <input
            id="auth-email"
            className="auth-field__input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="auth-field">
          <label className="auth-field__label" htmlFor="auth-password">
            비밀번호
          </label>
          <input
            id="auth-password"
            className="auth-field__input"
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {mode === 'register' && (
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="auth-role">
              역할
            </label>
            <select
              id="auth-role"
              className="auth-field__select"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && (
          <p className="auth-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}

        <button type="submit" className="auth-submit" disabled={busy}>
          {busy
            ? '처리 중…'
            : mode === 'login'
              ? '로그인'
              : '회원가입'}
        </button>
      </form>

      <button type="button" className="auth-back" onClick={onBack}>
        보드 둘러보기로 돌아가기
      </button>
    </div>
  );
}
