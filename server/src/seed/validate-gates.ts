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
//        법 판단이 "자명하지 않은" 경우 ERROR. 자명 = 학명 앞 두 단어(속 종소명)가 코드 허용목록(TRIVIAL_LEGAL_SPECIES,
//        보안 79 M-2 · 보안 129 LOW-1: 속이 아니라 종 단위 — 법 근거가 종이다) ∧ 그 종의 근거별 불리언 조건:
//          PET_ACT6(햄스터 3종·기니피그, Kenny K-4 되돌림 취지: 시행규칙 제3조 반려동물 — 법 검토 불요)
//            = animalProtectionAct6 === true ∧ cites === false ∧ designatedWildlifeWhitelist ∈ {null, false}
//          NOT_GATING_KENNY(몽골리안저빌, Kenny 2026-10-27: 분양을 하지 않는 서비스라 법 상태는 노출 조건이 아니다)
//            = animalProtectionAct6 ∈ {null, false} ∧ cites ∈ {null, false} ∧ designatedWildlifeWhitelist ∈ {null, false}
//              — act6 === true 는 거부(저빌은 제3조 6종 밖 — 사실과 다른 값 차단), cites true 거부.
//        허용목록 밖은 legal 불리언과 무관하게 Taxon VERIFIED 필요
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
  // 기니피그(QA118 X01, 2026-10-27): 쳇바퀴 없음(기니피그에 쓰지 않는다 — 105 근거·req-guineapig 16행) · 건초(hay)가 필수.
  'cp-guineapig': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'hay']),
  // 몽골리안저빌(126 S2, 2026-10-27): 쳇바퀴는 권장(RECOMMENDED — 104 T1·R2 '선택적 제공')이라 넣지 않는다 · 모래 목욕(sand-bath)이 필수.
  'cp-gerbil-mongolian': Object.freeze(['cage', 'food', 'water', 'bedding', 'hideout', 'sand-bath']),
});

/** X02 허용 근거. PET_ACT6 = 시행규칙 제3조 반려동물(불리언 isLegalTrivial), NOT_GATING_KENNY = Kenny 결정으로 법 상태가 노출 조건 아님(isLegalNotGating). */
export type TrivialLegalBasis = 'PET_ACT6' | 'NOT_GATING_KENNY';

/**
 * X02 자명 허용목록 — 학명 앞 두 단어(속 종소명) → 근거. 코드 고정(시드 편집으로 넓힐 수 없음, 보안 79 M-2).
 *   종 단위(보안 129 LOW-1, 2026-10-27): 법 근거가 종(예: Cavia porcellus)이라 같은 속의 다른 종(Cavia aperea·Mesocricetus brandti)은 밖.
 *   - 햄스터 3종(Kenny 승인 범위: K-4 되돌림) — 실시드 Taxon 3행.
 *   - Phodopus roborovskii(로보로브스키햄스터)는 넣지 않는다(271 보안 LOW #4, 오케스트레이터 2026-11-02): 시행규칙 제3조 「햄스터」의
 *     학명 범위 해석이 없고(272 확인 필요 B) Kenny K-4 승인 범위(햄스터 3종) 밖이다 → 앵무와 같은 fail-closed(Taxon OFFICIAL_SOURCE 검수 경로).
 *     272-B 확정·Kenny 결정 뒤 추가한다(추가 시 TRIVIAL_LEGAL_TAXON_ID 에도 같은 쌍).
 *   - 앵무(Melopsittacus undulatus·Nymphicus hollandicus)는 넣지 않는다: 제3조 6종 밖이라 PET_ACT6 불가,
 *     NOT_GATING_KENNY 는 Kenny 결정 없이는 불가(268 K-2 1안 = Taxon 을 사람이 OFFICIAL_SOURCE 로 검수).
 *   - Cavia porcellus(기니피그, QA118 X02 오케스트레이터 결정 2026-10-27: 시행규칙 제3조에 반려동물로 명시 — K-4 취지와 동일).
 *   - Meriones unguiculatus(몽골리안저빌, Kenny 2026-10-27: 분양을 하지 않고 이미 데려온 동물의 준비물을 잇는 서비스라
 *     법 상태는 노출 조건이 아니다 — 126 S2). 저빌은 제3조 6종 밖이므로 PET_ACT6 이 아니라 NOT_GATING_KENNY.
 */
export const TRIVIAL_LEGAL_SPECIES: Readonly<Record<string, TrivialLegalBasis>> = Object.freeze({
  'Mesocricetus auratus': 'PET_ACT6',
  'Phodopus sungorus': 'PET_ACT6',
  'Phodopus campbelli': 'PET_ACT6',
  'Cavia porcellus': 'PET_ACT6',
  'Meriones unguiculatus': 'NOT_GATING_KENNY',
});

