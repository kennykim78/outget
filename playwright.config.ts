// E2E(Playwright) — 하네스는 e2e/support/global-setup.ts(클라 빌드·시드 사이트·실제 서버, 전부 OS 임시 폴더).
//   npm run e2e                    데모 시드(기본)
//   E2E_SEED=real npm run e2e      실시드(전부 DRAFT → 빈 상태)
//   E2E_CHANNEL=chrome npm run e2e 로컬: 시스템 Chrome 사용(번들 chromium 미설치 시). CI 는 `npx playwright install chromium`.
//   결과물(trace 등)도 리포 밖(OS 임시 폴더)에 둔다.
import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const channel = process.env.E2E_CHANNEL?.trim() || undefined;
const ci = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
  outputDir: join(tmpdir(), 'ws-e2e-results'),
  // 서버 1개(인메모리 repos)를 공유 — 상태 충돌을 피하려고 직렬.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: 0,
  timeout: 30_000,
  reporter: ci ? [['list'], ['github']] : [['list']],
  use: {
    channel,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // 서비스 워커가 가로챈 요청은 route 를 우회한다 — 외부 요청 감시를 위해 막는다.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, channel } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, channel } },
  ],
});
