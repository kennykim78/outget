// 익명 반응(PRD US-015·US-022, 계약 C-R5-3, 결정 D9). 커뮤니티 기능 아님 — 신호 집계만.
//   불변식 ③: 반응은 노출·정렬·검수·판정에 쓰지 않는다(engine/·prerender/ 는 이 모듈을 import 하지 않는다, 테스트로 잠금).
//   불변식 ⑧: IP·UA 원문을 저장하지 않는다 — anonKey = HMAC(일자|ip|ua) 만.

export const REACTION_TARGETS = ['SUPPLY_ITEM', 'BUNDLE', 'PRODUCT'] as const;
export type ReactionTarget = (typeof REACTION_TARGETS)[number];

export const REACTION_KINDS = ['HELPFUL', 'RECHECK', 'LIKE'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

/** ♥(LIKE)는 상품에만, 👍·⚠(HELPFUL·RECHECK)는 준비물·구성안에만(스펙33 §8). */
export const KIND_TARGETS: Readonly<Record<ReactionKind, readonly ReactionTarget[]>> = {
  LIKE: ['PRODUCT'],
  HELPFUL: ['SUPPLY_ITEM', 'BUNDLE'],
  RECHECK: ['SUPPLY_ITEM', 'BUNDLE'],
};

/** 공개 임계(D9): LIKE 수가 이 값 미만이면 숫자를 내보내지 않는다(null). */
export const LIKE_PUBLIC_THRESHOLD = 10;
/** GET counts 한 번에 물을 수 있는 id 수. */
export const MAX_COUNT_IDS = 20;

export interface ReactionKey {
  anonKey: string;
  targetType: ReactionTarget;
  targetId: string;
  kind: ReactionKind;
}

export interface ReactionRecord extends ReactionKey {
  id: string;
  /** ISO 시각. */
  createdAt: string;
}

export const TARGET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
