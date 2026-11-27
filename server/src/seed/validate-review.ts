// 검수 규칙 V01~V05·V08~V13 +W-STALE·W-GENERAL-STALE·W-COHERENCE (불변식 7). slug 규칙은 validate-slug.ts(R3 C2, W-SLUG 대체).
//   노출 판정은 여기서 하지 않는다(A-6: engine/exposure.ts 단일). 여기선 "검수 기록이 규칙에 맞는가"만.
import { STALE_DAYS, isVerified, reviewerRank } from '../engine/index.js';
import { CONTENT_KEYS, daysBetween, has, isIsoDate, isNonEmptyStr, asRec, type Rec, type SeedKey } from './common.js';
import { isReviewBasis, requiredBasis, requiredBasisReason, REVIEW_BASES } from './signatures.js';
import { registrableDomainOfUrl } from './hostname.js';
import { isAiHandle } from './ai-handle.js';
import {
  CROSS_CHECK_CONTENT_KINDS,
  GENERAL_INFO_CONTENT_KINDS,
  GENERAL_INFO_MAX_AGE_DAYS,
  GENERAL_INFO_STATUS,
  GENERAL_INFO_TYPE_IDS,
  hasHttpsSource,
  isCrossCheckShape,
  isGeneralInfoTypeId,
} from '../engine/general-info.js';
import { GENERAL_INFO_FILES } from './validate-structure.js';
import type { Ctx } from './context.js';

/** contentKind 별 최소 검수 등급(제품기획 §7.3 + A-7). LEGAL 은 정확히 OFFICIAL_SOURCE. */
export const MIN_GRADE: Record<string, { min: string; exact?: boolean; minSources: number; distinctHosts?: boolean }> = {
  SPEC: { min: 'EXPERIENCED_KEEPER', minSources: 1 },
  CARE: { min: 'EXPERIENCED_KEEPER', minSources: 1 },
  FOOD: { min: 'VET_PUBLISHED_SOURCE', minSources: 2, distinctHosts: true },
  HEALTH: { min: 'VET_PUBLISHED_SOURCE', minSources: 2, distinctHosts: true },
  LEGAL: { min: 'OFFICIAL_SOURCE', exact: true, minSources: 1 },
};

/** engine isVerified 에 위임(VERIFIED ∧ ≠AI_DRAFT). */
const verified = (r: Rec): boolean =>
  isVerified({ reviewStatus: r.reviewStatus, reviewerType: r.reviewerType } as Parameters<typeof isVerified>[0]);

/** 국내 도메인(V08): registrable domain 의 최상위가 .kr 또는 .한국(punycode xn--3e0b707e). */
export const DOMESTIC_TLDS: readonly string[] = ['kr', 'xn--3e0b707e'];
export function isDomesticDomain(domain: string): boolean {
  return DOMESTIC_TLDS.includes(domain.slice(domain.lastIndexOf('.') + 1));
}

function sourceUrls(r: Rec): string[] {
  return Array.isArray(r.source) ? r.source.map((s) => asRec(s)?.url).filter((u): u is string => typeof u === 'string') : [];
}

