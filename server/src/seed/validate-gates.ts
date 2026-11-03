// 공개 게이트 X01 (R7-B 후속, QA 72 G-2 · 보안 79 M-1). 판정은 engine/exposure.ts 만(A-6) — 여기선 호출·보고만.
//   X01(Kenny K-B4 기계화): 노출 타입의 체크리스트에서 필수 항목이 빠지면 ERROR — "사료 미검수 상태로 체크리스트·준비 세트 공개 금지".
//        (a) 코드 고정 필수 항목(REQUIRED_ITEMS_BY_PROFILE, 보안 79 M-1): CareProfile 별 집합의 각 항목에 대해
//            요구사항 행 없음(삭제) / 노출 불가 / 해석 후 priority ≠ REQUIRED → ERROR.
//            비검수(DRAFT·AI_DRAFT) 행의 priority 는 판정에 쓰지 않는다 — 노출 가능(체인 전부 VERIFIED·유효)일 때만
//            priority 를 보므로, 비검수 행은 priority 와 무관하게 "REQUIRED 인데 비노출"로 ERROR(하향·삭제 우회 차단).
//            집합이 정의되지 않은 CareProfile 의 노출 타입도 ERROR(fail-closed — 새 동물은 집합을 코드에 먼저 넣는다).
//        (b) 그 밖의 요구사항: 해석 후 REQUIRED 인데 노출 불가 → ERROR(기존 규칙).
//        타입 자체가 비노출이면 대상 아님(W-EXPOSURE-ZERO 가 보고).
//   X02(법 상태 게이트)는 제거(280, Kenny ORDERS §47 — decisions.md 「10-27」: 분양·양도·매칭을 하지 않으므로 법적 의무와 무관).
//        Taxon.legal 은 정보용 메모일 뿐 공개 조건이 아니다(act6·cites·화이트리스트 값이 무엇이든·null 이어도 ACTIVE 를 막지 않는다).
//        공개를 막는 것은 검수(사실값 서명 — X01·V01~V08·isVerified)뿐이다. R11(학명 유일, validate-refs.ts)은 데이터 무결성이라 유지.
//   구조·참조 오류가 없을 때만 호출된다(validate.ts).
import { createCatalog, isAnimalTypeExposable, isRequirementExposable, listResolvedRequirements } from '../engine/index.js';
import { asSeedBundle, type RawSeed } from './common.js';
import type { Ctx } from './context.js';

/**
 * X01(a) CareProfile 별 필수 항목(SupplyItem id) — 코드 고정(보안 79 M-1, 결정 2026-10-25). 시드 편집으로 줄일 수 없다.
 *   새 CareProfile 을 노출하려면 여기에 집합을 먼저 추가한다(없으면 X01).
 */
export const REQUIRED_ITEMS_BY_PROFILE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'cp-hamster-syrian': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'wheel']),
  'cp-hamster-dwarf': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'wheel']),
  // 기니피그(QA118 X01, 2026-10-27): 쳇바퀴 없음(기니피그에 쓰지 않는다 — 105 근거·req-guineapig 16행) · 건초(hay)가 필수.
  'cp-guineapig': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'hay']),
  // 몽골리안저빌(126 S2, 2026-10-27): 쳇바퀴는 권장(RECOMMENDED — 104 T1·R2 '선택적 제공')이라 넣지 않는다 · 모래 목욕(sand-bath)이 필수.
  'cp-gerbil-mongolian': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'sand-bath']),
});

function requiredItemsFor(careProfileId: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(REQUIRED_ITEMS_BY_PROFILE, careProfileId)
    ? REQUIRED_ITEMS_BY_PROFILE[careProfileId]
    : null;
}

/**
 * 학명 "Genus species"(속 대문자 시작 + 종소명 소문자). 뒤에는 아종 한 단어와 ASCII 명명자·연도만 허용하고,
 *   그 밖(교잡 "× / x"·"hybrid"·유니코드 기호·괄호 안 다른 종)은 null — 허용 목록 방식(QA137 LOW-2 → 보안 144 LOW-1).
 */
