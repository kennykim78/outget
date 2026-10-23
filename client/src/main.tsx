// 진입점(계약 C-2): 프리렌더 HTML(SEO + ws-data) → readPageData → captureStatic → createRoot 교체 렌더(D1) — app/boot.tsx.
//   비밀번호 로그인 흐름 없음(R5 F3-0 — client/src/auth 삭제). 저장은 이메일 연결(save/)만, Phase 0 비로그인 흐름.
// Pretendard Variable dynamic-subset(D-1) — self-host(번들 woff2 조각, 외부 출처 0). 유니코드 범위별로 필요한 조각만 받는다(LCP).
// 토큰(--ws-font-sans)보다 먼저 로드해야 @font-face 가 적용된다(불변식 ①).
// 성능 P1(font2): 동기 CSS 에는 첫 화면 조각 90·91 만. 전체 92규칙은 빌드에선 build/wsAfterPaint.ts 가 별도 자산으로 내고
//   첫 페인트 뒤 주입한다(+ noscript). dev(플러그인 꺼짐)에서만 여기서 전체 CSS 를 직접 불러온다 — 프로덕션 번들에선 제거된다.
import './styles/fonts-first.css';
if (import.meta.env.DEV) void import('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css');
// 디자인 토큰(scripts/gen-tokens.mjs 생성 — 직접 수정 금지) → 앱 스타일(토큰 변수만).
import './styles/tokens.css';
import './styles/app.css';
import './styles/home.css';
// 프리렌더 정적 레이어 본문·JS 꺼짐 화면이 쓰는 CSS는 lazy 청크로 빠지면 안 된다 — 진입 CSS에 고정.
import './animal/picker.css';
import './styles/speccheck.css';
import './styles/layers.css';
import { boot } from './app/boot';

boot(document, window.location);
