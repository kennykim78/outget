// 264(Kenny ORDERS §41, security 257 3c MED·3d): 일일 전역 저장 상한 — 이벤트 204·제보 202 그대로 조용히 버림,
//   서울 날짜가 바뀌면 리셋, 재기동(새 앱) 시 저장소에서 그날 수를 한 번 복원, 매 요청 COUNT 없음.
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import { InMemoryEventRepository } from '../analytics/event.repo.js';
import { makeEventsRoutes } from '../analytics/events.routes.js';
import { InMemoryVetClinicRepository } from '../vet/vet.repo.js';
import { createVetReportRouter } from '../vet/vet.report.routes.js';
import { collectEnvProblems } from '../config/env.js';
import { seoulDayStartIso } from '../privacy/retention.js';
import {
  capHitLogger,
  DailyCap,
  DEFAULT_VET_REPORT_PER_IP_DAILY,
  PerKeyDailyLimit,
  VET_REPORT_PER_IP_DAILY_ENV,
  DEFAULT_EVENT_DAILY_CAP,
  DEFAULT_VET_REPORT_DAILY_CAP,
  EVENT_DAILY_CAP_ENV,
  resolveDailyCap,
  seoulDay,
  VET_REPORT_DAILY_CAP_ENV,
} from '../middleware/daily-cap.js';

const SK = '3f2b8c1e-9a4d-4c7e-8f10-2b3c4d5e6f70';
const TS = 1_790_000_000_000;
const ev = () => ({ name: 'vet_clicked', ts: TS, sessionKey: SK, props: { clinicId: 'vc-mapo-01', action: 'call' } });
const batch = (n: number) => ({ events: Array.from({ length: n }, ev) });
const REPORT = { name: '하늘 동물병원', address: '서울 마포구 어딘가로 1', phone: '02-123-4567', treats: [] as string[] };

// 서울 2026-11-02 23:59:59 / 2026-11-03 00:00:00
const D1_LATE = new Date('2026-11-02T14:59:59.000Z');
const D2_START = new Date('2026-11-02T15:00:00.000Z');

describe('DailyCap (순수 카운터)', () => {
  it('상한까지 허용, 넘으면 0, 부분 허용(남은 자리만큼)', async () => {
    const cap = new DailyCap(5);
    expect((await cap.take(3, D1_LATE)).allowed).toBe(3);
    expect((await cap.take(3, D1_LATE)).allowed).toBe(2);
    expect((await cap.take(1, D1_LATE)).allowed).toBe(0);
    expect(cap.snapshot()).toEqual({ date: '2026-11-02', used: 5 });
  });

  it('서울 날짜 경계에서 리셋(23:59:59 → 00:00:00)', async () => {
    const cap = new DailyCap(2);
    expect((await cap.take(2, D1_LATE)).allowed).toBe(2);
    expect((await cap.take(1, D1_LATE)).allowed).toBe(0);
    expect((await cap.take(1, D2_START)).allowed).toBe(1);
    expect(cap.snapshot()).toEqual({ date: '2026-11-03', used: 1 });
    expect(seoulDay(D1_LATE)).toBe('2026-11-02');
    expect(seoulDay(D2_START)).toBe('2026-11-03');
  });

  it('복원: 날짜가 바뀔 때만 1회(매 요청 COUNT 없음), 동시 요청은 같은 복원을 기다리고 상한을 넘지 않는다', async () => {
    const restore = vi.fn(async (_d: string) => 8);
    const cap = new DailyCap(10, restore);
    const got = await Promise.all(Array.from({ length: 5 }, () => cap.take(1, D1_LATE)));
    expect(got.map((g) => g.allowed)).toEqual([1, 1, 0, 0, 0]);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith('2026-11-02');
    await cap.take(1, D1_LATE);
    expect(restore).toHaveBeenCalledTimes(1);
    await cap.take(1, D2_START);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenLastCalledWith('2026-11-03');
  });

  it('복원 실패는 throw(호출자 500) 후 다음 요청에서 다시 복원, release 는 같은 날짜만 되돌린다', async () => {
    let fail = true;
    const cap = new DailyCap(3, async () => {
      if (fail) throw new Error('db down');
      return 0;
    });
    await expect(cap.take(1, D1_LATE)).rejects.toThrow('db down');
    fail = false;
    const t = await cap.take(2, D1_LATE);
    expect(t.allowed).toBe(2);
    cap.release(t);
    expect(cap.snapshot().used).toBe(0);
    const t2 = await cap.take(3, D1_LATE);
    await cap.take(1, D2_START); // 날짜 넘어감
    cap.release(t2); // 어제 몫은 오늘 카운터에 영향 없음
    expect(cap.snapshot()).toEqual({ date: '2026-11-03', used: 1 });
  });

  it('limit 은 0 이상 정수(0 = 저장 끔)', async () => {
    expect(() => new DailyCap(-1)).toThrow();
    expect(() => new DailyCap(1.5)).toThrow();
    expect((await new DailyCap(0).take(1, D1_LATE)).allowed).toBe(0);
  });
});

