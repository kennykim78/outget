// 채팅 메시지 영속 리포지토리(Prisma, append-only — 삭제 메서드 없음, 증빙 보존).
//   InMemory 와 동일 시그니처·행위. 불변식 ②: 자금 컬럼 0. 불변식 ⑤: 좌표 0.
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { MessageRepository } from './message.repo.js';
import type { StoredMessage } from './message.types.js';
import { rowToMessage } from '../db/mappers.js';

export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async append(
    threadId: string,
    senderId: string,
    body: string,
  ): Promise<StoredMessage> {
    const row = await this.prisma.message.create({
      data: {
        id: `msg-${randomUUID()}`,
        threadId,
        senderId,
        body,
        createdAt: new Date().toISOString(),
      },
    });
    return rowToMessage(row);
  }

  async listByThread(threadId: string): Promise<StoredMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(rowToMessage);
  }
}
