// R6 C3 Resend 메일 어댑터(Kenny 결정 K2/Q3①). 실제 네트워크 0 — 가짜 fetch 주입.
//   요청 형태(URL·메서드·Bearer·JSON 본문), 실패(비2xx·네트워크·타임아웃) → 라우트 503,
//   설정(resend 는 RESEND_API_KEY·MAIL_FROM 필수, 기동 검사 목록에 포함), 로그·예외에 키·원문 이메일 0.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { inspect } from 'node:util';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import { collectEnvProblems } from '../config/env.js';
import { resolveSaveConfig } from '../save/config.js';
import { maskEmail, RESEND_ENDPOINT, ResendMailTransport, type FetchLike } from '../save/mail.js';

const KEY = 're_test_SECRET_abcdef0123456789';
const FROM = 'WithSmall <noreply@withsmall.test>';
const ORIGIN = 'https://withsmall.test';
const EMAIL = 'kenny.kim@example.com';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(status = 200): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> });
    return { ok: status >= 200 && status < 300, status, body: null };
  };
  return { fetch, calls };
}

function transport(fetch: FetchLike, lines: string[], timeoutMs?: number) {
  return new ResendMailTransport({ apiKey: KEY, from: FROM, fetch, timeoutMs, log: (s) => lines.push(s) });
}

function appWith(t: ResendMailTransport) {
  const repos = makeInMemoryRepos();
  const app = createApp(repos, {
    save: { config: { publicOrigin: ORIGIN, transport: t, secureCookie: true }, now: () => new Date('2026-10-14T00:00:00Z') },
  });
  return { app, repos };
}

function assertNoLeak(text: string) {
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('SECRET');
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain('kenny.kim');
}

describe('ResendMailTransport — 요청 형태', () => {
  it('POST api.resend.com/emails, Bearer 키, JSON {from, to:[email], subject, text}', async () => {
    const { fetch, calls } = fakeFetch(200);
    const lines: string[] = [];
    await transport(fetch, lines).send({ to: EMAIL, subject: '제목', text: `${ORIGIN}/save#t=abc` });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(RESEND_ENDPOINT).toBe('https://api.resend.com/emails');
    expect(c.url).toBe(RESEND_ENDPOINT);
    expect(c.method).toBe('POST');
    expect(c.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(c.headers['Content-Type']).toBe('application/json');
    expect(c.body).toEqual({ from: FROM, to: [EMAIL], subject: '제목', text: `${ORIGIN}/save#t=abc` });
    expect(lines).toEqual([]); // 성공 시 로그 없음
  });

  it('라우트 경유: 202, 본문 링크 오리진 = PUBLIC_ORIGIN(Host 헤더 무시), to 는 정규화 이메일', async () => {
    const { fetch, calls } = fakeFetch(200);
    const { app } = appWith(transport(fetch, []));
    const res = await request(app)
      .post('/auth/magic/request')
      .set('Host', 'evil.example')
      .send({ email: ' Kenny.Kim@Example.com ', entry: 'home' });
    expect(res.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.to).toEqual([EMAIL]);
    expect(calls[0].body.from).toBe(FROM);
    expect(String(calls[0].body.text)).toMatch(new RegExp(`${ORIGIN}/save#t=[A-Za-z0-9_-]{43}(\\s|$)`));
    expect(String(calls[0].body.text)).not.toContain('evil.example');
  });
});

describe('ResendMailTransport — 실패 → 503', () => {
  it('비2xx(422·500) → throw, 라우트 503 SAVE_UNAVAILABLE, 로그는 마스킹·상태만', async () => {
    for (const status of [422, 500]) {
      const lines: string[] = [];
      const { fetch } = fakeFetch(status);
      const t = transport(fetch, lines);
      const err = await t.send({ to: EMAIL, subject: 's', text: 't' }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err?.message).toBe(`ResendMailTransport: HTTP ${status}`);
      const { app } = appWith(t);
      const res = await request(app).post('/auth/magic/request').send({ email: EMAIL, entry: 'home' });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ code: 'SAVE_UNAVAILABLE' });
      const out = lines.join('\n');
      expect(out).toContain(maskEmail(EMAIL));
      expect(out).toContain(`status=${status}`);
      assertNoLeak(out + JSON.stringify(res.body));
    }
  });

  it('네트워크 오류 → throw(원인·키 미포함), 503', async () => {
    const lines: string[] = [];
    const fetch: FetchLike = async (_u, init) => {
      throw new Error(`connect ECONNREFUSED ${init.headers.Authorization}`);
    };
    const t = transport(fetch, lines);
    const err = (await t.send({ to: EMAIL, subject: 's', text: 't' }).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('ResendMailTransport: network');
    expect(err.cause).toBeUndefined();
    assertNoLeak(err.message + String(err.stack) + lines.join('\n'));
    const { app } = appWith(t);
    expect((await request(app).post('/auth/magic/request').send({ email: EMAIL, entry: 'home' })).status).toBe(503);
  });

  it('타임아웃(AbortController) → throw timeout, 503', async () => {
    const lines: string[] = [];
    let aborted = false;
    const fetch: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    const t = transport(fetch, lines, 20);
    const err = (await t.send({ to: EMAIL, subject: 's', text: 't' }).catch((e: unknown) => e)) as Error;
    expect(aborted).toBe(true);
    expect(err.message).toBe('ResendMailTransport: timeout');
    expect(lines.join('\n')).toContain('reason=timeout');
    const { app } = appWith(t);
    expect((await request(app).post('/auth/magic/request').send({ email: EMAIL, entry: 'home' })).status).toBe(503);
  });

  it('기본 타임아웃 10초', async () => {
    const { RESEND_TIMEOUT_MS } = await import('../save/mail.js');
    expect(RESEND_TIMEOUT_MS).toBe(10_000);
  });
});

