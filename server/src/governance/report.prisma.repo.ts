// 신고 영속 리포지토리(Prisma). InMemory 와 동일 시그니처·행위.
//   불변식 ③: create 는 status='블라인드'(임시조치)로 즉시 스탬프. 삭제 메서드 없음(증거 보존).
//   불변식 ②: 자금 컬럼 0. 불변식 ⑤: 좌표 0.
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ReportRepository } from './report.repo.js';
import type {
  Report,
  ReportInput,
  ReportStatus,
  ReportTargetType,
} from './report.types.js';
import { rowToReport } from '../db/mappers.js';

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(reporterId: string, input: ReportInput): Promise<Report> {
    const row = await this.prisma.report.create({
      data: {
        id: `rep-${randomUUID()}`,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        reporterId,
        // 불변식 ③: 신고 즉시 블라인드(임시조치). 클라가 status 를 정하지 못한다.
        status: '블라인드',
        createdAt: new Date().toISOString(),
      },
    });
    return rowToReport(row);
  }

  async findById(id: string): Promise<Report | undefined> {
    const row = await this.prisma.report.findUnique({ where: { id } });
    return row ? rowToReport(row) : undefined;
  }

  async listByStatus(status: ReportStatus): Promise<Report[]> {
    const rows = await this.prisma.report.findMany({ where: { status } });
    return rows.map(rowToReport);
  }

  async listAll(): Promise<Report[]> {
    const rows = await this.prisma.report.findMany();
    return rows.map(rowToReport);
  }

  async setStatus(id: string, status: ReportStatus): Promise<Report | undefined> {
    const existing = await this.prisma.report.findUnique({ where: { id } });
    if (!existing) return undefined;
    const row = await this.prisma.report.update({ where: { id }, data: { status } });
    return rowToReport(row);
  }

  async isBlinded(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<boolean> {
    // 동일 대상에 블라인드 신고가 하나라도 있으면 true.
    const found = await this.prisma.report.findFirst({
      where: { targetType, targetId, status: '블라인드' },
    });
    return found !== null;
  }
}
