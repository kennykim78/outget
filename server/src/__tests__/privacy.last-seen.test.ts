// QA95 D-1·D-2·D-3(인메모리·순수):
//   D-1 lastSeenAt 하루 1회 갱신 규칙(서울 날짜) · verify·GET·PUT 이 갱신 · 같은 날 재방문 쓰기 0.
//   D-2 DELETE /api/save 204 응답 뒤 비동기 compact 1회 · 합치기 · 실패는 오류 이름만 로그.
//   D-3 verify 중 삭제 경합(세션 insert P2003/P2025) → 401 invalid_token(쿠키 0), 다른 오류는 500 유지.
//   실제 SQLite 판(마이그레이션·VACUUM·FK 경합·QA95 재현 시나리오)은 privacy.qa95.prisma.test.ts.
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeInMemoryRepos, type Repos } from '../db/repos.js';
import type { InMemoryUserRepository } from '../auth/user.repo.js';
import type { ErasureStore } from '../privacy/erase.js';
import { needsLastSeenTouch, seoulDayStartIsoAt } from '../privacy/last-seen.js';
import { seoulDayStartIso } from '../privacy/retention.js';
import { seoulToday } from '../prerender/cli.js';
import { compactFailLine, createCompactScheduler } from '../privacy/compact.js';
import type { MailMessage, MailTransport } from '../save/mail.js';
import type { SessionRepository } from '../save/save.repo.js';
import { sampleSave } from './fixtures/save-sample.js';

const ORIGIN = 'https://withsmall.test';
const EMAIL = 'seen@example.com';
// 서울 2026-10-25 12:00
const T0 = Date.parse('2026-10-25T03:00:00.000Z');
const SEOUL_MIDNIGHT = Date.parse('2026-10-25T15:00:00.000Z'); // 서울 2026-10-26 00:00
const HOUR = 60 * 60 * 1000;

class CaptureTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
}

function setup(over: (r: Repos) => Partial<Repos> = () => ({})) {
  const base = makeInMemoryRepos();
  const repos: Repos = { ...base, ...over(base) };
  const mail = new CaptureTransport();
  const clock = { t: T0 };
  const app = createApp(repos, {
    save: { config: { publicOrigin: ORIGIN, transport: mail, secureCookie: true }, now: () => new Date(clock.t) },
    rateLimits: false,
  });
  const requestToken = async (): Promise<string> => {
    await request(app).post('/auth/magic/request').send({ email: EMAIL, entry: 'direct' });
    return /#t=([A-Za-z0-9_-]+)/.exec(mail.sent[mail.sent.length - 1].text)![1];
  };
  const verify = (token: string) => request(app).post('/auth/magic/verify').send({ token });
  const cookieOf = (res: request.Response) =>
    ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []).find((x) => x.startsWith('ws_sid='));
  const link = async () => cookieOf(await verify(await requestToken()))!.split(';')[0];
  const users = base.user as InMemoryUserRepository;
  return { app, repos, base, users, clock, requestToken, verify, cookieOf, link };
}

describe('D-1 needsLastSeenTouch (순수)', () => {
  it('없음·빈 문자열 → 갱신, 같은 서울 날짜 → 안 함, 서울 자정 경계에서 갱신', () => {
    const now = new Date(T0);
    expect(needsLastSeenTouch(null, now)).toBe(true);
    expect(needsLastSeenTouch(undefined, now)).toBe(true);
    expect(needsLastSeenTouch('', now)).toBe(true);
    // 서울 10-25 00:00 정각 = 같은 날 → 안 함, 1ms 전(10-24 23:59:59.999) → 갱신
    expect(needsLastSeenTouch('2026-10-24T15:00:00.000Z', now)).toBe(false);
    expect(needsLastSeenTouch('2026-10-24T14:59:59.999Z', now)).toBe(true);
    // 자정 넘긴 직후
    expect(needsLastSeenTouch(new Date(SEOUL_MIDNIGHT - 1).toISOString(), new Date(SEOUL_MIDNIGHT))).toBe(true);
    expect(needsLastSeenTouch(new Date(SEOUL_MIDNIGHT).toISOString(), new Date(SEOUL_MIDNIGHT + 1))).toBe(false);
    // 미래 값(시계 역행)은 갱신 안 함
    expect(needsLastSeenTouch('2027-01-01T00:00:00.000Z', now)).toBe(false);
  });

  it('seoulDayStartIsoAt = retention.ts seoulDayStartIso(seoulToday(now)) (패리티, 7시간 간격 1년)', () => {
    for (let t = Date.parse('2026-01-01T00:00:00.000Z'); t < Date.parse('2027-01-01T00:00:00.000Z'); t += 7 * HOUR + 7) {
      const d = new Date(t);
      expect(seoulDayStartIsoAt(d)).toBe(seoulDayStartIso(seoulToday(d)));
    }
  });
});

