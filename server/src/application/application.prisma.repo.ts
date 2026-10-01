import type { PrismaClient } from '@prisma/client';
import type { AdoptionApplication, CreateApplicationInput, ApplicationStatus } from './application.types.js';
import type { ApplicationRepository } from './application.repo.js';

export class PrismaApplicationRepository implements ApplicationRepository {
  constructor(private prisma: PrismaClient) {}

  private mapFromPrisma(row: any): AdoptionApplication {
    return {
      id: row.id,
      postId: row.postId,
      applicantId: row.applicantId,
      cagePhotoUrl: row.cagePhotoUrl,
      experience: row.experience,
      familyAgreed: row.familyAgreed,
      commitment: row.commitment,
      status: row.status as ApplicationStatus,
      chatThreadId: row.chatThreadId ?? undefined,
      createdAt: row.createdAt,
    };
  }

  async create(applicantId: string, input: CreateApplicationInput): Promise<AdoptionApplication> {
    const id = `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const row = await this.prisma.adoptionApplication.create({
      data: {
        id,
        postId: input.postId,
        applicantId,
        cagePhotoUrl: input.cagePhotoUrl,
        experience: input.experience,
        familyAgreed: input.familyAgreed,
        commitment: input.commitment,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      },
    });
    return this.mapFromPrisma(row);
  }

  async findById(id: string): Promise<AdoptionApplication | null> {
    const row = await this.prisma.adoptionApplication.findUnique({ where: { id } });
    return row ? this.mapFromPrisma(row) : null;
  }

  async listByPostId(postId: string): Promise<AdoptionApplication[]> {
    const rows = await this.prisma.adoptionApplication.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(r => this.mapFromPrisma(r));
  }

  async listByApplicantId(applicantId: string): Promise<AdoptionApplication[]> {
    const rows = await this.prisma.adoptionApplication.findMany({
      where: { applicantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(r => this.mapFromPrisma(r));
  }

  async updateStatus(id: string, status: ApplicationStatus, chatThreadId?: string): Promise<AdoptionApplication | null> {
    try {
      const row = await this.prisma.adoptionApplication.update({
        where: { id },
        data: {
          status,
          ...(chatThreadId ? { chatThreadId } : {}),
        },
      });
      return this.mapFromPrisma(row);
    } catch {
      return null;
    }
  }
}
