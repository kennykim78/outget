// 정리 작업 Prisma 구현(P5). 토큰·세션 정리는 save 저장소의 기존 메서드와 같은 조건(재사용).
import type { PrismaClient } from '@prisma/client';
import { PrismaMagicTokenRepository, PrismaSessionRepository } from '../save/save.prisma.repo.js';
import { VET_REPORT_KEEP_STATUS, type RetentionStore, type UserActivity } from './retention.js';

export type DbProvider = 'sqlite' | 'postgresql';

export class PrismaRetentionStore implements RetentionStore {
  private readonly tokens: PrismaMagicTokenRepository;
  private readonly sessions: PrismaSessionRepository;

  /** provider 기본 'sqlite'(schema.prisma datasource). M2 Postgres 전환 시 'postgresql' 로 주입. */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: DbProvider = 'sqlite',
  ) {
    this.tokens = new PrismaMagicTokenRepository(prisma);
    this.sessions = new PrismaSessionRepository(prisma);
  }

  async listUserActivity(): Promise<UserActivity[]> {
    const rows = await this.prisma.user.findMany({
      select: {
        id: true,
        role: true,
        createdAt: true,
        lastSeenAt: true,
        saveSnapshot: { select: { updatedAt: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      role: r.role,
      createdAt: r.createdAt,
      lastSnapshotAt: r.saveSnapshot?.updatedAt ?? null,
      lastSeenAt: r.lastSeenAt ?? null,
    }));
  }

  deleteExpiredMagicTokens(cutoffIso: string): Promise<number> {
    return this.tokens.deleteExpired(cutoffIso);
  }

  deleteInactiveSessions(cutoffIso: string): Promise<number> {
    return this.sessions.deleteInactive(cutoffIso);
  }

  async deleteEventsBefore(date: string): Promise<number> {
    return (await this.prisma.eventLog.deleteMany({ where: { receivedDate: { lt: date } } })).count;
  }

  async deleteReactionsBefore(cutoffIso: string): Promise<number> {
    return (await this.prisma.reactionSignal.deleteMany({ where: { createdAt: { lt: cutoffIso } } })).count;
  }

  /**
   * 264: VERIFIED 외 사용자 제보(REPORTED·BLINDED·모르는 값 — QA LOW-1·security ②b, 처리방침 "목록에 올린 병원은 남아요"와 일치).
   *   VERIFIED(목록)·SEED 행은 지우지 않는다. createdAt '' (시드 행 기본값)도 '' < cutoff 이지만 source 조건으로 빠진다.
   *   마이그레이션 20261102000000 이 기존 USER_REPORT 행을 그 시각으로 채우므로 USER_REPORT 의 createdAt 은 비지 않는다.
   */
  async deleteReportedVetsBefore(cutoffIso: string): Promise<number> {
    return (
      await this.prisma.vetClinic.deleteMany({
        where: { source: 'USER_REPORT', status: { not: VET_REPORT_KEEP_STATUS }, createdAt: { lt: cutoffIso } },
      })
    ).count;
  }

  async vacuum(): Promise<void> {
    if (this.provider === 'sqlite') {
      // SQLite: 삭제한 행의 페이지가 파일에 남는다(R1) — VACUUM 으로 파일을 다시 써서 제거. 트랜잭션 밖에서만 가능.
      await this.prisma.$executeRawUnsafe('VACUUM');
      return;
    }
    // Postgres(M2): 행 공간은 autovacuum 이 회수한다. 삭제 즉시 디스크 덮어쓰기가 필요하면 그때 VACUUM FULL 여부를 정한다.
  }
}
