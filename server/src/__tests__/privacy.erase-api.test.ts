// P3 DELETE /api/save(처리방침 86): 세션 필수 + {"confirm":"ERASE"} → 204 + 쿠키 삭제.
//   삭제 후: 그 이메일 토큰 0 · 그 사용자 세션 0(다른 기기 포함 401) · 스냅샷 null · 삭제 전 발급 토큰 verify 401 ·
//   로그 'channel=SELF' 한 줄(식별자 0) · erase 리미터 5/15분 · 교차 오리진 403.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import type { MailMessage, MailTransport } from '../save/mail.js';
import type { InMemoryErasureStore } from '../privacy/erase.js';
import type { InMemoryMagicTokenRepository, InMemorySessionRepository } from '../save/save.repo.js';
import { sampleSave } from './fixtures/save-sample.js';

const ORIGIN = 'https://withsmall.test';
const T0 = Date.parse('2026-10-25T00:00:00.000Z');
const EMAIL = 'kenny@example.com';
const ERASE = { confirm: 'ERASE' };
const EVIL = 'http://evil.example';

class CaptureTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
}

function setup(opts: { rateLimits?: boolean } = {}) {
  const repos = makeInMemoryRepos();
  const mail = new CaptureTransport();
  const clock = { t: T0 };
  const lines: string[] = [];
  const origLog = console.log;
  const app = createApp(repos, {
    save: { config: { publicOrigin: ORIGIN, transport: mail, secureCookie: true }, now: () => new Date(clock.t) },
    rateLimits: opts.rateLimits ?? false,
  });
  const requestToken = async (addr: string): Promise<string> => {
    await request(app).post('/auth/magic/request').send({ email: addr, entry: 'direct' });
    return /#t=([A-Za-z0-9_-]+)/.exec(mail.sent[mail.sent.length - 1].text)![1];
  };
  const verify = (token: string) => request(app).post('/auth/magic/verify').send({ token });
  const link = async (addr = EMAIL): Promise<string> => {
    const res = await verify(await requestToken(addr));
    const c = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
    return c.find((x) => x.startsWith('ws_sid='))!.split(';')[0];
  };
  /** console.log 가로채기(eraseAccount 기본 stdoutLog). */
  const capture = async <T>(fn: () => Promise<T>): Promise<T> => {
    console.log = (...a: unknown[]) => {
      lines.push(a.map(String).join(' '));
    };
    try {
      return await fn();
    } finally {
      console.log = origLog;
    }
  };
  const tokens = repos.magicToken as InMemoryMagicTokenRepository;
  const sessions = repos.session as InMemorySessionRepository;
  const erasure = repos.erasure as InMemoryErasureStore;
  return { app, repos, mail, clock, lines, requestToken, verify, link, capture, tokens, sessions, erasure };
}

const del = (app: ReturnType<typeof createApp>, cookie?: string, body: unknown = ERASE) => {
  const r = request(app).delete('/api/save');
  if (cookie) r.set('Cookie', cookie);
  return r.send(body as object);
};

describe('DELETE /api/save — 거부', () => {
  it('세션 없음 401 no_session(본문 맞아도)', async () => {
    const { app } = setup();
    const res = await del(app);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'no_session' });
  });

  it('confirm 없음·틀림·추가 키·배열 → 400 confirm_required, 아무것도 안 지움', async () => {
    const { app, link } = setup();
    const cookie = await link();
    for (const body of [{}, { confirm: 'erase' }, { confirm: 'ERASE', x: 1 }, { confirm: true }, ['ERASE']]) {
      const res = await del(app, cookie, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'confirm_required' });
    }
    expect((await request(app).get('/api/save').set('Cookie', cookie)).status).toBe(200);
  });

  it('JSON 아님 415 · 깨진 JSON 400 bad_body', async () => {
    const { app, link } = setup();
    const cookie = await link();
    expect((await request(app).delete('/api/save').set('Cookie', cookie)).status).toBe(415);
    const bad = await request(app).delete('/api/save').set('Cookie', cookie).set('Content-Type', 'application/json').send('{"confirm":');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'bad_body' });
  });

  it('교차 오리진 403(CORS 기존 규칙)', async () => {
    const { app, link } = setup();
    const cookie = await link();
    const res = await request(app).delete('/api/save').set('Cookie', cookie).set('Origin', EVIL).send(ERASE);
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/save').set('Cookie', cookie)).status).toBe(200);
  });
});

