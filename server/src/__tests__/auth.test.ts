// 인증(R5 B1-4, D3·D4, SEC-1 M-C·L-H·L-I).
//   - 비밀번호 인증은 OPERATOR 전용(운영 지표 R6 용). /auth/register 없음, USER 로그인 403.
//   - refresh 토큰은 HttpOnly 쿠키(ws_op_rt, Path=/auth, SameSite=Strict)로만 — 응답 본문에 없음.
//   - JWT 는 HS256 고정(alg none·HS512 거부).
//   - Outget 표면(/auth/register·/api/notifications·/api/reports) 언마운트, Repos 에 message·badge 없음.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';

// 테스트용 JWT 시크릿을 앱 import 전에 env 주입(하드코딩된 운영 시크릿 사용 금지).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

const PW = 'pw-12345';

type Repos = import('../db/repos.js').Repos;
let app: Express;
let repos: Repos;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  const { makeInMemoryRepos } = await import('../db/repos.js');
  const { hashPassword } = await import('../auth/user.repo.js');
  repos = makeInMemoryRepos();
  await repos.user.create('op@example.com', await hashPassword(PW), 'OPERATOR');
  await repos.user.create('user@example.com', await hashPassword(PW), 'USER');
  await repos.user.upsertByEmail('magic@example.com'); // 매직링크 사용자(비밀번호 null)
  app = createApp(repos);
});

function setCookies(res: request.Response): string[] {
  return ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []);
}

function rtCookie(res: request.Response): string | undefined {
  return setCookies(res).find((c) => c.startsWith('ws_op_rt='));
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0];
}

async function loginOp() {
  const res = await request(app).post('/auth/login').send({ email: 'op@example.com', password: PW });
  expect(res.status).toBe(200);
  return { res, cookie: cookiePair(rtCookie(res)!) };
}

describe('Outget 표면 언마운트(D3·D4, M-C)', () => {
  it('/auth/register → 404', async () => {
    const res = await request(app).post('/auth/register').send({ email: 'x@example.com', password: PW });
    expect(res.status).toBe(404);
  });

  it('/api/notifications·/api/reports → 404', async () => {
    const { accessToken } = (await loginOp()).res.body as { accessToken: string };
    for (const [method, path] of [
      ['get', '/api/notifications'],
      ['get', '/api/reports'],
      ['post', '/api/reports'],
      ['post', '/api/reports/r1/appeal'],
      ['post', '/api/reports/r1/restore'],
    ] as const) {
      const res = await request(app)[method](path).set('Authorization', `Bearer ${accessToken}`).send({});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('Repos 에 message·badge 가 없다(소스·모델은 유지)', () => {
    expect(Object.keys(repos)).not.toContain('message');
    expect(Object.keys(repos)).not.toContain('badge');
  });
});

describe('POST /auth/login — OPERATOR 전용', () => {
  it('OPERATOR → 200 {accessToken, role}, 본문에 refresh 없음, refresh 는 HttpOnly 쿠키', async () => {
    const { res } = await loginOp();
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'role']);
    expect(res.body.role).toBe('OPERATOR');
    const c = rtCookie(res)!;
    expect(c).toMatch(/^ws_op_rt=[\w-]+\.[\w-]+\.[\w-]+;/);
    expect(c).toMatch(/;\s*HttpOnly/);
    expect(c).toMatch(/;\s*SameSite=Strict/);
    expect(c).toMatch(/;\s*Path=\/auth(;|$)/);
    expect(c).toMatch(/;\s*Max-Age=604800/);
    const rt = cookiePair(c).slice('ws_op_rt='.length);
    expect(res.text).not.toContain(rt);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('USER(올바른 비밀번호) → 403, 토큰·쿠키 없음', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'user@example.com', password: PW });
    expect(res.status).toBe(403);
    expect(res.body.accessToken).toBeUndefined();
    expect(rtCookie(res)).toBeUndefined();
  });

  it('USER 틀린 비밀번호 → 401(역할은 자격 확인 뒤에만 드러남)', async () => {
    expect((await request(app).post('/auth/login').send({ email: 'user@example.com', password: 'nope' })).status).toBe(401);
  });

  it('매직링크 사용자(비밀번호 null)·미지 이메일·틀린 비밀번호 → 401', async () => {
    for (const body of [
      { email: 'magic@example.com', password: PW },
      { email: 'nobody@example.com', password: PW },
      { email: 'op@example.com', password: 'wrong' },
    ]) {
      expect((await request(app).post('/auth/login').send(body)).status).toBe(401);
    }
  });

  it('L-4: 미지 이메일·비밀번호 없는 계정도 bcrypt 비교 1회(더미 해시) — 존재 여부 타이밍 비노출', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const { DUMMY_PASSWORD_HASH } = await import('../auth/user.repo.js');
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(10); // 실제 해시와 같은 비용
    const spy = vi.spyOn(bcrypt, 'compare');
    try {
      for (const email of ['nobody@example.com', 'magic@example.com', 'op@example.com']) {
        spy.mockClear();
        const res = await request(app).post('/auth/login').send({ email, password: 'wrong' });
        expect(res.status, email).toBe(401);
        expect(spy, email).toHaveBeenCalledTimes(1);
      }
      spy.mockClear();
      await request(app).post('/auth/login').send({ email: 'nobody@example.com', password: 'wrong' });
      expect(spy.mock.calls[0][1]).toBe(DUMMY_PASSWORD_HASH);
    } finally {
      spy.mockRestore();
    }
  });

  it('누락 → 400', async () => {
    expect((await request(app).post('/auth/login').send({ email: 'op@example.com' })).status).toBe(400);
  });
});