describe('D-1 lastSeenAt 갱신 경로(인메모리)', () => {
  it('verify 가 기록 → 같은 날 GET·PUT 은 쓰기 0 → 다음 서울 날짜 GET 1회 → 같은 날 PUT 은 0', async () => {
    const s = setup();
    const touch = vi.spyOn(s.users, 'touchLastSeen');
    const c = await s.link();
    const u = await s.users.findByEmail(EMAIL);
    // 101 L-3: 시각이 아니라 서울 날짜(00:00 KST)만 저장
    expect(s.users.lastSeenAtOf(u!.id)).toBe(seoulDayStartIsoAt(new Date(T0)));
    expect(s.users.lastSeenAtOf(u!.id)).toBe('2026-10-24T15:00:00.000Z');
    expect(touch).toHaveBeenCalledTimes(1);

    s.clock.t = T0 + 2 * HOUR;
    expect((await request(s.app).get('/api/save').set('Cookie', c)).status).toBe(200);
    const p = await request(s.app).put('/api/save').set('Cookie', c).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    expect(p.status).toBe(200);
    expect(touch).toHaveBeenCalledTimes(3);
    await expect(touch.mock.results[1].value).resolves.toBe(false);
    await expect(touch.mock.results[2].value).resolves.toBe(false);
    expect(s.users.lastSeenAtOf(u!.id)).toBe(seoulDayStartIsoAt(new Date(T0)));

    s.clock.t = SEOUL_MIDNIGHT; // 서울 다음 날 00:00
    expect((await request(s.app).get('/api/save').set('Cookie', c)).status).toBe(200);
    expect(s.users.lastSeenAtOf(u!.id)).toBe(new Date(SEOUL_MIDNIGHT).toISOString());
    s.clock.t = SEOUL_MIDNIGHT + HOUR;
    expect(
      (await request(s.app).put('/api/save').set('Cookie', c).send({ snapshot: sampleSave(), baseUpdatedAt: p.body.updatedAt })).status,
    ).toBe(200);
    expect(s.users.lastSeenAtOf(u!.id)).toBe(new Date(SEOUL_MIDNIGHT).toISOString());
  });

  it('PUT 409(다른 기기가 먼저 씀)도 사용 = 갱신', async () => {
    const s = setup();
    const c = await s.link();
    const id = (await s.users.findByEmail(EMAIL))!.id;
    expect((await request(s.app).put('/api/save').set('Cookie', c).send({ snapshot: sampleSave(), baseUpdatedAt: null })).status).toBe(200);
    s.clock.t = T0 + 3 * 24 * HOUR;
    const r = await request(s.app).put('/api/save').set('Cookie', c).send({ snapshot: sampleSave(), baseUpdatedAt: null });
    expect(r.status).toBe(409);
    expect(s.users.lastSeenAtOf(id)).toBe(seoulDayStartIsoAt(new Date(T0 + 3 * 24 * HOUR)));
  });

  it('갱신 실패는 GET 응답을 막지 않는다(오류 이름만 로그)', async () => {
    const s = setup();
    const c = await s.link();
    vi.spyOn(s.users, 'touchLastSeen').mockRejectedValue(Object.assign(new Error('secret@example.com'), { name: 'BoomError' }));
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
    try {
      const g = await request(s.app).get('/api/save').set('Cookie', c);
      expect(g.status).toBe(200);
    } finally {
      console.log = orig;
    }
    expect(lines).toEqual(['[privacy] lastSeen touch failed (BoomError)']);
  });

  it('없는 사용자 touch = false(throw 0), 삭제하면 기록도 사라진다', async () => {
    const s = setup();
    expect(await s.users.touchLastSeen('nope', new Date(T0))).toBe(false);
    const c = await s.link();
    const id = (await s.users.findByEmail(EMAIL))!.id;
    expect((await request(s.app).delete('/api/save').set('Cookie', c).send({ confirm: 'ERASE' })).status).toBe(204);
    expect(s.users.lastSeenAtOf(id)).toBeNull();
  });
});

