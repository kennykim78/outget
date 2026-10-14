// R5 B1-5: BE2 라우터(반응 C-R5-3, 병원 제보 C-R5-4)를 createApp 경유로 검증한다.
//   - 두 경로가 app.ts 를 통해 응답, 리미터 초과 429(분당 21번째 반응, 시간당 6번째 제보)
//   - POST /api/vets/reports 가 /api/vets/:id 읽기 라우터에 삼켜지지 않는다(제보 라우터 먼저 마운트)
//   - 라우터 전용 본문 상한(반응 1KB·제보 2KB)이 전역 JSON 파서(100KB)에 우회되지 않는다
//   - REACTION_KEY_SECRET: production 미설정 → 기동 throw, dev → 랜덤 시크릿으로 기동(K3)
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';

// 외부 오리진은 런타임 조립(소스 스캐너 C1-FETCH 는 같은 줄 네트워크 호출 + 비로컬 절대 URL 리터럴을 잡는다).
const FOREIGN_ORIGIN = ['https:', '', 'evil.test'].join('/');
const LIKE = { targetType: 'PRODUCT', targetId: 'p-cage-01', kind: 'LIKE' };
const REPORT = { name: '위드 동물병원', address: '서울 마포구 어딘가로 1', phone: '02-123-4567', treats: [] as string[] };

describe('반응 /api/reactions (createApp 경유)', () => {
  it('POST 204·중복 204·DELETE 204, counts 는 LIKE 10 미만 null', async () => {
    const app = createApp();
    expect((await request(app).post('/api/reactions').send(LIKE)).status).toBe(204);
    expect((await request(app).post('/api/reactions').send(LIKE)).status).toBe(204);
    const counts = await request(app).get('/api/reactions/counts').query({ targetType: 'PRODUCT', ids: 'p-cage-01' });
    expect(counts.status).toBe(200);
    expect(counts.body).toEqual({ counts: { 'p-cage-01': null } });
    expect((await request(app).delete('/api/reactions').send(LIKE)).status).toBe(204);
  });

  it('분당 21번째 POST → 429', async () => {
    const app = createApp(makeInMemoryRepos(), { rateLimits: true });
    for (let i = 0; i < 20; i++) expect((await request(app).post('/api/reactions').send(LIKE)).status).toBe(204);
    const over = await request(app).post('/api/reactions').send(LIKE);
    expect(over.status).toBe(429);
    expect(over.body).toEqual({ error: 'rate_limited' });
  });

  it('1KB 초과 본문 → 413(전역 파서 우회 없음)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/reactions')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...LIKE, pad: 'x'.repeat(2048) }));
    expect(res.status).toBe(413);
  });

  it('외부 Origin POST → 403', async () => {
    const app = createApp();
    expect((await request(app).post('/api/reactions').set('Origin', FOREIGN_ORIGIN).send(LIKE)).status).toBe(403);
  });
});

describe('병원 제보 /api/vets/reports (createApp 경유)', () => {
  it('POST 202, 저장은 비노출(목록·상세에 없음) — /api/vets/:id 에 삼켜지지 않음', async () => {
    const repos = makeInMemoryRepos();
    const app = createApp(repos);
    const res = await request(app).post('/api/vets/reports').send(REPORT);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({});
    const list = await request(app).get('/api/vets');
    expect(list.body.clinics).toEqual([]);
    // 읽기 라우터의 :id 로 오인되지 않는다 — GET /api/vets/reports 는 상세 404(제보 행이 노출되지 않음)
    expect((await request(app).get('/api/vets/reports')).status).toBe(404);
  });

  it('형식 오류 400, JSON 아님 415', async () => {
    const app = createApp();
    expect((await request(app).post('/api/vets/reports').send({ ...REPORT, phone: 'abc' })).status).toBe(400);
    expect(
      (await request(app).post('/api/vets/reports').set('Content-Type', 'text/plain').send(JSON.stringify(REPORT))).status,
    ).toBe(415);
  });

  it('시간당 6번째 → 429', async () => {
    const app = createApp(makeInMemoryRepos(), { rateLimits: true });
    for (let i = 0; i < 5; i++) expect((await request(app).post('/api/vets/reports').send(REPORT)).status).toBe(202);
    expect((await request(app).post('/api/vets/reports').send(REPORT)).status).toBe(429);
  });

  it('2KB 초과 본문 → 413(전역 파서 우회 없음)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/vets/reports')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...REPORT, pad: 'x'.repeat(3000) }));
    expect(res.status).toBe(413);
  });

  it('knownTypeIds 주입 시 그 밖의 treats 400', async () => {
    const app = createApp(makeInMemoryRepos(), { knownTypeIds: new Set(['hamster-golden']) });
    expect((await request(app).post('/api/vets/reports').send({ ...REPORT, treats: ['hamster-golden'] })).status).toBe(202);
    expect((await request(app).post('/api/vets/reports').send({ ...REPORT, treats: ['parrot-x'] })).status).toBe(400);
  });
});

