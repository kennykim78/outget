// 검수 규칙 V01~V05 + W-STALE·W-COHERENCE·W-SLUG (불변식 7).
//   노출 판정은 여기서 하지 않는다(A-6: engine/exposure.ts 단일). 여기선 "검수 기록이 규칙에 맞는가"만.
import { isVerified, reviewerRank } from '../engine/index.js';
import { CONTENT_KEYS, daysBetween, hostnameOf, isIsoDate, isNonEmptyStr, asRec, type Rec, type SeedKey } from './common.js';
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

/** W-STALE 기준일 수(US-020). */
export const STALE_DAYS = 180;

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
  if (!verified) return;

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
      const hosts = new Set(urls.map(hostnameOf).filter((h): h is string => h !== null));
      if (hosts.size < g.minSources) out.error('V04', key, id, 'source', `${kind} 는 서로 다른 호스트의 출처 ${g.minSources}개 이상 (현재 ${hosts.size})`);
    }
  }

  // W-STALE
  if (isIsoDate(r.verifiedAt) && daysBetween(r.verifiedAt, ctx.now) > STALE_DAYS) {
    out.warn('W-STALE', key, id, 'verifiedAt', `검수 ${daysBetween(r.verifiedAt, ctx.now)}일 경과(>${STALE_DAYS}) — 재검수 필요`);
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

  // W-SLUG (A-16)
  for (const { rec, id } of ctx.rows.animalTypes) {
    if (rec.status === 'ACTIVE' && !isNonEmptyStr(rec.slug)) ctx.out.warn('W-SLUG', 'animalTypes', id, 'slug', 'ACTIVE 동물에 slug 없음(라우트 체계 R3)');
  }
}