describe('POST /auth/refresh·/auth/logout — 쿠키 회전(L-H)', () => {
  it('쿠키로 회전 → 200 {accessToken}만, 새 쿠키, 이전 쿠키 재사용 401', async () => {
    const { cookie } = await loginOp();
    const r1 = await request(app).post('/auth/refresh').set('Cookie', cookie);
    expect(r1.status).toBe(200);
    expect(Object.keys(r1.body)).toEqual(['accessToken']);
    const next = rtCookie(r1)!;
    expect(next).toMatch(/HttpOnly/);
    expect(cookiePair(next)).not.toBe(cookie);
    expect(r1.text).not.toContain(cookiePair(next).slice('ws_op_rt='.length));
    expect((await request(app).post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    expect((await request(app).post('/auth/refresh').set('Cookie', cookiePair(next))).status).toBe(200);
  });

  it('본문 refreshToken 은 무시 — 쿠키 없으면 401', async () => {
    const { cookie } = await loginOp();
    const rt = cookie.slice('ws_op_rt='.length);
    expect((await request(app).post('/auth/refresh').send({ refreshToken: rt })).status).toBe(401);
  });

  it('logout → 204 + 쿠키 삭제, 이후 그 쿠키로 refresh 401', async () => {
    const { cookie } = await loginOp();
    const out = await request(app).post('/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect(rtCookie(out)).toMatch(/Max-Age=0/);
    expect((await request(app).post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('logout 은 쿠키 없어도 204(멱등)', async () => {
    expect((await request(app).post('/auth/logout')).status).toBe(204);
  });

  it('OPERATOR 가 USER 로 강등되면 refresh 401', async () => {
    const { hashPassword } = await import('../auth/user.repo.js');
    const u = await repos.user.create('demote@example.com', await hashPassword(PW), 'OPERATOR');
    const login = await request(app).post('/auth/login').send({ email: 'demote@example.com', password: PW });
    const cookie = cookiePair(rtCookie(login)!);
    u.role = 'USER'; // InMemory 객체 직접 변경(운영 절차로 역할 회수 가정)
    expect((await request(app).post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('JWT 알고리즘 고정 HS256(L-I)', () => {
  const header = (alg: string) => Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const payload = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = () => Math.floor(Date.now() / 1000);

  it('정상 HS256 access → /auth/me 200', async () => {
    const { res } = await loginOp();
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('OPERATOR');
    expect(jwt.decode(res.body.accessToken, { complete: true })?.header.alg).toBe('HS256');
  });

  it('alg none → 401', async () => {
    const t = `${header('none')}.${payload({ sub: '1', role: 'OPERATOR', exp: now() + 600 })}.`;
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    expect((await request(app).get('/admin/ping').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('HS512(올바른 시크릿) access → 401', async () => {
    const t = jwt.sign({ role: 'OPERATOR' }, ACCESS_SECRET, { subject: '1', expiresIn: '15m', algorithm: 'HS512' });
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
  });

  it('HS512(올바른 시크릿) refresh 쿠키 → 401', async () => {
    const t = jwt.sign({}, REFRESH_SECRET, { subject: '1', jwtid: 'x', expiresIn: '7d', algorithm: 'HS512' });
    expect((await request(app).post('/auth/refresh').set('Cookie', `ws_op_rt=${t}`)).status).toBe(401);
  });

  it('위조(다른 시크릿)·만료 → 401', async () => {
    const forged = jwt.sign({ role: 'OPERATOR' }, 'wrong-secret', { subject: '999', expiresIn: '15m' });
    const expired = jwt.sign({ role: 'OPERATOR' }, ACCESS_SECRET, { subject: '1', expiresIn: '-1s' });
    for (const t of [forged, expired]) {
      expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    }
  });
});

describe('가드', () => {
  it('토큰 없이 /auth/me → 401', async () => {
    expect((await request(app).get('/auth/me')).status).toBe(401);
  });

  it('USER 역할 토큰(정상 서명)으로 /admin/ping → 403', async () => {
    const { signAccess } = await import('../auth/jwt.js');
    const t = signAccess({ sub: 'u1', role: 'USER' });
    expect((await request(app).get('/admin/ping').set('Authorization', `Bearer ${t}`)).status).toBe(403);
  });

  it('OPERATOR 로그인 토큰으로 /admin/ping → 200', async () => {
    const { res } = await loginOp();
    const ping = await request(app).get('/admin/ping').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(ping.status).toBe(200);
    expect(ping.body.ok).toBe(true);
  });
});

describe('roles (D7 — USER | OPERATOR, schema User.role 기본 "USER")', () => {
  it('ROLES 는 정확히 USER·OPERATOR, isRole 은 Outget 역할을 거부', async () => {
    const { ROLES, isRole } = await import('../auth/roles.js');
    expect([...ROLES]).toEqual(['USER', 'OPERATOR']);
    for (const legacy of ['구매자', '개인대행자', '전문대행자', '소식알림자', '운영자', 'user', 'ADMIN']) {
      expect(isRole(legacy), legacy).toBe(false);
    }
  });

  it('스키마 User.role 기본값 USER, 매직링크 upsert 도 USER', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const schema = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');
    expect(schema).toMatch(/^\s*role\s+String\s+@default\("USER"\)/m);
    expect((await repos.user.upsertByEmail('fresh@example.com')).role).toBe('USER');
  });

  it('옛 한글 역할을 담은 토큰(올바른 시크릿) → 401', async () => {
    const legacy = jwt.sign({ role: '운영' + '자' }, ACCESS_SECRET, { subject: '1', expiresIn: '15m' });
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${legacy}`)).status).toBe(401);
  });
});
