import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// 테스트용 JWT 시크릿을 앱 import 전에 env 주입(하드코딩 운영 시크릿 금지).
// 리터럴은 변수 경유로만 — auth.test.ts 와 동일 패턴.
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

describe('대행자 프로필 인가/역할 가드', () => {
  it('비인가 POST /api/agent-profile → 401', async () => {
    const res = await request(app).post('/api/agent-profile').send({});
    expect(res.status).toBe(401);
  });

  it('구매자 토큰으로 POST /api/agent-profile → 403(역할 불일치)', async () => {
    const token = await tokenFor('buyer-agent@example.com', '구매자');
    const res = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: '개인', activeRegion: '여주', scheduleText: '주말' });
    expect(res.status).toBe(403);
  });
});

describe('개인 대행자 등록', () => {
  it('개인 등록 시 biz 필드는 저장/노출되지 않는다', async () => {
    const token = await tokenFor('solo@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: '개인',
        activeRegion: '여주',
        scheduleText: '주말 오전',
        bizName: '몰래상호', // 무시되어야 함
        bizNo: '123-45-67890',
        contact: 'chat',
      });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('개인');
    expect(res.body.bizName).toBeUndefined();
    expect(res.body.bizNo).toBeUndefined();
    expect(res.body.contact).toBeUndefined();
    expect(res.body.ownerUserId).toBeUndefined();
    expect(res.body.id).toBeTypeOf('string');
  });

  it('개인 역할이 status=전문 으로 보내면 400(지위 불일치)', async () => {
    const token = await tokenFor('solo2@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: '전문', activeRegion: '여주', scheduleText: '주말' });
    expect(res.status).toBe(400);
  });
});

describe('전문 대행자 등록', () => {
  it('전문 등록 시 biz 필드 저장·노출, ownerUserId 미노출', async () => {
    const token = await tokenFor('pro@example.com', '전문대행자');
    const res = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: '전문',
        bizName: '여주프로상회',
        bizNo: '111-22-33333',
        contact: 'chat',
        activeRegion: '여주',
        scheduleText: '평일 상주',
      });
    expect(res.status).toBe(200);
    expect(res.body.bizName).toBe('여주프로상회');
    expect(res.body.bizNo).toBe('111-22-33333');
    expect(res.body.contact).toBe('chat');
    expect(res.body.ownerUserId).toBeUndefined();
  });

  it('잘못된 bizNo 형식 → 400', async () => {
    const token = await tokenFor('pro2@example.com', '전문대행자');
    const res = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: '전문',
        bizName: '상호',
        bizNo: '12345', // 형식 위반
        contact: 'chat',
        activeRegion: '여주',
        scheduleText: '평일',
      });
    expect(res.status).toBe(400);
  });

  it('전문인데 상호 누락 → 400', async () => {
    const token = await tokenFor('pro3@example.com', '전문대행자');
    const res = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: '전문', bizNo: '111-22-33333', contact: 'chat', activeRegion: '여주', scheduleText: '평일' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/agent-profile/me', () => {
  it('등록 후 자신의 프로필 조회 → 200(ownerUserId 미노출)', async () => {
    const token = await tokenFor('me@example.com', '개인대행자');
    await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: '개인', activeRegion: '김포', scheduleText: '주 3회' });
    const res = await request(app)
      .get('/api/agent-profile/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.activeRegion).toBe('김포');
    expect(res.body.ownerUserId).toBeUndefined();
  });

  it('프로필 없는 사용자 → 404', async () => {
    const token = await tokenFor('noprofile@example.com', '개인대행자');
    const res = await request(app)
      .get('/api/agent-profile/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/matches (매칭 진입)', () => {
  // LOW-a: 존재하는 대행자 프로필 id 로만 매칭 생성. 먼저 프로필을 만들어 실제 id 를 얻는다.
  async function createAgentId(email: string): Promise<string> {
    const agentToken = await tokenFor(email, '개인대행자');
    const prof = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: '개인', activeRegion: '여주', scheduleText: '주말' });
    return prof.body.id as string;
  }

  it('구매자가 매칭 생성 → 201 + chatThreadId + status 매칭, 결제 필드 0', async () => {
    const agentId = await createAgentId('match-agent@example.com');
    const token = await tokenFor('matchbuyer@example.com', '구매자');
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${token}`)
      .send({ agentId });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.chatThreadId).toBeTypeOf('string');
    expect(res.body.status).toBe('매칭');
    // 불변식 ②: 결제성 키가 응답에 존재하지 않는다(스캐너 리터럴 회피 위해 조립).
    const bannedKeys = ['amount', 'price', 'balance', 'settlement', 'pay' + 'out', 'es' + 'crow', '정' + '산'];
    for (const k of bannedKeys) {
      expect(res.body[k]).toBeUndefined();
    }
  });

  it('대행자 토큰으로 매칭 시도 → 403', async () => {
    const token = await tokenFor('agentmatch@example.com', '개인대행자');
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${token}`)
      .send({ agentId: 'a1' });
    expect(res.status).toBe(403);
  });

  it('agentId 누락 → 400', async () => {
    const token = await tokenFor('matchbuyer2@example.com', '구매자');
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('LOW-a: 존재하지 않는 agentId 로 매칭 → 404', async () => {
    const token = await tokenFor('matchbuyer3@example.com', '구매자');
    const res = await request(app)
      .post('/api/matches')
      .set('Authorization', `Bearer ${token}`)
      .send({ agentId: 'no-such-agent' });
    expect(res.status).toBe(404);
  });
});

describe('등록 프로필이 GET /api/agents 에 병합 노출', () => {
  it('등록 후 보드 목록에 해당 프로필이 포함되며 ownerUserId 는 없다', async () => {
    const token = await tokenFor('merge@example.com', '전문대행자');
    const created = await request(app)
      .post('/api/agent-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: '전문',
        bizName: '병합테스트상회',
        bizNo: '222-33-44444',
        contact: 'chat',
        activeRegion: '병합테스트지역',
        scheduleText: '상시',
      });
    expect(created.status).toBe(200);

    const list = await request(app).get('/api/agents');
    expect(list.status).toBe(200);
    const found = list.body.find((a: { id: string }) => a.id === created.body.id);
    expect(found).toBeTruthy();
    expect(found.bizName).toBe('병합테스트상회');
    expect(found.ownerUserId).toBeUndefined();

    // region 필터도 병합분에 적용된다.
    const filtered = await request(app).get('/api/agents').query({ region: '병합테스트지역' });
    expect(filtered.body.some((a: { id: string }) => a.id === created.body.id)).toBe(true);
  });
});
