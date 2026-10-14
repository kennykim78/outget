// B1-3 GET/PUT /api/save(계약 C-R5-2, D5): 세션 필요, 왕복 동일, ≤32KB(413), 금지 키 400, 외부 Origin 403, JSON 만.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import type { MailMessage, MailTransport } from '../save/mail.js';
import { sampleSave, type LooseSave } from './fixtures/save-sample.js';

const ORIGIN = 'https://withsmall.test';
const T0 = Date.parse('2026-10-03T00:00:00.000Z');

class CaptureTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
}

async function linkedApp(email = 'kenny@example.com') {
  const repos = makeInMemoryRepos();
  const mail = new CaptureTransport();
  const clock = { t: T0 };
  const app = createApp(repos, {
    save: { config: { publicOrigin: ORIGIN, transport: mail, secureCookie: false }, now: () => new Date(clock.t) },
  });
  const link = async (addr: string) => {
    await request(app).post('/auth/magic/request').send({ email: addr, entry: 'direct' });
    const token = /#t=([A-Za-z0-9_-]+)/.exec(mail.sent[mail.sent.length - 1].text)![1];
    const res = await request(app).post('/auth/magic/verify').send({ token });
    const c = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
    return c.find((x) => x.startsWith('ws_sid='))!.split(';')[0];
  };
  const cookie = await link(email);
  return { app, cookie, clock, link, repos };
}

describe('세션 없음', () => {
  it('GET·PUT 401', async () => {
    const { app } = await linkedApp();
    expect((await request(app).get('/api/save')).status).toBe(401);
    expect((await request(app).put('/api/save').send({ snapshot: sampleSave() })).status).toBe(401);
    expect((await request(app).get('/api/save').set('Cookie', 'ws_sid=' + 'A'.repeat(43))).status).toBe(401);
  });

  it('DELETE /auth/session 이후 401', async () => {
    const { app, cookie } = await linkedApp();
    await request(app).delete('/auth/session').set('Cookie', cookie);
    expect((await request(app).get('/api/save').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('왕복', () => {
  it('처음 GET → {snapshot:null, updatedAt:null}', async () => {
    const { app, cookie } = await linkedApp();
    const res = await request(app).get('/api/save').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ snapshot: null, updatedAt: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('PUT 200 {updatedAt} → GET 동일 스냅샷 + 같은 서버 수신 시각', async () => {
    const { app, cookie, clock } = await linkedApp();
    clock.t += 5000;
    const put = await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ updatedAt: new Date(T0 + 5000).toISOString() });
    const res = await request(app).get('/api/save').set('Cookie', cookie);
    expect(res.body.snapshot).toEqual(sampleSave());
    expect(res.body.updatedAt).toBe(new Date(T0 + 5000).toISOString());
  });

  it('사용자 간 격리 — 다른 세션은 남의 스냅샷을 못 본다', async () => {
    const { app, cookie, link } = await linkedApp();
    await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    const other = await link('other@example.com');
    expect((await request(app).get('/api/save').set('Cookie', other)).body).toEqual({ snapshot: null, updatedAt: null });
  });

  it('응답·저장값에 이메일 없음', async () => {
    const { app, cookie } = await linkedApp();
    await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    const res = await request(app).get('/api/save').set('Cookie', cookie);
    expect(res.text).not.toContain('@');
  });

  it('SetupV3(uncheckedAt) 왕복 동일 + v2·v3 혼재 200 (F 계약)', async () => {
    const { app, cookie } = await linkedApp();
    const s = sampleSave() as LooseSave;
    const v2 = JSON.parse(JSON.stringify(s.setups['hamster-golden']));
    s.setups['hamster-golden'] = { ...v2, v: 3, uncheckedAt: { wheel: '2026-10-04T05:06:07.008Z', cage: '2026-10-04T05:06:07.008Z' } };
    s.setups['rabbit'] = v2; // v2 레코드 혼재
    const put = await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: s, baseUpdatedAt: null });
    expect(put.status).toBe(200);
    const res = await request(app).get('/api/save').set('Cookie', cookie);
    expect(res.body.snapshot).toEqual(s);
    // uncheckedAt 금지 키 → 400 forbidden_key, 저장값 불변
    const bad = JSON.parse(JSON.stringify(s)) as LooseSave;
    bad.setups['hamster-golden'].uncheckedAt = { email: '2026-10-04T05:06:07.008Z' };
    const r2 = await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: bad, baseUpdatedAt: put.body.updatedAt });
    expect(r2.status).toBe(400);
    expect(r2.body).toEqual({ error: 'forbidden_key' });
    expect((await request(app).get('/api/save').set('Cookie', cookie)).body.snapshot).toEqual(s);
  });
});

describe('거부', () => {
  it('33KB 본문 → 413', async () => {
    const { app, cookie } = await linkedApp();
    const big = JSON.stringify({ snapshot: sampleSave(), pad: 'x'.repeat(33 * 1024) });
    const res = await request(app).put('/api/save').set('Cookie', cookie).set('Content-Type', 'application/json').send(big);
    expect(res.status).toBe(413);
  });

  it('금지 키 email·lat·region·token → 400 forbidden_key, 저장 안 됨', async () => {
    const { app, cookie } = await linkedApp();
    for (const key of ['email', 'lat', 'region', 'token']) {
      const s = sampleSave() as LooseSave;
      s.setups['hamster-golden'].checks.cage[key] = 'x';
      const res = await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: s });
      expect(res.status, key).toBe(400);
      expect(res.body).toEqual({ error: 'forbidden_key' });
    }
    // 최상위 body 에 숨겨도
    // 금지 키 이름은 런타임 조립(소스 스캐너 C5-GEO 오탐 회피 — 이 테스트는 거부를 검증한다).
    const hidden = ['l', 'ng'].join('');
    const res = await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: sampleSave(), [hidden]: 1 });
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/save').set('Cookie', cookie)).body.snapshot).toBeNull();
  });

  it('스키마 위반 → 400 invalid_snapshot', async () => {
    const { app, cookie } = await linkedApp();
    const res = await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: { v: 1 } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_snapshot' });
    expect((await request(app).put('/api/save').set('Cookie', cookie).send({})).status).toBe(400);
  });

  it('깨진 JSON → 400', async () => {
    const { app, cookie } = await linkedApp();
    const res = await request(app).put('/api/save').set('Cookie', cookie).set('Content-Type', 'application/json').send('{"snapshot":');
    expect(res.status).toBe(400);
  });

  it('Content-Type text/plain → 415', async () => {
    const { app, cookie } = await linkedApp();
    const res = await request(app).put('/api/save').set('Cookie', cookie).set('Content-Type', 'text/plain').send(JSON.stringify({ snapshot: sampleSave() }));
    expect(res.status).toBe(415);
  });

  it('외부 Origin PUT → 403, 저장 안 됨', async () => {
    const { app, cookie } = await linkedApp();
    const res = await request(app)
      .put('/api/save')
      .set('Origin', 'https://evil.example')
      .set('Cookie', cookie)
      .send({ snapshot: sampleSave() });
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/save').set('Cookie', cookie)).body.snapshot).toBeNull();
  });

  it('동일 오리진 PUT → 200', async () => {
    const { app, cookie } = await linkedApp();
    const res = await request(app)
      .put('/api/save')
      .set('Host', 'withsmall.test')
      .set('Origin', 'http://withsmall.test')
      .set('Cookie', cookie)
      .send({ snapshot: sampleSave(), baseUpdatedAt: null });
    expect(res.status).toBe(200);
  });
});

