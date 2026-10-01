import type { PrismaClient } from '@prisma/client';
import type { SupplyPost, CreateSupplyInput, SupplyStatus, SupplyItemType, SupplyDealType } from './supply.types.js';
import type { SupplyRepository, SupplyPostFilter } from './supply.repo.js';

export class PrismaSupplyRepository implements SupplyRepository {
  constructor(private prisma: PrismaClient) {}

  private mapFromPrisma(row: any): SupplyPost {
    return {
      id: row.id,
      authorId: row.authorId,
      title: row.title,
      itemType: row.itemType as SupplyItemType,
      dealType: row.dealType as SupplyDealType,
      price: row.price,
      description: row.description,
      photos: typeof row.photos === 'string' ? JSON.parse(row.photos || '[]') : (row.photos || []),
      region: row.region,
      lat: row.lat ?? undefined,
      lng: row.lng ?? undefined,
      status: row.status as SupplyStatus,
      createdAt: row.createdAt,
    };
  }

  async create(authorId: string, input: CreateSupplyInput): Promise<SupplyPost> {
    const id = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const price = input.dealType === 'FREE' ? 0 : (input.price ?? 0);
    const row = await this.prisma.supplyPost.create({
      data: {
        id,
        authorId,
        title: input.title,
        itemType: input.itemType,
        dealType: input.dealType,
        price,
        description: input.description,
        photos: JSON.stringify(input.photos || []),
        region: input.region,
        lat: input.lat,
        lng: input.lng,
        status: 'AVAILABLE',
        createdAt: new Date().toISOString(),
      },
    });
    return this.mapFromPrisma(row);
  }

  async findById(id: string): Promise<SupplyPost | null> {
    const row = await this.prisma.supplyPost.findUnique({ where: { id } });
    return row ? this.mapFromPrisma(row) : null;
  }

  async list(filter?: SupplyPostFilter): Promise<SupplyPost[]> {
    const where: any = {};
    if (filter?.itemType) where.itemType = filter.itemType;
    if (filter?.dealType) where.dealType = filter.dealType;
    if (filter?.status) {
      where.status = filter.status;
    } else {
      where.status = { not: 'BLINDED' };
    }
    if (filter?.region) {
      where.region = { contains: filter.region };
    }

    const rows = await this.prisma.supplyPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(r => this.mapFromPrisma(r));
  }

  async updateStatus(id: string, status: SupplyStatus): Promise<SupplyPost | null> {
    try {
      const row = await this.prisma.supplyPost.update({
        where: { id },
        data: { status },
      });
      return this.mapFromPrisma(row);
    } catch {
      return null;
    }
  }

  async blind(id: string): Promise<boolean> {
    try {
      await this.prisma.supplyPost.update({
        where: { id },
        data: { status: 'BLINDED' },
      });
      return true;
    } catch {
      return false;
    }
  }
}
