// 356(Kenny 2026-11-23 지시 · 총괄 K1 승인, decisions.md 11-23) — reviewStatus GENERAL_INFO(일반 참고 정보) 판정.
//   VERIFIED 승격이 아니다: isVerified 는 GENERAL_INFO 를 늘 false 로 본다(V01 「AI_DRAFT 는 VERIFIED 불가」 유지).
//   노출 허용 범위는 코드 고정 6종의 체인 메타(AnimalType·SupplyRequirement·SupplyItem·CareProfile)뿐 — exposure.ts okChainMeta.
//   상품·구성안·호환 규칙·Taxon(LEGAL)·후기는 이 경로를 쓰지 않는다(VERIFIED 만).
//   scripts/lib/seed-exposure.mjs 가 같은 규칙을 독립 구현한다(패리티 시험 engine.general-info.parity).
//   순수 모듈: 시계를 읽지 않는다(호출자가 asOf 를 넣는다).
import { STALE_DAYS, isContentKind, isReviewerType, isoDayNumber, type ContentKind } from './domain.js';
import type { ContentMeta } from './types.js';

export const GENERAL_INFO_STATUS = 'GENERAL_INFO' as const;

/** 코드 고정 — 시드 편집으로 늘릴 수 없다(다른 종을 이 등급으로 노출하려면 여기·seed-exposure.mjs 를 함께 바꾸고 결정 행을 남긴다). */
export const GENERAL_INFO_TYPE_IDS = Object.freeze([
  'hamster-robo',
  'gerbil-mongolian',
  'budgie',
  'cockatiel',
  'lovebird-peach',
  'sun-conure',
] as const);
export type GeneralInfoTypeId = (typeof GENERAL_INFO_TYPE_IDS)[number];

/** draftedAt 이 이 일수를 넘기면 노출하지 않는다(VERIFIED 의 STALE_DAYS 와 같은 값). */
export const GENERAL_INFO_MAX_AGE_DAYS = STALE_DAYS;

/** LEGAL 은 이 등급이 될 수 없다(법 정보는 OFFICIAL_SOURCE VERIFIED 만). */
export const GENERAL_INFO_CONTENT_KINDS: readonly ContentKind[] = Object.freeze(['SPEC', 'CARE', 'FOOD', 'HEALTH'] as const);
/** 위험 수치 — 교차 확인 기록 필수 + 출처 1곳 이상(Kenny 2026-11-25). */
export const CROSS_CHECK_CONTENT_KINDS: readonly ContentKind[] = Object.freeze(['FOOD', 'HEALTH'] as const);
export const CROSS_CHECK_TOOLS = Object.freeze(['CODEX_DISCUSS'] as const);
export const CROSS_CHECK_RESULTS = Object.freeze(['AGREE', 'REVISED'] as const);
export const CROSS_CHECK_KEYS = Object.freeze(['tool', 'checkedAt', 'result'] as const);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function isGeneralInfoTypeId(id: unknown): id is GeneralInfoTypeId {
  return typeof id === 'string' && (GENERAL_INFO_TYPE_IDS as readonly string[]).includes(id);
}

/**
 * 교차 확인 기록 형식(키 3개 정확히 · tool·result 허용목록 · checkedAt 달력 날짜). 날짜 순서는 보지 않는다
 *   (crossCheckOkAt 이 draftedAt ≤ checkedAt ≤ asOf 를 더 본다). validate V12·S03 이 같은 함수를 쓴다.
 */
export function isCrossCheckShape(cc: unknown): boolean {
  if (!isObj(cc)) return false;
  const ks = Object.keys(cc);
  if (ks.length !== CROSS_CHECK_KEYS.length || !CROSS_CHECK_KEYS.every((k) => ks.includes(k))) return false;
  if (!(CROSS_CHECK_TOOLS as readonly unknown[]).includes(cc.tool)) return false;
  if (!(CROSS_CHECK_RESULTS as readonly unknown[]).includes(cc.result)) return false;
  return isoDayNumber(cc.checkedAt) !== null;
}

function crossCheckOkAt(cc: unknown, drafted: number, day: number): boolean {
  if (!isCrossCheckShape(cc)) return false;
  const c = isoDayNumber((cc as Record<string, unknown>).checkedAt) as number;
  return c >= drafted && c <= day;
}

/** 출처 1곳 이상 — url 이 https 인 항목이 하나라도 있어야 한다. 기관 종류는 사람이 고른다(기계 판정 없음). validate V12 가 같은 함수를 쓴다. */
export function hasHttpsSource(source: unknown): boolean {
  return Array.isArray(source) && source.some((s) => isObj(s) && typeof s.url === 'string' && s.url.startsWith('https://'));
}

type GeneralInfoInput = Pick<ContentMeta, 'reviewStatus' | 'reviewerType' | 'contentKind'> &
  Partial<Pick<ContentMeta, 'draftedAt' | 'crossCheck' | 'source'>>;

/** exposure.ts 내부용(일 번호 입력). */
export function generalInfoOkAt(m: unknown, day: number): boolean {
  if (!isObj(m)) return false;
  if (m.reviewStatus !== GENERAL_INFO_STATUS) return false;
  if (!isReviewerType(m.reviewerType)) return false;
  if (!isContentKind(m.contentKind) || !GENERAL_INFO_CONTENT_KINDS.includes(m.contentKind)) return false;
  const drafted = isoDayNumber(m.draftedAt);
  if (drafted === null) return false;
  const age = day - drafted;
  if (age < 0 || age > GENERAL_INFO_MAX_AGE_DAYS) return false;
  if (!CROSS_CHECK_CONTENT_KINDS.includes(m.contentKind)) return true;
  return crossCheckOkAt(m.crossCheck, drafted, day) && hasHttpsSource(m.source);
}

/**
 * 일반 참고 정보 메타 유효(fail-closed): reviewStatus GENERAL_INFO ∧ 알려진 reviewerType ∧ contentKind ∈ {SPEC,CARE,FOOD,HEALTH}(LEGAL 제외)
 *   ∧ draftedAt 달력 날짜 ∧ 0 ≤ (asOf − draftedAt) ≤ 180 ∧ (FOOD·HEALTH → crossCheck{CODEX_DISCUSS, checkedAt, AGREE|REVISED},
 *   draftedAt ≤ checkedAt ≤ asOf ∧ https 출처 1곳 이상). 타입 범위(6종)는 보지 않는다 — exposure.ts 가 체인의 animalTypeId 로 따로 본다.
 *   asOf 가 YYYY-MM-DD 가 아니면 RangeError.
 */
export function isGeneralInfoMeta(m: GeneralInfoInput | null | undefined, asOf: string): boolean {
  const day = isoDayNumber(asOf);
  if (day === null) throw new RangeError(`general-info: asOf 는 YYYY-MM-DD 여야 한다 (${String(asOf)})`);
  return generalInfoOkAt(m, day);
}