describe('D-2 compact 스케줄러', () => {
  it('대기 중 요청은 1회로, 실행 중 요청은 "끝난 뒤 1회 더"로 합친다', async () => {
    let release!: () => void;
    let calls = 0;
    const compact = vi.fn(async () => {
      calls++;
      if (calls === 1) await new Promise<void>((r) => (release = r));
    });
    const sch = createCompactScheduler(compact, { log: () => {} });
    sch.request();
    sch.request(); // 아직 시작 전 → 합침
    expect(compact).not.toHaveBeenCalled(); // 동기 구간에선 시작하지 않는다
    await new Promise((r) => setImmediate(r));
    expect(compact).toHaveBeenCalledTimes(1);
    sch.request();
    sch.request();
    sch.request(); // 실행 중 3개 → 끝난 뒤 1회
    release();
    await sch.idle();
    expect(compact).toHaveBeenCalledTimes(2);
    await sch.idle(); // 할 일 없음 → 즉시
  });

  it('실패는 오류 이름·코드만 로그, 다음 요청은 다시 실행', async () => {
    const lines: string[] = [];
    const compact = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error('SQLITE_BUSY: user@example.com'), { name: 'PrismaClientKnownRequestError', code: 'P1008' }))
      .mockResolvedValueOnce(undefined);
    const sch = createCompactScheduler(compact, { log: (l) => lines.push(l) });
    sch.request();
    await sch.idle();
    expect(lines).toEqual(['[privacy] vacuum failed (PrismaClientKnownRequestError P1008)']);
    sch.request();
    await sch.idle();
    expect(compact).toHaveBeenCalledTimes(2);
    expect(compactFailLine(null)).toBe('[privacy] vacuum failed (Error)');
  });

  it('compact 없음(인메모리) → request 는 아무것도 안 함', async () => {
    const sch = createCompactScheduler(undefined);
    sch.request();
    await sch.idle();
  });
});

describe('D-2 DELETE /api/save → 204 응답 뒤 compact 1회', () => {
  function withCompact() {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const compact = vi.fn(async () => {
      events.push('compact');
      await gate; // VACUUM 이 오래 걸려도 응답은 이미 나갔다
    });
    const s = setup((b) => {
      const inner = b.erasure;
      const erasure: ErasureStore = {
        eraseByEmail: (...a) => inner.eraseByEmail(...a),
        eraseUser: async (...a) => {
          const r = await inner.eraseUser(...a);
          events.push('erase');
          return r;
        },
        reapplyTombstones: (...a) => inner.reapplyTombstones(...a),
        pruneTombstones: (...a) => inner.pruneTombstones(...a),
        compact,
      };
      return { erasure };
    });
    // 응답 완료(finish) 시점을 같은 이벤트 열에 기록하는 서버
    const server = createServer((req, res) => {
      res.on('finish', () => events.push(`finish:${req.method}:${res.statusCode}`));
      s.app(req, res);
    });
    return { ...s, events, compact, release, server };
  }

  it('순서 erase → 204 finish → compact, compact 가 끝나지 않아도 응답은 온다', async () => {
    const s = withCompact();
    const c = await s.link();
    s.events.length = 0;
    const r = await request(s.server).delete('/api/save').set('Cookie', c).send({ confirm: 'ERASE' });
    expect(r.status).toBe(204);
    await vi.waitFor(() => expect(s.compact).toHaveBeenCalledTimes(1));
    expect(s.events).toEqual(['erase', 'finish:DELETE:204', 'compact']);
    s.release();
  });

  it('거부(400·401)는 compact 를 부르지 않는다', async () => {
    const s = withCompact();
    const c = await s.link();
    expect((await request(s.app).delete('/api/save').set('Cookie', c).send({ confirm: 'no' })).status).toBe(400);
    expect((await request(s.app).delete('/api/save').send({ confirm: 'ERASE' })).status).toBe(401);
    await new Promise((r) => setImmediate(r));
    expect(s.compact).not.toHaveBeenCalled();
    s.release();
  });
});

describe('D-3 verify 중 삭제 경합 → 401 (500 아님)', () => {
  const failingInsert = (code: string) => (b: Repos) => {
    const inner = b.session;
    const session: SessionRepository = {
      insert: async () => {
        throw Object.assign(new Error('Foreign key constraint violated'), { name: 'PrismaClientKnownRequestError', code });
      },
      findActiveUserId: (...a) => inner.findActiveUserId(...a),
      revoke: (...a) => inner.revoke(...a),
      enforceCap: (...a) => inner.enforceCap(...a),
      deleteInactive: (...a) => inner.deleteInactive(...a),
    };
    return { session };
  };

  it.each(['P2003', 'P2025'])('%s → 401 {error:"invalid_token"}, ws_sid 쿠키 없음', async (code) => {
    const s = setup(failingInsert(code));
    const r = await s.verify(await s.requestToken());
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'invalid_token' });
    expect(s.cookieOf(r)).toBeUndefined();
  });

  it('다른 오류(P1001)는 그대로 500', async () => {
    const s = setup(failingInsert('P1001'));
    const r = await s.verify(await s.requestToken());
    expect(r.status).toBe(500);
  });
});
