// 매칭 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   불변식 ②: 금액·자금 흐름 컬럼 0. dealMethod 는 단순 라벨.
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Match, MatchRepository } from './match.repo.js';
import type { DealMethod } from '../payment/payment.types.js';
import { rowToMatch } from '../db/mappers.js';

export class PrismaMatchRepository implements MatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMatch(
    agentId: string,
    buyerId: string,
    requestId?: string,
  ): Promise<Match> {
    const n = randomUUID();
    const row = await this.prisma.match.create({
      data: {
        id: `m-${n}`,
        agentId,
        buyerId,
        // requestId 는 채택 진입 시에만 동반(없으면 null).
        requestId: requestId ?? null,
        status: '매칭',
        chatThreadId: `thread-${n}`,
        createdAt: new Date().toISOString(),
      },
    });
    return rowToMatch(row);
  }

  async findById(id: string): Promise<Match | undefined> {
    const row = await this.prisma.match.findUnique({ where: { id } });
    return row ? rowToMatch(row) : undefined;
  }

  async setDealMethod(matchId: string, method: DealMethod): Promise<Match | undefined> {
    const existing = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!existing) return undefined;
    const row = await this.prisma.match.update({
      where: { id: matchId },
      data: { dealMethod: method },
    });
    return rowToMatch(row);
  }
}