function checkRow(ctx: Ctx, key: SeedKey, id: string, r: Rec): void {
  const { out } = ctx;
  const verified = r.reviewStatus === 'VERIFIED';
  const kind = r.contentKind as string;

  // V05 contentKind ↔ 파일
  if (key === 'taxa' && kind !== 'LEGAL') out.error('V05', key, id, 'contentKind', 'Taxon 은 LEGAL');
  if (key !== 'taxa' && kind === 'LEGAL') out.error('V05', key, id, 'contentKind', 'LEGAL 은 Taxon 에만');

  // V01 — 어떤 경우에도
  if (verified && r.reviewerType === 'AI_DRAFT') {
    out.error('V01', key, id, 'reviewStatus', 'AI_DRAFT 는 VERIFIED 가 될 수 없다(불변식 7)');
  }
  // V09(보안 79 H-1) — 검수 방식은 VERIFIED 행에만, VERIFIED 는 반드시. 누락 키는 S04 가 보고.
  if (has(r, 'reviewBasis')) {
    if (!verified && r.reviewBasis !== null) out.error('V09', key, id, 'reviewBasis', `비VERIFIED(${String(r.reviewStatus)}) 행의 reviewBasis 는 null`);
    if (verified && !isReviewBasis(r.reviewBasis)) out.error('V09', key, id, 'reviewBasis', `VERIFIED 는 reviewBasis ${REVIEW_BASES.join('/')} 필요 (현재 ${String(r.reviewBasis)})`);
  }
  // V11(QA 82 D2) — 검수자·규격 확인자는 사람만. 상태와 무관하게 값이 있으면 검사(AI 핸들 판정 단일 출처 ai-handle.json).
  for (const f of ['verifiedBy', 'specVerifiedBy'] as const) {
    if (isAiHandle(r[f])) out.error('V11', key, id, f, `${f}=${JSON.stringify(r[f])} 는 AI/봇 핸들 — 검수자는 사람만(불변식 7)`);
  }
  checkGeneralInfo(ctx, key, id, r);
  if (!verified) return;

  // V10 — 행별 출처 확인이 근거인 행(상품·최소 규격)은 ROW_CHECKED 만(일괄 승인 불가, Kenny 2026-10-24 H-1).
  const need = requiredBasis(key, r);
  if (need && isReviewBasis(r.reviewBasis) && r.reviewBasis !== need) {
    out.error('V10', key, id, 'reviewBasis', `${requiredBasisReason(key, r) ?? '행'}은 ${need} 만 (현재 ${r.reviewBasis}) — 일괄 승인 불가`);
  }

  // V02
  if (!isNonEmptyStr(r.verifiedBy)) out.error('V02', key, id, 'verifiedBy', 'VERIFIED 는 verifiedBy 필요');
  if (!isIsoDate(r.verifiedAt)) out.error('V02', key, id, 'verifiedAt', 'VERIFIED 는 verifiedAt(YYYY-MM-DD) 필요');

  // V03
  const g = MIN_GRADE[kind];
  if (g && r.reviewerType !== 'AI_DRAFT') {
    const rank = reviewerRank(r.reviewerType as string);
    const ok = g.exact ? r.reviewerType === g.min : rank >= reviewerRank(g.min);
    if (!ok) out.error('V03', key, id, 'reviewerType', `${kind} 는 ${g.exact ? '' : '최소 '}${g.min} (현재 ${String(r.reviewerType)})`);
  }

  // V04
  if (g) {
    const urls = sourceUrls(r);
    if (urls.length < 1) out.error('V04', key, id, 'source', 'VERIFIED 는 출처 1개 이상');
    if (g.distinctHosts) {
      // M6: registrable domain 기준(서브도메인·후행 점·대소문자·IDN 우회 차단). 판정 불가(IP·localhost 등)는 세지 않는다.
      const domains = new Set(urls.map(registrableDomainOfUrl).filter((h): h is string => h !== null));
      if (domains.size < g.minSources) out.error('V04', key, id, 'source', `${kind} 는 서로 다른 기관 도메인(registrable domain)의 출처 ${g.minSources}개 이상 (현재 ${domains.size})`);
      // V08(QA 72 G-3): 국내 출처 1개 이상. 시드 source 형식(PRD 부록 B: url·title·accessedAt)에 국가 메타가 없으므로
      //   registrable domain 의 국가 최상위 도메인(.kr·.한국)으로만 판정한다(.com 국내 기관은 세지 않음 — fail-closed).
      //   '수의(veterinary)' 여부는 기계 판정 불가 — 검수자 확인(패킷 0-4).
      if (![...domains].some(isDomesticDomain)) out.error('V08', key, id, 'source', `${kind} 는 국내 출처(.kr·.한국 도메인) 1개 이상 (현재 0)`);
    }
  }

  // W-STALE — 경계는 engine isFresh 와 동일(days > STALE_DAYS → 경고 + 노출 판정에서 비노출, M-1).
  if (isIsoDate(r.verifiedAt) && daysBetween(r.verifiedAt, ctx.now) > STALE_DAYS) {
    out.warn('W-STALE', key, id, 'verifiedAt', `검수 ${daysBetween(r.verifiedAt, ctx.now)}일 경과(>${STALE_DAYS}) — 재검수 필요, 노출 판정에서 빠진다`);
  }
}

