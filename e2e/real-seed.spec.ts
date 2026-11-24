// X4 실시드 스모크(R6 E2) — E2E_SEED=real 일 때만. server/seed 그대로.
//   2026-11-16 Kenny 확인표 5종 서명(4 패킷 107행 VERIFIED, ORDERS 11/16 16:4x) 뒤: ACTIVE 인 골든햄스터만 노출,
//   서명됐지만 PLANNED 인 드워프·저빌·기니피그와 미서명 앵무·로보는 노출 0. 색인은 WS_INDEXABLE 로만 켜진다(robots Disallow 유지).
//   / 200 · 홈 ws-data types = [hamster-golden] · /hamster/golden 200 · PLANNED 종 경로 404 · sitemap 은 골든만 · robots Disallow.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './support/fixtures';
import { assertScreen } from './support/invariants';

test.skip(() => process.env.E2E_SEED_MODE !== 'real', '실시드 전용(E2E_SEED=real)');

// 노출 종 = 시드 ACTIVE(2026-11-23 드워프·기니피그 활성화 뒤 「골든만」 고정을 시드 기준으로 바꿈 — 가드 약화 아님).
const SEED_TYPES = JSON.parse(readFileSync(join(__dirname, '../server/seed/animal-types.json'), 'utf8')) as Array<{ id: string; slug: string; status: string }>;
const ACTIVE = SEED_TYPES.filter((t) => t.status === 'ACTIVE');
const ACTIVE_IDS = ACTIVE.map((t) => t.id).sort();
const ACTIVE_PATHS = ACTIVE.map((t) => '/' + t.slug);
// 그룹 경로(/hamster·/parrot 등)는 ACTIVE 종이 하나라도 있으면 노출, 하나도 없으면 PLANNED(404). 2026-11-25 6종 활성화로 /parrot 고정 404 가정이 낡음(가드 약화 아님).
const ACTIVE_GROUPS = new Set(ACTIVE.map((t) => '/' + t.slug.split('/')[0]));
const PLANNED_GROUPS = [...new Set(SEED_TYPES.map((t) => '/' + t.slug.split('/')[0]))].filter((g) => !ACTIVE_GROUPS.has(g));
const PLANNED_PATHS = [...SEED_TYPES.filter((t) => t.status !== 'ACTIVE').map((t) => '/' + t.slug), ...PLANNED_GROUPS];

test('실시드: / 200 · 홈 types = 시드 ACTIVE · 금지어 0', async ({ page, request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const r = await page.goto('/');
  expect(r?.status()).toBe(200);
  await expect(page.locator('#ws-hero-title')).toBeVisible();
  const types = await page.evaluate(
    () => (JSON.parse(document.getElementById('ws-data')?.textContent ?? 'null') as { data?: { types?: Array<{ id?: unknown }> } } | null)?.data?.types?.map((t) => t.id),
  );
  expect([...(types ?? [])].map(String).sort()).toEqual(ACTIVE_IDS);
  await assertScreen(page, '실시드 홈');
});

test('실시드: /hamster/golden 200 · /hamster 200 · PLANNED 종 404', async ({ request }) => {
  expect((await request.get('/hamster')).status()).toBe(200);
  for (const p of ACTIVE_PATHS) expect([p, (await request.get(p)).status()]).toEqual([p, 200]);
  for (const p of PLANNED_PATHS) expect([p, (await request.get(p)).status()]).toEqual([p, 404]);
});

test('실시드: sitemap 타입 URL 은 ACTIVE 만 · robots Disallow', async ({ request }) => {
  const sm = await request.get('/sitemap.xml');
  expect(sm.status()).toBe(200);
  const locs = Array.from((await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g), (m) => new URL(m[1]).pathname);
  for (const p of ACTIVE_PATHS) expect(locs).toContain(p);
  // 타입·그룹·타입 하위 경로는 ACTIVE 종(과 그룹 /hamster)뿐 — PLANNED 종 경로 0.
  const isActive = (p: string) => ACTIVE_GROUPS.has(p) || ACTIVE_PATHS.some((a) => p === a || p.startsWith(a + '/'));
  expect(locs.filter((p) => /^\/(hamster|gerbil|guinea-pig|parrot)(\/|$)/.test(p) && !isActive(p))).toEqual([]);
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toMatch(/^Disallow:\s*\/\s*$/m);
});