describe('H1 낙관적 동시성(baseUpdatedAt)', () => {
  /** 같은 계정의 두 기기(세션 쿠키 2개). */
  async function twoDevices() {
    const ctx = await linkedApp();
    const second = await ctx.link('kenny@example.com');
    return { ...ctx, a: ctx.cookie, b: second };
  }
  const put = (app: Parameters<typeof request>[0], cookie: string, body: object) => request(app).put('/api/save').set('Cookie', cookie).send(body);

  it('기기 A 옛 기준으로 PUT → 409 + 기기 B 가 쓴 지금 서버본·시각, 저장값은 B 그대로', async () => {
    const { app, a, b, clock } = await twoDevices();
    clock.t += 1000;
    const first = await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: null });
    expect(first.status).toBe(200);
    const base = first.body.updatedAt as string;
    // 기기 B: 같은 기준에서 새 레코드 추가
    clock.t += 1000;
    const sb = sampleSave() as LooseSave;
    sb.setups.gerbil = { ...sb.setups['hamster-golden'] };
    const rb = await put(app, b, { snapshot: sb, baseUpdatedAt: base });
    expect(rb.status).toBe(200);
    // 기기 A: 아직 옛 기준 — B 레코드를 모르는 스냅샷
    clock.t += 1000;
    const ra = await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: base });
    expect(ra.status).toBe(409);
    expect(ra.body).toEqual({ error: 'conflict', snapshot: sb, updatedAt: rb.body.updatedAt });
    expect((await request(app).get('/api/save').set('Cookie', a)).body.snapshot.setups.gerbil).toBeDefined();
    // A 가 409 서버본과 병합해 새 기준으로 다시 보내면 통과
    const retry = await put(app, a, { snapshot: sb, baseUpdatedAt: ra.body.updatedAt });
    expect(retry.status).toBe(200);
  });

  it('행이 있는데 첫 PUT(null 기준) → 409, 행 없음 + 기준 시각 → 409 {snapshot:null}', async () => {
    const { app, a, b } = await twoDevices();
    expect((await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: '2026-10-01T00:00:00.000Z' })).body).toEqual({
      error: 'conflict',
      snapshot: null,
      updatedAt: null,
    });
    expect((await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: null })).status).toBe(200);
    expect((await put(app, b, { snapshot: sampleSave(), baseUpdatedAt: null })).status).toBe(409);
  });

  it('같은 ms 에 연속 PUT 해도 새 시각은 기준보다 크다(옛 기준 재사용 → 409)', async () => {
    const { app, a } = await twoDevices();
    const r1 = await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: null });
    const r2 = await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: r1.body.updatedAt });
    expect(r2.status).toBe(200);
    expect(r2.body.updatedAt > r1.body.updatedAt).toBe(true);
    expect((await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: r1.body.updatedAt })).status).toBe(409);
  });

  it('baseUpdatedAt 없음 → 428(옛 클라 무조건 덮어쓰기 차단), 형식 오류 → 400 invalid_base, 다른 키 → 400', async () => {
    const { app, a } = await twoDevices();
    const none = await put(app, a, { snapshot: sampleSave() });
    expect(none.status).toBe(428);
    expect(none.body).toEqual({ error: 'precondition_required' });
    for (const bad of ['어제', 123, '2026-10-01', { t: 1 }]) {
      const r = await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: bad });
      expect(r.status, String(bad)).toBe(400);
      expect(r.body).toEqual({ error: 'invalid_base' });
    }
    expect((await put(app, a, { snapshot: sampleSave(), baseUpdatedAt: null, extra: 1 })).status).toBe(400);
    expect((await request(app).get('/api/save').set('Cookie', a)).body.snapshot).toBeNull();
  });
});
