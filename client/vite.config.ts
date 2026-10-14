/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 리포 기준 상대 경로 → 절대 파일 경로(node 타입 없이 — 클라 tsconfig 에 node 전역을 들이지 않는다).
// Windows 의 '/C:/...' 앞 슬래시를 떼어 낸다.
function fromHere(rel: string): string {
  return decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, '');
}

// 모바일우선 PWA. 외부 사이트 수집(크롤링) 코드 없음 — 프록시는 자사 API(/api)만.
export default defineConfig({
  // 클라이언트 회귀 테스트. 테스트는 로컬(외부 출처 0, 불변식 ①).
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // styles/*.css 는 ?raw 로 읽어 jsdom 에 주입하는 레이아웃 회귀 테스트용(F8 — 레이어 머리 가림 방지).
    css: { include: [/src\/styles\/.+\.css/] },
  },
  // 서버 공용 순수 모듈 별칭(tsconfig.json paths 와 1:1). 클라 코드는 이 별칭으로만 서버 파일을 import 한다.
  resolve: {
    alias: {
      '@ws/engine': fromHere('../server/src/engine/index.ts'),
      '@ws/copy': fromHere('../server/src/prerender/copy.ts'),
      '@ws/events': fromHere('../server/src/shared/event-contract.ts'),
      '@ws/forbidden-keys': fromHere('../server/src/shared/forbidden-keys.ts'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'WithSmall',
        short_name: 'WithSmall',
        description: '작은 반려동물을 처음 맞을 때, 지금 필요한 것과 아직 필요 없는 것을 종별 기준으로 정리해 드려요.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        lang: 'ko',
        icons: [],
      },
      // D9: HTML 은 프리캐시하지 않는다(페이지마다 ws-data 가 달라 셸 하나로 대체 불가). navigateFallback 끔.
      //   문서 이동 → NetworkFirst(3초, 오프라인이면 마지막 본 페이지), 카탈로그(내용 해시 파일명) → CacheFirst,
      //   /api → NetworkOnly(사용자·이벤트 응답 캐시 0).
      workbox: {
        navigateFallback: null,
        // woff2 는 프리캐시하지 않는다 — dynamic-subset(D-1) 조각 92개를 설치 때 전부 받지 않고, 쓴 조각만 런타임 캐시.
        globPatterns: ['**/*.{js,css,svg,png,webmanifest}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // 문서 이동만, 단 /api·/auth·/admin 최상위 이동은 캐시하지 않는다(SEC). 7일 지난 페이지는 오프라인에서도 버린다
            // (회수·강등된 페이지가 무기한 남지 않게).
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' && !/^\/(?:api|auth|admin)(?:\/|$)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ws-html',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/data\/catalog\.v1\./.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ws-catalog',
              expiration: { maxEntries: 4 },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/assets\/.+\.woff2$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ws-font',
              expiration: { maxEntries: 100 },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/api\//.test(url.pathname),
            handler: 'NetworkOnly',
          },
        ],
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
