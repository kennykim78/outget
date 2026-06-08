// 모바일 셸. 기본 화면으로 지도 셸(S1 기반)을 렌더한다.
// 토글/핀/카드 클러스터링 등 양면 보드 본기능은 후속 에픽에서 src/board 에 구현.
import NaverMapShell from './map/NaverMapShell';

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">Outget</header>
      <main className="app-main app-main--map">
        <NaverMapShell />
      </main>
    </div>
  );
}
