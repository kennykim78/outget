// 공동대행 슬롯 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   join: 트랜잭션 안에서 정원 가드(현재 인원 재조회 → 미달이면 +1, 도달 시 '마감').
//   불변식 ②: 금액·정산 컬럼 0(인원 카운트뿐). 불변식 ⑤: scheduleText/region 텍스트(좌표 0).
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { GroupSlotRepository, JoinResult } from './groupslot.repo.js';
import type {
  GroupSlot,
  GroupSlotInput,
  GroupSlotStatus,
} from './groupslot.types.js';
import { rowToGroupSlot } from '../db/mappers.js';

export class PrismaGroupSlotRepository implements GroupSlotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(agentId: string, input: GroupSlotInput): Promise<GroupSlot> {
    const row = await this.prisma.groupSlot.create({
      data: {
        id: `gs-${randomUUID()}`,
        agentId,
        scheduleText: input.scheduleText,
        region: input.region,
        capacity: input.capacity,
        joinedCount: 0,
        status: '모집',
      },
    });
    return rowToGroupSlot(row);
  }

  async findById(id: string): Promise<GroupSlot | undefined> {
    const row = await this.prisma.groupSlot.findUnique({ where: { id } });
    return row ? rowToGroupSlot(row) : undefined;
  }

  async listAll(): Promise<GroupSlot[]> {
    const rows = await this.prisma.groupSlot.findMany();
    return rows.map(rowToGroupSlot);
  }

  async join(id: string): Promise<JoinResult> {
    // 트랜잭션 정원 가드: 현재 인원을 읽고, 미달일 때만 원자적으로 +1.
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.groupSlot.findUnique({ where: { id } });
      if (!found) return { ok: false, reason: '없음' } as JoinResult;
      if (found.joinedCount >= found.capacity || found.status === '마감') {
        return { ok: false, reason: '마감' } as JoinResult;
      }
      const joinedCount = found.joinedCount + 1;
      const status: GroupSlotStatus =
        joinedCount >= found.capacity ? '마감' : '모집';
      const updated = await tx.groupSlot.update({
        where: { id },
        data: { joinedCount, status },
      });
      return { ok: true, slot: rowToGroupSlot(updated) } as JoinResult;
    });
  }
}
