import type { PrismaClient } from '@prisma/client';
import type { AdoptionPost, CreateAdoptionPostInput, AdoptionStatus } from './adoption.types.js';
import type { AdoptionRepository, AdoptionPostFilter } from './adoption.repo.js';

export class PrismaAdoptionRepository implements AdoptionRepository {
  constructor(private prisma: PrismaClient) {}

  private mapFromPrisma(row: any): AdoptionPost {
    return {
      id: row.id,
      authorId: row.authorId,
      category: row.category as any,
      speciesDetail: row.speciesDetail,
      petName: row.petName ?? undefined,
      gender: row.gender as any,
      ageText: row.ageText,
      healthStatus: row.healthStatus,
      dealType: row.dealType as any,
      price: row.price,
      depositRefundTerms: row.depositRefundTerms ?? undefined,
      citesSpecies: row.citesSpecies,
      citesDocReady: row.citesDocReady,
      requiredCageSpec: row.requiredCageSpec ?? undefined,
      story: row.story,
      photos: typeof row.photos === 'string' ? JSON.parse(row.photos || '[]') : (row.photos || []),
      region: row.region,
      lat: row.lat ?? undefined,
      lng: row.lng ?? undefined,
      status: row.status as AdoptionStatus,
      createdAt: row.createdAt,
    };
  }

  async create(authorId: string, input: CreateAdoptionPostInput): Promise<AdoptionPost> {
    const id = `adopt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const price = input.dealType === 'FREE' ? 0 : (input.price ?? 0);
    const row = await this.prisma.adoptionPost.create({
      data: {
        id,
        authorId,
        category: input.category,
        speciesDetail: input.speciesDetail,
        petName: input.petName,
        gender: input.gender,
        ageText: input.ageText,
        healthStatus: input.healthStatus,
        dealType: input.dealType,
        price,
        depositRefundTerms: input.depositRefundTerms,
        citesSpecies: input.citesSpecies ?? false,
        citesDocReady: input.citesDocReady ?? false,
        requiredCageSpec: input.requiredCageSpec,
        story: input.story,
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

  async findById(id: string): Promise<AdoptionPost | null> {
    const row = await this.prisma.adoptionPost.findUnique({ where: { id } });
    return row ? this.mapFromPrisma(row) : null;
  }

  async list(filter?: AdoptionPostFilter): Promise<AdoptionPost[]> {
    const where: any = {};
    if (filter?.category) where.category = filter.category;
    if (filter?.dealType) where.dealType = filter.dealType;
    if (filter?.status) {
      where.status = filter.status;
    } else {
      where.status = { not: 'BLINDED' };
    }
    if (filter?.region) {
      where.region = { contains: filter.region };
    }

    const rows = await this.prisma.adoptionPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.mapFromPrisma(r));
  }

  async updateStatus(id: string, status: AdoptionStatus): Promise<AdoptionPost | null> {
    try {
      const row = await this.prisma.adoptionPost.update({
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
      await this.prisma.adoptionPost.update({
        where: { id },
        data: { status: 'BLINDED' },
      });
      return true;
    } catch {
      return false;
    }
  }
}
