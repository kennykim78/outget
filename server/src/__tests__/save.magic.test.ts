// B1-2 매직링크·세션(계약 C-R5-2, D1·D2·D19·D20). 시계 주입으로 15분 경계를 정확히 잰다.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { createApp } from '../app.js';
import { makeInMemoryRepos, type Repos } from '../db/repos.js';
import type { MailMessage, MailTransport } from '../save/mail.js';
import type { SaveConfig } from '../save/config.js';
import { InMemoryMagicTokenRepository, InMemorySessionRepository } from '../save/save.repo.js';

const ORIGIN = 'https://withsmall.test';
const T0 = Date.parse('2026-10-03T00:00:00.000Z');

class CaptureTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  fail = false;
  async send(m: MailMessage): Promise<void> {
    if (this.fail) throw new Error('down');
    this.sent.push(m);
  }
}

function setup(over: Partial<SaveConfig> = {}, repos: Repos = makeInMemoryRepos()) {
  const mail = new CaptureTransport();
  const clock = { t: T0 };
  const config: SaveConfig = { publicOrigin: ORIGIN, transport: mail, secureCookie: false, ...over };
  const app = createApp(repos, { save: { config, now: () => new Date(clock.t) } });
  return { app, repos, mail, clock };
}

function tokenFrom(m: MailMessage): string {
  const hit = /\/save#t=([A-Za-z0-9_-]+)/.exec(m.text);
  if (!hit) throw new Error('링크 없음');
  return hit[1];
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

type App = ReturnType<typeof setup>['app'];

function requestLink(app: App, email = 'Kenny@Example.com') {
  return request(app).post('/auth/magic/request').send({ email, entry: 'home' });
}

function cookies(res: request.Response): string[] {
  return ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []);
}

function sidFrom(res: request.Response): string {
  const c = cookies(res).find((x) => x.startsWith('ws_sid='));
  if (!c) throw new Error('쿠키 없음');
  return c.split(';')[0].slice('ws_sid='.length);
}

describe('POST /auth/magic/request', () => {
  it('미지 이메일 → 202, 링크는 PUBLIC_ORIGIN/save#t=<base64url 32B>(Host 헤더 무시)', async () => {
    const { app, mail } = setup();
    const res = await request(app)
      .post('/auth/magic/request')
      .set('Host', 'evil.example')
      .send({ email: '  New@Example.com ', entry: 'checklist' });
    expect(res.status).toBe(202);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('new@example.com');
    expect(mail.sent[0].text).toMatch(new RegExp(`${ORIGIN}/save#t=[A-Za-z0-9_-]{43}(\\s|$)`));
    expect(mail.sent[0].text).not.toContain('evil.example');
  });

  it('가입된·미가입 이메일: 같은 상태·같은 본문·같은 작업(토큰 행 1개·메일 1통)', async () => {
    const { app, repos, mail } = setup();
    await repos.user.upsertByEmail('kenny@example.com');
    const known = await requestLink(app);
    const unknown = await requestLink(app, 'nobody@example.com');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.text).toBe(known.text);
    expect(mail.sent.map((m) => m.to)).toEqual(['kenny@example.com', 'nobody@example.com']);
    expect((repos.magicToken as InMemoryMagicTokenRepository).size()).toBe(2);
  });

  it('request 경로는 사용자 저장소를 전혀 조회하지 않는다(존재 분기 0 — 타이밍 동일)', async () => {
    const repos = makeInMemoryRepos();
    const touched: string[] = [];
    repos.user = new Proxy(repos.user, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv) as unknown;
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          touched.push(String(prop));
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const { app } = setup({}, repos);
    await repos.user.create('kenny@example.com', null, 'USER');
    touched.length = 0;
    await requestLink(app);
    await requestLink(app, 'nobody@example.com');
    expect(touched).toEqual([]);
  });

  it('User 는 request 단계에서 만들지 않는다(D20)', async () => {
    const { app, repos } = setup();
    await requestLink(app, 'later@example.com');
    expect(await repos.user.findByEmail('later@example.com')).toBeUndefined();
  });

  it('잘못된 이메일·entry·254자 초과·누락 → 400, 메일 0', async () => {
    const { app, mail } = setup();
    for (const body of [
      { email: 'not-an-email', entry: 'home' },
      { email: 'a@b.co', entry: 'nope' },
      { email: `${'a'.repeat(250)}@b.co`, entry: 'home' },
      { entry: 'home' },
      { email: 'a@b.co' },
    ]) {
      expect((await request(app).post('/auth/magic/request').send(body)).status).toBe(400);
    }
    expect(mail.sent).toHaveLength(0);
  });

  it('Content-Type 이 JSON 이 아니면 415', async () => {
    const { app } = setup();
    const res = await request(app).post('/auth/magic/request').type('text/plain').send('email=a@b.co');
    expect(res.status).toBe(415);
  });

  it('NFKC: 전각 문자 이메일은 정규화돼 같은 주소로 보낸다', async () => {
    const { app, mail } = setup();
    await requestLink(app, 'ＫＥＮＮＹ@example.com');
    expect(mail.sent[0].to).toBe('kenny@example.com');
  });

  it('같은 이메일 시간당 3회 초과 → 429, 메일 3통, 1시간 뒤 다시 202', async () => {
    const { app, mail, clock } = setup();
    for (let i = 0; i < 3; i++) expect((await requestLink(app)).status).toBe(202);
    const over = await requestLink(app);
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'rate_limited' });
    expect(mail.sent).toHaveLength(3);
    clock.t += 60 * 60 * 1000;
    expect((await requestLink(app)).status).toBe(202);
    expect(mail.sent).toHaveLength(4);
  });

  it('이메일 리밋 429 는 가입 여부와 무관하게 같은 본문', async () => {
    const { app, repos } = setup();
    await repos.user.upsertByEmail('kenny@example.com');
    for (let i = 0; i < 3; i++) {
      await requestLink(app);
      await requestLink(app, 'nobody@example.com');
    }
    const known = await requestLink(app);
    const unknown = await requestLink(app, 'nobody@example.com');
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(unknown.text).toBe(known.text);
  });

  it('공급자 없음(production 미설정) → 503 SAVE_UNAVAILABLE', async () => {
    const { app } = setup({ transport: null });
    const res = await requestLink(app);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'SAVE_UNAVAILABLE' });
  });

  it('공급자 발송 실패 → 503 SAVE_UNAVAILABLE', async () => {
    const { app, mail } = setup();
    mail.fail = true;
    const res = await requestLink(app);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'SAVE_UNAVAILABLE' });
  });

  it('저장소에 원문 토큰 0 — sha256 해시만', async () => {
    const { app, mail, repos } = setup();
    await requestLink(app);
    const token = tokenFrom(mail.sent[0]);
    const dump = JSON.stringify((repos.magicToken as InMemoryMagicTokenRepository).dump());
    expect(dump).not.toContain(token);
    expect(dump).toContain(sha(token));
  });
});