describe('resolveDailyCap / env', () => {
  it('비우면 기본값, 0 이상 정수만, 그 밖은 throw', () => {
    expect(DEFAULT_EVENT_DAILY_CAP).toBe(10_000);
    expect(DEFAULT_VET_REPORT_DAILY_CAP).toBe(100);
    expect(resolveDailyCap({}, EVENT_DAILY_CAP_ENV, 7)).toBe(7);
    expect(resolveDailyCap({ [EVENT_DAILY_CAP_ENV]: ' ' }, EVENT_DAILY_CAP_ENV, 7)).toBe(7);
    expect(resolveDailyCap({ [EVENT_DAILY_CAP_ENV]: '0' }, EVENT_DAILY_CAP_ENV, 7)).toBe(0);
    expect(resolveDailyCap({ [EVENT_DAILY_CAP_ENV]: ' 20000 ' }, EVENT_DAILY_CAP_ENV, 7)).toBe(20_000);
    for (const bad of ['-1', '1.5', 'abc', '1e3', '99999999999999999999']) {
      expect(() => resolveDailyCap({ [EVENT_DAILY_CAP_ENV]: bad }, EVENT_DAILY_CAP_ENV, 7), bad).toThrow(EVENT_DAILY_CAP_ENV);
    }
  });

  it('기동 검사(collectEnvProblems)가 잘못된 값을 이름과 함께 모은다, createApp 도 throw', async () => {
    const r = await collectEnvProblems({ NODE_ENV: 'test', [EVENT_DAILY_CAP_ENV]: 'x', [VET_REPORT_DAILY_CAP_ENV]: '-3', [VET_REPORT_PER_IP_DAILY_ENV]: '1.5' });
    expect(r.problems.filter((p) => p.includes(VET_REPORT_PER_IP_DAILY_ENV))).toHaveLength(1);
    expect(r.problems.filter((p) => p.includes(EVENT_DAILY_CAP_ENV))).toHaveLength(1);
    expect(r.problems.filter((p) => p.includes(VET_REPORT_DAILY_CAP_ENV))).toHaveLength(1);
    const ok = await collectEnvProblems({ NODE_ENV: 'test' });
    expect(ok.problems.some((p) => p.includes('DAILY_CAP'))).toBe(false);
    const prev = process.env[EVENT_DAILY_CAP_ENV];
    process.env[EVENT_DAILY_CAP_ENV] = 'nope';
    try {
      expect(() => createApp(makeInMemoryRepos())).toThrow(EVENT_DAILY_CAP_ENV);
    } finally {
      if (prev === undefined) delete process.env[EVENT_DAILY_CAP_ENV];
      else process.env[EVENT_DAILY_CAP_ENV] = prev;
    }
  });
});

