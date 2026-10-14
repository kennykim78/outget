// E2E 공용 픽스처 — 모든 스펙은 '@playwright/test' 대신 여기서 test/expect 를 가져온다.
//   baseURL: 글로벌 셋업이 띄운 서버(E2E_BASE_URL).
//   guard(자동): 같은 오리진 밖 요청을 전부 차단·기록(불변식 ① — 외부 이미지·가격·페이지 0)하고, 테스트 끝에 0건을 단언.
//               페이지 미처리 예외(pageerror)도 기록·0건 단언.
//   newContext(픽스처): 같은 guard 를 단 추가 브라우저 컨텍스트(다른 기기·JS 꺼짐 등) — 테스트 끝에 닫는다.
import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';

export interface Guard {
  /** 차단된 외부 요청 URL(같은 오리진 밖). */
  external: string[];
  /** 페이지 미처리 예외 메시지. */
  pageErrors: string[];
}

export function e2eEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 없음 — 글로벌 셋업(e2e/support/global-setup.ts)을 거쳐 실행하라`);
  return v;
}

/** 컨텍스트에 외부 요청 차단·기록과 pageerror 기록을 단다(기본 컨텍스트·추가 컨텍스트 공용). */
export async function installGuard(context: BrowserContext, origin: string, g: Guard): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    let same = false;
    try {
      same = new URL(url).origin === origin;
    } catch {
      same = false;
    }
    if (same) {
      await route.continue();
      return;
    }
    g.external.push(url);
    await route.abort('blockedbyclient');
  });
  context.on('page', (p) => p.on('pageerror', (e) => g.pageErrors.push(e.message)));
}

/** 추가 컨텍스트 옵션 — 현재 프로젝트의 화면·기기 값을 이어받는다(서비스 워커 차단 고정). */
export type ExtraContextOptions = Pick<BrowserContextOptions, 'javaScriptEnabled' | 'reducedMotion'>;

export const test = base.extend<{ guard: Guard; newContext: (opts?: ExtraContextOptions) => Promise<BrowserContext> }>({
  baseURL: async ({}, use) => {
    await use(e2eEnv('E2E_BASE_URL'));
  },
  guard: [
    async ({ context, baseURL }, use) => {
      const origin = new URL(baseURL ?? e2eEnv('E2E_BASE_URL')).origin;
      const g: Guard = { external: [], pageErrors: [] };
      await installGuard(context, origin, g);
      await use(g);
      expect(g.external, '외부 요청(같은 오리진 밖)은 0건이어야 한다').toEqual([]);
      expect(g.pageErrors, '페이지 미처리 예외는 0건이어야 한다').toEqual([]);
    },
    { auto: true },
  ],
  newContext: async ({ browser, baseURL, guard, viewport, userAgent, isMobile, hasTouch, deviceScaleFactor, locale, timezoneId }, use) => {
    const made: BrowserContext[] = [];
    const origin = new URL(baseURL ?? e2eEnv('E2E_BASE_URL')).origin;
    await use(async (opts = {}) => {
      const ctx = await (browser as Browser).newContext({
        baseURL: origin,
        viewport,
        userAgent,
        isMobile,
        hasTouch,
        deviceScaleFactor,
        locale,
        timezoneId,
        serviceWorkers: 'block',
        ...opts,
      });
      await installGuard(ctx, origin, guard);
      made.push(ctx);
      return ctx;
    });
    for (const c of made) await c.close();
  },
});

export { expect };