describe('POST /auth/magic/verify', () => {
  it('정상 → 200 {linked:true} + ws_sid 쿠키 플래그(HttpOnly·SameSite=Lax·Path=/·Max-Age=7776000, dev 는 Secure 없음)', async () => {
    const { app, mail, repos } = setup();
    await requestLink(app);
    const res = await request(app).post('/auth/magic/verify').send({ token: tokenFrom(mail.sent[0]) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: true, maskedEmail: 'k***@e***.com' }); // SEC-3 M-1
    const cookie = cookies(res).find((c) => c.startsWith('ws_sid='))!;
    expect(cookie).toMatch(/^ws_sid=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//);
    expect(cookie).toMatch(/;\s*Max-Age=7776000/);
    expect(cookie).not.toMatch(/Secure/i);
    expect(res.headers['cache-control']).toBe('no-store');
    const u = await repos.user.findByEmail('kenny@example.com');
    expect(u).toMatchObject({ role: 'USER', passwordHash: null });
    expect(res.text).not.toContain('kenny');
    expect(res.text).not.toContain('example.com');
    const sid = sidFrom(res);
    const dump = JSON.stringify((repos.session as InMemorySessionRepository).dump());
    expect(dump).not.toContain(sid);
    expect(dump).toContain(sha(sid));
  });

  it('production(secureCookie) → Secure 포함', async () => {
    const { app, mail } = setup({ secureCookie: true });
    await requestLink(app);
    const res = await request(app).post('/auth/magic/verify').send({ token: tokenFrom(mail.sent[0]) });
    expect(cookies(res).find((c) => c.startsWith('ws_sid='))).toMatch(/;\s*Secure/);
  });

  it('토큰 1회용 — 재사용 401, 쿠키 없음', async () => {
    const { app, mail } = setup();
    await requestLink(app);
    const token = tokenFrom(mail.sent[0]);
    expect((await request(app).post('/auth/magic/verify').send({ token })).status).toBe(200);
    const again = await request(app).post('/auth/magic/verify').send({ token });
    expect(again.status).toBe(401);
    expect(cookies(again)).toEqual([]);
  });

  it('15분 경계: 14:59 OK', async () => {
    const { app, mail, clock } = setup();
    await requestLink(app);
    clock.t += 14 * 60 * 1000 + 59 * 1000;
    expect((await request(app).post('/auth/magic/verify').send({ token: tokenFrom(mail.sent[0]) })).status).toBe(200);
  });

  it('15분 경계: 15:00 401', async () => {
    const { app, mail, clock } = setup();
    await requestLink(app);
    clock.t += 15 * 60 * 1000;
    expect((await request(app).post('/auth/magic/verify').send({ token: tokenFrom(mail.sent[0]) })).status).toBe(401);
  });

  it('위조·형식 오류 토큰 401, 누락 400', async () => {
    const { app } = setup();
    expect((await request(app).post('/auth/magic/verify').send({ token: 'A'.repeat(43) })).status).toBe(401);
    expect((await request(app).post('/auth/magic/verify').send({ token: '../../x' })).status).toBe(401);
    expect((await request(app).post('/auth/magic/verify').send({})).status).toBe(400);
  });

  it('기존 OPERATOR 이메일로 verify 해도 역할·비밀번호 불변', async () => {
    const { app, mail, repos } = setup();
    await repos.user.create('op@example.com', 'hash', 'OPERATOR');
    await requestLink(app, 'op@example.com');
    await request(app).post('/auth/magic/verify').send({ token: tokenFrom(mail.sent[0]) });
    expect(await repos.user.findByEmail('op@example.com')).toMatchObject({ role: 'OPERATOR', passwordHash: 'hash' });
  });

  it('매직링크 사용자(비밀번호 null)는 비밀번호 로그인 401', async () => {
    const { app, mail } = setup();
    await requestLink(app);
    await request(app).post('/auth/magic/verify').send({ token: tokenFrom(mail.sent[0]) });
    const res = await request(app).post('/auth/login').send({ email: 'kenny@example.com', password: 'x' });
    expect(res.status).toBe(401);
  });
});

describe('GET/DELETE /auth/session', () => {
  async function linked() {
    const s = setup();
    await requestLink(s.app);
    const res = await request(s.app).post('/auth/magic/verify').send({ token: tokenFrom(s.mail.sent[0]) });
    return { ...s, sid: sidFrom(res) };
  }

  it('쿠키 없음 → {linked:false}', async () => {
    const { app } = setup();
    const res = await request(app).get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false });
  });

  it('유효 세션 → {linked:true, maskedEmail}, 원문 이메일 미반환(M-1)', async () => {
    const { app, sid } = await linked();
    const res = await request(app).get('/auth/session').set('Cookie', `ws_sid=${sid}`);
    expect(res.body).toEqual({ linked: true, maskedEmail: 'k***@e***.com' });
    expect(res.text).not.toContain('kenny');
    expect(res.text).not.toContain('example.com');
  });

  it('90일 경계: 직전 linked, 90일 정각 unlinked', async () => {
    const { app, sid, clock } = await linked();
    clock.t += 90 * 24 * 60 * 60 * 1000 - 1000;
    expect((await request(app).get('/auth/session').set('Cookie', `ws_sid=${sid}`)).body).toEqual({ linked: true, maskedEmail: 'k***@e***.com' });
    clock.t += 1000;
    expect((await request(app).get('/auth/session').set('Cookie', `ws_sid=${sid}`)).body).toEqual({ linked: false });
  });

  it('DELETE → 204 + 쿠키 삭제(Max-Age=0), 이후 linked:false', async () => {
    const { app, sid } = await linked();
    const del = await request(app).delete('/auth/session').set('Cookie', `ws_sid=${sid}`);
    expect(del.status).toBe(204);
    const cleared = cookies(del).find((c) => c.startsWith('ws_sid='))!;
    expect(cleared).toMatch(/Max-Age=0/);
    expect(cleared).toMatch(/HttpOnly/);
    expect((await request(app).get('/auth/session').set('Cookie', `ws_sid=${sid}`)).body).toEqual({ linked: false });
  });

  it('DELETE 는 쿠키 없어도 204(멱등)', async () => {
    const { app } = setup();
    expect((await request(app).delete('/auth/session')).status).toBe(204);
  });

  it('외부 Origin 의 verify·DELETE → 403(CORS)', async () => {
    const { app, sid } = await linked();
    const del = await request(app)
      .delete('/auth/session')
      .set('Origin', 'https://evil.example')
      .set('Cookie', `ws_sid=${sid}`);
    expect(del.status).toBe(403);
    const ver = await request(app)
      .post('/auth/magic/verify')
      .set('Origin', 'https://evil.example')
      .send({ token: 'x' });
    expect(ver.status).toBe(403);
    // 세션은 살아 있다
    expect((await request(app).get('/auth/session').set('Cookie', `ws_sid=${sid}`)).body).toEqual({ linked: true, maskedEmail: 'k***@e***.com' });
  });
});
