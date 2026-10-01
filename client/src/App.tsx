// WithSmall 최소 셸(R1). 홈 2종·레이어(L1~L8)·병원 화면은 R4에서 채운다.
// 인증 부팅 상태만 반영한다(로그인 화면·역할 게이팅 없음 — Phase 0 비로그인 흐름).
import { useAuth } from './auth/AuthContext';

export default function App() {
  const { status } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <span>WithSmall</span>
      </header>
      <main className="app-main">
        {status === 'booting' ? (
          <p role="status">불러오는 중…</p>
        ) : (
          <p>작은 친구를 맞이할 준비, 곧 이곳에서 시작해요.</p>
        )}
      </main>
    </div>
  );
}
