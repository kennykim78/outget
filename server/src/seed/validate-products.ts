// 큐레이션 상품 규칙 P01~P06 (불변식 1·3·7).
//   P01(meetsMinSpec 재계산 일치)은 엔진 checkProfileMinSpec 에 위임 — 판정 로직을 여기 두지 않는다.
import { isIsoDate, isNonEmptyStr, isSlotRow } from './common.js';
import type { Ctx } from './context.js';

/** 이미지 자산을 붙일 수 있는 사용권(불변식 1). NONE 이면 imageAsset 은 null. */
export const PRODUCT_IMAGE_LICENSES_WITH_ASSET = ['OWN_PHOTO', 'SELLER_PERMISSION', 'AFFILIATE_API'];

/** P05(M7): 상품 이미지는 동일 오리진 자산 경로만 — 외부 URL 핫링크·경로 순회·프로토콜 상대 URL 차단(불변식 1). */
export const PRODUCT_IMAGE_ASSET_RE = /^\/assets\/products\/[a-z0-9][a-z0-9-]*\.(webp|avif|jpg|jpeg|png)$/;

/** P01 재계산기 — validate.ts 가 엔진으로 주입한다. 반환 null = 재계산 불가(참조 오류, R09 가 보고). */
export type MeetsMinSpecFn = (careProfileId: string, supplyItemId: string, specValues: Record<string, unknown>) => boolean | null;

/** P06 참조 결과 — 규칙 key 또는 when key 로 참조하는가, 규칙 묶음별. */
export interface SpecRefers {
  minSpec: boolean;
  recommendedSpec: boolean;
}

/**
 * P06 참조 판정기 — validate.ts 가 엔진(resolveRequirement·referencedSpecKeys)으로 주입한다.
 *   프로필 기본 요구사항 ∪ 그 프로필 AnimalType 들의 해석 결과(careOverrides 반영) 기준(173).
 */
export type SpecRefersFn = (careProfileId: string, supplyItemId: string, key: string) => SpecRefers;

/** P06(154 B안·보안 144 LOW-2) 대상 필드 — 값이 '이 행의 CareProfile 동물' 상대 의미인 불리언. */
export const COVERS_THIS_ANIMAL_KEY = 'coversThisAnimal';

/** source[] 에 url 이 있는 항목이 하나라도 있는가(증빙 출처 — 운영자가 확인해 기록, 자동 수집 금지·불변식 1). */
function hasSourceUrl(source: unknown): boolean {
  return Array.isArray(source) && source.some((x) => x !== null && typeof x === 'object' && isNonEmptyStr((x as Record<string, unknown>).url));
}

/**
 * P06 — 겸용(MULTI) 사료의 '포장 대상에 이 동물 표기'(coversThisAnimal).
 *   P06a: 비SLOT ∧ coversThisAnimal === true ∧ source url 0 → ACTIVE·VERIFIED 면 ERROR, 그 외 WARN(증빙 없는 true 기입 차단).
 *   P06b: coversThisAnimal 키가 있고(값 무관 — false 도), 그 키를 minSpec 또는 recommendedSpec 이 참조하는
 *         careProfileIds(중복 제거)가 2개 이상 → ERROR(상대 의미 → 프로필별 행 분리). recommendedSpec 포함 근거:
 *         같은 행의 true 가 다른 동물의 '권장 충족' 표시 증빙으로도 재사용되면 안 된다(173).
 *   P06c: forSpecies=MULTI ∧ coversThisAnimal 없음 ∧ minSpec 참조 프로필 있음 → WARN(확인 전까지 meetsMinSpec=false — P01 이 강제).
 *   참조 = 규칙 key 또는 when key, 프로필 기본 요구사항 ∪ AnimalType.careOverrides 반영 결과(specRefersFn).
 */
function checkCoversThisAnimal(ctx: Ctx, rec: Record<string, unknown>, id: string, slot: boolean, refers: SpecRefersFn | null): void {
  const values = rec.specValues !== null && typeof rec.specValues === 'object' && !Array.isArray(rec.specValues) ? (rec.specValues as Record<string, unknown>) : {};
  const has = Object.prototype.hasOwnProperty.call(values, COVERS_THIS_ANIMAL_KEY);
  const path = `specValues.${COVERS_THIS_ANIMAL_KEY}`;

  if (!slot && values[COVERS_THIS_ANIMAL_KEY] === true && !hasSourceUrl(rec.source)) {
    const msg = '포장 대상 표기 증빙 출처 필요(LOW-2) — coversThisAnimal=true 면 source 에 url 이 있는 항목이 있어야 한다';
    if (rec.status === 'ACTIVE' || rec.reviewStatus === 'VERIFIED') ctx.out.error('P06', 'curatedProducts', id, path, msg);
    else ctx.out.warn('P06', 'curatedProducts', id, path, msg);
  }

  if (!refers || typeof rec.supplyItemId !== 'string') return;
  const profiles = Array.isArray(rec.careProfileIds) ? rec.careProfileIds.filter((x): x is string => typeof x === 'string') : [];
  const refs = [...new Set(profiles)].map((p) => ({ p, r: refers(p, rec.supplyItemId as string, COVERS_THIS_ANIMAL_KEY) }));
  const referring = refs.filter((x) => x.r.minSpec || x.r.recommendedSpec).map((x) => x.p);
  if (has && referring.length >= 2) {
    ctx.out.error('P06', 'curatedProducts', id, path, `coversThisAnimal 은 이 행의 동물 기준 값 — 참조 프로필 ${referring.length}개(${referring.join(', ')}) → 프로필별 행 분리`);
  }
  if (!has && values.forSpecies === 'MULTI' && refs.some((x) => x.r.minSpec)) {
    ctx.out.warn('P06', 'curatedProducts', id, path, '겸용 사료는 포장 대상 표기 확인 전까지 meetsMinSpec=false(최소 규격 CHECK)');
  }
}

export function checkProducts(ctx: Ctx, recompute: MeetsMinSpecFn | null, refers: SpecRefersFn | null = null): void {
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

    // P06 — 모든 행(P06a 는 비SLOT 만)
    checkCoversThisAnimal(ctx, rec, id, slot, refers);

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
