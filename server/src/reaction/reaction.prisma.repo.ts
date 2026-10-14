// 반응 영속 저장소(Prisma, 기존 ReactionSignal 모델 — 스키마 변경 없음).
//   add 는 @@unique(anonKey, targetType, targetId, kind) 위 upsert(멱등). existsAny·removeAny 는 창 키 목록(anonKey IN …).
//   키 목록(최대 400)은 SQLite 바인드 변수 한도(999) 아래로 나눠 보낸다.
import type { PrismaClient } from '@prisma/client';
import type { ReactionRepository, ReactionTargetRef } from './reaction.repo.js';
import type { ReactionKind, ReactionRecord, ReactionTarget } from './reaction.types.js';

const CHUNK = 500;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export class PrismaReactionRepository implements ReactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(rec: ReactionRecord): Promise<void> {
    const { anonKey, targetType, targetId, kind } = rec;
    await this.prisma.reactionSignal.upsert({
      where: { anonKey_targetType_targetId_kind: { anonKey, targetType, targetId, kind } },
      create: { id: rec.id, anonKey, targetType, targetId, kind, createdAt: rec.createdAt },
      update: {},
    });
  }

  async existsAny(anonKeys: readonly string[], ref: ReactionTargetRef): Promise<boolean> {
    for (const part of chunks(anonKeys)) {
      const hit = await this.prisma.reactionSignal.findFirst({
        where: { anonKey: { in: part }, targetType: ref.targetType, targetId: ref.targetId, kind: ref.kind },
        select: { id: true },
      });
      if (hit) return true;
    }
    return false;
  }

  async removeAny(anonKeys: readonly string[], ref: ReactionTargetRef): Promise<void> {
    for (const part of chunks(anonKeys)) {
      await this.prisma.reactionSignal.deleteMany({
        where: { anonKey: { in: part }, targetType: ref.targetType, targetId: ref.targetId, kind: ref.kind },
      });
    }
  }

  async count(targetType: ReactionTarget, kind: ReactionKind, ids: readonly string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of ids) out[id] = 0;
    if (ids.length === 0) return out;
    const groups = await this.prisma.reactionSignal.groupBy({
      by: ['targetId'],
      where: { targetType, kind, targetId: { in: [...ids] } },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (Object.prototype.hasOwnProperty.call(out, g.targetId)) out[g.targetId] = g._count._all;
    }
    return out;
  }
}
