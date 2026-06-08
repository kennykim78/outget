// 모바일 셸. 기본 화면으로 양면 토글 보드(S1)를 렌더한다.
// 토글/핀/카드 클러스터링·필터·거리는 src/board/BoardView 에 구현(Epic2).
// 글쓰기·내요청 진입은 라우터 없이 경량 화면 전환(상태 토글)으로 처리.
import { useState } from 'react';
import BoardView from './board/BoardView';
import AgentProfileForm from './agent/AgentProfileForm';
import RequestForm from './request/RequestForm';
import MyRequestsView from './request/MyRequestsView';
import ChatView from './chat/ChatView';
import DiscountForm from './discount/DiscountForm';
import AdminBlindView from './governance/AdminBlindView';

type Screen =
  | 'board'
  | 'agentProfile'
  | 'requestForm'
  | 'myRequests'
  | 'discountForm'
  | 'adminReports'
  | 'chat';

// 운영자 진입은 조건부(클라 인증 배선 부재 → 표시 게이트만). 권위는 서버 requireRole.
// ?admin 쿼리로만 진입 노출 — 켜도 서버가 운영자 검증을 거부하면 큐는 비어/거부된다.
function isAdminEntry(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('admin');
}

// 채팅 진입 컨텍스트 — 매칭/채택 성공 시 보존(POST /api/matches 응답 식별자).
// 자금 흐름 필드 없음(②): 매칭 식별자·스레드 식별자뿐.
interface ChatContext {
  matchId: string;
  chatThreadId?: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('board');
  const [chatCtx, setChatCtx] = useState<ChatContext | null>(null);
  const [adminEntry] = useState(isAdminEntry);

  // 매칭/채택 성공 콜백 — 컨텍스트 보존 후 채팅 화면 진입.
  const enterChat = (ctx: ChatContext) => {
    setChatCtx(ctx);
    setScreen('chat');
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <span>Outget</span>
        {screen === 'board' ? (
          <nav className="app-header__nav">
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
            <button
              type="button"
              className="app-header__action"
              onClick={() => setScreen('agentProfile')}
            >
              대행 광고 올리기
            </button>
            <button
              type="button"
              className="app-header__action"
              onClick={() => setScreen('discountForm')}
            >
              할인소식 올리기
            </button>
            {adminEntry && (
              <button
                type="button"
                className="app-header__action"
                onClick={() => setScreen('adminReports')}
              >
                신고 관리
              </button>
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
        {screen === 'adminReports' && adminEntry && (
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
