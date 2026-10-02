import { defineConfig } from 'vitest/config';

// 전체 병렬 실행 중 부하가 걸리면 app.js 를 동적 import 하는 beforeAll 훅이
// 기본 10s 를 넘겨 hardening/report 스위트가 간헐 실패했다(R3 2회 관찰, 단독 실행은 통과).
export default defineConfig({
  test: {
    hookTimeout: 30_000,
  },
});
