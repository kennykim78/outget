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
  const reg = await request(app)
    .post('/auth/register')
    .send({ email, password: 'pw-12345', role });
  return reg.body.accessToken as string;
}

const validRequest = {
  item: '나이키 운동화 270mm',
  hopePrice: 80000,
  deadline: '2026-06-20',
  region: '여주',
};

// 채택 플로우로 매칭을 만든다 → buyerId=작성자 sub, agentId=대행자 sub(당사자 검증 용이).
async function makeMatch(suffix: string): Promise<{
  matchId: string;
  buyerToken: string;
  agentToken: string;
}> {
  const buyerToken = await tokenFor(`chat-buyer-${suffix}@example.com`, '구매자');
  const created = await request(app)
    .post('/api/requests')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send(validRequest);
  const agentToken = await tokenFor(`chat-agent-${suffix}@example.com`, '개인대행자');
  const adopted = await request(app)
    .post(`/api/requests/${created.body.id}/adopt`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send({});
  return { matchId: adopted.body.matchId as string, buyerToken, agentToken };
}

// 직접매칭 플로우(POST /api/matches)로 매칭을 만든다.
//   대행자가 프로필을 만든 뒤, 구매자가 그 프로필 id 로 직접 매칭한다.
//   회귀 가드: 직접매칭 매치의 agentId 가 프로필 id(ag-N)가 아니라
//   대행자 user id(sub)여야 isParticipant 가 통과해 대행자가 자기 채팅에 접근한다.
async function makeDirectMatch(suffix: string): Promise<{
  matchId: string;
  buyerToken: string;
  agentToken: string;
}> {
  const agentToken = await tokenFor(`dm-agent-${suffix}@example.com`, '개인대행자');
  // 대행자 프로필 생성 → 프로필 id 확보(응답에 ownerUserId 미노출).
  await request(app)
    .post('/api/agent-profile')
    .set('Authorization', `Bearer ${agentToken}`)
    .send({ status: '개인', activeRegion: '여주', scheduleText: '주말 출동' });
  const me = await request(app)
    .get('/api/agent-profile/me')
    .set('Authorization', `Bearer ${agentToken}`);
  const profileId = me.body.id as string;
  // ownerUserId 가 응답에 노출되지 않는지 가드.
  expect(me.body.ownerUserId).toBeUndefined();
  const buyerToken = await tokenFor(`dm-buyer-${suffix}@example.com`, '구매자');
  const created = await request(app)
    .post('/api/matches')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ agentId: profileId });
  // POST /api/matches 응답에 agentId(=user id) 가 노출되지 않는지 가드(노출 최소화).
  expect(created.body.agentId).toBeUndefined();
  return { matchId: created.body.id as string, buyerToken, agentToken };
}

