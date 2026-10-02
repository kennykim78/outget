import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

let app: Express;
let repos: ReturnType<typeof import('../db/repos.js').makeInMemoryRepos>;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const { makeInMemoryRepos } = await import('../db/repos.js');
  repos = makeInMemoryRepos();
  app = createApp(repos);
});

async function tokenFor(email: string, role: string): Promise<string> {
  if (role === 'OPERATOR') {
    // register 는 role 을 무시(USER 고정) — OPERATOR 는 repo 로 직접 생성 후 로그인.
    const { hashPassword } = await import('../auth/user.repo.js');
    await repos.user.create(email, await hashPassword('pw-12345'), 'OPERATOR');
    const login = await request(app).post('/auth/login').send({ email, password: 'pw-12345' });
    return login.body.accessToken as string;
  }
  const reg = await request(app)
    .post('/auth/register')
    .send({ email, password: 'pw-12345', role });
  return reg.body.accessToken as string;
}

// 메시지 대상 신고 1건 생성 → report id.
async function reportOne(suffix: string): Promise<string> {
  const reporter = await tokenFor(`rep-reporter-${suffix}@example.com`, 'USER');
  const res = await request(app)
    .post('/api/reports')
    .set('Authorization', `Bearer ${reporter}`)
    .send({ targetType: 'message', targetId: `msg-${suffix}`, reason: '욕설' });
  return res.body.id as string;
}

describe('POST /api/reports — 신고 즉시 블라인드(임시조치)', () => {
  it('비인가 → 401', async () => {
    const res = await request(app)
      .post('/api/reports')
      .send({ targetType: 'message', targetId: 'x', reason: '욕설' });
    expect(res.status).toBe(401);
  });

  it('신고 → 201, status=블라인드 즉시', async () => {
    const reporter = await tokenFor('rep-reporter1@example.com', 'USER');
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'profile', targetId: 'u-1', reason: '사칭' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('블라인드');
    expect(res.body.reporterId).toBeTypeOf('string');
  });
});

describe('POST /api/reports/:id/appeal — 작성자 추적 불가 대상은 fail-closed', () => {
  it('작성자를 알 수 없는 대상 이의 → 403', async () => {
    const reportId = await reportOne('appeal');
    const other = await tokenFor('rep-ap-other@example.com', 'USER');
    const res = await request(app)
      .post(`/api/reports/${reportId}/appeal`)
      .set('Authorization', `Bearer ${other}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('없는 신고 이의 → 404', async () => {
    const other = await tokenFor('rep-ap-404@example.com', 'USER');
    const res = await request(app)
      .post('/api/reports/no-such-report/appeal')
      .set('Authorization', `Bearer ${other}`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('운영자 복구/삭제', () => {
  it('비운영자 목록 조회 → 403', async () => {
    const buyer = await tokenFor('rep-list-buyer@example.com', 'USER');
    const res = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${buyer}`);
    expect(res.status).toBe(403);
  });

  it('운영자 목록(status=블라인드) 조회 → 200 + 블라인드 항목', async () => {
    await reportOne('list');
    const op = await tokenFor('rep-op-list@example.com', 'OPERATOR');
    const res = await request(app)
      .get('/api/reports')
      .query({ status: '블라인드' })
      .set('Authorization', `Bearer ${op}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const r of res.body) expect(r.status).toBe('블라인드');
  });

  it('운영자 복구 → 200, status=복구', async () => {
    const reportId = await reportOne('restore');
    const op = await tokenFor('rep-op-restore@example.com', 'OPERATOR');
    const res = await request(app)
      .post(`/api/reports/${reportId}/restore`)
      .set('Authorization', `Bearer ${op}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('복구');
  });

  it('비운영자 복구 시도 → 403', async () => {
    const reportId = await reportOne('restore-403');
    const buyer = await tokenFor('rep-restore-403@example.com', 'USER');
    const res = await request(app)
      .post(`/api/reports/${reportId}/restore`)
      .set('Authorization', `Bearer ${buyer}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('운영자 삭제 → 200, status=삭제', async () => {
    const reportId = await reportOne('remove');
    const op = await tokenFor('rep-op-remove@example.com', 'OPERATOR');
    const res = await request(app)
      .post(`/api/reports/${reportId}/remove`)
      .set('Authorization', `Bearer ${op}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('삭제');
  });
});

describe('신고 입력 검증', () => {
  it('targetType 오류 → 400', async () => {
    const reporter = await tokenFor('rep-bad-type@example.com', 'USER');
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'invalid', targetId: 'x', reason: '사유' });
    expect(res.status).toBe(400);
  });

  it('제거된 Outget 대상 타입(discount) → 400', async () => {
    const reporter = await tokenFor('rep-old-type@example.com', 'USER');
    const res = await request(app)
      .post('/api/reports')
      .set('Authorization', `Bearer ${reporter}`)
      .send({ targetType: 'discount', targetId: 'x', reason: '사유' });
    expect(res.status).toBe(400);
  });

  it('좌표 키 포함 → 400(불변식 8)', async () => {
    const reporter = await tokenFor('rep-coord@example.com', 'USER');
    const keyA = 'l' + 'at';
    const body: Record<string, unknown> = {
      targetType: 'message',
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
