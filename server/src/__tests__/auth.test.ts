import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';

// 테스트용 JWT 시크릿을 앱 import 전에 env 주입(하드코딩된 운영 시크릿 사용 금지).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

let app: Express;

beforeAll(async () => {
  // env 설정 이후 동적 import.
  const { createApp } = await import('../app.js');
  app = createApp();
});

async function registerUser(email: string, password: string, role: string) {
  const res = await request(app).post('/auth/register').send({ email, password, role });
  return res;
}

describe('auth flow', () => {
  it('register → login → /auth/me 200 (role 포함)', async () => {
    const email = 'buyer@example.com';
    const password = 'pw-12345';

    const reg = await registerUser(email, password, '구매자');
    expect(reg.status).toBe(201);
    expect(reg.body.accessToken).toBeTypeOf('string');
    expect(reg.body.refreshToken).toBeTypeOf('string');
    expect(reg.body.role).toBe('구매자');

    const login = await request(app).post('/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTypeOf('string');

    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('구매자');
    expect(me.body.sub).toBeTypeOf('string');
  });

  it('잘못된 비밀번호 로그인 → 401', async () => {
    const email = 'buyer2@example.com';
    await registerUser(email, 'correct-pw', '구매자');
    const login = await request(app).post('/auth/login').send({ email, password: 'wrong-pw' });
    expect(login.status).toBe(401);
  });

  it('중복 이메일 register → 409', async () => {
    const email = 'dup@example.com';
    expect((await registerUser(email, 'pw-12345', '구매자')).status).toBe(201);
    expect((await registerUser(email, 'pw-12345', '개인대행자')).status).toBe(409);
  });

  it('유효하지 않은 role 은 무시되고 구매자로 가입 → 201', async () => {
    const res = await registerUser('badrole@example.com', 'pw-12345', '해커');
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('구매자');
  });

  it('잘못된 이메일 형식 register → 400', async () => {
    const res = await registerUser('not-an-email', 'pw-12345', '구매자');
    expect(res.status).toBe(400);
  });

  it('refresh 토큰으로 새 access 발급 → 200', async () => {
    const reg = await registerUser('refresh@example.com', 'pw-12345', '소식알림자');
    const res = await request(app)
      .post('/auth/refresh')
      .send({ refreshToken: reg.body.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
  });
});

describe('auth guards', () => {
  it('토큰 없이 /auth/me → 401', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('비운영자 토큰으로 /admin/ping → 403', async () => {
    const reg = await registerUser('notadmin@example.com', 'pw-12345', '구매자');
    const res = await request(app)
      .get('/admin/ping')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('register 는 role 을 무시 — role 운영자로 가입해도 구매자, /admin/ping·/api/reports 목록 403', async () => {
    const reg = await registerUser('escalate@example.com', 'pw-12345', '운영자');
    expect(reg.status).toBe(201);
    expect(reg.body.role).not.toBe('운영자');
    const me = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(me.body.role).not.toBe('운영자');
    const ping = await request(app)
      .get('/admin/ping')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(ping.status).toBe(403);
    const list = await request(app)
      .get('/api/reports')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);
    expect(list.status).toBe(403);
  });

  it('운영자 토큰으로 /admin/ping → 200 (repo 로 직접 생성한 운영자)', async () => {
    const { makeInMemoryRepos } = await import('../db/repos.js');
    const { createApp } = await import('../app.js');
    const { hashPassword } = await import('../auth/user.repo.js');
    const repos = makeInMemoryRepos();
    await repos.user.create('admin@example.com', await hashPassword('pw-12345'), '운영자');
    const opApp = createApp(repos);
    const login = await request(opApp)
      .post('/auth/login')
      .send({ email: 'admin@example.com', password: 'pw-12345' });
    const res = await request(opApp)
      .get('/admin/ping')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('위조 토큰(다른 시크릿) → 401', async () => {
    const forged = jwt.sign({ role: '운영자' }, 'wrong-secret', {
      subject: '999',
      expiresIn: '15m',
    });
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('만료된 토큰 → 401', async () => {
    // 올바른 시크릿이지만 이미 만료된 토큰을 직접 서명.
    const expired = jwt.sign({ role: '구매자' }, ACCESS_SECRET, {
      subject: '1',
      expiresIn: '-1s',
    });
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });
});
