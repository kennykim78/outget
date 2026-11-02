// 이벤트 영속 저장소(Prisma EventLog) — createMany 1회. 행 필드는 EventRow 를 명시 매핑(여분 필드 유입 차단).
import type { PrismaClient } from '@prisma/client';
import type { EventRepository, EventRow } from './event.repo.js';

export class PrismaEventRepository implements EventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(rows: EventRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.eventLog.createMany({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        ts: r.ts,
        animalTypeId: r.animalTypeId,
        props: r.props,
        sessionKey: r.sessionKey,
        receivedDate: r.receivedDate,
      })),
    });
    return count;
  }

  /** 일일 상한 복원(264) — receivedDate 인덱스(마이그레이션 20261102000000_vet_report_created_at)로 범위 조회. */
  countOnDate(receivedDate: string): Promise<number> {
    return this.prisma.eventLog.count({ where: { receivedDate } });
  }
}
