import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Epic 8 바운티(무금전) — 발주→제출→뱃지·평판만(금전 0).
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

// 대행자 프로필을 만들어 두면 제출 시 평판 +1 누계가 가능하다.
async function makeAgent(email: string): Promise<string> {
  const token = await tokenFor(email, '개인대행자');
  await request(app)
    .post('/api/agent-profile')
    .set('Authorization', `Bearer ${token}`)
    .send({ status: '개인', activeRegion: '여주', scheduleText: '주말' });
  return token;
}

describe('POST /api/bounties (발주)', () => {
  it('비인가 → 401', async () => {
    const res = await request(app).post('/api/bounties').send({ mission: '가격 확인' });
    expect(res.status).toBe(401);
  });

  it('개인대행자 토큰 → 403(역할 불일치)', async () => {
    const token = await tokenFor('bty-agent-403@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${token}`)
      .send({ mission: '가격 확인' });
    expect(res.status).toBe(403);
  });

  it('구매자 발주 → 201, requesterId 미노출, status=모집', async () => {
    const token = await tokenFor('bty-buyer@example.com', '구매자');
    const res = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${token}`)
      .send({ mission: 'A매장 양말 가격 확인' });
    expect(res.status).toBe(201);
    expect(res.body.mission).toBe('A매장 양말 가격 확인');
    expect(res.body.status).toBe('모집');
    expect(res.body.requesterId).toBeUndefined();
  });

  it('운영자도 발주 가능 → 201', async () => {
    const token = await tokenFor('bty-admin@example.com', '운영자');
    const res = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${token}`)
      .send({ mission: '운영자 큐레이션 미션' });
    expect(res.status).toBe(201);
  });

  it('mission 누락 → 400', async () => {
    const token = await tokenFor('bty-empty@example.com', '구매자');
    const res = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/bounties/:id/submissions (제출 → 뱃지·평판만)', () => {
  it('제출 → 201 badgeAwarded=true, solverId 미노출, 뱃지 1 + 평판 +1', async () => {
    // 발주자(구매자) + 제출자(대행자, 평판 누계 대상).
    const buyer = await tokenFor('bty-flow-buyer@example.com', '구매자');
    const solver = await makeAgent('bty-flow-solver@example.com');

    const created = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ mission: '현장 가격 확인' });
    expect(created.status).toBe(201);

    const sub = await request(app)
      .post(`/api/bounties/${created.body.id}/submissions`)
      .set('Authorization', `Bearer ${solver}`)
      .send({ photo: 'img-local-1' });
    expect(sub.status).toBe(201);
    expect(sub.body.badgeAwarded).toBe(true);
    expect(sub.body.solverId).toBeUndefined();
    expect(sub.body.photo).toBe('img-local-1');

    // 제출자 프로필 조회 → 뱃지 '확인러' 1개 + 평판 1.
    const me = await request(app)
      .get('/api/agent-profile/me')
      .set('Authorization', `Bearer ${solver}`);
    expect(me.status).toBe(200);
    expect(me.body.badges).toEqual(['확인러']);
    expect(me.body.reputation).toBe(1);
  });

  it('자기 바운티 제출 차단 → 403(셀프 평판 부여 방지)', async () => {
    // 운영자는 발주 가능 + 인증 전원 제출 가능하므로 같은 계정으로 self-submit 시도.
    const admin = await tokenFor('bty-self@example.com', '운영자');
    const created = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${admin}`)
      .send({ mission: '셀프 제출 미션' });
    expect(created.status).toBe(201);

    const sub = await request(app)
      .post(`/api/bounties/${created.body.id}/submissions`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});
    expect(sub.status).toBe(403);
  });

  it('비인가 제출 → 401', async () => {
    const buyer = await tokenFor('bty-401-buyer@example.com', '구매자');
    const created = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ mission: '미션' });
    const sub = await request(app)
      .post(`/api/bounties/${created.body.id}/submissions`)
      .send({});
    expect(sub.status).toBe(401);
  });

  it('없는 바운티 제출 → 404', async () => {
    const solver = await tokenFor('bty-404@example.com', '소식알림자');
    const sub = await request(app)
      .post('/api/bounties/bty-nonexistent/submissions')
      .set('Authorization', `Bearer ${solver}`)
      .send({});
    expect(sub.status).toBe(404);
  });

  it('대행자 프로필이 없는 제출자도 제출 가능(평판 누계는 노옵, 뱃지는 부여)', async () => {
    const buyer = await tokenFor('bty-nonagent-buyer@example.com', '구매자');
    const newsTeller = await tokenFor('bty-nonagent-solver@example.com', '소식알림자');
    const created = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ mission: '미션' });
    const sub = await request(app)
      .post(`/api/bounties/${created.body.id}/submissions`)
      .set('Authorization', `Bearer ${newsTeller}`)
      .send({});
    expect(sub.status).toBe(201);
    expect(sub.body.badgeAwarded).toBe(true);
  });
});

describe('GET /api/bounties · /me (requesterId 미노출)', () => {
  it('목록은 requesterId 를 노출하지 않는다', async () => {
    const buyer = await tokenFor('bty-list@example.com', '구매자');
    await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ mission: '리스트 미션' });
    const list = await request(app)
      .get('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`);
    expect(list.status).toBe(200);
    for (const b of list.body) {
      expect(b.requesterId).toBeUndefined();
    }
  });

  it('/me 는 본인 발주만(requesterId 미노출)', async () => {
    const a = await tokenFor('bty-me-a@example.com', '구매자');
    const b = await tokenFor('bty-me-b@example.com', '구매자');
    await request(app).post('/api/bounties').set('Authorization', `Bearer ${a}`).send({ mission: 'A-mission' });
    await request(app).post('/api/bounties').set('Authorization', `Bearer ${b}`).send({ mission: 'B-mission' });
    const mine = await request(app).get('/api/bounties/me').set('Authorization', `Bearer ${a}`);
    expect(mine.status).toBe(200);
    expect(mine.body.every((x: { mission: string }) => x.mission === 'A-mission')).toBe(true);
    for (const x of mine.body) expect(x.requesterId).toBeUndefined();
  });
});
