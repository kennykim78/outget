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

test('no-JS /hamster/golden 본문 — 타입명 · 필수 항목 카드 · 규격 숫자 · 구성안·준비물·병원 레일(R4-2b)', async ({ newContext }) => {
  const ctx = await newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  const res = await page.goto(TYPE.home);
  expect(res?.status()).toBe(200);
  await expect(page.locator('h1#ws-context-title')).toHaveText(TYPE.name);
  const now = page.locator('section[data-ws-section="now"]');
  // 필수 항목(데모 시드: 케이지·쳇바퀴) 카드 — 정적은 neutral.
  for (const [item, name] of [
    ['cage', '케이지'],
    ['wheel', '쳇바퀴'],
  ] as const) {
    const card = now.locator(`li[data-ws-item="${item}"]`);
    await expect(card).toContainText(name);
    await expect(card.locator('a.ws-now-card')).toHaveAttribute('data-ws-state', 'neutral');
  }
  // 규격 숫자 = 시드 최소 규격(BE92: 골든 케이지 100×50×50, Kenny 2026-10-25) — 엔진 minSpecFigure.
  await expect(page.locator('section[data-ws-section="spec"] .ws-spec-sec-value')).toHaveText('100×50×50');
  await expect(page.locator('section[data-ws-section="vet"] a[href="/vet"]')).toHaveCount(1);
  // R4-2b: PRD US-003 레일 복원 — 데모 시드 병원 3 · 상품 1 · 구성안 ≥1.
  const vets = page.locator('section[data-ws-section="vet"] li.ws-vet');
  await expect(vets).toHaveCount(3);
  await expect(page.locator('section[data-ws-section="vet"]')).toContainText('데모 동물병원 1');
  await expect(page.locator('section[data-ws-section="products"] li.ws-product')).toHaveCount(1);
  await expect(page.locator('section[data-ws-section="bundles"] li[data-ws-tier]').first()).toBeVisible();
  // qa MED-1: 정적에서도 보이는 항목 링크(390 = 링크 줄, 1280 = 카드) — 이름만 있는 비링크 줄 0.
  for (const item of ['cage', 'wheel']) {
    await expect(
      now.locator(`li[data-ws-item="${item}"] a.ws-now-card:visible, li[data-ws-now-link="${item}"] a.ws-now-link:visible`),
    ).toHaveAttribute('href', `${TYPE.home}/supplies/${item}`);
  }
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

// R4-2(이월 R4-1 qa MED-1): 홈 B 「지금 필요한 것」은 가로 레일이 아니라 카드 그리드 — 재정렬 없이 derive 순서 고정.
//   케이지 체크 ✓ → 호환 판정 뒤 △ 로 바뀌면 카드가 제자리(입력 순서)에 나타날 뿐, 앞 카드 순서는 흔들리지 않는다.
test('홈 B 항목 카드 — 판정 뒤에도 derive 순서(케이지 → 쳇바퀴)를 지킨다(390 · 1280)', async ({ page }) => {
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
  const items = page.locator('section[data-ws-section="now"] li.ws-now-item');
  await expect(items.first()).toHaveAttribute('data-ws-item', 'cage');
  await expect(items.first().locator('a.ws-now-card')).toHaveAttribute('data-ws-state', 'check');
  const ids = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-ws-item')));
  expect(ids.indexOf('cage')).toBeLessThan(ids.indexOf('wheel'));
  const doc = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(doc.scroll, '문서 가로 넘침 0').toBeLessThanOrEqual(doc.client);
});

// U2b(Kenny D1·D2·D3 2026-11-14): 헤더 메뉴 — 탭바 0. 1280 = 메뉴 3 바로 보임·단추 숨김.
//   390 = 「메뉴」 단추(aria-expanded) → 패널 펼침(첫 링크 포커스) · Esc 닫힘(단추 복귀). no-JS 390 = 단추 숨김 + 메뉴 링크 보임(scripting: none).
test('U2b 헤더 메뉴 — 1280 메뉴 3 · 390 메뉴 단추 펼침/Esc · no-JS 링크 보임 · 탭바 0', async ({ page, newContext }) => {
  const mobile = (page.viewportSize()?.width ?? 0) <= 767;
  const menu = (p: typeof page) => p.locator('header.ws-header nav#ws-nav');
  const links = (p: typeof page) => menu(p).locator('a:not([data-ws-chip])');
  await gotoHydrated(page, '/');
  await expect(page.locator('.ws-tabbar, .ws-tab')).toHaveCount(0);
  await expect(links(page)).toHaveText(['준비물', '크기 확인', '병원']);
  const btn = page.getByRole('button', { name: '메뉴' });
  if (!mobile) {
    await expect(btn).toBeHidden();
    for (const a of await links(page).all()) await expect(a).toBeVisible();
    await expect(menu(page).locator('a[data-ws-chip]')).toHaveText('친구 선택하기');
  } else {
    await expect(btn).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(links(page).first()).toBeFocused();
    for (const a of await links(page).all()) await expect(a).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(btn).toBeFocused();
    await expect(menu(page)).toBeHidden();
  }
  await assertScreen(page, 'U2b 헤더');

  const ctx = await newContext({ javaScriptEnabled: false });
  const nojs = await ctx.newPage();
  await nojs.goto('/');
  await expect(nojs.getByRole('button', { name: '메뉴' })).toBeHidden();
  for (const a of await links(nojs).all()) await expect(a).toBeVisible();
  const [res] = await Promise.all([
    nojs.waitForResponse((r) => new URL(r.url()).pathname === '/vet' && r.request().isNavigationRequest()),
    links(nojs).filter({ hasText: '병원' }).click(),
  ]);
  expect(res.status()).toBe(200);
  await expect(nojs.locator('.ws-tabbar, .ws-tab')).toHaveCount(0);
});

// qa MED-2: JS 번들이 오지 않으면(로드 실패·차단·하이드레이션 전) <html data-ws-js> 표식이 없다 — ≤767 에서도 「메뉴」 단추는 숨고
//   nav 링크(준비물·크기 확인·병원·칩)가 헤더 한 줄(가로 스크롤)로 보인다. 헤더 높이는 하이드레이션 뒤와 같다(레이아웃 시프트 0).
test('qa MED-2 JS 번들 차단 — 단추 숨김 · nav 링크 보임·이동 · 헤더 높이 = 하이드레이션 뒤', async ({ page, newContext }) => {
  const links = (p: typeof page) => p.locator('header.ws-header nav#ws-nav a');
  await gotoHydrated(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-ws-js', '');
  const hydratedH = (await page.locator('header.ws-header').boundingBox())?.height;

  const ctx = await newContext();
  const blocked = await ctx.newPage();
  let aborted = 0;
  await blocked.route(
    (u) => /\.m?js$/.test(u.pathname),
    (r) => {
      aborted += 1;
      return r.abort();
    },
  );
  await blocked.goto('/');
  expect(aborted, 'JS 번들 요청을 실제로 막았다').toBeGreaterThan(0);
  await expect(blocked.locator('#root')).toHaveAttribute('data-ws-prerendered', /.*/); // 하이드레이션 안 됨
  await expect(blocked.locator('html')).not.toHaveAttribute('data-ws-js', /.*/);
  await expect(blocked.getByRole('button', { name: '메뉴' })).toBeHidden();
  await expect(links(blocked)).toHaveText(['준비물', '크기 확인', '병원', '친구 선택하기']);
  for (const a of await links(blocked).all()) await expect(a).toBeVisible();
  expect((await blocked.locator('header.ws-header').boundingBox())?.height).toBe(hydratedH);
  await assertScreen(blocked, 'JS 차단 홈');
  const [res] = await Promise.all([
    blocked.waitForResponse((r) => new URL(r.url()).pathname === '/vet' && r.request().isNavigationRequest()),
    links(blocked).filter({ hasText: '병원' }).click(),
  ]);
  expect(res.status()).toBe(200);
});
