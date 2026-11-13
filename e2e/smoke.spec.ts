// 스모크(R6 E1): 홈 200 · 홈 A(미선택) 렌더 · 외부 요청 0 · 하네스 출력이 리포 밖 · 디스크 시드 불변.
//   외부 요청 0·페이지 예외 0 은 guard 픽스처가 모든 테스트 끝에 단언한다(여기서는 명시적으로 한 번 더).
import { test, expect, e2eEnv } from './support/fixtures';
import { isInsideRepo, seedFilesDigest } from './support/repo';

test('홈 / 는 200 HTML', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
  const body = await res.text();
  // no-JS 본문: 프리렌더된 히어로가 HTML 에 이미 있다.
  expect(body).toContain('data-ws-section="hero"');
});

test('홈 A(미선택) 렌더 · 외부 요청 0', async ({ page, guard }) => {
  await page.goto('/');
  await expect(page.locator('#ws-hero-title')).toBeVisible();
  // 미선택 홈: 컨텍스트 헤더(홈 B) 없음.
  await expect(page.locator('.ws-context')).toHaveCount(0);
  await page.waitForLoadState('networkidle');

  const sections = await page.locator('main [data-ws-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ws-section')));
  const top = sections.filter((s) => ['hero', 'starters', 'reviews', 'intro', 'start'].includes(s ?? ''));
  // 286 U3a(D6): 홈 후기·소개 섹션 없음 — 데모(후기 8건)·실시드 모두 히어로 → 시작 카드(U3b) → 하단 CTA.
  expect(top).toEqual(['hero', 'starters', 'start']);

  expect(guard.external).toEqual([]);
  expect(guard.pageErrors).toEqual([]);
});

test('외부 요청 차단기 자가 점검 — 외부 호스트 요청은 막히고 기록된다', async ({ page, guard }) => {
  // 앱 CSP 와 무관하게 라우터만 점검하려고 about:blank 에서 프로브(앱 코드 아님). 차단되므로 실제로 나가지 않는다.
  const failed = page.waitForEvent('requestfailed');
  await page.setContent('<img src="https://example.invalid/e2e-guard-probe.png" alt="">');
  expect((await failed).url()).toBe('https://example.invalid/e2e-guard-probe.png');
  expect(guard.external).toEqual(['https://example.invalid/e2e-guard-probe.png']);
  guard.external.length = 0; // 의도한 1건 — 픽스처 종료 단언에서 제외.
});

test('하네스 출력은 리포 밖 · 디스크 시드 불변', async () => {
  for (const name of ['E2E_WORK_DIR', 'E2E_SITE_DIR', 'E2E_MAIL_FILE']) {
    expect(isInsideRepo(e2eEnv(name)), `${name} 는 리포 밖이어야 한다`).toBe(false);
  }
  expect(seedFilesDigest()).toBe(e2eEnv('E2E_SEED_DIGEST_BEFORE'));
});
