// 할인소식(UGC) 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   불변식 ④: create 에서 정가(listPrice) 미입력이면 unverifiedBase=true 를 서버가 스탬프(클라 우회 불가).
//   불변식 ⑤: UGC 등록분은 매장 앵커 좌표 없이 보관(사용자 위치 미수집). 불변식 ②: 자금 컬럼 0.
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type {
  DiscountReferenceStamp,
  DiscountRepository,
  DiscountStatus,
} from './discount.repo.js';
import type { DiscountInput, StoredDiscountPost } from './listings.types.js';
import { rowToDiscount } from '../db/mappers.js';

export class PrismaDiscountRepository implements DiscountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    authorId: string,
    input: DiscountInput,
    reference?: DiscountReferenceStamp,
  ): Promise<StoredDiscountPost> {
    const row = await this.prisma.discountPost.create({
      data: {
        id: `disc-${randomUUID()}`,
        authorId,
        storeBrand: input.storeBrand,
        discountRate: input.discountRate ?? null,
        discountPrice: input.discountPrice ?? null,
        listPrice: input.listPrice ?? null,
        // 불변식 ④: 정가 미입력이면 unverifiedBase=true 강제(서버 스탬프).
        unverifiedBase: input.listPrice === undefined,
        source: input.source,
        photo: input.photo ?? null,
        createdAt: new Date().toISOString(),
        status: '정상',
        // 네이버쇼핑 참고가 서버 스탬프(있을 때만, all-or-nothing) — 외부 출처(불변식 ④).
        //   referenceQuery/ProductId(입력)는 단독 저장하지 않는다(reference 6필드로만). 본문 0.
        referenceBasePrice: reference?.referenceBasePrice ?? null,
        referenceLowestPrice: reference?.referenceLowestPrice ?? null,
        referenceProductId: reference?.referenceProductId ?? null,
        referenceSource: reference?.referenceSource ?? null,
        referenceQuery: reference?.referenceQuery ?? null,
        referenceFetchedAt: reference?.referenceFetchedAt ?? null,
      },
    });
    return rowToDiscount(row);
  }

  async findById(id: string): Promise<StoredDiscountPost | undefined> {
    const row = await this.prisma.discountPost.findUnique({ where: { id } });
    return row ? rowToDiscount(row) : undefined;
  }

  async listByOwner(authorId: string): Promise<StoredDiscountPost[]> {
    const rows = await this.prisma.discountPost.findMany({ where: { authorId } });
    return rows.map(rowToDiscount);
  }

  async listAll(): Promise<StoredDiscountPost[]> {
    const rows = await this.prisma.discountPost.findMany();
    return rows.map(rowToDiscount);
  }

  async setStatus(
    id: string,
    status: DiscountStatus,
  ): Promise<StoredDiscountPost | undefined> {
    const existing = await this.prisma.discountPost.findUnique({ where: { id } });
    if (!existing) return undefined;
    const row = await this.prisma.discountPost.update({
      where: { id },
      data: { status },
    });
    return rowToDiscount(row);
  }
}
