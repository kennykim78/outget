// 검수 규칙 V01~V05·V08~V11 + W-STALE·W-COHERENCE (불변식 7). slug 규칙은 validate-slug.ts(R3 C2, W-SLUG 대체).
//   노출 판정은 여기서 하지 않는다(A-6: engine/exposure.ts 단일). 여기선 "검수 기록이 규칙에 맞는가"만.
import { STALE_DAYS, isVerified, reviewerRank } from '../engine/index.js';
import { CONTENT_KEYS, daysBetween, has, isIsoDate, isNonEmptyStr, asRec, type Rec, type SeedKey } from './common.js';
import { isReviewBasis, requiredBasis, REVIEW_BASES } from './signatures.js';
import { registrableDomainOfUrl } from './hostname.js';
import { isAiHandle } from './ai-handle.js';
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
  if (!verified) return;

  // V10 — 행별 출처 확인이 근거인 행(상품·최소 규격)은 ROW_CHECKED 만(일괄 승인 불가, Kenny 2026-10-24 H-1).
  const need = requiredBasis(key, r);
  if (need && isReviewBasis(r.reviewBasis) && r.reviewBasis !== need) {
    out.error('V10', key, id, 'reviewBasis', `${key === 'curatedProducts' ? '상품' : '최소 규격 행'}은 ${need} 만 (현재 ${r.reviewBasis}) — 일괄 승인 불가`);
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

export function checkReview(ctx: Ctx): void {
  for (const key of CONTENT_KEYS) {
    for (const { rec, id } of ctx.rows[key]) checkRow(ctx, key, id, rec);
  }

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
