/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 모바일우선 PWA. 외부 사이트 수집(크롤링) 코드 없음 — 프록시는 자사 API(/api)만.
export default defineConfig({
  // 컴플라이언스 UI 회귀 잠금(음수 할인율 가드·면책·고지·미검증). 테스트는 로컬(외부 출처 0, 불변식 ①).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Outget',
        short_name: 'Outget',
        description: '지도 기반 아울렛 구매대행 양면 매칭 보드',
        theme_color: '#111111',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
