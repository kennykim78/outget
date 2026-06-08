// 분쟁 감사기록 영속 리포지토리(Prisma, append-only — 삭제 없음). InMemory 와 동일 행위.
//   불변식 ②: 자금 컬럼 0. 불변식 ⑤: 좌표 0.
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { DisputeAuditEntry, DisputeRepository } from './dispute.repo.js';
import { rowToDispute } from '../db/mappers.js';

export class PrismaDisputeRepository implements DisputeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async appendAudit(
    matchId: string,
    actorId: string,
    action: string,
    detail: string,
  ): Promise<DisputeAuditEntry> {
    const row = await this.prisma.dispute.create({
      data: {
        id: `dsp-${randomUUID()}`,
        matchId,
        actorId,
        action,
        detail,
        createdAt: new Date().toISOString(),
      },
    });
    return rowToDispute(row);
  }

  async listByMatch(matchId: string): Promise<DisputeAuditEntry[]> {
    const rows = await this.prisma.dispute.findMany({
      where: { matchId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(rowToDispute);
  }
}
