// 기동 시 1회 계산하는 허용 id 집합(index.ts → createApp).
//   knownTypeIds   — 병원 제보 treats 허용 동물(C-R5-4): 검수 통과 AnimalType.
//   knownTargetIds — 반응 대상(C-R5-3, SEC-3 L-7): 검수 통과 SupplyItem·SetupBundle + 규격·검수·상태 통과 CuratedProduct.
// 판정은 엔진 isVerified 단일 소스(VERIFIED ∧ 검수자 등급 ≥ OPERATOR — AI_DRAFT 제외, 불변식 ⑦).
// 상위집합 보장(거짓 400 없음): engine/exposure.ts 에서
//   노출 SupplyItem ⇒ requirementOk ⇒ okMeta(item) ⇒ isVerified(item)
//   노출 Bundle    ⇒ isBundleExposable ⇒ okMeta(bundle) ⇒ isVerified(bundle)
//   노출 상품      ⇒ exposedVerdict ⇒ ACTIVE ∧ meetsMinSpec ∧ okMeta ⇒ 아래 조건
//   검수 나이·동물별 요구사항 노출은 DB 행만으로 재현하지 않으므로 실제 노출 집합보다 넓을 수 있다
//   (반응은 노출·정렬·엔진 입력이 아니라 영향 없음, 불변식 ③).
// 시드 재적재 후에는 재기동으로 갱신된다. 비어 있으면 모든 대상이 거부된다(fail-closed).
import type { PrismaClient } from '@prisma/client';
import { isVerified } from '../engine/index.js';

type Meta = { reviewStatus: string; reviewerType: string };
type IdMeta = Meta & { id: string };
type ProductRow = IdMeta & { status: string; meetsMinSpec: boolean };

const verified = (m: Meta): boolean => isVerified(m as Parameters<typeof isVerified>[0]);

export function knownTypeIdsFrom(types: readonly IdMeta[]): ReadonlySet<string> {
  return new Set(types.filter(verified).map((t) => t.id));
}

export function knownTargetIdsFrom(rows: {
  supplyItems: readonly IdMeta[];
  bundles: readonly IdMeta[];
  products: readonly ProductRow[];
}): ReadonlySet<string> {
  const out = new Set<string>();
  for (const r of rows.supplyItems) if (verified(r)) out.add(r.id);
  for (const r of rows.bundles) if (verified(r)) out.add(r.id);
  for (const p of rows.products) if (p.status === 'ACTIVE' && p.meetsMinSpec === true && verified(p)) out.add(p.id);
  return out;
}

const META = { id: true, reviewStatus: true, reviewerType: true } as const;

export async function loadKnownIds(
  prisma: PrismaClient,
): Promise<{ knownTypeIds: ReadonlySet<string>; knownTargetIds: ReadonlySet<string> }> {
  const [types, supplyItems, bundles, products] = await Promise.all([
    prisma.animalType.findMany({ select: META }),
    prisma.supplyItem.findMany({ select: META }),
    prisma.setupBundle.findMany({ select: META }),
    prisma.curatedProduct.findMany({ select: { ...META, status: true, meetsMinSpec: true } }),
  ]);
  return {
    knownTypeIds: knownTypeIdsFrom(types),
    knownTargetIds: knownTargetIdsFrom({ supplyItems, bundles, products }),
  };
}
