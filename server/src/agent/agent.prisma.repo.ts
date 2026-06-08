// 대행자 프로필 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   upsertByOwner: 1인 1프로필(ownerUserId @unique). incrementReputation: 원자적 {increment}.
//   불변식 ⑤: lat/lng 는 매장 앵커(옵셔널)일 뿐 사용자 위치가 아니다.
//   불변식 ②: 자금 흐름 컬럼 0(reputation 은 무금전 평판 점수).
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AgentProfileRepository } from './agent.repo.js';
import type { AgentProfileInput, StoredAgentProfile } from './agent.types.js';
import { rowToAgent } from '../db/mappers.js';

// 입력의 optional 필드를 Prisma data 형태(undefined 유지)로 옮긴다.
//   undefined 는 Prisma 에서 "미설정" → null 저장. 매장 앵커 좌표 포함.
function inputData(input: AgentProfileInput) {
  return {
    status: input.status,
    bizName: input.bizName ?? null,
    bizNo: input.bizNo ?? null,
    contact: input.contact ?? null,
    bizDocRef: input.bizDocRef ?? null,
    activeRegion: input.activeRegion,
    scheduleText: input.scheduleText,
    reputation: input.reputation,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  };
}

export class PrismaAgentProfileRepository implements AgentProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByOwner(
    ownerUserId: string,
    input: AgentProfileInput,
  ): Promise<StoredAgentProfile> {
    const data = inputData(input);
    const row = await this.prisma.agentProfile.upsert({
      where: { ownerUserId },
      update: data,
      create: { id: `ag-${randomUUID()}`, ownerUserId, ...data },
    });
    return rowToAgent(row);
  }

  async findByOwner(ownerUserId: string): Promise<StoredAgentProfile | undefined> {
    const row = await this.prisma.agentProfile.findUnique({ where: { ownerUserId } });
    return row ? rowToAgent(row) : undefined;
  }

  async findById(id: string): Promise<StoredAgentProfile | undefined> {
    const row = await this.prisma.agentProfile.findUnique({ where: { id } });
    return row ? rowToAgent(row) : undefined;
  }

  async listAll(): Promise<StoredAgentProfile[]> {
    const rows = await this.prisma.agentProfile.findMany();
    return rows.map(rowToAgent);
  }

  async incrementReputation(
    ownerUserId: string,
    delta: number,
  ): Promise<StoredAgentProfile | undefined> {
    // 소유자 프로필이 없으면 노옵(undefined).
    const existing = await this.prisma.agentProfile.findUnique({ where: { ownerUserId } });
    if (!existing) return undefined;
    const row = await this.prisma.agentProfile.update({
      where: { ownerUserId },
      data: { reputation: { increment: delta } },
    });
    return rowToAgent(row);
  }
}
