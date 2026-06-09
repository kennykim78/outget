import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthProvider from './auth/AuthProvider';
// Pretendard Variable — self-host(번들 woff2, 외부 출처 0). CSP(style-src/font-src 'self')와 정합.
// 테마(outget-theme.css)의 --font 보다 먼저 로드해야 @font-face 가 적용된다(불변식 ①).
import 'pretendard/dist/web/variable/pretendardvariable.css';
import './index.css';
// Claude Design 핸드오프 테마(타입 A 「동네」) — index.css 뒤에 마지막 로드(드롭인 재스타일).
import './outget-theme.css';
import './outget-theme.forms.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('root element not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
