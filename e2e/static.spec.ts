// X1 정적 경로 + X2 no-JS 본문(R6 E2) — 데모 시드 전용.
//   /hamster 그룹 페이지 카드 → 타입 홈 · /pick no-JS(CTA → /pick 200 · 정적 L1 링크 → 타입 홈 200)
//   · no-JS /hamster/golden 본문(타입명·필수 항목·규격 문장·병원 리스트) · 미달 상품 페이지 404 · 후기 '규격 확인해보기' → L5 딥링크.
import { test, expect, gotoHydrated } from './support/fixtures';
import { assertScreen, BELOW_MIN_PRODUCT, belowMinSeeded, tap } from './support/invariants';

const TYPE = { id: 'hamster-golden', name: '골든햄스터', home: '/hamster/golden' } as const;

test.skip(() => process.env.E2E_SEED_MODE !== 'demo', '데모 시드 전용');

test('/hamster 그룹 페이지 카드 → 타입 홈', async ({ page }) => {
  const res = await page.goto('/hamster');
  expect(res?.status()).toBe(200);
  await expect(page.locator('main h1')).toHaveText('햄스터');
  await assertScreen(page, '/hamster');
  const card = page.locator(`main a.ws-type-card[href="${TYPE.home}"]`);
  await expect(card).toHaveCount(1);
  await Promise.all([page.waitForURL(`**${TYPE.home}`), tap(page, card)]);
  await expect(page.locator('h1#ws-context-title')).toHaveText(TYPE.name);
  await assertScreen(page, '/hamster → 타입 홈');
});

test('no-JS: 홈 CTA → /pick 200 · 정적 L1 링크 → 타입 홈 200', async ({ newContext }) => {
  const ctx = await newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  const home = await page.goto('/');
  expect(home?.status()).toBe(200);
  await assertScreen(page, 'no-JS 홈');

  const cta = page.locator('section[data-ws-section="hero"] a[data-ws-action="pick-animal"]');
  await expect(cta).toHaveAttribute('href', '/pick');
  const [pickRes] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === '/pick' && r.request().isNavigationRequest()), cta.click()]);
  expect(pickRes.status()).toBe(200);
  await page.waitForURL('**/pick');
  // 정적 L1(aside) — 노출 타입 링크.
  const aside = page.locator('aside[data-ws-layer="L1"]');
  await expect(aside).toBeVisible();
  await assertScreen(page, 'no-JS /pick');
  const typeLink = aside.locator(`a.ws-type-card[href="${TYPE.home}"]`);
  await expect(typeLink).toHaveCount(1);
  const [typeRes] = await Promise.all([page.waitForResponse((r) => new URL(r.url()).pathname === TYPE.home && r.request().isNavigationRequest()), typeLink.click()]);
  expect(typeRes.status()).toBe(200);
  await expect(page.locator('h1#ws-context-title')).toHaveText(TYPE.name);
});

test('no-JS /hamster/golden 본문 — 타입명 · 필수 항목 · 규격 문장 · 병원 리스트', async ({ newContext }) => {
  const ctx = await newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  const res = await page.goto(TYPE.home);
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1#ws-context-title')).toHaveText(TYPE.name);
  const now = page.locator('section[data-ws-section="now"]');
  // 필수 항목(데모 시드: 케이지·쳇바퀴)과 각 규격 문장(최소 규격에서 나온 "… 이상").
  for (const [item, name, spec] of [
    ['cage', '케이지', '100×50×50cm 이상'], // BE92: 골든 케이지 최소 100×50×50(Kenny 2026-10-25)
    ['wheel', '쳇바퀴', '27cm 이상'], // BE92: 쳇바퀴 최소 27(85)
  ] as const) {
    const chip = now.locator(`li[data-ws-item="${item}"]`);
    await expect(chip).toContainText(name);
    await expect(chip).toContainText(spec);
  }
  const vets = page.locator('section[data-ws-section="vet"] li.ws-vet');
  await expect(vets).toHaveCount(3);
  await expect(page.locator('section[data-ws-section="vet"]')).toContainText('데모 동물병원 1');
  const products = page.locator('section[data-ws-section="products"] li.ws-product');
  await expect(products).toHaveCount(1);
  await assertScreen(page, 'no-JS /hamster/golden');
});