describe('DELETE /api/save — 삭제', () => {
  it('204 + ws_sid 삭제 쿠키 + no-store, 본문 없음', async () => {
    const { app, link, capture } = setup();
    const cookie = await link();
    const res = await capture(() => del(app, cookie));
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
    const set = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
    expect(set).toEqual(['ws_sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure']);
  });

  it('삭제 후: 토큰 0 · 세션 0 · 스냅샷 null · 이 기기·다른 기기 401 · 삭제 전 발급 토큰 verify 401', async () => {
    const { app, link, requestToken, verify, capture, tokens, sessions, repos, clock } = setup();
    const phone = await link();
    const laptop = await link();
    clock.t += 1000;
    const put = await request(app).put('/api/save').set('Cookie', phone).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    expect(put.status).toBe(200);
    const user = await repos.user.findByEmail(EMAIL);
    expect(user).toBeDefined();
    const pending = await requestToken(EMAIL); // 아직 쓰지 않은 링크(메일함에 남은 것)
    const other = await link('other@example.com');

    expect((await capture(() => del(app, phone))).status).toBe(204);

    expect(tokens.dump().filter((r) => r.email === EMAIL)).toEqual([]);
    expect(sessions.dump().filter((r) => r.userId === user!.id)).toEqual([]);
    expect(await repos.saveSnapshot.get(user!.id)).toBeNull();
    expect(await repos.user.findByEmail(EMAIL)).toBeUndefined();
    expect((await request(app).get('/api/save').set('Cookie', phone)).status).toBe(401);
    expect((await request(app).get('/api/save').set('Cookie', laptop)).status).toBe(401);
    expect((await request(app).get('/auth/session').set('Cookie', laptop)).body).toEqual({ linked: false });
    const v = await verify(pending);
    expect(v.status).toBe(401);
    expect(v.body).toEqual({ error: 'invalid_token' });
    expect(await repos.user.findByEmail(EMAIL)).toBeUndefined(); // 옛 링크로 계정이 되살아나지 않는다
    // 다른 사용자는 그대로
    expect((await request(app).get('/auth/session').set('Cookie', other)).body.linked).toBe(true);
    // 다시 DELETE(같은 쿠키) → 401(멱등 아님 — 세션이 없다)
    expect((await del(app, phone)).status).toBe(401);
  });

  it('로그: 정확히 "[privacy] erase channel=SELF" 한 줄, 이메일·userId 0 · 묘비 1건(sha256 키)', async () => {
    const { app, link, capture, lines, repos, erasure } = setup();
    const cookie = await link();
    const user = await repos.user.findByEmail(EMAIL);
    await capture(() => del(app, cookie));
    expect(lines).toEqual(['[privacy] erase channel=SELF']);
    expect(lines.join('\n')).not.toContain('@');
    expect(lines.join('\n')).not.toContain(user!.id);
    const ts = erasure.dumpTombstones();
    expect(ts).toHaveLength(1);
    expect(ts[0].emailSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ts)).not.toContain(EMAIL);
    expect(ts[0].erasedAt).toBe(new Date(T0).toISOString());
  });

  it('삭제 뒤 같은 이메일로 다시 연결하면 새 빈 계정(스냅샷 null)', async () => {
    const { app, link, capture } = setup();
    const cookie = await link();
    await request(app).put('/api/save').set('Cookie', cookie).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    await capture(() => del(app, cookie));
    const again = await link();
    expect((await request(app).get('/api/save').set('Cookie', again)).body).toEqual({ snapshot: null, updatedAt: null });
  });
});

describe('DELETE /api/save — 리미터', () => {
  it('erase 5/15분/IP: 6번째 429 rate_limited(세션 없는 요청도 센다)', async () => {
    const { app } = setup({ rateLimits: true });
    for (let i = 0; i < 5; i++) expect((await del(app)).status).toBe(401);
    const sixth = await del(app);
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ error: 'rate_limited' });
    // GET 은 erase 리미터 대상 아님
    expect((await request(app).get('/api/save')).status).toBe(401);
  });
});
