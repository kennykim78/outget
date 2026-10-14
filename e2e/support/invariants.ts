// X2 화면 불변식 단언(R6 E2) — 여정의 각 화면에서 부른다.
//   금지어: server/src/seed/banned-words.json(콘텐츠 린트·compliance-scan 과 같은 단일 출처)의 banned 패턴 — 렌더된 body innerText 기준.
//   '판매처': 금지어는 아니지만 상품 면에 판매처 노출 0 — 면책 문구(copy.ts 의 priceNote 2개)만 허용.
//   BELOW_MIN: 데모 시드에 넣은 최소 규격 미달 상품(demo-seed.mts BELOW_MIN_PRODUCT)이 DOM 어디에도 0(불변식 ③ — 추천 영역 금지).
//   외부 요청 0·pageerror 0 은 fixtures 의 guard 가 맡는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';
import { REPO_ROOT } from './repo';

interface BannedFile {
  banned: Array<{ term: string; pattern: string }>;
}

const BANNED_PATH = join(REPO_ROOT, 'server', 'src', 'seed', 'banned-words.json');
const COPY_PATH = join(REPO_ROOT, 'server', 'src', 'prerender', 'copy.ts');

/** 금지어(용어, 정규식) — banned-words.json 의 banned 전부(전문가 N명 패턴 포함). */
export const BANNED: ReadonlyArray<{ term: string; re: RegExp }> = (JSON.parse(readFileSync(BANNED_PATH, 'utf8')) as BannedFile).banned.map((b) => ({
  term: b.term,
  re: new RegExp(b.pattern, 'u'),
}));
if (BANNED.length < 8) throw new Error(`e2e: 금지어 목록이 비정상(${BANNED.length}개) — ${BANNED_PATH}`);

/**
 * 가격 면책 문구(copy.ts `priceNote: sent('…')`) — '판매처'가 들어가도 되는 유일한 문장들.
 *   copy.ts 는 ESM(서버 패키지)이라 CJS 스펙에서 import 하지 않고 원문에서 읽는다(문구 단일 출처 유지).
 */
export const PRICE_NOTES: readonly string[] = Array.from(readFileSync(COPY_PATH, 'utf8').matchAll(/priceNote:\s*sent\('([^']+)'\)/g), (m) => m[1]);
if (PRICE_NOTES.length < 2 || !PRICE_NOTES.every((n) => n.includes('판매처'))) {
  throw new Error(`e2e: copy.ts priceNote 면책 문구를 찾지 못했다(${PRICE_NOTES.length}개) — ${COPY_PATH}`);
}

/** 데모 시드의 최소 규격 미달 상품 — below-min.json 단일 출처(demo-seed.mts 가 같은 파일로 메모리 시드에 더한다). */
export const BELOW_MIN_PRODUCT = JSON.parse(readFileSync(join(__dirname, 'below-min.json'), 'utf8')) as { id: string; title: string; diameterCm: number };

export const belowMinSeeded = (): boolean => process.env.E2E_BELOW_MIN_SEEDED === '1';

/** 면책 문구를 지운 텍스트(판매처 검사용). */
export function withoutPriceNotes(text: string): string {
  let t = text;
  for (const n of PRICE_NOTES) t = t.split(n).join('');
  return t;
}

/** 텍스트 안의 금지어 용어 목록(없으면 []). */
export function bannedIn(text: string): string[] {
  return BANNED.filter((b) => b.re.test(text)).map((b) => b.term);
}

/** 문서 가로 넘침(px) — layout 너비가 화면보다 넓으면 모바일 브라우저가 페이지를 축소해 보여 준다(반응형 깨짐). 0 이면 정상. */
export async function pageOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth, window.innerWidth - document.documentElement.clientWidth));
}

/**
 * 클릭. 문서가 가로로 넘쳐 모바일 에뮬레이션이 축소 배율이 되면(알려진 결함 — 보고서 E2-D1) 좌표 클릭이 다른 요소에 맞는다.
 *   그 경우만 DOM click 이벤트로 대신하고(여정의 나머지 단언을 계속 검증), 넘침 자체는 assertScreen 의 soft 단언이 실패로 남긴다.
 *   결함이 고쳐지면 항상 실제 클릭 경로만 탄다.
 */
export async function tap(page: Page, target: Locator): Promise<void> {
  if ((await pageOverflowPx(page)) > 0) {
    await target.scrollIntoViewIfNeeded();
    await target.dispatchEvent('click');
    return;
  }
  await target.click();
}

const overflowReported = new WeakSet<Page>();

/** 화면 불변식: 금지어 0 · 판매처는 면책 문구만 · 최소 규격 미달 상품 0 · 문서 가로 넘침 0(soft). label 은 실패 메시지용. */
export async function assertScreen(page: Page, label: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  // 넘침은 같은 page 에서 처음 한 번만 soft 실패로 남긴다(같은 문서의 레이어마다 반복 보고하지 않게).
  const over = await pageOverflowPx(page);
  if (over > 0 && !overflowReported.has(page)) {
    overflowReported.add(page);
    expect.soft(over, `[${label}] 문서 가로 넘침 0(넘치면 모바일이 페이지를 축소 표시) — ${page.url()}`).toBe(0);
  }
  const text = await page.locator('body').innerText();
  expect(bannedIn(text), `[${label}] 금지어 0`).toEqual([]);
  expect(withoutPriceNotes(text).includes('판매처'), `[${label}] '판매처'는 면책 문구 밖에 0`).toBe(false);
  await expect(page.locator(`[data-ws-id="curatedProducts#${BELOW_MIN_PRODUCT.id}"]`), `[${label}] 미달 상품 노드 0`).toHaveCount(0);
  await expect(page.locator(`a[href*="/products/${BELOW_MIN_PRODUCT.id}"]`), `[${label}] 미달 상품 링크 0`).toHaveCount(0);
  expect(text.includes(BELOW_MIN_PRODUCT.title), `[${label}] 미달 상품 이름 0`).toBe(false);
}
