// L6 등록한 케이지 보기(R4-5 · R4 시안 l6_my_cage) — 순수 함수. 판정 계산은 @ws/engine 만(불변식 ⑥), 여기는 결과를 글자로 옮길 뿐.
//   두 가지를 섞지 않는다(R4 notes):
//     ① 자체 최소 규격 = 등록한 케이지 값 × 이 동물의 케이지 최소·권장(engine.specCheck 제품 단, 사용자 컨텍스트 없음 — cageCompatMap 과 같은 호출)
//     ② 용품 간 호환 = 다른 용품의 해석된 최소(빈 값은 권장) 규격 × 내 케이지(engine.requirementCompat — L2 △·L4 서브카드와 같은 호출)
//   숫자는 저장값·해석된 minSpec·엔진 Reason 만. 시안의 「쳇바퀴 30 + 베딩 25 / 필요 높이 55」 같은 피연산자는 엔진이 내지 않으므로 그리지 않는다.
//   대상 요구사항은 같은 문서 ws-data(VERIFIED 노출분)만 — 없는 항목은 판정하지 않는다(불변식 ⑦).
//   표시용: 노출·정렬 영향 0(불변식 ③).
import { COPY, comitativeParticle, formatCopy } from '@ws/copy';
import type { Engine, PublicRequirement, Reason, SpecCheckResult } from '@ws/engine';
import { compatMark, isProductNoCriteria, isSmallOnly, minFigure, productMark, reasonMessages, verdictTitle, type VerdictMark } from '../speccheck/verdictView';
import { CAGE_ITEM_ID, toUserContext, type CageV1 } from './cageStore';

export interface CageSelfView {
  mark: VerdictMark;
  title: string;
  /** 「최소 규격 100×50×50cm 이상」 — 해석된 minSpec 의 숫자 gte 규칙(minFigure). 없으면 null. */
  minText: string | null;
  /** 충족이 아닐 때 엔진 Reason.message(중복 제거). */
  messages: string[];
}

export interface CageCompatItemView {
  supplyItemId: string;
  mark: VerdictMark;
  title: string;
  messages: string[];
  /** 엔진이 권장 규격으로 빈 값을 채웠다고 알릴 때만 true(문구 분기만). */
  usedRecommended: boolean;
}

export interface CageReview {
  self: CageSelfView | null;
  /** CHECK·BELOW_MIN 인 용품만(요구사항 순서). OK·NONE 은 그리지 않는다 — 가상 기준값으로 「호환」을 과대 표시하지 않게. */
  compat: CageCompatItemView[];
}

function nonOkMessages(reasons: readonly Reason[]): string[] {
  return reasonMessages(reasons.filter((r) => r.verdict !== 'OK'));
}

export function cageSelfView(
  engine: Pick<Engine, 'specCheck'>,
  typeId: string,
  cageReq: PublicRequirement,
  cage: CageV1,
  animalName: string,
): CageSelfView | null {
  const owned = toUserContext(cage)?.ownedItems[CAGE_ITEM_ID];
  if (!owned) return null;
  let product: SpecCheckResult['product'];
  try {
    product = engine.specCheck(typeId, CAGE_ITEM_ID, owned).product;
  } catch {
    return null; // 공개 카탈로그에 없음 — 판정하지 않는다
  }
  const schema = cageReq.item.specSchema;
  const minSpec = cageReq.minSpec;
  const name = cageReq.item.name;
  const mark = productMark(product.verdict, isProductNoCriteria(product), isSmallOnly(schema, product, minSpec), product.reasons);
  const title =
    product.verdict === 'OK' ? formatCopy(COPY.cage.selfOk, { name }) : verdictTitle(schema, product, minSpec, { item: name, animal: animalName });
  const fig = minFigure(schema, product, minSpec);
  const minText = fig ? `${fig.label} ${fig.value}${fig.unit} ${fig.suffix}` : null;
  return { mark, title, minText, messages: product.verdict === 'OK' ? [] : nonOkMessages(product.reasons) };
}

export function cageCompatViews(
  engine: Pick<Engine, 'requirementCompat'>,
  typeId: string,
  reqs: readonly PublicRequirement[],
  cage: CageV1,
): CageCompatItemView[] {
  const ctx = toUserContext(cage);
  if (!ctx) return [];
  const out: CageCompatItemView[] = [];
  for (const r of reqs) {
    if (r.animalTypeId !== typeId || r.supplyItemId === CAGE_ITEM_ID) continue;
    let c: SpecCheckResult['compat'];
    try {
      c = engine.requirementCompat(typeId, r.supplyItemId, ctx);
    } catch {
      continue;
    }
    if (c.verdict !== 'CHECK' && c.verdict !== 'BELOW_MIN') continue;
    const mark = compatMark(c.verdict);
    if (!mark) continue;
    const name = comitativeParticle(r.item.name);
    out.push({
      supplyItemId: r.supplyItemId,
      mark,
      title: formatCopy(c.verdict === 'CHECK' ? COPY.cage.compatCheckTitle : COPY.cage.compatBelowMinTitle, { name }),
      messages: nonOkMessages(c.reasons),
      usedRecommended: c.usedRecommended === true,
    });
  }
  return out;
}

/** 케이지 요구사항이 ws-data 에 없으면 자체 판정 없음(⑦). */
export function cageReview(
  engine: Pick<Engine, 'specCheck' | 'requirementCompat'>,
  typeId: string,
  reqs: readonly PublicRequirement[],
  cage: CageV1,
  animalName: string,
): CageReview {
  const cageReq = reqs.find((r) => r.animalTypeId === typeId && r.supplyItemId === CAGE_ITEM_ID) ?? null;
  return {
    self: cageReq ? cageSelfView(engine, typeId, cageReq, cage, animalName) : null,
    compat: cageCompatViews(engine, typeId, reqs, cage),
  };
}
