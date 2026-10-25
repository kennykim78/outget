// 공개 게이트 X01·X02 (R7-B 후속, QA 72 G-2 · 보안 71 M-1 · 보안 79 M-1·M-2). 판정은 engine/exposure.ts 만(A-6) — 여기선 호출·보고만.
//   X01(Kenny K-B4 기계화): 노출 타입의 체크리스트에서 필수 항목이 빠지면 ERROR — "사료 미검수 상태로 체크리스트·준비 세트 공개 금지".
//        (a) 코드 고정 필수 항목(REQUIRED_ITEMS_BY_PROFILE, 보안 79 M-1): CareProfile 별 집합의 각 항목에 대해
//            요구사항 행 없음(삭제) / 노출 불가 / 해석 후 priority ≠ REQUIRED → ERROR.
//            비검수(DRAFT·AI_DRAFT) 행의 priority 는 판정에 쓰지 않는다 — 노출 가능(체인 전부 VERIFIED·유효)일 때만
//            priority 를 보므로, 비검수 행은 priority 와 무관하게 "REQUIRED 인데 비노출"로 ERROR(하향·삭제 우회 차단).
//            집합이 정의되지 않은 CareProfile 의 노출 타입도 ERROR(fail-closed — 새 동물은 집합을 코드에 먼저 넣는다).
//        (b) 그 밖의 요구사항: 해석 후 REQUIRED 인데 노출 불가 → ERROR(기존 규칙).
//        타입 자체가 비노출이면 대상 아님(W-EXPOSURE-ZERO 가 보고).
//   X02(제품기획 §9 대비): ACTIVE 타입의 대표 Taxon 이 공개 불가(isTaxonExposable=false: 미검수·AI_DRAFT·만료)인데
//        법 판단이 "자명하지 않은" 경우 ERROR. 자명 = 학명 속(genus)이 코드 허용목록(TRIVIAL_LEGAL_GENERA, 보안 79 M-2 —
//        Kenny K-4 되돌림 취지: 햄스터는 법 검토 불요) ∧ animalProtectionAct6 === true ∧ cites === false
//        ∧ designatedWildlifeWhitelist ∈ {null, false}. 허용목록 밖은 legal 불리언과 무관하게 Taxon VERIFIED 필요
//        (미검수 Taxon 의 불리언은 AI_DRAFT 가 쓴 값일 수 있어 그것만으로 자명 판정하지 않는다).
//        (반려동물 6종은 야생생물법 제2조제4호바목에 따라 지정관리 야생동물 대상이 아니므로 화이트리스트 null 은 "미해당".)
//   구조·참조 오류가 없을 때만 호출된다(validate.ts).
import { createCatalog, isAnimalTypeExposable, isRequirementExposable, isTaxonExposable, listResolvedRequirements } from '../engine/index.js';
import { asRec, asSeedBundle, isNonEmptyStr, type RawSeed } from './common.js';
import type { Ctx } from './context.js';

/**
 * X01(a) CareProfile 별 필수 항목(SupplyItem id) — 코드 고정(보안 79 M-1, 결정 2026-10-25). 시드 편집으로 줄일 수 없다.
 *   새 CareProfile 을 노출하려면 여기에 집합을 먼저 추가한다(없으면 X01).
 */
export const REQUIRED_ITEMS_BY_PROFILE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'cp-hamster-syrian': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'wheel']),
  'cp-hamster-dwarf': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'wheel']),
});

/** X02 자명 허용목록 — 학명 속(Kenny 승인 범위: 햄스터 Mesocricetus·Phodopus). */
export const TRIVIAL_LEGAL_GENERA: readonly string[] = Object.freeze(['Mesocricetus', 'Phodopus']);

function requiredItemsFor(careProfileId: string): readonly string[] | null {
  return Object.prototype.hasOwnProperty.call(REQUIRED_ITEMS_BY_PROFILE, careProfileId)
    ? REQUIRED_ITEMS_BY_PROFILE[careProfileId]
    : null;
}

/** 학명 첫 단어(속). 형식이 "Genus species…"(대문자 시작 라틴 문자)가 아니면 null. */
export function genusOf(scientificName: unknown): string | null {
  if (typeof scientificName !== 'string') return null;
  const m = /^([A-Z][a-z]+)(?:\s|$)/.exec(scientificName.trim());
  return m ? m[1] : null;
}

/** X02: 법 불리언 조합이 "판단 불요" 형태인가(허용목록 판정과 함께 쓴다 — 단독으로는 자명 판정 아님). */
export function isLegalTrivial(legal: unknown): boolean {
  const l = asRec(legal);
  if (!l) return false;
  const w = l.designatedWildlifeWhitelist;
  return l.animalProtectionAct6 === true && l.cites === false && (w === null || w === false);
}

/** X02: 미검수 Taxon 으로도 ACTIVE 가 허용되는가 = 속 허용목록 ∧ isLegalTrivial(legal). */
export function isTaxonLegallyTrivial(taxon: { scientificName?: unknown; legal?: unknown }): boolean {
  const g = genusOf(taxon.scientificName);
  return g !== null && TRIVIAL_LEGAL_GENERA.includes(g) && isLegalTrivial(taxon.legal);
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

    // X02 — 법 판단이 자명하지 않은 종은 Taxon 검수 전 ACTIVE 불가.
    if (!isNonEmptyStr(at.taxonId)) continue; // R01 이 보고.
    const taxon = ctx.byId.taxa.get(at.taxonId);
    if (!taxon) continue; // R01 이 보고.
    if (isTaxonExposable(cat, at.taxonId, ctx.now) || isTaxonLegallyTrivial(taxon)) continue;
    const l = asRec(taxon.legal);
    const g = genusOf(taxon.scientificName);
    const shown = l
      ? `animalProtectionAct6=${String(l.animalProtectionAct6)}, cites=${String(l.cites)}, designatedWildlifeWhitelist=${String(l.designatedWildlifeWhitelist)}`
      : 'legal 없음';
    const genusNote = g !== null && TRIVIAL_LEGAL_GENERA.includes(g) ? `속 ${g}` : `속 ${String(g)} 허용목록(${TRIVIAL_LEGAL_GENERA.join('·')}) 밖`;
    ctx.out.error(
      'X02',
      'animalTypes',
      at.id,
      'taxonId',
      `ACTIVE 타입의 Taxon ${at.taxonId} 가 미검수인데 법 판단이 필요하다(${genusNote}; ${shown}) — Taxon VERIFIED(OFFICIAL_SOURCE) 전에는 ACTIVE 불가(제품기획 §9)`,
    );
  }
}
