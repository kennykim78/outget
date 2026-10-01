/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 모바일우선 PWA. 외부 사이트 수집(크롤링) 코드 없음 — 프록시는 자사 API(/api)만.
export default defineConfig({
  // 클라이언트 회귀 테스트. 테스트는 로컬(외부 출처 0, 불변식 ①).
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
        name: 'WithSmall',
        short_name: 'WithSmall',
        description: '작은 반려동물을 처음 맞을 때, 지금 필요한 것과 아직 필요 없는 것을 종별 기준으로 정리해 드려요.',
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
