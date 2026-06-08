// 역경매 요청 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   create: status 를 서버가 '대기' 강제. adopt: updateMany where status='대기' 로 원자적 선착 1채택.
//   불변식 ②: hopePrice/verifiedPrice 는 표시값일 뿐 자금 흐름 0. 불변식 ⑤: region 텍스트(좌표 0).
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { RequestRepository } from './request.repo.js';
import type { RequestInput, StoredRequest, VerifiedPrice } from './request.types.js';
import { rowToRequest, verifiedPriceToColumns } from '../db/mappers.js';

export class PrismaRequestRepository implements RequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(ownerUserId: string, input: RequestInput): Promise<StoredRequest> {
    const row = await this.prisma.request.create({
      data: {
        id: `req-${randomUUID()}`,
        ownerUserId,
        item: input.item,
        options: input.options ?? null,
        hopePrice: input.hopePrice,
        deadline: input.deadline,
        region: input.region,
        // status 는 서버가 '대기' 로 강제(클라가 정하지 못한다).
        status: '대기',
      },
    });
    return rowToRequest(row);
  }

  async findById(id: string): Promise<StoredRequest | undefined> {
    const row = await this.prisma.request.findUnique({ where: { id } });
    return row ? rowToRequest(row) : undefined;
  }

  async listByOwner(ownerUserId: string): Promise<StoredRequest[]> {
    const rows = await this.prisma.request.findMany({ where: { ownerUserId } });
    return rows.map(rowToRequest);
  }

  async listAll(): Promise<StoredRequest[]> {
    const rows = await this.prisma.request.findMany();
    return rows.map(rowToRequest);
  }

  async adopt(
    reqId: string,
    agentId: string,
    matchId: string,
  ): Promise<StoredRequest | undefined> {
    // 원자적 선착 1채택: '대기' 인 행만 갱신(동시 채택 경쟁에서 단 1건만 성공).
    const result = await this.prisma.request.updateMany({
      where: { id: reqId, status: '대기' },
      data: { status: '채택', adoptedBy: agentId, matchId },
    });
    // 0행 갱신 = 없거나 이미 비대기 → 거부(undefined).
    if (result.count === 0) return undefined;
    const row = await this.prisma.request.findUnique({ where: { id: reqId } });
    return row ? rowToRequest(row) : undefined;
  }

  async setVerifiedPrice(
    reqId: string,
    vp: VerifiedPrice,
  ): Promise<StoredRequest | undefined> {
    const existing = await this.prisma.request.findUnique({ where: { id: reqId } });
    if (!existing) return undefined;
    const row = await this.prisma.request.update({
      where: { id: reqId },
      data: verifiedPriceToColumns(vp),
    });
    return rowToRequest(row);
  }

  async reject(reqId: string): Promise<StoredRequest | undefined> {
    // 거절은 상태를 바꾸지 않는다(대기 유지). 알림만 라우터에서 발송.
    const row = await this.prisma.request.findUnique({ where: { id: reqId } });
    return row ? rowToRequest(row) : undefined;
  }
}
