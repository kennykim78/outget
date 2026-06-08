// 모바일 셸. 기본 화면으로 양면 토글 보드(S1)를 렌더한다.
// 토글/핀/카드 클러스터링·필터·거리는 src/board/BoardView 에 구현(Epic2).
import BoardView from './board/BoardView';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">Outget</header>
      <main className="app-main app-main--map">
        <BoardView />
      </main>
    </div>
  );
}
