import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Epic 9 공동대행 슬롯 — 개설(대행자)·참여(구매자)·정원 가드(409)·권한(403). 금액 0.
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
  const reg = await request(app)
    .post('/auth/register')
    .send({ email, password: 'pw-12345', role });
  return reg.body.accessToken as string;
}

describe('POST /api/group-slots (개설)', () => {
  it('비인가 → 401', async () => {
    const res = await request(app)
      .post('/api/group-slots')
      .send({ scheduleText: '토요일', region: '여주', capacity: 3 });
    expect(res.status).toBe(401);
  });

  it('구매자 토큰 → 403(역할 불일치)', async () => {
    const token = await tokenFor('gs-buyer-403@example.com', '구매자');
    const res = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ scheduleText: '토요일', region: '여주', capacity: 3 });
    expect(res.status).toBe(403);
  });

  it('개인대행자 개설 → 201, joinedCount=0, status=모집', async () => {
    const token = await tokenFor('gs-agent@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ scheduleText: '토요일 오전', region: '여주', capacity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.joinedCount).toBe(0);
    expect(res.body.status).toBe('모집');
    expect(res.body.capacity).toBe(2);
  });

  it('capacity 0/음수 → 400', async () => {
    const token = await tokenFor('gs-cap@example.com', '전문대행자');
    const res = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ scheduleText: '토', region: '여주', capacity: 0 });
    expect(res.status).toBe(400);
  });

  it('region 누락 → 400', async () => {
    const token = await tokenFor('gs-region@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${token}`)
      .send({ scheduleText: '토', capacity: 2 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/group-slots/:id/join (참여 + 정원 가드)', () => {
  it('구매자 참여 → 200 joinedCount 증가, 정원 도달 시 마감', async () => {
    const agent = await tokenFor('gs-join-agent@example.com', '개인대행자');
    const created = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${agent}`)
      .send({ scheduleText: '일요일', region: '김포', capacity: 2 });
    const slotId = created.body.id;

    const b1 = await tokenFor('gs-join-b1@example.com', '구매자');
    const b2 = await tokenFor('gs-join-b2@example.com', '구매자');
    const b3 = await tokenFor('gs-join-b3@example.com', '구매자');

    const r1 = await request(app)
      .post(`/api/group-slots/${slotId}/join`)
      .set('Authorization', `Bearer ${b1}`);
    expect(r1.status).toBe(200);
    expect(r1.body.joinedCount).toBe(1);
    expect(r1.body.status).toBe('모집');

    const r2 = await request(app)
      .post(`/api/group-slots/${slotId}/join`)
      .set('Authorization', `Bearer ${b2}`);
    expect(r2.status).toBe(200);
    expect(r2.body.joinedCount).toBe(2);
    expect(r2.body.status).toBe('마감');

    // 정원 초과 → 409.
    const r3 = await request(app)
      .post(`/api/group-slots/${slotId}/join`)
      .set('Authorization', `Bearer ${b3}`);
    expect(r3.status).toBe(409);
  });

  it('대행자 참여 → 403(구매자만)', async () => {
    const agent = await tokenFor('gs-join-agent2@example.com', '개인대행자');
    const created = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${agent}`)
      .send({ scheduleText: '월', region: '여주', capacity: 3 });
    const otherAgent = await tokenFor('gs-join-other-agent@example.com', '전문대행자');
    const res = await request(app)
      .post(`/api/group-slots/${created.body.id}/join`)
      .set('Authorization', `Bearer ${otherAgent}`);
    expect(res.status).toBe(403);
  });

  it('없는 슬롯 참여 → 404', async () => {
    const buyer = await tokenFor('gs-join-404@example.com', '구매자');
    const res = await request(app)
      .post('/api/group-slots/gs-nonexistent/join')
      .set('Authorization', `Bearer ${buyer}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/group-slots', () => {
  it('개설한 슬롯이 목록에 노출', async () => {
    const agent = await tokenFor('gs-list-agent@example.com', '개인대행자');
    const created = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${agent}`)
      .send({ scheduleText: '화요일특수', region: '여주', capacity: 4 });
    const list = await request(app)
      .get('/api/group-slots')
      .set('Authorization', `Bearer ${agent}`);
    expect(list.status).toBe(200);
    const found = list.body.find((s: { id: string }) => s.id === created.body.id);
    expect(found).toBeTruthy();
    expect(found.scheduleText).toBe('화요일특수');
  });
});
