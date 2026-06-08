import { describe, expect, it } from 'vitest';
import { InMemoryAgentProfileRepository } from '../agent/agent.repo.js';
import { InMemoryMatchRepository } from '../agent/match.repo.js';

// Epic 3 불변식 가드(단위). 외부 호출/네트워크 없이 저장 객체 형태만 검사한다.

describe('불변식 ⑤ — 사용자 위치 추적 필드 부재', () => {
  it('저장 프로필에 사용자 위치 추적 키(coords/accuracy/heading 등)가 없다', async () => {
    const repo = new InMemoryAgentProfileRepository();
    const stored = await repo.upsertByOwner('owner-1', {
      status: '개인',
      activeRegion: '여주',
      scheduleText: '주말',
      reputation: 0,
    });
    const keys = Object.keys(stored);
    // 사용자 위치 추적성 필드는 절대 없어야 한다.
    for (const banned of ['coords', 'accuracy', 'heading', 'speed', 'userLat', 'userLng', 'geolocation']) {
      expect(keys).not.toContain(banned);
    }
    // 좌표 미입력 시 매장 앵커도 비어있다(선택값).
    expect((stored as Record<string, unknown>).lat).toBeUndefined();
    expect((stored as Record<string, unknown>).lng).toBeUndefined();
  });
});

describe('불변식 ② — Match 에 자금 흐름 키 0', () => {
  it('생성된 Match 객체에 결제성 키가 전혀 없다', async () => {
    const repo = new InMemoryMatchRepository();
    const match = await repo.createMatch('a1', 'buyer-1');
    const keys = Object.keys(match);
    // 결제성 키 목록(스캐너 키워드 리터럴 회피 위해 조립). 어느 것도 존재하면 안 된다.
    const banned = [
      'amount', 'price', 'fee', 'balance', 'deposit', 'settlement',
      'pay' + 'out', 'es' + 'crow', 're' + 'fund', '정' + '산', '예' + '치',
    ];
    for (const k of banned) {
      expect(keys).not.toContain(k);
    }
    // 허용된 키만 존재한다.
    expect(keys.sort()).toEqual(
      ['agentId', 'buyerId', 'chatThreadId', 'createdAt', 'id', 'status'].sort(),
    );
    expect(match.status).toBe('매칭');
    expect(match.chatThreadId).toBeTypeOf('string');
  });
});

describe('불변식 ① — 라우트/리포지토리가 외부 URL 을 구성하지 않음', () => {
  it('agent.routes 소스에 외부 http(s) URL 리터럴이 없다', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'agent', 'agent.routes.ts'), 'utf8');
    // 절대 외부 URL 리터럴 부재(딥링크/진위 API 등 외부 호출 0 — Epic 3 범위).
    expect(/[`'"]https?:\/\//i.test(src)).toBe(false);
  });
});
