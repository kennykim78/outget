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

// 286 U3a(D6): 홈 후기 섹션 비노출로 「후기 '규격 확인해보기' → L1 → L5」 시나리오 삭제. 의도 보존 경로(intent.ts)는 U3b 3카드에서 다시 덮는다.

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

// qa MED-1: 홈 B 「지금 필요한 것」 칩이 하이드레이션 뒤 재정렬(케이지 체크 ✓ → 호환 판정 △ 로 맨 앞)되어도
//   레일은 시작(scrollLeft 0)에 머문다 — Chrome scroll-snap 재스냅이 원래 첫 칩을 따라가 새 첫 칩이 왼쪽으로 잘리던 결함.
test('홈 B 칩 레일 — 재정렬 뒤에도 첫 칩이 잘리지 않는다(390 · 1280)', async ({ page }) => {
  await page.addInitScript((typeId) => {
    if (sessionStorage.getItem('ws.e2e.seeded')) return;
    sessionStorage.setItem('ws.e2e.seeded', '1');
    const now = new Date().toISOString();
    localStorage.setItem('ws.animalType', typeId);
    localStorage.setItem(
      `ws.setup.${typeId}`,
      JSON.stringify({ v: 3, firstTime: true, owned: [], answeredAt: now, startedAt: now, checks: { cage: { source: 'OWNED', at: now } }, uncheckedAt: {}, reached100At: null, updatedAt: now }),
    );
    localStorage.setItem(`ws.context.${typeId}.cage`, JSON.stringify({ v: 1, type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35, updatedAt: now }));
  }, TYPE.id);
  await gotoHydrated(page, TYPE.home);
  const rail = page.locator('section[data-ws-section="now"] ul.ws-chips');
  // 호환 판정 뒤 △ 케이지가 맨 앞(재정렬 완료).
  await expect(rail.locator('li').first()).toHaveAttribute('data-ws-item', 'cage');
  await expect(rail.locator('li').first().locator('a.ws-need')).toHaveAttribute('data-ws-state', 'check');
  await page.waitForTimeout(300); // 재스냅(스크롤 이벤트) 한 바퀴
  const m = await rail.evaluate((ul) => {
    const pad = parseFloat(getComputedStyle(ul).paddingLeft) || 0;
    const first = ul.querySelector('li')!.getBoundingClientRect().left;
    return { scrollLeft: ul.scrollLeft, first, start: ul.getBoundingClientRect().left + pad };
  });
  expect(m.scrollLeft, '레일 시작 고정').toBe(0);
  expect(m.first, '첫 칩 왼쪽 ≥ 레일 안쪽 시작').toBeGreaterThanOrEqual(m.start - 0.5);
});