/**
 * V12(356, Kenny 2026-11-23 — 불변식 7 「예외 2」): GENERAL_INFO(일반 참고 정보) 기록 규칙. VERIFIED 승격이 아니다(V01 그대로).
 *   - 체인 네 파일(animalTypes·careProfiles·supplyItems·supplyRequirements)에만. 상품·구성안·호환·Taxon·후기 → ERROR.
 *   - animalTypes 행은 코드 고정 6종(engine/general-info.ts)만.
 *   - 검수자 필드 없음: verifiedBy·verifiedAt null(reviewBasis 는 V09 가 본다).
 *   - draftedAt(YYYY-MM-DD) 필수 · contentKind ∈ SPEC·CARE·FOOD·HEALTH(LEGAL 불가).
 *   - FOOD·HEALTH 는 crossCheck{tool,checkedAt,result} 필수, draftedAt ≤ checkedAt(미래는 S07).
 *   - FOOD·HEALTH 는 https 출처 1곳 이상(Kenny 2026-11-25, 356r M3). 형식(url·title·accessedAt)은 S04, 노출 쪽도 같은 조건.
 *   - draftedAt·crossCheck 값은 GENERAL_INFO 행에만(다른 상태 행에 남아 있으면 ERROR — VERIFIED 로 올릴 때 지운다).
 *   - draftedAt 이 GENERAL_INFO_MAX_AGE_DAYS 초과 → W-GENERAL-STALE(노출 판정에서 빠진다 — engine isGeneralInfoMeta).
 */
function checkGeneralInfo(ctx: Ctx, key: SeedKey, id: string, r: Rec): void {
  const { out } = ctx;
  if (r.reviewStatus !== GENERAL_INFO_STATUS) {
    for (const f of ['draftedAt', 'crossCheck'] as const) {
      if (has(r, f) && r[f] !== null) out.error('V12', key, id, f, `${f} 는 GENERAL_INFO 행에만(현재 ${String(r.reviewStatus)}) — 다른 상태로 옮길 때 지운다`);
    }
    return;
  }
  if (!GENERAL_INFO_FILES.includes(key)) {
    out.error('V12', key, id, 'reviewStatus', `GENERAL_INFO 는 ${GENERAL_INFO_FILES.join('·')} 에만(356 — 상품·구성안·호환·Taxon·후기는 VERIFIED 만)`);
    return;
  }
  if (key === 'animalTypes' && !isGeneralInfoTypeId(id)) {
    out.error('V12', key, id, 'reviewStatus', `GENERAL_INFO 동물 타입은 코드 고정 ${GENERAL_INFO_TYPE_IDS.join('·')} 만(engine/general-info.ts)`);
  }
  for (const f of ['verifiedBy', 'verifiedAt'] as const) {
    if (has(r, f) && r[f] !== null) out.error('V12', key, id, f, `GENERAL_INFO 는 검수 기록이 아니다 — ${f} 는 null`);
  }
  const kind = r.contentKind as string;
  if (!(GENERAL_INFO_CONTENT_KINDS as readonly string[]).includes(kind)) {
    out.error('V12', key, id, 'contentKind', `GENERAL_INFO contentKind 는 ${GENERAL_INFO_CONTENT_KINDS.join('/')} 만(LEGAL 불가, 현재 ${String(kind)})`);
  }
  const drafted = isIsoDate(r.draftedAt) ? r.draftedAt : null;
  if (drafted === null) {
    out.error('V12', key, id, 'draftedAt', 'GENERAL_INFO 는 draftedAt(YYYY-MM-DD) 필수');
  } else if (daysBetween(drafted, ctx.now) > GENERAL_INFO_MAX_AGE_DAYS) {
    out.warn('W-GENERAL-STALE', key, id, 'draftedAt', `초안 ${daysBetween(drafted, ctx.now)}일 경과(>${GENERAL_INFO_MAX_AGE_DAYS}) — 다시 정리 필요, 노출 판정에서 빠진다`);
  }
  if ((CROSS_CHECK_CONTENT_KINDS as readonly string[]).includes(kind)) {
    if (!hasHttpsSource(r.source)) out.error('V12', key, id, 'source', `GENERAL_INFO ${kind} 는 https 출처 1곳 이상 필수`);
    if (!isCrossCheckShape(r.crossCheck)) {
      out.error('V12', key, id, 'crossCheck', `GENERAL_INFO ${kind} 는 교차 확인 기록 crossCheck{tool,checkedAt,result} 필수`);
    } else if (drafted !== null && (asRec(r.crossCheck)?.checkedAt as string) < drafted) {
      out.error('V12', key, id, 'crossCheck', `crossCheck.checkedAt 이 draftedAt(${drafted}) 보다 앞선다`);
    }
  }
}

