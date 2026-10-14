// 큐레이션 상품 규칙 P01~P05 (불변식 1·3).
//   P01(meetsMinSpec 재계산 일치)은 엔진 checkProfileMinSpec 에 위임 — 판정 로직을 여기 두지 않는다.
import { isIsoDate, isNonEmptyStr, isSlotRow } from './common.js';
import type { Ctx } from './context.js';

/** 이미지 자산을 붙일 수 있는 사용권(불변식 1). NONE 이면 imageAsset 은 null. */
export const PRODUCT_IMAGE_LICENSES_WITH_ASSET = ['OWN_PHOTO', 'SELLER_PERMISSION', 'AFFILIATE_API'];

/** P05(M7): 상품 이미지는 동일 오리진 자산 경로만 — 외부 URL 핫링크·경로 순회·프로토콜 상대 URL 차단(불변식 1). */
export const PRODUCT_IMAGE_ASSET_RE = /^\/assets\/products\/[a-z0-9][a-z0-9-]*\.(webp|avif|jpg|jpeg|png)$/;

/** P01 재계산기 — validate.ts 가 엔진으로 주입한다. 반환 null = 재계산 불가(참조 오류, R09 가 보고). */
export type MeetsMinSpecFn = (careProfileId: string, supplyItemId: string, specValues: Record<string, unknown>) => boolean | null;

export function checkProducts(ctx: Ctx, recompute: MeetsMinSpecFn | null): void {
  const { out } = ctx;
  for (const { rec, id } of ctx.rows.curatedProducts) {
    const slot = isSlotRow('curatedProducts', rec);

    // P03·P05 — 모든 행(SLOT 포함)
    const asset = rec.imageAsset;
    if (asset !== null && asset !== undefined) {
      if (typeof asset !== 'string' || !PRODUCT_IMAGE_ASSET_RE.test(asset)) {
        out.error('P05', 'curatedProducts', id, 'imageAsset', `imageAsset 은 /assets/products/<kebab>.(webp|avif|jpg|jpeg|png) 만 (현재 ${JSON.stringify(asset)})`);
      }
      if (!PRODUCT_IMAGE_LICENSES_WITH_ASSET.includes(rec.imageLicense as string)) {
        out.error('P03', 'curatedProducts', id, 'imageLicense', `imageAsset 이 있으면 사용권 ${PRODUCT_IMAGE_LICENSES_WITH_ASSET.join('/')} 필요 (현재 ${String(rec.imageLicense)})`);
      }
    }

    // P04
    if (slot) {
      if (rec.reviewStatus === 'VERIFIED') out.error('P04', 'curatedProducts', id, 'reviewStatus', 'SLOT 은 VERIFIED 가 될 수 없다');
      continue;
    }

    // P01
    if (typeof rec.meetsMinSpec !== 'boolean') {
      out.error('P01', 'curatedProducts', id, 'meetsMinSpec', 'SLOT 아닌 상품은 meetsMinSpec boolean 필요(빌드 재계산 대상)');
    } else if (recompute) {
      const profiles = Array.isArray(rec.careProfileIds) ? rec.careProfileIds.filter((x): x is string => typeof x === 'string') : [];
      const values = (rec.specValues ?? {}) as Record<string, unknown>;
      const results = profiles.map((p) => recompute(p, rec.supplyItemId as string, values));
      if (profiles.length > 0 && results.every((x) => x !== null)) {
        const expected = results.every((x) => x === true);
        if (expected !== rec.meetsMinSpec) {
          out.error('P01', 'curatedProducts', id, 'meetsMinSpec', `시드 ${String(rec.meetsMinSpec)} ≠ 재계산 ${String(expected)} (specCheck, 불변식 3)`);
        }
        // P03b(감사 54 #7): 다프로필 상품의 프로필별 판정이 다르면 단일 boolean(AND)이 충족 프로필까지 숨긴다 → 행 분리 권고.
        if (profiles.length > 1 && new Set(results).size > 1) {
          const detail = profiles.map((p, i) => `${p}=${String(results[i])}`).join(', ');
          out.warn('P03b', 'curatedProducts', id, 'careProfileIds', `프로필별 최소 규격 판정이 다르다(${detail}) — 프로필별 행 분리`);
        }
      }
    }

    // P02
    if (rec.status === 'ACTIVE') {
      if (!isNonEmptyStr(rec.title)) out.error('P02', 'curatedProducts', id, 'title', 'ACTIVE 상품은 title 필요');
      if (!isNonEmptyStr(rec.specVerifiedBy)) out.error('P02', 'curatedProducts', id, 'specVerifiedBy', 'ACTIVE 상품은 규격 확인자 필요');
      if (!isIsoDate(rec.specVerifiedAt)) out.error('P02', 'curatedProducts', id, 'specVerifiedAt', 'ACTIVE 상품은 규격 확인일 필요');
      if (rec.meetsMinSpec !== true) out.error('P02', 'curatedProducts', id, 'meetsMinSpec', '최소 규격 미달·미확인 상품은 ACTIVE 불가(불변식 3)');
    }
  }
}
