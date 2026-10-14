// 반응 저장소 — (anonKey, targetType, targetId, kind) 당 1행. anonKey 는 날짜 솔트 키라
//   중복 판정·취소는 창(anon-key.ts REACTION_KEY_WINDOW_DAYS) 안의 키 목록으로 한다. 집계는 LIKE 수만 꺼낸다.
import type { ReactionKind, ReactionRecord, ReactionTarget } from './reaction.types.js';

export interface ReactionTargetRef {
  targetType: ReactionTarget;
  targetId: string;
  kind: ReactionKind;
}

export interface ReactionRepository {
  /** 같은 키가 이미 있으면 아무것도 하지 않는다. */
  add(rec: ReactionRecord): Promise<void>;
  /** anonKeys 중 하나라도 이 대상·종류 행이 있는가. */
  existsAny(anonKeys: readonly string[], ref: ReactionTargetRef): Promise<boolean>;
  /** anonKeys 중 이 대상·종류 행을 모두 지운다(없으면 아무것도 안 함). */
  removeAny(anonKeys: readonly string[], ref: ReactionTargetRef): Promise<void>;
  /** ids 각각의 행 수(없으면 0). */
  count(targetType: ReactionTarget, kind: ReactionKind, ids: readonly string[]): Promise<Record<string, number>>;
}

const keyOf = (k: ReactionTargetRef & { anonKey: string }): string => `${k.anonKey}|${k.targetType}|${k.targetId}|${k.kind}`;

export class InMemoryReactionRepository implements ReactionRepository {
  private readonly rows = new Map<string, ReactionRecord>();

  async add(rec: ReactionRecord): Promise<void> {
    const k = keyOf(rec);
    if (!this.rows.has(k)) this.rows.set(k, { ...rec });
  }

  async existsAny(anonKeys: readonly string[], ref: ReactionTargetRef): Promise<boolean> {
    return anonKeys.some((anonKey) => this.rows.has(keyOf({ ...ref, anonKey })));
  }

  async removeAny(anonKeys: readonly string[], ref: ReactionTargetRef): Promise<void> {
    for (const anonKey of anonKeys) this.rows.delete(keyOf({ ...ref, anonKey }));
  }

  async count(targetType: ReactionTarget, kind: ReactionKind, ids: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of ids) out[id] = 0;
    for (const r of this.rows.values()) {
      if (r.targetType === targetType && r.kind === kind && Object.prototype.hasOwnProperty.call(out, r.targetId)) {
        out[r.targetId] += 1;
      }
    }
    return out;
  }

  /** 테스트 전용 — 저장된 행 사본. */
  dump(): ReactionRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}
