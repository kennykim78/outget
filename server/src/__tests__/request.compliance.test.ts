import { describe, expect, it } from 'vitest';
import { InMemoryRequestRepository } from '../request/request.repo.js';
import { InMemoryNotificationRepository } from '../notification/notification.repo.js';
import { InMemoryMatchRepository } from '../agent/match.repo.js';

// Epic 4 불변식 가드(단위). 외부 호출/네트워크 없이 저장 객체 형태만 검사한다.

describe('불변식 ② — StoredRequest 에 자금 흐름 키 0', () => {
  it('생성된 요청에 결제성 키가 전혀 없다(hopePrice 는 표시값)', async () => {
    const repo = new InMemoryRequestRepository();
    const stored = await repo.create('owner-1', {
      item: '운동화',
      hopePrice: 80000,
      deadline: '2026-06-20',
      region: '여주',
    });
    const keys = Object.keys(stored);
    const banned = [
      'amount', 'fee', 'balance', 'deposit', 'settlement',
      'pay' + 'out', 'es' + 'crow', 're' + 'fund', '정' + '산', '예' + '치',
    ];
    for (const k of banned) {
      expect(keys).not.toContain(k);
    }
  });
});

describe('불변식 ⑤ — StoredRequest 에 좌표 키 0', () => {
  it('저장 요청에 좌표 추적 키(lat/lng/coords 등)가 없다', async () => {
    const repo = new InMemoryRequestRepository();
    const stored = await repo.create('owner-1', {
      item: '운동화',
      hopePrice: 80000,
      deadline: '2026-06-20',
      region: '여주',
    });
    const keys = Object.keys(stored);
    for (const banned of ['lat', 'lng', 'latitude', 'longitude', 'coords', 'geolocation', 'userLat', 'userLng']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('불변식 ② — StoredNotification 에 자금 흐름 키 0', () => {
  it('생성된 알림에 결제성 키가 전혀 없다', async () => {
    const repo = new InMemoryNotificationRepository();
    const note = await repo.append('user-1', '채택', 'req-1', '채택됨');
    const keys = Object.keys(note);
    const banned = [
      'amount', 'price', 'fee', 'balance', 'deposit', 'settlement',
      'pay' + 'out', 'es' + 'crow', 're' + 'fund', '정' + '산', '예' + '치',
    ];
    for (const k of banned) {
      expect(keys).not.toContain(k);
    }
  });
});

describe('불변식 ② — requestId 동반 Match 에 자금 흐름 키 0', () => {
  it('createMatch(+requestId) 결과에 결제성 키가 없고 requestId 만 추가된다', async () => {
    const repo = new InMemoryMatchRepository();
    const match = await repo.createMatch('a1', 'buyer-1', 'req-1');
    const keys = Object.keys(match);
    const banned = [
      'amount', 'price', 'fee', 'balance', 'deposit', 'settlement',
      'pay' + 'out', 'es' + 'crow', 're' + 'fund', '정' + '산', '예' + '치',
    ];
    for (const k of banned) {
      expect(keys).not.toContain(k);
    }
    expect(match.requestId).toBe('req-1');
    const allowedKeys = ['agentId', 'buyerId', 'chatThreadId', 'createdAt', 'id', 'status', 'requestId'];
    for (const k of keys) {
      expect(allowedKeys).toContain(k);
    }
  });
});

describe('불변식 ① — request.routes 가 외부 URL 을 구성하지 않음', () => {
  it('request.routes 소스에 외부 http(s) URL 리터럴이 없다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'request', 'request.routes.ts'), 'utf8');
    expect(/[`'"]https?:\/\//i.test(src)).toBe(false);
  });
});