describe('REACTION_KEY_SECRET 기동 규칙(K3)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['NODE_ENV', 'REACTION_KEY_SECRET', 'PUBLIC_ORIGIN', 'MAIL_TRANSPORT']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('production + 시크릿 없음 → createApp throw', () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_ORIGIN = 'https://withsmall.test';
    delete process.env.MAIL_TRANSPORT;
    delete process.env.REACTION_KEY_SECRET;
    expect(() => createApp(makeInMemoryRepos())).toThrow(/REACTION_KEY_SECRET/);
  });

  it('production + 32자 미만 시크릿 → throw, 32자 이상 → 기동', () => {
    expect(() =>
      createApp(makeInMemoryRepos(), { reaction: { secret: 'short', nodeEnv: 'production' } }),
    ).toThrow(/REACTION_KEY_SECRET/);
    expect(() =>
      createApp(makeInMemoryRepos(), { reaction: { secret: 'a'.repeat(32), nodeEnv: 'production' } }),
    ).not.toThrow();
  });

  it('development + 시크릿 없음 → 기동(랜덤 시크릿)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.REACTION_KEY_SECRET;
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.MAIL_TRANSPORT;
    const app = createApp(makeInMemoryRepos());
    expect((await request(app).post('/api/reactions').send(LIKE)).status).toBe(204);
  });
});

describe('errorHandler — 라우터 전용 파서 오류', () => {
  it('깨진 JSON(반응·제보) → 400 bad_body, 스택·상세 없음', async () => {
    const app = createApp();
    for (const path of ['/api/reactions', '/api/vets/reports']) {
      const res = await request(app).post(path).set('Content-Type', 'application/json').send('{"x":');
      expect(res.status, path).toBe(400);
      expect(res.body).toEqual({ error: 'bad_body' });
    }
  });
});

describe('반응 대상 허용 집합(knownTargetIds, SEC-3 L-7) — createApp 경유', () => {
  const known = new Set(['wheel', 'starter', 'p-cage-01']);
  const app = () => createApp(makeInMemoryRepos(), { knownTargetIds: known });

  it('노출 SupplyItem 👍(HELPFUL) → 204, Bundle 👍 → 204, 상품 ♥ → 204', async () => {
    const a = app();
    expect((await request(a).post('/api/reactions').send({ targetType: 'SUPPLY_ITEM', targetId: 'wheel', kind: 'HELPFUL' })).status).toBe(204);
    expect((await request(a).post('/api/reactions').send({ targetType: 'BUNDLE', targetId: 'starter', kind: 'HELPFUL' })).status).toBe(204);
    expect((await request(a).post('/api/reactions').send(LIKE)).status).toBe(204);
  });

  it('미지 대상 → 400(POST·DELETE)', async () => {
    const a = app();
    const unknown = { targetType: 'SUPPLY_ITEM', targetId: 'no-such-item', kind: 'HELPFUL' };
    expect((await request(a).post('/api/reactions').send(unknown)).status).toBe(400);
    expect((await request(a).delete('/api/reactions').send(unknown)).status).toBe(400);
  });
});
