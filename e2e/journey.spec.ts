// X1 데모 완주 + X2 화면 불변식(R6 E2) — 데모 시드 전용(실시드는 real-seed.spec.ts).
//   홈 A → L1(소동물 → 골든햄스터) → 홈 B → L3 2질문 → L2 체크 → L4 쳇바퀴 → L5 판정(30 ✓ · 20 ✕ · 누락 ?)
//   → L6 케이지 60×40×35 → 재판정 △ '공간 조건 재확인' → /setup → L7(✓ 기준 충족 · 가격·판매처·구매 0) → /vet/서울-마포구
//   → L8 이메일 → 메일 링크 → [이 기기 연결하기] → 확인(마스킹 주소) → [이 주소로 저장하기] → 다른 컨텍스트 새 링크 → 체크·케이지 복원.
//   각 화면: assertScreen(금지어 0 · 판매처 면책만 · 미달 상품 0). 외부 요청 0·pageerror 0 은 guard 가 테스트 끝에 단언.
import type { Locator, Page } from '@playwright/test';
import { test, expect, e2eEnv } from './support/fixtures';
import { assertScreen, belowMinSeeded, PRICE_NOTES, tap, withoutPriceNotes } from './support/invariants';
import { mailsTo, waitForSaveLink } from './support/mail';

const TYPE = { id: 'hamster-golden', name: '골든햄스터', home: '/hamster/golden' } as const;
// 데모 시드(server/seed + 메모리 승격) 값: 케이지 최소 60×40×30cm, 쳇바퀴 최소 28cm·권장 30cm.
const CAGE = { floorWcm: '60', floorDcm: '40', heightCm: '35' } as const;

test.skip(() => process.env.E2E_SEED_MODE !== 'demo', '데모 시드 전용');

const layer = (page: Page, kind: string): Locator => page.locator(`[data-ws-layer="${kind}"][role="dialog"]`);

/** L5 폼 채우고 판정. diameter '' = 값 누락. */
async function judgeWheel(L5: Locator, diameter: string): Promise<Locator> {
  const page = L5.page();
  await L5.locator('input[name="diameterCm"]').fill(diameter);
  for (const radio of [L5.locator('[data-ws-field="surface"] input[value="SOLID"]'), L5.locator('[data-ws-field="mount"] input[value="STAND"]')]) {
    if (!(await radio.isChecked())) await tap(page, radio.locator('xpath=..'));
    await expect(radio).toBeChecked();
  }
  await tap(page, L5.locator('button.ws-spec-submit'));
  return L5.locator('section.ws-verdict');
}

