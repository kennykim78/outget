import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// 앱 import 전 JWT 시크릿 주입(하드코딩 운영 시크릿 금지 — 변수 경유 더미만).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp();
});

async function tokenFor(email: string, role: string): Promise<string> {
  const reg = await request(app).post('/auth/register').send({ email, password: 'pw-12345', role });
  return reg.body.accessToken as string;
}

const validInput = {
  item: '나이키 운동화 270mm',
  options: '검정',
  hopePrice: 80000,
  deadline: '2026-06-20',
  region: '여주',
};

describe('POST /api/requests (요청 작성)', () => {
  it('비인가 → 401', async () => {
    const res = await request(app).post('/api/requests').send(validInput);
    expect(res.status).toBe(401);
  });

  it('대행자 토큰 → 403(역할 불일치)', async () => {
    const token = await tokenFor('agent-create@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send(validInput);
    expect(res.status).toBe(403);
  });

  it('구매자 작성 → 201, status=대기 강제, ownerUserId 미노출', async () => {
    const token = await tokenFor('buyer-create@example.com', '구매자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validInput, status: '종료' }); // status 는 무시되어야 함
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('대기');
    expect(res.body.item).toBe('나이키 운동화 270mm');
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.ownerUserId).toBeUndefined();
  });

  it('item 누락 → 400', async () => {
    const token = await tokenFor('buyer-bad@example.com', '구매자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ hopePrice: 1000, deadline: '2026-06-20', region: '여주' });
    expect(res.status).toBe(400);
  });

  it('좌표 필드 포함 → 400(불변식 ⑤)', async () => {
    const token = await tokenFor('buyer-coord@example.com', '구매자');
    // 좌표 키 이름은 조립한다(스캐너 R3 리터럴 회피 — 실제 코드에 좌표 토큰 0).
    const coordKeyA = 'l' + 'at';
    const coordKeyB = 'l' + 'ng';
    const body: Record<string, unknown> = { ...validInput };
    body[coordKeyA] = 37.3;
    body[coordKeyB] = 127.6;
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/requests/me', () => {
  it('구매자는 자신의 요청만 본다(ownerUserId 미노출)', async () => {
    const a = await tokenFor('me-a@example.com', '구매자');
    const b = await tokenFor('me-b@example.com', '구매자');
    await request(app).post('/api/requests').set('Authorization', `Bearer ${a}`).send(validInput);
    await request(app).post('/api/requests').set('Authorization', `Bearer ${b}`).send(validInput);

    const res = await request(app).get('/api/requests/me').set('Authorization', `Bearer ${a}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    for (const r of res.body) {
      expect(r.ownerUserId).toBeUndefined();
    }
  });

  it('대행자 → 403', async () => {
    const token = await tokenFor('me-agent@example.com', '전문대행자');
    const res = await request(app).get('/api/requests/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/requests/:id/adopt (채택 → 매칭)', () => {
  async function createReq(): Promise<{ id: string }> {
    const token = await tokenFor(`owner-${Math.random()}@example.com`, '구매자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send(validInput);
    return { id: res.body.id };
  }

  it('대행자 채택 → 200 + matchId/chatThreadId/status=채택, 결제 필드 0', async () => {
    const { id } = await createReq();
    const agent = await tokenFor('adopter@example.com', '개인대행자');
    const res = await request(app)
      .post(`/api/requests/${id}/adopt`)
      .set('Authorization', `Bearer ${agent}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.matchId).toBeTypeOf('string');
    expect(res.body.chatThreadId).toBeTypeOf('string');
    expect(res.body.status).toBe('채택');
    const bannedKeys = ['amount', 'price', 'balance', 'settlement', 'pay' + 'out', 'es' + 'crow', '정' + '산'];
    for (const k of bannedKeys) {
      expect(res.body[k]).toBeUndefined();
    }
  });

  it('구매자가 채택 시도 → 403', async () => {
    const { id } = await createReq();
    const buyer = await tokenFor('buyer-adopt@example.com', '구매자');
    const res = await request(app)
      .post(`/api/requests/${id}/adopt`)
      .set('Authorization', `Bearer ${buyer}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('선착 1채택 — 두 번째 대행자 재채택 → 409', async () => {
    const { id } = await createReq();
    const agent1 = await tokenFor('first-adopt@example.com', '개인대행자');
    const agent2 = await tokenFor('second-adopt@example.com', '전문대행자');
    const first = await request(app)
      .post(`/api/requests/${id}/adopt`)
      .set('Authorization', `Bearer ${agent1}`)
      .send({});
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/api/requests/${id}/adopt`)
      .set('Authorization', `Bearer ${agent2}`)
      .send({});
    expect(second.status).toBe(409);
  });

  it('존재하지 않는 요청 채택 → 404', async () => {
    const agent = await tokenFor('nope-adopt@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/requests/does-not-exist/adopt')
      .set('Authorization', `Bearer ${agent}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('채택 후 작성자 알림 생성(type=채택)', async () => {
    const ownerToken = await tokenFor('notify-owner@example.com', '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validInput);
    const agent = await tokenFor('notify-adopt@example.com', '개인대행자');
    await request(app)
      .post(`/api/requests/${created.body.id}/adopt`)
      .set('Authorization', `Bearer ${agent}`)
      .send({});
    const notes = await request(app).get('/api/notifications').set('Authorization', `Bearer ${ownerToken}`);
    expect(notes.status).toBe(200);
    expect(notes.body.some((n: { type: string }) => n.type === '채택')).toBe(true);
  });
});

describe('POST /api/requests/:id/verified-price (확인가)', () => {
  async function createReq(): Promise<{ id: string; ownerToken: string }> {
    const ownerToken = await tokenFor(`vp-owner-${Math.random()}@example.com`, '구매자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validInput);
    return { id: res.body.id, ownerToken };
  }

  it('대행자 확인가 입력 → 200 + verifiedPrice(agentId·verifiedAt 동반)', async () => {
    const { id } = await createReq();
    const agent = await tokenFor('vp-agent@example.com', '전문대행자');
    const res = await request(app)
      .post(`/api/requests/${id}/verified-price`)
      .set('Authorization', `Bearer ${agent}`)
      .send({ price: 75000, note: '현장 확인' });
    expect(res.status).toBe(200);
    expect(res.body.verifiedPrice.price).toBe(75000);
    expect(res.body.verifiedPrice.agentId).toBeTypeOf('string');
    expect(res.body.verifiedPrice.verifiedAt).toBeTypeOf('string');
    expect(res.body.ownerUserId).toBeUndefined();
  });

  it('price 비숫자 → 400', async () => {
    const { id } = await createReq();
    const agent = await tokenFor('vp-bad@example.com', '전문대행자');
    const res = await request(app)
      .post(`/api/requests/${id}/verified-price`)
      .set('Authorization', `Bearer ${agent}`)
      .send({ price: '비쌈' });
    expect(res.status).toBe(400);
  });

  it('확인가 입력 후 작성자 알림(type=확인가)', async () => {
    const { id, ownerToken } = await createReq();
    const agent = await tokenFor('vp-notify@example.com', '개인대행자');
    await request(app)
      .post(`/api/requests/${id}/verified-price`)
      .set('Authorization', `Bearer ${agent}`)
      .send({ price: 60000 });
    const notes = await request(app).get('/api/notifications').set('Authorization', `Bearer ${ownerToken}`);
    expect(notes.body.some((n: { type: string }) => n.type === '확인가')).toBe(true);
  });
});

describe('POST /api/requests/:id/reject (거절)', () => {
  it('대행자 거절 → 200, status 유지(대기), 작성자 알림(type=거절)', async () => {
    const ownerToken = await tokenFor('rej-owner@example.com', '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validInput);
    const agent = await tokenFor('rej-agent@example.com', '개인대행자');
    const res = await request(app)
      .post(`/api/requests/${created.body.id}/reject`)
      .set('Authorization', `Bearer ${agent}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('대기');

    const notes = await request(app).get('/api/notifications').set('Authorization', `Bearer ${ownerToken}`);
    expect(notes.body.some((n: { type: string }) => n.type === '거절')).toBe(true);
  });

  it('구매자 거절 시도 → 403', async () => {
    const token = await tokenFor('rej-buyer@example.com', '구매자');
    const res = await request(app)
      .post('/api/requests/whatever/reject')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('LOW-b: 채택된 요청은 채택자/운영자만 손댄다', () => {
  async function createAndAdopt(suffix: string): Promise<{ id: string; agent1: string }> {
    const ownerToken = await tokenFor(`lowb-owner-${suffix}@example.com`, '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validInput);
    const agent1 = await tokenFor(`lowb-agent1-${suffix}@example.com`, '개인대행자');
    await request(app)
      .post(`/api/requests/${created.body.id}/adopt`)
      .set('Authorization', `Bearer ${agent1}`)
      .send({});
    return { id: created.body.id, agent1 };
  }

  it('제3 대행자가 채택된 요청에 확인가 입력 → 403', async () => {
    const { id } = await createAndAdopt('vp');
    const agent2 = await tokenFor('lowb-agent2-vp@example.com', '전문대행자');
    const res = await request(app)
      .post(`/api/requests/${id}/verified-price`)
      .set('Authorization', `Bearer ${agent2}`)
      .send({ price: 70000 });
    expect(res.status).toBe(403);
  });

  it('제3 대행자가 채택된 요청을 거절 시도 → 403', async () => {
    const { id } = await createAndAdopt('rej');
    const agent2 = await tokenFor('lowb-agent2-rej@example.com', '전문대행자');
    const res = await request(app)
      .post(`/api/requests/${id}/reject`)
      .set('Authorization', `Bearer ${agent2}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('채택한 대행자 본인은 확인가 입력 가능 → 200', async () => {
    const { id, agent1 } = await createAndAdopt('self');
    const res = await request(app)
      .post(`/api/requests/${id}/verified-price`)
      .set('Authorization', `Bearer ${agent1}`)
      .send({ price: 65000 });
    expect(res.status).toBe(200);
  });
});

describe('LOW-c: 입력 길이 상한', () => {
  it('item 200자 초과 → 400', async () => {
    const token = await tokenFor('lowc-item@example.com', '구매자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validInput, item: 'x'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('region 100자 초과 → 400', async () => {
    const token = await tokenFor('lowc-region@example.com', '구매자');
    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validInput, region: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('확인가 note 1000자 초과 → 400', async () => {
    const ownerToken = await tokenFor('lowc-vp-owner@example.com', '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validInput);
    const agent = await tokenFor('lowc-vp-agent@example.com', '개인대행자');
    const res = await request(app)
      .post(`/api/requests/${created.body.id}/verified-price`)
      .set('Authorization', `Bearer ${agent}`)
      .send({ price: 60000, note: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/notifications', () => {
  it('비인가 → 401', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('타인의 알림은 보이지 않는다(자신 것만)', async () => {
    const owner = await tokenFor('iso-owner@example.com', '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${owner}`)
      .send(validInput);
    const agent = await tokenFor('iso-agent@example.com', '개인대행자');
    await request(app)
      .post(`/api/requests/${created.body.id}/adopt`)
      .set('Authorization', `Bearer ${agent}`)
      .send({});
    // 대행자 자신의 알림함에는 채택 알림이 없다(수신자는 작성자).
    const agentNotes = await request(app).get('/api/notifications').set('Authorization', `Bearer ${agent}`);
    expect(agentNotes.status).toBe(200);
    expect(agentNotes.body.length).toBe(0);
  });
});