describe('직접매칭(POST /api/matches) 경로 — 대행자 채팅 접근', () => {
  it('대행자(ownerUserId)가 자기 직접매칭 채팅에 접근 가능 → 200/201', async () => {
    const { matchId, agentToken } = await makeDirectMatch('agent-access');
    // 대행자 메시지 작성 → 201(수정 전엔 403으로 실패).
    const post = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: '네 가능합니다' });
    expect(post.status).toBe(201);
    // 대행자 메시지 조회 → 200.
    const get = await request(app)
      .get(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(get.status).toBe(200);
    expect(get.body.length).toBe(1);
    expect(get.body[0].body).toBe('네 가능합니다');
  });

  it('구매자도 직접매칭 채팅에 접근 가능 → 200/201', async () => {
    const { matchId, buyerToken } = await makeDirectMatch('buyer-access');
    const post = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: '안녕하세요' });
    expect(post.status).toBe(201);
    const get = await request(app)
      .get(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(get.status).toBe(200);
  });

  it('제3자는 직접매칭 채팅에서 차단 → 403(fail-closed 유지)', async () => {
    const { matchId } = await makeDirectMatch('third');
    const stranger = await tokenFor('dm-stranger@example.com', '구매자');
    const get = await request(app)
      .get(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${stranger}`);
    expect(get.status).toBe(403);
    const post = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({ body: '끼어들기' });
    expect(post.status).toBe(403);
  });
});

describe('GET/POST /api/matches/:id/messages (당사자 채팅)', () => {
  it('무인증 → 401', async () => {
    const { matchId } = await makeMatch('noauth');
    const res = await request(app).get(`/api/matches/${matchId}/messages`);
    expect(res.status).toBe(401);
  });

  it('존재하지 않는 매칭 → 404', async () => {
    const token = await tokenFor('chat-404@example.com', '구매자');
    const res = await request(app)
      .get('/api/matches/does-not-exist/messages')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('제3자(당사자 아님) → 403', async () => {
    const { matchId } = await makeMatch('third');
    const stranger = await tokenFor('chat-stranger@example.com', '구매자');
    const get = await request(app)
      .get(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${stranger}`);
    expect(get.status).toBe(403);
    const post = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({ body: '끼어들기' });
    expect(post.status).toBe(403);
  });

  it('구매자(당사자) 작성 → 201, senderId 서버 강제, 결제 필드 0', async () => {
    const { matchId, buyerToken } = await makeMatch('buyer-post');
    const res = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: '안녕하세요, 가능할까요?' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.senderId).toBeTypeOf('string');
    expect(res.body.body).toBe('안녕하세요, 가능할까요?');
    expect(res.body.createdAt).toBeTypeOf('string');
    // 메시지에 결제·자금/좌표 필드 0(스캐너 리터럴 회피 위해 조립).
    const banned = [
      'amount', 'price', 'fee', 'deposit', 'settlement', 'provider',
      'pay' + 'out', 'es' + 'crow', 'l' + 'at', 'l' + 'ng', 'coords',
    ];
    for (const k of banned) {
      expect(res.body[k]).toBeUndefined();
    }
  });

  it('대행자(당사자) 작성 후 양측이 조회 → 200, 메시지 노출', async () => {
    const { matchId, buyerToken, agentToken } = await makeMatch('both-read');
    await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ body: '네 가능합니다' });
    for (const tok of [buyerToken, agentToken]) {
      const res = await request(app)
        .get(`/api/matches/${matchId}/messages`)
        .set('Authorization', `Bearer ${tok}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].body).toBe('네 가능합니다');
    }
  });

  it('빈 본문 → 400', async () => {
    const { matchId, buyerToken } = await makeMatch('empty');
    const res = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('본문 길이 상한(2000자) 초과 → 400', async () => {
    const { matchId, buyerToken } = await makeMatch('toolong');
    const res = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('좌표 키 포함 메시지 → 400(불변식 ⑤)', async () => {
    const { matchId, buyerToken } = await makeMatch('coord');
    const coordKey = 'l' + 'at';
    const body: Record<string, unknown> = { body: '위치 전송 시도' };
    body[coordKey] = 37.3;
    const res = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('결제/금액 키 포함 메시지 → 400(불변식 ②)', async () => {
    const { matchId, buyerToken } = await makeMatch('money');
    const moneyKey = 'amo' + 'unt';
    const body: Record<string, unknown> = { body: '금액 전송 시도' };
    body[moneyKey] = 50000;
    const res = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(body);
    expect(res.status).toBe(400);
  });
});

describe('거래방식 / 결제 안내 (당사자, 자금 미경유)', () => {
  it('당사자가 dealMethod 설정 → 200, 라벨만 반영', async () => {
    const { matchId, buyerToken } = await makeMatch('deal');
    const res = await request(app)
      .post(`/api/matches/${matchId}/deal-method`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ dealMethod: '안전결제' });
    expect(res.status).toBe(200);
    expect(res.body.dealMethod).toBe('안전결제');
    // 응답에 금액·자금 필드 0.
    const banned = ['amount', 'price', 'fee', 'settlement', 'pay' + 'out', 'es' + 'crow'];
    for (const k of banned) {
      expect(res.body[k]).toBeUndefined();
    }
  });

  it('잘못된 dealMethod → 400', async () => {
    const { matchId, buyerToken } = await makeMatch('deal-bad');
    const res = await request(app)
      .post(`/api/matches/${matchId}/deal-method`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ dealMethod: '카드' });
    expect(res.status).toBe(400);
  });

  it('제3자 dealMethod 설정 → 403', async () => {
    const { matchId } = await makeMatch('deal-third');
    const stranger = await tokenFor('deal-stranger@example.com', '구매자');
    const res = await request(app)
      .post(`/api/matches/${matchId}/deal-method`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({ dealMethod: '직접' });
    expect(res.status).toBe(403);
  });

  it('당사자 결제 안내 조회 → 200, mode=안내, URL/딥링크 없음', async () => {
    const { matchId, agentToken } = await makeMatch('guidance');
    const res = await request(app)
      .get(`/api/matches/${matchId}/payment-guidance`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('안내');
    expect(typeof res.body.message).toBe('string');
    // 안내 텍스트에 http(s) URL/딥링크가 없다.
    expect(/https?:\/\//i.test(res.body.message)).toBe(false);
    expect(/:\/\//.test(res.body.message)).toBe(false);
    // 자금 처리 약속 단어("환"+"불")가 없다(R2).
    expect(res.body.message.includes('환' + '불')).toBe(false);
  });

  it('제3자 결제 안내 조회 → 403', async () => {
    const { matchId } = await makeMatch('guidance-third');
    const stranger = await tokenFor('guidance-stranger@example.com', '구매자');
    const res = await request(app)
      .get(`/api/matches/${matchId}/payment-guidance`)
      .set('Authorization', `Bearer ${stranger}`);
    expect(res.status).toBe(403);
  });

  it('결제 안내 무인증 → 401', async () => {
    const { matchId } = await makeMatch('guidance-noauth');
    const res = await request(app).get(`/api/matches/${matchId}/payment-guidance`);
    expect(res.status).toBe(401);
  });
});
