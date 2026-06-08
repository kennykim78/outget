// 모바일 셸. 기본 화면으로 양면 토글 보드(S1)를 렌더한다.
// 토글/핀/카드 클러스터링·필터·거리는 src/board/BoardView 에 구현(Epic2).
// 글쓰기·내요청 진입은 라우터 없이 경량 화면 전환(상태 토글)으로 처리.
// 인증: useAuth() 로 부팅/역할 게이팅. 미로그인도 BoardView 공개 조회 가능.
//   진입 게이트는 표시일 뿐 — 실제 권한은 서버 requireRole 이 권위.
import { useState } from 'react';
import BoardView from './board/BoardView';
import AgentProfileForm from './agent/AgentProfileForm';
import RequestForm from './request/RequestForm';
import MyRequestsView from './request/MyRequestsView';
import ChatView from './chat/ChatView';
import DiscountForm from './discount/DiscountForm';
import AdminBlindView from './governance/AdminBlindView';
import LoginView from './auth/LoginView';
import { useAuth } from './auth/AuthContext';
import type { Role } from './auth/authApi';

type Screen =
  | 'board'
  | 'login'
  | 'agentProfile'
  | 'requestForm'
  | 'myRequests'
  | 'discountForm'
  | 'adminReports'
  | 'chat';

// 채팅 진입 컨텍스트 — 매칭/채택 성공 시 보존(POST /api/matches 응답 식별자).
// 자금 흐름 필드 없음(②): 매칭 식별자·스레드 식별자뿐.
interface ChatContext {
  matchId: string;
  chatThreadId?: string;
}

// 역할별 진입 노출 게이트(표시용 — 권위는 서버 requireRole).
const isBuyer = (role: Role) => role === '구매자';
const isAgent = (role: Role) =>
  role === '개인대행자' || role === '전문대행자';
const canPostDiscount = (role: Role) =>
  role === '소식알림자' ||
  role === '개인대행자' ||
  role === '전문대행자' ||
  role === '운영자';
const isAdmin = (role: Role) => role === '운영자';

export default function App() {
  const { status, user, logout } = useAuth();
  const [screen, setScreen] = useState<Screen>('board');
  const [chatCtx, setChatCtx] = useState<ChatContext | null>(null);

  // 매칭/채택 성공 콜백 — 컨텍스트 보존 후 채팅 화면 진입.
  const enterChat = (ctx: ChatContext) => {
    setChatCtx(ctx);
    setScreen('chat');
  };

  // 부팅(세션 복구) 중 — 로딩.
  if (status === 'booting') {
    return (
      <div className="app-shell">
        <header className="app-header">
          <span>Outget</span>
        </header>
        <main className="app-main">
          <p role="status">불러오는 중…</p>
        </main>
      </div>
    );
  }

  const role = user?.role ?? null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span>Outget</span>
        {screen === 'board' ? (
          <nav className="app-header__nav">
            {/* 미로그인 — 로그인 진입만(보드는 공개 조회). */}
            {status === 'anon' && (
              <button
                type="button"
                className="app-header__action"
                onClick={() => setScreen('login')}
              >
                로그인
              </button>
            )}

            {/* 로그인 — 역할 게이팅 진입 + 로그아웃·역할 표시. */}
            {status === 'authed' && role && (
              <>
                {isBuyer(role) && (
                  <>
                    <button
                      type="button"
                      className="app-header__action"
                      onClick={() => setScreen('requestForm')}
                    >
                      역경매 요청 올리기
                    </button>
                    <button
                      type="button"
                      className="app-header__action"
                      onClick={() => setScreen('myRequests')}
                    >
                      내 요청
                    </button>
                  </>
                )}
                {isAgent(role) && (
                  <button
                    type="button"
                    className="app-header__action"
                    onClick={() => setScreen('agentProfile')}
                  >
                    대행 광고 올리기
                  </button>
                )}
                {canPostDiscount(role) && (
                  <button
                    type="button"
                    className="app-header__action"
                    onClick={() => setScreen('discountForm')}
                  >
                    할인소식 올리기
                  </button>
                )}
                {isAdmin(role) && (
                  <button
                    type="button"
                    className="app-header__action"
                    onClick={() => setScreen('adminReports')}
                  >
                    신고 관리
                  </button>
                )}
                <span className="app-header__role">{role}</span>
                <button
                  type="button"
                  className="app-header__action"
                  onClick={logout}
                >
                  로그아웃
                </button>
              </>
            )}
          </nav>
        ) : (
          <button
            type="button"
            className="app-header__action"
            onClick={() => setScreen('board')}
          >
            보드로
          </button>
        )}
      </header>
      <main
        className={
          'app-main' + (screen === 'board' ? ' app-main--map' : '')
        }
      >
        {screen === 'board' && <BoardView onEnterChat={enterChat} />}
        {screen === 'login' && (
          <LoginView
            onDone={() => setScreen('board')}
            onBack={() => setScreen('board')}
          />
        )}
        {screen === 'agentProfile' && (
          <AgentProfileForm
            onSaved={() => setScreen('board')}
            onCancel={() => setScreen('board')}
          />
        )}
        {screen === 'requestForm' && (
          <RequestForm
            onSaved={() => setScreen('myRequests')}
            onCancel={() => setScreen('board')}
          />
        )}
        {screen === 'myRequests' && (
          <MyRequestsView onWriteNew={() => setScreen('requestForm')} />
        )}
        {screen === 'discountForm' && (
          <DiscountForm
            onSaved={() => setScreen('board')}
            onCancel={() => setScreen('board')}
          />
        )}
        {screen === 'adminReports' && role && isAdmin(role) && (
          <AdminBlindView onBack={() => setScreen('board')} />
        )}
        {screen === 'chat' && chatCtx && (
          <ChatView
            matchId={chatCtx.matchId}
            chatThreadId={chatCtx.chatThreadId}
            onBack={() => setScreen('board')}
          />
        )}
      </main>
    </div>
  );
}
