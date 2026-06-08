// 알림 영속 리포지토리(Prisma, append-only). InMemory 와 동일 시그니처·행위.
//   불변식 ②: 자금 컬럼 0. 외부 fetch 0(자사 폴링 노출).
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { NotificationRepository } from './notification.repo.js';
import type { StoredNotification } from '../request/request.types.js';
import { rowToNotification } from '../db/mappers.js';

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(
    userId: string,
    type: string,
    refId: string,
    message: string,
  ): Promise<StoredNotification> {
    const row = await this.prisma.notification.create({
      data: {
        id: `n-${randomUUID()}`,
        userId,
        type,
        refId,
        message,
        createdAt: new Date().toISOString(),
        read: false,
      },
    });
    return rowToNotification(row);
  }

  async listByUser(userId: string): Promise<StoredNotification[]> {
    const rows = await this.prisma.notification.findMany({ where: { userId } });
    return rows.map(rowToNotification);
  }
}