test('최소 규격 미달 상품 — 상품 페이지·용품 페이지·사이트맵 어디에도 없다(불변식 ③)', async ({ page, request }) => {
  expect(belowMinSeeded(), '데모 시드에 미달 상품 변형이 있어야 한다').toBe(true);
  const direct = await request.get(`${TYPE.home}/products/${BELOW_MIN_PRODUCT.id}`);
  expect(direct.status()).toBe(404);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain(BELOW_MIN_PRODUCT.id);
  // 같은 용품(쳇바퀴)의 추천이 실리는 화면 — L4 딥링크·용품 페이지.
  for (const url of [`${TYPE.home}/supplies/wheel`, '/supplies/wheel', `/supplies/wheel/${TYPE.id}`, TYPE.home]) {
    const r = await gotoHydrated(page, url);
    expect(r?.status(), url).toBe(200);
    await assertScreen(page, url);
    const html = await (await request.get(url)).text();
    expect(html.includes(BELOW_MIN_PRODUCT.id), `${url} HTML(ws-data 포함)에 미달 상품 id 0`).toBe(false);
  }
});

test("후기 '규격 확인해보기' → 동물 선택 → /hamster/golden/check/cage(L5)", async ({ page }) => {
  // 마퀴 정지(prefers-reduced-motion) — 움직이는 카드는 클릭 안정성 대기를 통과하지 못한다.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoHydrated(page, '/');
  // G3b: 홈 ws-data 의 타입별 specCheckItemId(데모: 골든 = cage).
  const types = await page.evaluate(() => (JSON.parse(document.getElementById('ws-data')?.textContent ?? '{}') as { data?: { types?: Array<{ id: string; specCheckItemId?: string }> } }).data?.types ?? []);
  expect(types.find((t) => t.id === TYPE.id)?.specCheckItemId).toBe('cage');
  const action = page.locator('section[data-ws-section="reviews"] button.ws-review-action:not([tabindex="-1"])', { hasText: '규격 확인해보기' }).first();
  await expect(action).toBeVisible();
  await tap(page, action);
  const L1 = page.locator('[data-ws-layer="L1"][role="dialog"]');
  await expect(L1).toBeVisible();
  await tap(page, L1.locator('[data-ws-group="SMALL_MAMMAL"]'));
  await Promise.all([page.waitForURL(`**${TYPE.home}/check/cage`), tap(page, L1.locator(`[data-ws-type="${TYPE.id}"]`))]);
  const L5 = page.locator('[data-ws-layer="L5"][role="dialog"]');
  await expect(L5).toBeVisible();
  await expect(L5.locator('h2')).toContainText('케이지');
  await assertScreen(page, '후기 → L5 케이지');

  // 이미 선택된 동물이 있으면 L1 없이 바로 같은 대상.
  await gotoHydrated(page, '/');
  const again = page.locator('section[data-ws-section="reviews"] button.ws-review-action:not([tabindex="-1"])', { hasText: '규격 확인해보기' }).first();
  await Promise.all([page.waitForURL(`**${TYPE.home}/check/cage`), tap(page, again)]);
  await expect(L5).toBeVisible();
});

// 96 S3 — /privacy 390: 가로 스크롤 래퍼 없이 표가 부모 폭 안, 문서 가로 넘침 0(모든 프로젝트에서 390 으로 맞춰 본다).
test('/privacy 390 — 표 폭 ≤ 부모 폭 · 문서 가로 넘침 0', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const res = await gotoHydrated(page, '/privacy');
  expect(res?.status()).toBe(200);
  await expect(page.locator('main h1')).toHaveText('개인정보 처리방침');
  const m = await page.evaluate(() => ({
    tables: Array.from(document.querySelectorAll<HTMLTableElement>('main table.ws-privacy-table')).map((t) => ({
      scroll: t.scrollWidth,
      parent: (t.parentElement as HTMLElement).clientWidth,
      wrapped: t.parentElement?.classList.contains('ws-privacy-table-wrap') ?? false,
    })),
    doc: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
  }));
  expect(m.tables.length).toBe(3);
  for (const [i, t] of m.tables.entries()) {
    expect(t.wrapped, `표 ${i} 래퍼 없음`).toBe(false);
    expect(t.scroll, `표 ${i} scrollWidth ≤ 부모 clientWidth`).toBeLessThanOrEqual(t.parent);
  }
  expect(m.doc.scroll, '문서 가로 넘침 0').toBeLessThanOrEqual(m.doc.client);
});
