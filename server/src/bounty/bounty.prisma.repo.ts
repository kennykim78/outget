// 바운티 영속 리포지토리(Prisma, 제출 append-only). InMemory 와 동일 시그니처·행위.
//   불변식 ②: 금액·결제·정산 컬럼 0(보상은 뱃지·평판뿐). 불변식 ⑤: 좌표 0.
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { BountyRepository } from './bounty.repo.js';
import type {
  Bounty,
  BountyInput,
  BountyStatus,
  BountySubmission,
} from './bounty.types.js';
import { rowToBounty, rowToSubmission } from '../db/mappers.js';

export class PrismaBountyRepository implements BountyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(requesterId: string, input: BountyInput): Promise<Bounty> {
    const row = await this.prisma.bounty.create({
      data: {
        id: `bty-${randomUUID()}`,
        requesterId,
        mission: input.mission,
        status: '모집',
      },
    });
    return rowToBounty(row);
  }

  async findById(id: string): Promise<Bounty | undefined> {
    const row = await this.prisma.bounty.findUnique({ where: { id } });
    return row ? rowToBounty(row) : undefined;
  }

  async listAll(): Promise<Bounty[]> {
    const rows = await this.prisma.bounty.findMany();
    return rows.map(rowToBounty);
  }

  async listByRequester(requesterId: string): Promise<Bounty[]> {
    const rows = await this.prisma.bounty.findMany({ where: { requesterId } });
    return rows.map(rowToBounty);
  }

  async addSubmission(
    bountyId: string,
    solverId: string,
    photo: string | undefined,
    badgeAwarded: boolean,
  ): Promise<BountySubmission> {
    const row = await this.prisma.bountySubmission.create({
      data: {
        id: `bsub-${randomUUID()}`,
        bountyId,
        solverId,
        photo: photo ?? null,
        createdAt: new Date().toISOString(),
        badgeAwarded,
      },
    });
    return rowToSubmission(row);
  }

  async listSubmissions(bountyId: string): Promise<BountySubmission[]> {
    const rows = await this.prisma.bountySubmission.findMany({ where: { bountyId } });
    return rows.map(rowToSubmission);
  }

  async setStatus(id: string, status: BountyStatus): Promise<Bounty | undefined> {
    const existing = await this.prisma.bounty.findUnique({ where: { id } });
    if (!existing) return undefined;
    const row = await this.prisma.bounty.update({ where: { id }, data: { status } });
    return rowToBounty(row);
  }
}
