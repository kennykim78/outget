// 저장(C-R5-2) Prisma 구현 — InMemory 와 동일 행위. 1회용 소비·세션 활성 판정은 조건부 쿼리 한 번으로(경합 안전).
import type { PrismaClient } from '@prisma/client';
import type {
  MagicTokenRepository,
  MagicTokenRow,
  SavePutResult,
  SaveSnapshotRepository,
  SaveSnapshotRow,
  SessionRepository,
  SessionRow,
} from './save.repo.js';
import { newestFirst } from './save.repo.js';

export class PrismaMagicTokenRepository implements MagicTokenRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(row: MagicTokenRow): Promise<void> {
    await this.prisma.magicLinkToken.create({ data: row });
  }

  async consume(tokenHash: string, nowIso: string): Promise<string | null> {
    // 조건부 갱신 1건 = 소비 성공. 동시 요청 두 개 중 하나만 count 1 을 받는다.
    const { count } = await this.prisma.magicLinkToken.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: nowIso } },
      data: { consumedAt: nowIso },
    });
    if (count !== 1) return null;
    const row = await this.prisma.magicLinkToken.findUnique({ where: { tokenHash }, select: { email: true } });
    return row?.email ?? null;
  }

  async deleteExpired(cutoffIso: string): Promise<number> {
    const { count } = await this.prisma.magicLinkToken.deleteMany({ where: { expiresAt: { lte: cutoffIso } } });
    return count;
  }
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(row: SessionRow): Promise<void> {
    await this.prisma.session.create({ data: row });
  }

  async findActiveUserId(sidHash: string, nowIso: string): Promise<string | null> {
    const row = await this.prisma.session.findFirst({
      where: { sidHash, revokedAt: null, expiresAt: { gt: nowIso } },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  async revoke(sidHash: string, nowIso: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { sidHash, revokedAt: null }, data: { revokedAt: nowIso } });
  }

  async enforceCap(userId: string, keepSidHash: string, max: number, nowIso: string): Promise<number> {
    // 조회·폐기를 한 트랜잭션으로(SQLite 쓰기 직렬화) — 같은 사용자의 동시 연결이 상한을 넘겨 남기지 않게.
    return this.prisma.$transaction(async (tx) => {
      const others = await tx.session.findMany({
        where: { userId, sidHash: { not: keepSidHash }, revokedAt: null, expiresAt: { gt: nowIso } },
        select: { sidHash: true, createdAt: true },
      });
      const victims = others.sort(newestFirst).slice(Math.max(0, max - 1)).map((r) => r.sidHash);
      if (victims.length === 0) return 0;
      const { count } = await tx.session.updateMany({
        where: { sidHash: { in: victims }, revokedAt: null },
        data: { revokedAt: nowIso },
      });
      return count;
    });
  }

  async deleteInactive(cutoffIso: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lte: cutoffIso } }, { revokedAt: { lte: cutoffIso } }] },
    });
    return count;
  }
}

export class PrismaSaveSnapshotRepository implements SaveSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string): Promise<SaveSnapshotRow | null> {
    const row = await this.prisma.saveSnapshot.findUnique({ where: { userId } });
    return row ? { userId: row.userId, v: row.v, payload: row.payload, updatedAt: row.updatedAt } : null;
  }

  async put(row: SaveSnapshotRow): Promise<void> {
    const { userId, ...rest } = row;
    await this.prisma.saveSnapshot.upsert({ where: { userId }, create: row, update: rest });
  }

  async putIfMatch(row: SaveSnapshotRow, baseUpdatedAt: string | null): Promise<SavePutResult> {
    const { userId, ...rest } = row;
    if (baseUpdatedAt === null) {
      // 행 없음이 기준 — 생성 1건. 이미 있으면(다른 기기가 먼저 만듦) 기본 키 충돌 P2002 → 경합.
      try {
        await this.prisma.saveSnapshot.create({ data: row });
        return { ok: true };
      } catch (err) {
        if ((err as { code?: unknown }).code !== 'P2002') throw err;
        return { ok: false, current: await this.get(userId) };
      }
    }
    // 조건부 갱신 1건 = 기준 일치. 동시 요청 둘 중 하나만 count 1(magic 토큰 소비와 같은 방식).
    const { count } = await this.prisma.saveSnapshot.updateMany({ where: { userId, updatedAt: baseUpdatedAt }, data: rest });
    if (count === 1) return { ok: true };
    return { ok: false, current: await this.get(userId) };
  }
}