export function speciesOf(scientificName: unknown): string | null {
  if (typeof scientificName !== 'string') return null;
  const m = /^([A-Z][a-z]+) ([a-z]+)(?: (?!(?:x|hybrid)$)[a-z]{2,})?(?: \(?[A-Z][A-Za-z'.-]*(?: [A-Z][A-Za-z'.-]*)*,? \d{4}\)?)?$/.exec(
    scientificName.trim(),
  );
  return m ? `${m[1]} ${m[2]}` : null;
}

export function checkPublishGates(ctx: Ctx, raw: RawSeed): void {
  const bundle = asSeedBundle(raw);
  const cat = createCatalog(bundle);
  for (const at of bundle.animalTypes) {
    if (at.status !== 'ACTIVE') continue;

    // X01 — 노출 타입의 필수 항목은 전부 REQUIRED·노출 가능해야 한다.
    if (isAnimalTypeExposable(cat, at.id, ctx.now)) {
      const resolved = listResolvedRequirements(cat, at.id);
      const bySupply = new Map(resolved.map((r) => [r.supplyItemId, r]));
      const fixed = at.careProfileId ? requiredItemsFor(at.careProfileId) : null;
      if (fixed === null) {
        ctx.out.error(
          'X01',
          'animalTypes',
          at.id,
          'careProfileId',
          `노출 타입의 CareProfile ${String(at.careProfileId)} 에 코드 고정 필수 항목 집합이 없다 — REQUIRED_ITEMS_BY_PROFILE(validate-gates.ts)에 먼저 추가(보안 79 M-1, fail-closed)`,
        );
      }
      const fixedSet = new Set(fixed ?? []);
      for (const itemId of fixed ?? []) {
        const r = bySupply.get(itemId);
        if (!r) {
          ctx.out.error(
            'X01',
            'animalTypes',
            at.id,
            `requirements.${itemId}`,
            `노출 타입의 필수 항목 ${itemId} 요구사항 행이 없다(${String(at.careProfileId)}) — 필수 항목이 빠진 체크리스트는 공개하지 않는다(K-B4, 보안 79 M-1)`,
          );
          continue;
        }
        const reqId = cat.requirementsByProfile.get(r.careProfileId)?.get(r.supplyItemId)?.id ?? r.supplyItemId;
        if (!isRequirementExposable(cat, r, ctx.now)) {
          ctx.out.error(
            'X01',
            'animalTypes',
            at.id,
            `requirements.${itemId}`,
            `노출 타입의 필수 항목 ${reqId}(${itemId}, ${r.contentKind}) 가 노출 불가(미검수·만료·체인 미검수 — 비검수 행 priority 는 보지 않고 REQUIRED 로 본다) — 필수 항목이 빠진 체크리스트는 공개하지 않는다(K-B4)`,
          );
        } else if (r.priority !== 'REQUIRED') {
          ctx.out.error(
            'X01',
            'animalTypes',
            at.id,
            `requirements.${itemId}`,
            `노출 타입의 필수 항목 ${reqId}(${itemId}) priority 가 ${r.priority}(해석 후) — 코드 고정 필수 항목은 REQUIRED 여야 한다(보안 79 M-1)`,
          );
        }
      }
      for (const r of resolved) {
        if (fixedSet.has(r.supplyItemId)) continue; // 위에서 판정.
        if (r.priority !== 'REQUIRED' || isRequirementExposable(cat, r, ctx.now)) continue;
        const reqId = cat.requirementsByProfile.get(r.careProfileId)?.get(r.supplyItemId)?.id ?? r.supplyItemId;
        ctx.out.error(
          'X01',
          'animalTypes',
          at.id,
          `requirements.${r.supplyItemId}`,
          `노출 타입의 REQUIRED 요구사항 ${reqId}(${r.supplyItemId}, ${r.contentKind}) 가 노출 불가(미검수·만료·체인 미검수) — 필수 항목이 빠진 체크리스트는 공개하지 않는다(K-B4)`,
        );
      }
    }
  }
}