test('X1 데모 완주 — 홈 A → L1 → 홈 B → L3 → L2 → L4 → L5/L6 → setup → L7 → 병원 → L8 저장 → 다른 기기 복원', async ({ page, newContext, baseURL }, testInfo) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL as string).origin;
  expect(belowMinSeeded(), '데모 시드에 최소 규격 미달 상품 변형이 들어가 있어야 X2 ③ 단언이 의미 있다').toBe(true);

  await test.step('홈 A → L1 → 소동물 → 골든햄스터(홈 B)', async () => {
    await page.goto('/');
    await expect(page.locator('#ws-hero-title')).toBeVisible();
    await expect(page.locator('.ws-context')).toHaveCount(0);
    await assertScreen(page, '홈 A');
    await page.locator('section[data-ws-section="hero"] a[data-ws-action="pick-animal"]').click();
    const L1 = layer(page, 'L1');
    await expect(L1).toBeVisible();
    await expect(L1.locator('h2')).toHaveText('어떤 친구인가요?');
    await assertScreen(page, 'L1 그룹');
    await L1.locator('[data-ws-group="SMALL_MAMMAL"]').click();
    await expect(L1.locator('[data-ws-step="types"]')).toBeVisible();
    await assertScreen(page, 'L1 타입');
    await Promise.all([page.waitForURL(`**${TYPE.home}`), L1.locator(`[data-ws-type="${TYPE.id}"]`).click()]);
    await expect(page.locator('h1#ws-context-title')).toHaveText(TYPE.name);
    expect(await page.evaluate(() => localStorage.getItem('ws.animalType'))).toBe(TYPE.id);
    // L3 전: 숫자 없음.
    await expect(page.locator('section[data-ws-section="now"]')).toHaveAttribute('data-ws-answered', '0');
    await assertScreen(page, '홈 B(L3 전)');
  });

  await test.step('L3 2질문 → L2 체크리스트 체크', async () => {
    await tap(page, page.locator('section[data-ws-section="save"] button.ws-btn--fill'));
    const L2 = layer(page, 'L2');
    await expect(L2.locator('[data-ws-step="L3"]')).toBeVisible();
    await assertScreen(page, 'L3');
    const next = L2.getByRole('button', { name: '다음' });
    await expect(next).toBeDisabled();
    await tap(page, L2.locator('label', { hasText: '처음 키워요' }));
    await expect(next).toBeEnabled();
    await tap(page, next);
    await expect(L2.locator('[data-ws-step="L2"]')).toBeVisible();
    const cageRow = L2.locator('li[data-ws-id="supplyRequirements#cage"]');
    await expect(cageRow).toHaveAttribute('data-ws-state', 'FIRST');
    await tap(page, cageRow.locator('[role="checkbox"]'));
    await expect(cageRow.locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'true');
    await expect(cageRow).toHaveAttribute('data-ws-state', 'READY');
    await assertScreen(page, 'L2');
    const setup = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), `ws.setup.${TYPE.id}`)) ?? 'null') as {
      firstTime: boolean;
      checks: Record<string, unknown>;
    } | null;
    expect(setup?.firstTime).toBe(true);
    expect(Object.keys(setup?.checks ?? {})).toEqual(['cage']);
  });

  const L5 = layer(page, 'L5');
  await test.step('L4 쳇바퀴 → L5 규격 판정(30 ✓ · 20 ✕ · 누락 ?)', async () => {
    const L2 = layer(page, 'L2');
    await Promise.all([page.waitForURL(`**${TYPE.home}/supplies/wheel`), tap(page, L2.getByRole('link', { name: '쳇바퀴 자세히' }))]);
    const L4 = layer(page, 'L4');
    await expect(L4).toBeVisible();
    await expect(L4.locator('h2')).toHaveText('쳇바퀴');
    // 왜 → 조건 → 주의 → 피할 것 순서.
    const parts = await L4.locator('section[data-ws-part]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ws-part')));
    expect(parts.filter((p) => ['why', 'conditions', 'caution', 'avoid'].includes(p ?? ''))).toEqual(['why', 'conditions', 'caution', 'avoid']);
    await assertScreen(page, 'L4');
    await Promise.all([page.waitForURL(`**${TYPE.home}/check/wheel`), tap(page, L4.locator('.ws-layer-foot a', { hasText: '규격 확인' }))]);
    await expect(L5.locator('[data-ws-step="L5"]')).toBeVisible();
    await assertScreen(page, 'L5');

    const v30 = await judgeWheel(L5, '30');
    await expect(v30).toHaveAttribute('data-ws-verdict', 'OK');
    await expect(v30.locator('[data-ws-tier="product"] .ws-verdict-glyph')).toHaveText('✓');
    await expect(v30.locator('[data-ws-tier="compat"]')).toHaveCount(0);
    await assertScreen(page, 'L5 30cm');

    const v20 = await judgeWheel(L5, '20');
    await expect(v20).toHaveAttribute('data-ws-verdict', 'BELOW_MIN');
    await expect(v20.locator('[data-ws-tier="product"] .ws-verdict-glyph')).toHaveText('✕');
    await assertScreen(page, 'L5 20cm');

    const vNone = await judgeWheel(L5, '');
    await expect(vNone).toHaveAttribute('data-ws-verdict', 'CHECK');
    await expect(vNone.locator('[data-ws-tier="product"] .ws-verdict-glyph')).toHaveText('?');
    await assertScreen(page, 'L5 값 누락');
  });

  await test.step('L6 내 케이지 60×40×35 → 재판정 △ 공간 조건 재확인', async () => {
    await tap(page, L5.locator('[data-ws-cage-row="empty"] button'));
    await expect(L5.locator('[data-ws-step="L6"]')).toBeVisible();
    await assertScreen(page, 'L6');
    const save = L5.locator('button.ws-cage-save');
    await expect(save).toBeDisabled();
    const living = L5.locator('[data-ws-field="type"] input[value="LIVING_BOX"]');
    await tap(page, living.locator('xpath=..'));
    await expect(living).toBeChecked();
    for (const [k, v] of Object.entries(CAGE)) await L5.locator(`input[name="${k}"]`).fill(v);
    await expect(save).toBeEnabled();
    await tap(page, save);
    await expect(L5.locator('[data-ws-step="L5"]')).toBeVisible();
    await expect(L5.locator('[data-ws-cage-row="set"]')).toContainText('60×40×35cm');
    const cage = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), `ws.context.${TYPE.id}.cage`)) ?? 'null') as Record<string, unknown> | null;
    expect(cage).toMatchObject({ type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 });

    const v = await judgeWheel(L5, '30');
    await expect(v).toHaveAttribute('data-ws-verdict', 'CHECK');
    await expect(v.locator('[data-ws-tier="product"] .ws-verdict-glyph')).toHaveText('✓');
    const compat = v.locator('[data-ws-tier="compat"]');
    await expect(compat.locator('.ws-verdict-glyph')).toHaveText('△');
    await expect(compat).toContainText('공간 조건 재확인');
    await assertScreen(page, 'L5 케이지 재판정');
  });

  await test.step('/setup 구성안 → 홈 B → L7 상품(✓ 기준 충족 · 가격·판매처·구매 0)', async () => {
    await page.goto(`${TYPE.home}/setup`);
    await expect(page.locator('main section.ws-bundle').first()).toBeVisible();
    await expect(page.locator('main')).toContainText('처음 준비한다면');
    await assertScreen(page, '/setup');

    await page.goto(TYPE.home);
    await expect(page.locator('h1#ws-context-title')).toHaveText(TYPE.name);
    // L3 응답 후: 숫자 줄. 케이지 ✓, 쳇바퀴는 케이지 등록으로 △.
    await expect(page.locator('section[data-ws-section="now"]')).toHaveAttribute('data-ws-answered', '1');
    await expect(page.locator('section[data-ws-section="now"] li[data-ws-item="cage"] [data-ws-state]')).toHaveAttribute('data-ws-state', 'ready');
    await expect(page.locator('section[data-ws-section="now"] li[data-ws-item="wheel"] [data-ws-state]')).toHaveAttribute('data-ws-state', 'check');
    await assertScreen(page, '홈 B(L3 후)');

    const products = page.locator('section[data-ws-section="products"] li.ws-product');
    await expect(products).toHaveCount(1);
    await expect(products.first().locator('.ws-badge')).toContainText('기준 충족');
    await expect(products.first().locator('.ws-badge [data-ws-glyph="ready"]')).toHaveText('✓');
    await Promise.all([page.waitForURL(`**${TYPE.home}/products/cp-001`), tap(page, products.first().locator('a').first())]);
    const L7 = layer(page, 'L7');
    await expect(L7).toBeVisible();
    await expect(L7.locator('.ws-badge')).toContainText('기준 충족');
    await expect(L7.locator('.ws-badge [data-ws-glyph="ready"]')).toHaveText('✓');
    await expect(L7.locator('[data-ws-part="reasons"] li').first()).toBeVisible();
    const noCommerce = async (label: string) => {
      const t = withoutPriceNotes(await L7.innerText());
      expect(t, `[${label}] 가격·판매처·구매 문구 0`).not.toMatch(/구매|판매처|가격|최저가|₩|\d\s*원|별점|★/);
    };
    await noCommerce('L7');
    await assertScreen(page, 'L7');
    await tap(page, L7.locator('button.ws-product-detail-find'));
    await expect(L7.locator('button.ws-product-detail-find')).toHaveAttribute('aria-expanded', 'true');
    await noCommerce('L7 찾기 펼침');
    // 펼치면 면책 문구(가격·판매처는 검색 결과에서)만.
    await expect(L7).toContainText(PRICE_NOTES.find((n) => n.startsWith('가격')) ?? '');
    await assertScreen(page, 'L7 찾기 펼침');
  });

  await test.step('/vet/서울-마포구 — 그 지역 병원만', async () => {
    await page.goto('/vet/서울-마포구');
    await expect(page.locator('main')).toContainText('서울 마포구');
    const vets = page.locator('main li.ws-vet');
    await expect(vets).toHaveCount(1);
    await expect(vets.first()).toContainText('데모 동물병원 1');
    await expect(page.locator('main')).not.toContainText('데모 동물병원 2');
    await assertScreen(page, '/vet/서울-마포구');
  });

  const email = `e2e-x1-${testInfo.project.name}-${Date.now()}@example.com`;
  await test.step('L8 저장 — 메일 링크 → 이 기기 연결하기 → 확인(마스킹) → 이 주소로 저장하기', async () => {
    await page.goto(TYPE.home);
    await Promise.all([page.waitForURL('**/save'), tap(page, page.locator('section[data-ws-section="save"] a.ws-save-link'))]);
    const L8 = layer(page, 'L8');
    await expect(L8.locator('[data-ws-save="input"]')).toBeVisible();
    await expect(L8.locator('[data-ws-save="summary"]')).toContainText(TYPE.name);
    await assertScreen(page, 'L8 입력');
    const before = mailsTo(email).length;
    await L8.locator('input[type="email"]').fill(email);
    await tap(page, L8.getByRole('button', { name: '인증 메일 보내기' }));
    await expect(L8.locator('[data-ws-save="sent"]')).toBeVisible();
    await assertScreen(page, 'L8 보냄');
    const link = await waitForSaveLink(email, before, origin);

    await page.goto(link);
    await expect(L8.locator('[data-ws-save="connect"]')).toBeVisible();
    // 토큰은 즉시 주소창에서 지운다.
    expect(new URL(page.url()).hash).toBe('');
    await assertScreen(page, 'L8 연결');
    await tap(page, L8.getByRole('button', { name: '이 기기 연결하기' }));
    const masked = L8.locator('[data-ws-save="confirm-masked"]');
    await expect(masked).toBeVisible();
    await expect(masked).not.toContainText(email);
    await expect(masked).toContainText('***');
    await assertScreen(page, 'L8 확인');
    await tap(page, L8.getByRole('button', { name: '이 주소로 저장하기' }));
    await expect(L8.locator('[data-ws-save="confirmed"]')).toBeVisible();
    await assertScreen(page, 'L8 저장됨');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('ws.save'))) ?? '{}')).toMatchObject({ linked: true });
  });

  await test.step('다른 브라우저 컨텍스트 — 새 링크로 연결 → 체크·케이지 복원', async () => {
    const ctx2 = await newContext();
    const p2 = await ctx2.newPage();
    await p2.goto('/save');
    const L8 = layer(p2, 'L8');
    await expect(L8.locator('[data-ws-save="input"]')).toBeVisible();
    expect(await p2.evaluate((k) => localStorage.getItem(k), `ws.setup.${TYPE.id}`)).toBeNull();
    const before = mailsTo(email).length;
    await L8.locator('input[type="email"]').fill(email);
    await tap(p2, L8.getByRole('button', { name: '인증 메일 보내기' }));
    await expect(L8.locator('[data-ws-save="sent"]')).toBeVisible();
    const link2 = await waitForSaveLink(email, before, origin);
    await p2.goto(link2);
    await tap(p2, L8.getByRole('button', { name: '이 기기 연결하기' }));
    // 서버에 저장된 준비가 있으므로 확인 화면을 거친다(R6 D2) — 복원은 그 전에 로컬로 합쳐진다.
    await expect(L8.locator('[data-ws-save="confirm-masked"]')).toBeVisible();
    await tap(p2, L8.getByRole('button', { name: '이 주소로 저장하기' }));
    await expect(L8.locator('[data-ws-save="confirmed"]')).toBeVisible();
    await assertScreen(p2, '다른 기기 L8 저장됨');

    const setup = JSON.parse((await p2.evaluate((k) => localStorage.getItem(k), `ws.setup.${TYPE.id}`)) ?? 'null') as {
      firstTime: boolean;
      checks: Record<string, unknown>;
    } | null;
    expect(setup?.firstTime).toBe(true);
    expect(Object.keys(setup?.checks ?? {})).toEqual(['cage']);
    const cage = JSON.parse((await p2.evaluate((k) => localStorage.getItem(k), `ws.context.${TYPE.id}.cage`)) ?? 'null') as Record<string, unknown> | null;
    expect(cage).toMatchObject({ type: 'LIVING_BOX', floorWcm: 60, floorDcm: 40, heightCm: 35 });
    expect(await p2.evaluate(() => localStorage.getItem('ws.animalType'))).toBe(TYPE.id);

    // 화면 복원: 홈 B 칩(케이지 ✓ · 쳇바퀴 △) · L5 케이지 줄.
    await p2.goto(TYPE.home);
    await expect(p2.locator('h1#ws-context-title')).toHaveText(TYPE.name);
    await expect(p2.locator('section[data-ws-section="now"] li[data-ws-item="cage"] [data-ws-state]')).toHaveAttribute('data-ws-state', 'ready');
    await expect(p2.locator('section[data-ws-section="now"] li[data-ws-item="wheel"] [data-ws-state]')).toHaveAttribute('data-ws-state', 'check');
    await assertScreen(p2, '다른 기기 홈 B');
    await p2.goto(`${TYPE.home}/check/wheel`);
    await expect(layer(p2, 'L5').locator('[data-ws-cage-row="set"]')).toContainText('60×40×35cm');
  });

  // 서버 매직링크는 E2E_MAIL_FILE 에만(외부 발송 0).
  expect(e2eEnv('E2E_MAIL_FILE')).toBeTruthy();
});
