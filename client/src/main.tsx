// 진입점(계약 C-2): 프리렌더 HTML(SEO + ws-data) → readPageData → captureStatic → createRoot 교체 렌더(D1) — app/boot.tsx.
//   AuthProvider 는 마운트하지 않는다(D10 — 파일은 R5 재마운트까지 보존). Phase 0 비로그인 흐름.
// Pretendard Variable dynamic-subset(D-1) — self-host(번들 woff2 조각, 외부 출처 0). 유니코드 범위별로 필요한 조각만 받는다(LCP).
// 토큰(--ws-font-sans)보다 먼저 로드해야 @font-face 가 적용된다(불변식 ①).
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
// 디자인 토큰(scripts/gen-tokens.mjs 생성 — 직접 수정 금지) → 앱 스타일(토큰 변수만).
import './styles/tokens.css';
import './styles/app.css';
import './styles/home.css';
import './styles/layer-static.css';
import { boot } from './app/boot';

boot(document, window.location);
