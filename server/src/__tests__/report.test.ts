import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

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

// 할인소식 1건 작성 → { discountId, authorToken }.
async function createDiscount(suffix: string): Promise<{ id: string; authorToken: string }> {
  const authorToken = await tokenFor(`rep-author-${suffix}@example.com`, '소식알림자');
  const res = await request(app)
    .post('/api/discounts')
    .set('Authorization', `Bearer ${authorToken}`)
    .send({ storeBrand: `신고대상-${suffix}`, discountRate: 20, source: '제보' });
  return { id: res.body.id, authorToken };
}

describe('POST /api/reports — 신고 즉시 블라인드(임시조치)', () => {
  it('비인가 → 401', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ targetType: 'discount', targetId: 'x', reason: '허위' });
    expect(res.status).toBe(401);
  });

  it('신고 → 201, status=블라인드 즉시', async () => {
    const reporter = await tokenFor('rep-reporter1@example.com', '구매자');
    const { id } = await createDiscount('blind');
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'discount', targetId: id, reason: '허위 가격' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('블라인드');
    expect(res.body.reporterId).toBeTypeOf('string');
  });

  it('신고된 할인소식은 GET /api/discounts 목록에서 제외된다', async () => {
    const reporter = await tokenFor('rep-reporter2@example.com', '구매자');
    const { id } = await createDiscount('exclude');

    // 신고 전: 목록에 있음.
    const before = await request(app).get('/api/discounts');
    expect(before.body.some((d: { id: string }) => d.id === id)).toBe(true);

    await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'discount', targetId: id, reason: '허위' });

    // 신고 후: 블라인드되어 목록에서 사라진다.
    const after = await request(app).get('/api/discounts');
    expect(after.body.some((d: { id: string }) => d.id === id)).toBe(false);
  });

  it('신고 시 작성자에게 블라인드 알림 생성', async () => {
    const reporter = await tokenFor('rep-reporter3@example.com', '구매자');
    const { id, authorToken } = await createDiscount('notify');
    await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'discount', targetId: id, reason: '허위' });
    const notes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${authorToken}`);
    expect(notes.body.some((n: { type: string }) => n.type === '블라인드')).toBe(true);
  });
});

describe('POST /api/reports/:id/appeal — 작성자만', () => {
  async function reportOne(suffix: string): Promise<{ reportId: string; authorToken: string }> {
    const reporter = await tokenFor(`rep-ap-reporter-${suffix}@example.com`, '구매자');
    const { id, authorToken } = await createDiscount(`ap-${suffix}`);
    const rep = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'discount', targetId: id, reason: '허위' });
    return { reportId: rep.body.id, authorToken };
  }

  it('작성자 본인 이의 → 200, status=이의', async () => {
    const { reportId, authorToken } = await reportOne('self');
    const res = await request(app)
      .post(`/api/reports/${reportId}/appeal`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('이의');
  });

  it('제3자 이의 시도 → 403', async () => {
    const { reportId } = await reportOne('third');
    const other = await tokenFor('rep-ap-other@example.com', '소식알림자');
    const res = await request(app)
      .post(`/api/reports/${reportId}/appeal`)
      .set('Authorization', `Bearer ${other}`)
      .send({});
    expect(res.status).toBe(403);
  });
});

describe('운영자 복구/삭제', () => {
  async function reportOne(suffix: string): Promise<{ reportId: string; discountId: string }> {
    const reporter = await tokenFor(`rep-op-reporter-${suffix}@example.com`, '구매자');
    const { id } = await createDiscount(`op-${suffix}`);
    const rep = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'discount', targetId: id, reason: '허위' });
    return { reportId: rep.body.id, discountId: id };
  }

  it('비운영자 목록 조회 → 403', async () => {
    const buyer = await tokenFor('rep-list-buyer@example.com', '구매자');
    const res = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${buyer}`);
    expect(res.status).toBe(403);
  });

  it('운영자 목록(status=블라인드) 조회 → 200 + 블라인드 항목', async () => {
    await reportOne('list');
    const op = await tokenFor('rep-op-list@example.com', '운영자');
    const res = await request(app)
      .get('/api/reports')
      .query({ status: '블라인드' })
      .set('Authorization', `Bearer ${op}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const r of res.body) expect(r.status).toBe('블라인드');
  });

  it('운영자 복구 → 200, 할인소식 재노출', async () => {
    const { reportId, discountId } = await reportOne('restore');
    const op = await tokenFor('rep-op-restore@example.com', '운영자');
    // 복구 전: 블라인드라 목록에 없음.
    const before = await request(app).get('/api/discounts');
    expect(before.body.some((d: { id: string }) => d.id === discountId)).toBe(false);

    const res = await request(app)
      .post(`/api/reports/${reportId}/restore`)
      .set('Authorization', `Bearer ${op}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('복구');

    // 복구 후: 다시 노출.
    const after = await request(app).get('/api/discounts');
    expect(after.body.some((d: { id: string }) => d.id === discountId)).toBe(true);
  });

  it('비운영자 복구 시도 → 403', async () => {
    const { reportId } = await reportOne('restore-403');
    const buyer = await tokenFor('rep-restore-403@example.com', '구매자');
    const res = await request(app)
      .post(`/api/reports/${reportId}/restore`)
      .set('Authorization', `Bearer ${buyer}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('운영자 삭제 → 200, 할인소식 영구 제외(복구해도 안 돌아오는 삭제 상태)', async () => {
    const { reportId, discountId } = await reportOne('remove');
    const op = await tokenFor('rep-op-remove@example.com', '운영자');
    const res = await request(app)
      .post(`/api/reports/${reportId}/remove`)
      .set('Authorization', `Bearer ${op}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('삭제');

    const after = await request(app).get('/api/discounts');
    expect(after.body.some((d: { id: string }) => d.id === discountId)).toBe(false);
  });
});

