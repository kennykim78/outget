// X4 실시드 스모크(R6 E2) — E2E_SEED=real 일 때만. server/seed 그대로(전부 DRAFT) → 노출 0.
//   / 200 · 홈 ws-data types [] · /hamster/golden 404 · sitemap 에 타입 URL 0 · robots Disallow.
import { test, expect } from './support/fixtures';
import { assertScreen } from './support/invariants';

test.skip(() => process.env.E2E_SEED_MODE !== 'real', '실시드 전용(E2E_SEED=real)');

test('실시드: / 200 · 홈 types [] · 금지어 0', async ({ page, request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const r = await page.goto('/');
  expect(r?.status()).toBe(200);
  await expect(page.locator('#ws-hero-title')).toBeVisible();
  const types = await page.evaluate(() => (JSON.parse(document.getElementById('ws-data')?.textContent ?? 'null') as { data?: { types?: unknown[] } } | null)?.data?.types);
  expect(types).toEqual([]);
  await assertScreen(page, '실시드 홈');
});

test('실시드: /hamster/golden 404 · /hamster 404', async ({ request }) => {
  expect((await request.get('/hamster/golden')).status()).toBe(404);
  expect((await request.get('/hamster')).status()).toBe(404);
});

test('실시드: sitemap 타입 URL 0 · robots Disallow', async ({ request }) => {
  const sm = await request.get('/sitemap.xml');
  expect(sm.status()).toBe(200);
  const locs = Array.from((await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g), (m) => new URL(m[1]).pathname);
  expect(locs.length).toBeGreaterThan(0);
  // 타입·그룹·타입 하위 경로(/hamster/…) 0.
  expect(locs.filter((p) => /^\/hamster(\/|$)/.test(p))).toEqual([]);
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/^Disallow:\s*\/\s*$/m);
});
