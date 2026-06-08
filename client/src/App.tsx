// 모바일 셸. 기본 화면으로 양면 토글 보드(S1)를 렌더한다.
// 토글/핀/카드 클러스터링·필터·거리는 src/board/BoardView 에 구현(Epic2).
// 글쓰기·내요청 진입은 라우터 없이 경량 화면 전환(상태 토글)으로 처리.
import { useState } from 'react';
import BoardView from './board/BoardView';
import AgentProfileForm from './agent/AgentProfileForm';
import RequestForm from './request/RequestForm';
import MyRequestsView from './request/MyRequestsView';

type Screen = 'board' | 'agentProfile' | 'requestForm' | 'myRequests';

export default function App() {
  const [screen, setScreen] = useState<Screen>('board');

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
        {screen === 'board' && <BoardView />}
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
      </main>
    </div>
  );
}