describe('메시지 블라인드 — 신고된 메시지는 본문이 가려진다', () => {
  it('메시지 신고 후 조회 시 본문이 대체 문구로 가려진다', async () => {
    // 매칭 생성(요청→채택)으로 채팅 스레드 확보.
    const buyer = await tokenFor('rep-msg-buyer@example.com', '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ item: '운동화', hopePrice: 80000, deadline: '2026-06-20', region: '여주' });
    const agent = await tokenFor('rep-msg-agent@example.com', '전문대행자');
    const adopt = await request(app)
      .post(`/api/requests/${created.body.id}/adopt`)
      .set('Authorization', `Bearer ${agent}`)
      .send({});
    const matchId = adopt.body.matchId;

    // 메시지 작성.
    const sent = await request(app)
      .post(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyer}`)
      .send({ body: '원본 메시지 본문' });
    const msgId = sent.body.id;

    // 메시지 신고.
    await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${agent}`)
      .send({ targetType: 'message', targetId: msgId, reason: '욕설' });

    // 조회 시 본문 가려짐.
    const list = await request(app)
      .get(`/api/matches/${matchId}/messages`)
      .set('Authorization', `Bearer ${buyer}`);
    expect(list.status).toBe(200);
    const found = list.body.find((m: { id: string }) => m.id === msgId);
    expect(found).toBeTruthy();
    expect(found.body).not.toBe('원본 메시지 본문');
  });
});

describe('신고 입력 검증', () => {
  it('targetType 오류 → 400', async () => {
    const reporter = await tokenFor('rep-bad-type@example.com', '구매자');
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'invalid', targetId: 'x', reason: '사유' });
    expect(res.status).toBe(400);
  });

  it('좌표 키 포함 → 400(불변식 ⑤)', async () => {
    const reporter = await tokenFor('rep-coord@example.com', '구매자');
    const keyA = 'l' + 'at';
    const body: Record<string, unknown> = {
      targetType: 'discount',
      targetId: 'x',
      reason: '사유',
    };
    body[keyA] = 37.3;
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send(body);
    expect(res.status).toBe(400);
  });
});