/**
 * V13(356r M1, 불변식 3·7): VERIFIED 상품의 연결 체인에 GENERAL_INFO 행이 있으면 ERROR.
 *   체인 = 상품 supplyItemId 의 SupplyItem · careProfileIds 의 CareProfile · (그 프로필, 그 용품) SupplyRequirement
 *        · 그 프로필을 쓰는 AnimalType. GENERAL_INFO 의 minSpec 은 AI 초안이라 meetsMinSpec 판정 근거가 될 수 없다.
 *   노출 쪽은 engine/exposure.ts strictChainOk 가 같은 연결을 비노출로 막는다(이중 방어).
 */
function checkProductChain(ctx: Ctx): void {
  const isGi = (r: Rec | undefined): boolean => r !== undefined && r.reviewStatus === GENERAL_INFO_STATUS;
  for (const { rec, id } of ctx.rows.curatedProducts) {
    if (rec.reviewStatus !== 'VERIFIED') continue;
    const itemId = rec.supplyItemId;
    const profileIds = Array.isArray(rec.careProfileIds) ? rec.careProfileIds.filter((x): x is string => typeof x === 'string') : [];
    const hits: string[] = [];
    if (typeof itemId === 'string' && isGi(ctx.byId.supplyItems.get(itemId))) hits.push(`SupplyItem ${itemId}`);
    for (const pid of profileIds) if (isGi(ctx.byId.careProfiles.get(pid))) hits.push(`CareProfile ${pid}`);
    for (const { rec: r, id: rid } of ctx.rows.supplyRequirements) {
      if (r.supplyItemId === itemId && profileIds.includes(r.careProfileId as string) && isGi(r)) hits.push(`SupplyRequirement ${rid}`);
    }
    for (const { rec: t, id: tid } of ctx.rows.animalTypes) {
      if (profileIds.includes(t.careProfileId as string) && isGi(t)) hits.push(`AnimalType ${tid}`);
    }
    if (hits.length > 0) {
      ctx.out.error('V13', 'curatedProducts', id, 'careProfileIds', `VERIFIED 상품이 GENERAL_INFO 체인에 연결됨(${hits.join(', ')}) — AI 초안 minSpec 으로 규격 판정 불가(불변식 3·7)`);
    }
  }
}

export function checkReview(ctx: Ctx): void {
  for (const key of CONTENT_KEYS) {
    for (const { rec, id } of ctx.rows[key]) checkRow(ctx, key, id, rec);
  }

  checkProductChain(ctx);

  // W-COHERENCE: VERIFIED 요구사항인데 용품·프로필이 미검수 → 노출 안 됨을 운영자에게 알림.
  for (const { rec, id } of ctx.rows.supplyRequirements) {
    if (!verified(rec)) continue;
    const item = ctx.byId.supplyItems.get(rec.supplyItemId as string);
    const profile = ctx.byId.careProfiles.get(rec.careProfileId as string);
    const missing = [
      item && !verified(item) ? `SupplyItem ${String(rec.supplyItemId)}` : null,
      profile && !verified(profile) ? `CareProfile ${String(rec.careProfileId)}` : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      ctx.out.warn('W-COHERENCE', 'supplyRequirements', id, 'reviewStatus', `VERIFIED 요구사항이지만 ${missing.join(', ')} 미검수 — 노출되지 않는다`);
    }
  }
}
