// 모바일 셸. 기본 화면으로 양면 토글 보드(S1)를 렌더한다.
// 토글/핀/카드 클러스터링·필터·거리는 src/board/BoardView 에 구현(Epic2).
// 대행 광고 올리기(S3 입력) 진입은 라우터 없이 경량 화면 전환(상태 토글)으로 처리.
import { useState } from 'react';
import BoardView from './board/BoardView';
import AgentProfileForm from './agent/AgentProfileForm';

type Screen = 'board' | 'agentProfile';

export default function App() {
  const [screen, setScreen] = useState<Screen>('board');

  return (
    <div className="app-shell">
      <header className="app-header">
        <span>Outget</span>
        {screen === 'board' ? (
          <button
            type="button"
            className="app-header__action"
            onClick={() => setScreen('agentProfile')}
          >
            대행 광고 올리기
          </button>
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
        {screen === 'board' ? (
          <BoardView />
        ) : (
          <AgentProfileForm
            onSaved={() => setScreen('board')}
            onCancel={() => setScreen('board')}
          />
        )}
      </main>
    </div>
  );
}