describe('ResendMailTransport — 키 비노출', () => {
  it('inspect·JSON·String 어디에도 키가 없다', () => {
    const t = transport(fakeFetch().fetch, []);
    assertNoLeak(inspect(t, { depth: 5, showHidden: true }) + JSON.stringify(t) + String(t));
  });

  it('생성자: 빈 키·공백 키·개행 from 거부(메시지에 값 없음)', () => {
    expect(() => new ResendMailTransport({ apiKey: '', from: FROM })).toThrow(/RESEND_API_KEY/);
    expect(() => new ResendMailTransport({ apiKey: 're_a b', from: FROM })).toThrow(/RESEND_API_KEY/);
    expect(() => new ResendMailTransport({ apiKey: KEY, from: 'a@b.co\r\nBcc: x@y.z' })).toThrow(/MAIL_FROM/);
  });
});

describe('resolveSaveConfig — MAIL_TRANSPORT=resend', () => {
  const PROD = { NODE_ENV: 'production', PUBLIC_ORIGIN: ORIGIN, MAIL_TRANSPORT: 'resend' };

  it('키·발신 주소 있으면 ResendMailTransport(production·development 모두)', () => {
    for (const NODE_ENV of ['production', 'development']) {
      const c = resolveSaveConfig({ ...PROD, NODE_ENV, RESEND_API_KEY: KEY, MAIL_FROM: FROM });
      expect(c.transport).toBeInstanceOf(ResendMailTransport);
    }
    expect(resolveSaveConfig({ ...PROD, RESEND_API_KEY: KEY, MAIL_FROM: 'noreply@withsmall.test' }).transport).toBeInstanceOf(
      ResendMailTransport,
    );
  });

  it('RESEND_API_KEY·MAIL_FROM 누락 → throw(이름만, 값 없음)', () => {
    expect(() => resolveSaveConfig({ ...PROD })).toThrow(/RESEND_API_KEY·MAIL_FROM/);
    expect(() => resolveSaveConfig({ ...PROD, MAIL_FROM: FROM })).toThrow(/RESEND_API_KEY/);
    expect(() => resolveSaveConfig({ ...PROD, RESEND_API_KEY: KEY, MAIL_FROM: '  ' })).toThrow(/MAIL_FROM/);
    let msg = '';
    try {
      resolveSaveConfig({ ...PROD, RESEND_API_KEY: KEY });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/MAIL_FROM/);
    assertNoLeak(msg);
  });

  it('MAIL_FROM 형식 오류 → throw', () => {
    for (const MAIL_FROM of ['noreply', 'WithSmall noreply@x.kr', '<a@b>', 'A <a@b.co> extra']) {
      expect(() => resolveSaveConfig({ ...PROD, RESEND_API_KEY: KEY, MAIL_FROM }), MAIL_FROM).toThrow(/MAIL_FROM/);
    }
  });

  it('기동 검사(collectEnvProblems): production 에서 키 누락이 problems 에 오르고 값은 안 보인다', async () => {
    const base = {
      ...PROD,
      DATABASE_URL: 'file:/data/prod.db',
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      REACTION_KEY_SECRET: 'c'.repeat(64),
    };
    const bad = await collectEnvProblems({ ...base, MAIL_FROM: FROM });
    expect(bad.problems.some((p) => p.includes('RESEND_API_KEY'))).toBe(true);
    const ok = await collectEnvProblems({ ...base, RESEND_API_KEY: KEY, MAIL_FROM: FROM });
    expect(ok.problems.filter((p) => /MAIL|RESEND/.test(p))).toEqual([]);
    assertNoLeak(JSON.stringify(ok) + JSON.stringify(bad));
  });
});
