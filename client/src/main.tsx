import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthProvider from './auth/AuthProvider';
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
