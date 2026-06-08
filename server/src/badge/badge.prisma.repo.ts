// 뱃지 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   멱등: (userId, type) 복합키 upsert — 재호출해도 중복 부여되지 않고 기존 레코드 유지.
//   불변식 ②: 무금전 신뢰 신호일 뿐 금액·잔액 컬럼 0.
import type { PrismaClient } from '@prisma/client';
import type { Badge } from './badge.types.js';
import type { BadgeRepository } from './badge.repo.js';
import { rowToBadge } from '../db/mappers.js';

export class PrismaBadgeRepository implements BadgeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async grant(userId: string, type: string): Promise<Badge> {
    // 멱등: 이미 있으면 update 가 grantedAt 을 건드리지 않아 기존 발급 시각 유지.
    const row = await this.prisma.badge.upsert({
      where: { userId_type: { userId, type } },
      update: {},
      create: { userId, type, grantedAt: new Date().toISOString() },
    });
    return rowToBadge(row);
  }

  async listByUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.badge.findMany({ where: { userId } });
    return rows.map((r) => r.type);
  }
}
