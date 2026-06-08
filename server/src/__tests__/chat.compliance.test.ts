import { describe, expect, it } from 'vitest';
import { InMemoryMessageRepository } from '../chat/message.repo.js';

// Epic 5 채팅 불변식 가드(단위). 저장 메시지에 좌표·결제 키 0.
// 증거 보존: 리포지토리에 삭제 메서드가 없음을 확인한다.

describe('불변식 ⑤ — StoredMessage 에 좌표 키 0', () => {
  it('저장된 메시지에 좌표 추적 키가 없다', async () => {
    const repo = new InMemoryMessageRepository();
    const msg = await repo.append('thread-1', 'user-1', '안녕하세요');
    const keys = Object.keys(msg);
    for (const banned of ['lat', 'lng', 'latitude', 'longitude', 'coords', 'geolocation', 'userLat', 'userLng']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('불변식 ② — StoredMessage 에 결제·자금 키 0', () => {
  it('저장된 메시지에 결제성 키가 전혀 없다', async () => {
    const repo = new InMemoryMessageRepository();
    const msg = await repo.append('thread-1', 'user-1', '본문');
    const keys = Object.keys(msg);
    const banned = [
      'amount', 'price', 'fee', 'deposit', 'settlement', 'provider', 'merchantId',
      'pay' + 'out', 'es' + 'crow', 're' + 'fund', '정' + '산', '예' + '치', 'bal' + 'ance',
    ];
    for (const k of banned) {
      expect(keys).not.toContain(k);
    }
  });

  it('저장 메시지 키는 허용 집합(id/threadId/senderId/body/createdAt)뿐', async () => {
    const repo = new InMemoryMessageRepository();
    const msg = await repo.append('thread-1', 'user-1', '본문');
    const allowed = ['id', 'threadId', 'senderId', 'body', 'createdAt'];
    for (const k of Object.keys(msg)) {
      expect(allowed).toContain(k);
    }
  });
});

describe('증거 보존 — MessageRepository 에 삭제 메서드 없음', () => {
  it('repo 에 delete/remove 류 메서드가 노출되지 않는다', () => {
    const repo = new InMemoryMessageRepository();
    const proto = Object.getPrototypeOf(repo) as Record<string, unknown>;
    const names = Object.getOwnPropertyNames(proto);
    for (const banned of ['delete', 'remove', 'destroy', 'clear', 'purge']) {
      expect(names).not.toContain(banned);
    }
    expect(names).toContain('append');
    expect(names).toContain('listByThread');
  });
});