/**
 * X02 허용 쌍(271 보안 LOW #5): 허용목록 종 → 그 종의 실시드 Taxon id. 판정은 (taxonId, scientificName) 쌍으로 —
 *   다른 Taxon 행(예: budgie 의 Taxon)에 허용 학명·불리언을 옮겨 적어도 자명 판정이 나지 않는다. 학명 유일성은 R11(validate-refs.ts).
 */
export const TRIVIAL_LEGAL_TAXON_ID: Readonly<Record<string, string>> = Object.freeze({
  'Mesocricetus auratus': 'mesocricetus-auratus',
  'Phodopus sungorus': 'phodopus-sungorus',
  'Phodopus campbelli': 'phodopus-campbelli',
  'Cavia porcellus': 'cavia-porcellus',
  'Meriones unguiculatus': 'meriones-unguiculatus',
});

function trivialBasisOf(species: string | null): TrivialLegalBasis | null {
  return species !== null && Object.prototype.hasOwnProperty.call(TRIVIAL_LEGAL_SPECIES, species) ? TRIVIAL_LEGAL_SPECIES[species] : null;
}

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

const nullOrFalse = (v: unknown): boolean => v === null || v === false;

/** X02 PET_ACT6: 법 불리언 조합이 "판단 불요" 형태인가(허용목록 판정과 함께 쓴다 — 단독으로는 자명 판정 아님). */
export function isLegalTrivial(legal: unknown): boolean {
  const l = asRec(legal);
  if (!l) return false;
  return l.animalProtectionAct6 === true && l.cites === false && nullOrFalse(l.designatedWildlifeWhitelist);
}

/**
 * X02 NOT_GATING_KENNY(Kenny 2026-10-27): 6종 밖(act6 null·false) ∧ CITES 아님(null·false) ∧ 백색목록 표시 아님(null·false).
 *   act6 === true 는 거부(이 근거의 종은 제3조 6종이 아니다 — 사실과 다른 값 차단). 키 누락(undefined)도 거부(fail-closed).
 */
export function isLegalNotGating(legal: unknown): boolean {
  const l = asRec(legal);
  if (!l) return false;
  return nullOrFalse(l.animalProtectionAct6) && nullOrFalse(l.cites) && nullOrFalse(l.designatedWildlifeWhitelist);
}

/** X02 허용 쌍 일치: taxon.id 가 그 학명에 고정된 Taxon id 와 같은가(271 LOW #5). id 누락은 불일치(fail-closed). */
function isAllowedPair(species: string | null, taxonId: unknown): boolean {
  return (
    species !== null &&
    Object.prototype.hasOwnProperty.call(TRIVIAL_LEGAL_TAXON_ID, species) &&
    typeof taxonId === 'string' &&
    TRIVIAL_LEGAL_TAXON_ID[species] === taxonId
  );
}

/** X02: 미검수 Taxon 으로도 ACTIVE 가 허용되는가 = 종 허용목록 ∧ (taxonId, 학명) 허용 쌍 ∧ 그 종 근거의 불리언 조건. */
export function isTaxonLegallyTrivial(taxon: { id?: unknown; scientificName?: unknown; legal?: unknown }): boolean {
  const species = speciesOf(taxon.scientificName);
  if (!isAllowedPair(species, taxon.id)) return false;
  const basis = trivialBasisOf(species);
  if (basis === 'PET_ACT6') return isLegalTrivial(taxon.legal);
  if (basis === 'NOT_GATING_KENNY') return isLegalNotGating(taxon.legal);
  return false;
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
    const sp = speciesOf(taxon.scientificName);
    const basis = trivialBasisOf(sp);
    const shown = l
      ? `animalProtectionAct6=${String(l.animalProtectionAct6)}, cites=${String(l.cites)}, designatedWildlifeWhitelist=${String(l.designatedWildlifeWhitelist)}`
      : 'legal 없음';
    const genusNote =
      basis !== null && !isAllowedPair(sp, taxon.id)
        ? `종 ${String(sp)} 는 Taxon ${String(TRIVIAL_LEGAL_TAXON_ID[sp as string])} 에만 허용 — ${at.taxonId} 는 허용 쌍 아님(271 LOW #5)`
        : basis !== null
        ? `종 ${String(sp)} (근거 ${basis} — 불리언 조건 불충족)`
        : `종 ${String(sp)} 허용목록(${Object.keys(TRIVIAL_LEGAL_SPECIES).join('·')}) 밖`;
    ctx.out.error(
      'X02',
      'animalTypes',
      at.id,
      'taxonId',
      `ACTIVE 타입의 Taxon ${at.taxonId} 가 미검수인데 법 판단이 필요하다(${genusNote}; ${shown}) — Taxon VERIFIED(OFFICIAL_SOURCE) 전에는 ACTIVE 불가(제품기획 §9)`,
    );
  }
}