describe('POST /api/events — 일일 상한', () => {
  function appWith(limit: number, clock: { now: Date }, store = new InMemoryEventRepository()) {
    const app = express();
    app.use('/api/events', makeEventsRoutes(store, { now: () => clock.now, cap: new DailyCap(limit, (d) => store.countOnDate(d)) }));
    return { app, store };
  }

  it('상한 도달 → 204 그대로·미저장, 배치는 남은 자리만큼만 저장', async () => {
    const clock = { now: D1_LATE };
    const { app, store } = appWith(5, clock);
    expect((await request(app).post('/api/events').send(batch(3))).status).toBe(204);
    const over = await request(app).post('/api/events').send(batch(4));
    expect(over.status).toBe(204);
    expect(over.text).toBe('');
    expect(store.all()).toHaveLength(5);
    const after = await request(app).post('/api/events').set('Content-Type', 'text/plain').send(JSON.stringify(batch(1)));
    expect(after.status).toBe(204);
    expect(store.all()).toHaveLength(5);
  });

  it('날짜가 바뀌면 리셋', async () => {
    const clock = { now: D1_LATE };
    const { app, store } = appWith(2, clock);
    await request(app).post('/api/events').send(batch(2));
    await request(app).post('/api/events').send(batch(1));
    expect(store.all()).toHaveLength(2);
    clock.now = D2_START;
    expect((await request(app).post('/api/events').send(batch(1))).status).toBe(204);
    expect(store.all().map((r) => r.receivedDate)).toEqual(['2026-11-02', '2026-11-02', '2026-11-03']);
  });

  it('재기동(새 라우터·같은 저장소) → 그날 저장 수에서 이어 센다', async () => {
    const clock = { now: D1_LATE };
    const store = new InMemoryEventRepository();
    await request(appWith(3, clock, store).app).post('/api/events').send(batch(2));
    const count = vi.spyOn(store, 'countOnDate');
    const rebooted = appWith(3, clock, store).app;
    await request(rebooted).post('/api/events').send(batch(5));
    await request(rebooted).post('/api/events').send(batch(1));
    expect(store.all()).toHaveLength(3);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('검증 실패(400)는 자리를 쓰지 않는다, 저장 실패(500)는 자리를 돌려준다', async () => {
    const clock = { now: D1_LATE };
    const cap = new DailyCap(2);
    let fail = true;
    const store = new InMemoryEventRepository();
    const app = express();
    app.use(
      '/api/events',
      makeEventsRoutes(
        {
          append: async (rows) => {
            if (fail) throw new Error('down');
            return store.append(rows);
          },
          countOnDate: async () => 0,
        },
        { now: () => clock.now, cap },
      ),
    );
    expect((await request(app).post('/api/events').send({ events: [{ ...ev(), name: 'nope' }] })).status).toBe(400);
    expect((await request(app).post('/api/events').send(batch(2))).status).toBe(500);
    expect(cap.snapshot().used).toBe(0);
    fail = false;
    expect((await request(app).post('/api/events').send(batch(2))).status).toBe(204);
    expect(store.all()).toHaveLength(2);
  });

  it('createApp 배선: dailyCaps.events 가 /api/events 에 걸린다(응답 204 그대로)', async () => {
    const repos = makeInMemoryRepos();
    const app = createApp(repos, { dailyCaps: { events: 1 } });
    expect((await request(app).post('/api/events').send(batch(3))).status).toBe(204);
    expect((await request(app).post('/api/events').send(batch(1))).status).toBe(204);
    expect((repos.event as InMemoryEventRepository).all()).toHaveLength(1);
  });

  it('기본 배선(옵션 없음) = 기본 상한 10,000 — 기존 동작(소량)은 그대로 저장', async () => {
    const repos = makeInMemoryRepos();
    const app = createApp(repos);
    expect((await request(app).post('/api/events').send(batch(20))).status).toBe(204);
    expect((repos.event as InMemoryEventRepository).all()).toHaveLength(20);
  });
});

describe('POST /api/vets/reports — 일일 상한·접수 시각', () => {
  it('createdAt = 접수 시각 ISO, 상한 넘으면 202 {} 그대로·미저장, 다음 날 리셋', async () => {
    const clock = { now: D1_LATE };
    const repo = new InMemoryVetClinicRepository();
    const app = express();
    app.use('/api/vets/reports', createVetReportRouter(repo, { now: () => clock.now, cap: new DailyCap(1, (d) => repo.countReportsSince(seoulDayStartIso(d))) }));
    const a = await request(app).post('/api/vets/reports').send(REPORT);
    expect([a.status, a.body]).toEqual([202, {}]);
    const b = await request(app).post('/api/vets/reports').send({ ...REPORT, name: '둘째 병원' });
    expect([b.status, b.body]).toEqual([202, {}]);
    expect(repo.dump().map((r) => [r.name, r.createdAt])).toEqual([['하늘 동물병원', D1_LATE.toISOString()]]);
    clock.now = D2_START;
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: '셋째 병원' });
    expect(repo.dump()).toHaveLength(2);
  });

  it('createApp 배선 + 재기동 복원: 그날 이미 받은 제보 수(서울 날짜 시작 이후 USER_REPORT)에서 이어 센다', async () => {
    const repos = makeInMemoryRepos();
    const today = new Date();
    await repos.vet.createReport({ id: 'vr-old', region: '', ...REPORT, createdAt: today.toISOString() });
    const app = createApp(repos, { dailyCaps: { vetReports: 1 } });
    const r = await request(app).post('/api/vets/reports').send(REPORT);
    expect([r.status, r.body]).toEqual([202, {}]);
    expect((repos.vet as InMemoryVetClinicRepository).dump()).toHaveLength(1);
  });

  it('QA LOW-3 서울 날짜(createApp 배선, 고정 시계): 서울 00:30(UTC 전날 15:30) 제보는 「오늘」로 세어진다 — 재기동 복원이 서울 자정 기준', async () => {
    expect(seoulDayStartIso('2026-11-03')).toBe('2026-11-02T15:00:00.000Z'); // Z 정규화(사전순 비교 가능)
    const repos = makeInMemoryRepos();
    // 서울 2026-11-03 00:30 에 이미 1건(이전 프로세스에서 받음)
    await repos.vet.createReport({ id: 'vr-early', region: '', ...REPORT, createdAt: '2026-11-02T15:30:00.000Z' });
    // 서울 2026-11-02 23:59 제보(어제) — 오늘 수에 넣지 않는다
    await repos.vet.createReport({ id: 'vr-yday', region: '', ...REPORT, createdAt: '2026-11-02T14:59:00.000Z' });
    const clock = { now: new Date('2026-11-02T15:40:00.000Z') }; // 서울 00:40
    const app = createApp(repos, { dailyCaps: { vetReports: 2, now: () => clock.now } });
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: '둘째' }); // 오늘 2번째 → 저장
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: '셋째' }); // 상한 → 버림
    const names = (repos.vet as InMemoryVetClinicRepository).dump().map((r) => r.name);
    expect(names.filter((n) => n !== REPORT.name)).toEqual(['둘째']);
    expect((repos.vet as InMemoryVetClinicRepository).dump().at(-1)?.createdAt).toBe('2026-11-02T15:40:00.000Z');
  });

  it('QA LOW-3 서울 23:59 → 00:00 경계에서 제보·이벤트 카운터 리셋(createApp 배선, 고정 시계)', async () => {
    const repos = makeInMemoryRepos();
    const clock = { now: new Date('2026-11-02T14:59:00.000Z') }; // 서울 11-02 23:59
    const app = createApp(repos, { dailyCaps: { vetReports: 1, events: 1, now: () => clock.now } });
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: 'a' });
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: 'b' }); // 버림
    await request(app).post('/api/events').send(batch(2)); // 1개만
    clock.now = new Date('2026-11-02T15:00:00.000Z'); // 서울 11-03 00:00
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: 'c' });
    await request(app).post('/api/events').send(batch(1));
    clock.now = new Date('2026-11-02T15:30:00.000Z'); // 서울 00:30 — 같은 「오늘」
    await request(app).post('/api/vets/reports').send({ ...REPORT, name: 'd' }); // 버림
    await request(app).post('/api/events').send(batch(1)); // 버림
    expect((repos.vet as InMemoryVetClinicRepository).dump().map((r) => r.name)).toEqual(['a', 'c']);
    expect((repos.event as InMemoryEventRepository).all().map((r) => r.receivedDate)).toEqual(['2026-11-02', '2026-11-03']);
  });

  it('QA LOW-3 이벤트 재기동 복원: 서울 00:30 에 받은 이벤트(receivedDate 오늘)를 이어 센다', async () => {
    const repos = makeInMemoryRepos();
    const clock = { now: new Date('2026-11-02T15:30:00.000Z') }; // 서울 11-03 00:30
    await request(createApp(repos, { dailyCaps: { events: 2, now: () => clock.now } })).post('/api/events').send(batch(1));
    expect((repos.event as InMemoryEventRepository).all()[0].receivedDate).toBe('2026-11-03');
    clock.now = new Date('2026-11-02T15:45:00.000Z');
    const rebooted = createApp(repos, { dailyCaps: { events: 2, now: () => clock.now } });
    await request(rebooted).post('/api/events').send(batch(3));
    expect((repos.event as InMemoryEventRepository).all()).toHaveLength(2);
  });

  it('security ④a: 상한을 그날 처음 쳤을 때만 1회 로그(날짜·상한 숫자만, 식별자 0) — 제보·이벤트 둘 다, 다음 날 다시 1회', async () => {
    const lines: string[] = [];
    const repos = makeInMemoryRepos();
    const clock = { now: D1_LATE };
    const app = createApp(repos, { dailyCaps: { vetReports: 1, events: 1, now: () => clock.now, log: (l) => lines.push(l) } });
    const IPX = '203.0.113.77';
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/vets/reports').set('X-Forwarded-For', IPX).send({ ...REPORT, name: `p${i}` });
      await request(app).post('/api/events').send(batch(2));
    }
    expect([...lines].sort()).toEqual([
      '[cap] events daily cap reached date=2026-11-02 limit=1',
      '[cap] vetReports daily cap reached date=2026-11-02 limit=1',
    ]);
    clock.now = D2_START;
    await request(app).post('/api/events').send(batch(2));
    expect(lines.at(-1)).toBe('[cap] events daily cap reached date=2026-11-03 limit=1');
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l).not.toContain(IPX);
      expect(l).not.toMatch(/@|하늘|p\d|vc-|[0-9a-f]{8}-[0-9a-f]{4}/);
    }
    expect(capHitLogger('x', (l) => lines.push(l))).toBeTypeOf('function');
  });

  it('security ④b: IP별 하루 한도(기본 10) — 넘치면 같은 202 {}, 전역 상한은 쓰지 않음, 다른 IP·다음 날은 받음', async () => {
    expect(DEFAULT_VET_REPORT_PER_IP_DAILY).toBe(10);
    const repos = makeInMemoryRepos();
    const clock = { now: D1_LATE };
    const app = createApp(repos, { trustProxy: 1, dailyCaps: { vetReports: 5, vetReportsPerIp: 2, now: () => clock.now } });
    const from = (ip: string, name: string) => request(app).post('/api/vets/reports').set('X-Forwarded-For', ip).send({ ...REPORT, name });
    const rs = [await from('198.51.100.1', 'a1'), await from('198.51.100.1', 'a2'), await from('198.51.100.1', 'a3'), await from('198.51.100.1', 'a4')];
    expect(rs.map((r) => [r.status, r.body])).toEqual([[202, {}], [202, {}], [202, {}], [202, {}]]);
    // 전역 5 중 2만 썼다 → 다른 IP 3건 모두 저장
    await from('198.51.100.2', 'b1');
    await from('198.51.100.2', 'b2');
    await from('2001:db8:1:200::5', 'c1');
    const dump = () => (repos.vet as InMemoryVetClinicRepository).dump().map((r) => r.name);
    expect(dump()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1']);
    clock.now = D2_START;
    await from('198.51.100.1', 'a5');
    expect(dump().at(-1)).toBe('a5');
    // 저장 행에 IP 0
    expect(JSON.stringify((repos.vet as InMemoryVetClinicRepository).dump())).not.toMatch(/198\.51|2001:db8/);
  });

  it('security ④b: PerKeyDailyLimit 표에는 원문 IP 가 없다(HMAC 키), 날짜가 바뀌면 비운다, 표가 가득 차면 새 키는 통과(전역 상한에 맡김)', () => {
    const lim = new PerKeyDailyLimit(1, 2);
    expect(lim.hit('198.51.100.9', D1_LATE)).toBe(true);
    expect(lim.hit('198.51.100.9', D1_LATE)).toBe(false);
    const snap = lim.snapshot();
    expect(snap.keys).toHaveLength(1);
    expect(snap.keys.join()).not.toContain('198.51');
    expect(snap.keys[0]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(lim.hit('198.51.100.10', D1_LATE)).toBe(true);
    expect(lim.hit('198.51.100.11', D1_LATE)).toBe(true); // 표 가득(2) → 세지 않고 통과
    expect(lim.snapshot().keys).toHaveLength(2);
    expect(lim.hit('198.51.100.9', D2_START)).toBe(true);
    expect(lim.snapshot()).toMatchObject({ date: '2026-11-03' });
    expect(lim.snapshot().keys).toHaveLength(1);
    // 275 B-1: 날짜가 바뀌면 salt 도 바뀐다 — 같은 IP 라도 어제 키와 오늘 키가 달라야 한다(날짜 넘어 같은 사람 추적 0)
    expect(lim.snapshot().keys[0]).not.toBe(snap.keys[0]);
    expect(new PerKeyDailyLimit(0).hit('x', D1_LATE)).toBe(false);
    expect(() => new PerKeyDailyLimit(-1)).toThrow();
  });

  it('빈 treats:[] 는 받는다(264 판단 — 제보 폼은 진료 동물을 고르지 않아도 보낼 수 있다)', async () => {
    const repo = new InMemoryVetClinicRepository();
    const app = express();
    app.use('/api/vets/reports', createVetReportRouter(repo));
    expect((await request(app).post('/api/vets/reports').send(REPORT)).status).toBe(202);
    expect(repo.dump()[0].treats).toEqual([]);
  });
});
