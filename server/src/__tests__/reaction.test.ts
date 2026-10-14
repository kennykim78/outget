// R5 B2-3(C-R5-3, D9) + SEC-3 M-3·L-6·L-7: 익명 반응 — 키 = HMAC(서울일자|IP 프리픽스), UA 제외, 창 400일 중복·취소,
//   LIKE 임계 10, IP·UA 원문 0, knownTargetIds, 노출 경로와 import 분리(불변식 ③⑧).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  REACTION_KEY_WINDOW_DAYS,
  anonKey,
  createAnonKeyer,
  daysBefore,
  ipPrefix,
  isProdLikeEnv,
  resolveReactionSecret,
} from '../reaction/anon-key.js';
import { InMemoryReactionRepository } from '../reaction/reaction.repo.js';
import { createReactionRouter, type ReactionRouterOptions } from '../reaction/reaction.routes.js';

const SECRET = 's'.repeat(40);
const IP = '203.0.113.7';
const UA = 'Mozilla/5.0 (TestAgent 1.0)';

/** 서울 정오 기준 시계(day 0 = 2026-10-02). c.day 를 바꿔 날짜 이동. */
function clock() {
  const c = { day: 0, now: (): Date => new Date(Date.UTC(2026, 9, 2 + c.day, 3, 0, 0)) };
  return c;
}
function appWith(repo = new InMemoryReactionRepository(), c = clock(), extra: Partial<ReactionRouterOptions> = {}) {
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/reactions', createReactionRouter(repo, { secret: SECRET, nodeEnv: 'test', now: c.now, ...extra }));
  return { app, repo, c };
}
const post = (app: express.Express, body: unknown, ua = UA, ip = IP) =>
  request(app).post('/api/reactions').set('X-Forwarded-For', ip).set('User-Agent', ua).send(body as object);
const del = (app: express.Express, body: unknown, ua = UA, ip = IP) =>
  request(app).delete('/api/reactions').set('X-Forwarded-For', ip).set('User-Agent', ua).send(body as object);
const countOf = async (app: express.Express, id = 'cp-wheel-01') =>
  ((await request(app).get(`/api/reactions/counts?targetType=PRODUCT&ids=${id}`)).body as { counts: Record<string, number | null> })
    .counts[id];

const LIKE = { targetType: 'PRODUCT', targetId: 'cp-wheel-01', kind: 'LIKE' };

describe('ipPrefix(IPv4 /24, IPv6 /64)', () => {
  it.each([
    ['203.0.113.7', 'v4:203.0.113'],
    ['203.0.113.250', 'v4:203.0.113'],
    ['::ffff:203.0.113.7', 'v4:203.0.113'],
    ['2001:db8:abcd:12:1:2:3:4', 'v6:2001:db8:abcd:12'],
    ['2001:db8:abcd:12::99', 'v6:2001:db8:abcd:12'],
    ['2001:DB8:ABCD:0012:ffff::1', 'v6:2001:db8:abcd:12'],
    ['fe80::1%eth0', 'v6:fe80:0:0:0'],
    ['::1', 'v6:0:0:0:0'],
    ['', 'unknown'],
    ['not-an-ip', 'unknown'],
  ])('%s → %s', (ip, want) => expect(ipPrefix(ip)).toBe(want));
});

describe('anonKey', () => {
  it('HMAC-SHA256(secret, 서울일자|프리픽스) hex — 결정적, 일자가 바뀌면 다른 키(DB 만으로 날짜 간 연결 불가)', () => {
    const k = anonKey(SECRET, '2026-10-02', 'v4:203.0.113');
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(anonKey(SECRET, '2026-10-02', 'v4:203.0.113')).toBe(k);
    expect(anonKey(SECRET, '2026-10-03', 'v4:203.0.113')).not.toBe(k);
    expect(anonKey(SECRET, '2026-10-02', 'v4:203.0.114')).not.toBe(k);
  });
  it('서울 일자 기준(UTC 15:00 = 서울 다음날 00:00), UA 는 키에 없다', () => {
    const at = (iso: string) => createAnonKeyer({ secret: SECRET, nodeEnv: 'test', now: () => new Date(iso) }).today(IP);
    expect(at('2026-10-02T14:59:59Z')).toBe(anonKey(SECRET, '2026-10-02', 'v4:203.0.113'));
    expect(at('2026-10-02T15:00:00Z')).toBe(anonKey(SECRET, '2026-10-03', 'v4:203.0.113'));
  });
  it(`창 = 오늘부터 ${REACTION_KEY_WINDOW_DAYS}일(오늘이 [0], 달력 산술)`, () => {
    const w = createAnonKeyer({ secret: SECRET, nodeEnv: 'test', now: () => new Date('2026-03-01T03:00:00Z') }).window(IP);
    expect(w).toHaveLength(REACTION_KEY_WINDOW_DAYS);
    expect(w[0]).toBe(anonKey(SECRET, '2026-03-01', 'v4:203.0.113'));
    expect(w[1]).toBe(anonKey(SECRET, '2026-02-28', 'v4:203.0.113'));
    expect(new Set(w).size).toBe(REACTION_KEY_WINDOW_DAYS);
    expect(daysBefore('2024-03-01', 1)).toBe('2024-02-29');
    expect(daysBefore('2026-01-01', 1)).toBe('2025-12-31');
  });
  it('L-6: development·test 외 모든 NODE_ENV(미설정·오타 포함)는 운영 — 시크릿 없음·짧음 throw', () => {
    for (const env of ['production', undefined, '', 'prod', 'staging', 'Production']) {
      expect(isProdLikeEnv(env), String(env)).toBe(true);
      expect(() => resolveReactionSecret(undefined, env), String(env)).toThrow(/REACTION_KEY_SECRET/);
    }
    expect(() => resolveReactionSecret('short', 'production')).toThrow();
    expect(resolveReactionSecret(SECRET, 'production')).toBe(SECRET);
    for (const env of ['development', 'test']) {
      expect(isProdLikeEnv(env)).toBe(false);
      const a = resolveReactionSecret(undefined, env);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(resolveReactionSecret(undefined, env)).not.toBe(a);
    }
    expect(() => createReactionRouter(new InMemoryReactionRepository(), { secret: '', nodeEnv: 'production' })).toThrow();
    expect(() => createReactionRouter(new InMemoryReactionRepository(), { secret: '', nodeEnv: undefined })).toThrow();
  });
});

describe('M-3: 위조·취소', () => {
  it('같은 IP 에서 UA 10개 → ♥ 1(임계 미달 null), 행 1', async () => {
    const { app, repo } = appWith();
    for (let i = 0; i < 10; i++) expect((await post(app, LIKE, `UA-rotated-${i}`)).status).toBe(204);
    expect(repo.dump()).toHaveLength(1);
    expect(await countOf(app)).toBeNull();
  });
  it('같은 /24 의 다른 호스트 10개 → 1(IPv4 /24 묶음), 같은 /64 의 IPv6 10개 → 1', async () => {
    const { app, repo } = appWith();
    for (let i = 0; i < 10; i++) await post(app, LIKE, UA, `203.0.113.${i + 1}`);
    for (let i = 0; i < 10; i++) await post(app, LIKE, UA, `2001:db8:1:2::${i + 1}`);
    expect(repo.dump()).toHaveLength(2);
  });
  it('1일차 ♥ → 30일차 취소(다른 UA) → 0행·count null', async () => {
    const { app, repo, c } = appWith();
    await post(app, LIKE);
    c.day = 29;
    expect((await del(app, LIKE, 'another-UA')).status).toBe(204);
    expect(repo.dump()).toHaveLength(0);
    expect(await countOf(app)).toBeNull();
  });
  it('며칠 뒤 다시 ♥ 해도 창 안이면 중복 0(1행 유지)', async () => {
    const { app, repo, c } = appWith();
    await post(app, LIKE);
    c.day = 120;
    await post(app, LIKE);
    expect(repo.dump()).toHaveLength(1);
  });
  it(`창(${REACTION_KEY_WINDOW_DAYS}일) 밖의 행은 취소·중복 판정 밖(보존 기한 ≤ 창 필요 — 보고)`, async () => {
    const { app, repo, c } = appWith();
    await post(app, LIKE);
    c.day = REACTION_KEY_WINDOW_DAYS;
    await del(app, LIKE);
    expect(repo.dump()).toHaveLength(1);
    c.day = REACTION_KEY_WINDOW_DAYS - 1;
    await del(app, LIKE);
    expect(repo.dump()).toHaveLength(0);
  });
  it('다른 /24 10곳 → 10(임계 공개), 그중 1곳 취소 → null', async () => {
    const { app } = appWith();
    for (let i = 0; i < 10; i++) await post(app, LIKE, UA, `198.51.${i}.10`);
    expect(await countOf(app)).toBe(10);
    await del(app, LIKE, UA, '198.51.3.99');
    expect(await countOf(app)).toBeNull();
  });
});

describe('L-7: knownTargetIds', () => {
  it('집합 밖 targetId → POST·DELETE 400, 저장 0; 집합 안은 204', async () => {
    const { app, repo } = appWith(undefined, undefined, { knownTargetIds: new Set(['cp-wheel-01', 'cage']) });
    expect((await post(app, { ...LIKE, targetId: 'cp-ghost' })).status).toBe(400);
    expect((await del(app, { ...LIKE, targetId: 'cp-ghost' })).status).toBe(400);
    expect(repo.dump()).toHaveLength(0);
    expect((await post(app, LIKE)).status).toBe(204);
    expect((await post(app, { targetType: 'SUPPLY_ITEM', targetId: 'cage', kind: 'HELPFUL' })).status).toBe(204);
    expect(repo.dump()).toHaveLength(2);
  });
  it('미지정이면 형식만 검사(기존 동작)', async () => {
    const { app } = appWith();
    expect((await post(app, { ...LIKE, targetId: 'cp-anything' })).status).toBe(204);
  });
});

describe('POST/DELETE /api/reactions', () => {
  it('같은 키·대상 2회 → 204·204, 1행', async () => {
    const { app, repo } = appWith();
    expect((await post(app, LIKE)).status).toBe(204);
    expect((await post(app, LIKE)).status).toBe(204);
    expect(repo.dump()).toHaveLength(1);
  });
  it('DELETE → 행 삭제, 없어도 204', async () => {
    const { app, repo } = appWith();
    await post(app, LIKE);
    expect((await del(app, LIKE)).status).toBe(204);
    expect(repo.dump()).toHaveLength(0);
    expect((await del(app, LIKE)).status).toBe(204);
  });
  it('저장 행에 IP·UA 원문 0(⑧), 행 필드 = id·anonKey·target·kind·createdAt', async () => {
    const { app, repo } = appWith();
    await post(app, LIKE);
    await post(app, { targetType: 'SUPPLY_ITEM', targetId: 'cage', kind: 'HELPFUL' });
    const dump = JSON.stringify(repo.dump());
    expect(dump).not.toContain(IP);
    expect(dump).not.toContain('203.0.113'); // 프리픽스 원문도 0
    expect(dump).not.toContain('TestAgent');
    for (const r of repo.dump()) expect(Object.keys(r).sort()).toEqual(['anonKey', 'createdAt', 'id', 'kind', 'targetId', 'targetType']);
  });
  it('kind↔target 짝 위반·스키마 밖 키·형식 위반 → 400, 저장 0', async () => {
    const { app, repo } = appWith();
    const bad = [
      { targetType: 'SUPPLY_ITEM', targetId: 'cage', kind: 'LIKE' },
      { targetType: 'PRODUCT', targetId: 'cp-1', kind: 'HELPFUL' },
      { targetType: 'GUIDE', targetId: 'g', kind: 'HELPFUL' },
      { ...LIKE, targetId: 'Bad Id' },
      { ...LIKE, targetId: '__proto__' },
      { ...LIKE, email: 'a@b.co' },
      { targetType: 'PRODUCT', targetId: 'cp-1' },
      [LIKE],
    ];
    for (const b of bad) expect((await post(app, b)).status, JSON.stringify(b)).toBe(400);
    expect(repo.dump()).toHaveLength(0);
  });
  it('Content-Type application/json 아니면 415(교차 출처 단순 요청 차단)', async () => {
    const { app, repo } = appWith();
    const r = await request(app).post('/api/reactions').set('Content-Type', 'text/plain').send(JSON.stringify(LIKE));
    expect(r.status).toBe(415);
    expect(repo.dump()).toHaveLength(0);
  });
  it('리미터 옵션은 변경 메서드에만 걸린다', async () => {
    let hits = 0;
    const app = express();
    app.use(
      '/api/reactions',
      createReactionRouter(new InMemoryReactionRepository(), {
        secret: SECRET,
        nodeEnv: 'test',
        limiter: (_q, res) => {
          hits++;
          res.status(429).json({ error: 'rate_limited' });
        },
      }),
    );
    expect((await post(app, LIKE)).status).toBe(429);
    expect((await request(app).get('/api/reactions/counts?targetType=PRODUCT&ids=a')).status).toBe(200);
    expect(hits).toBe(1);
  });
});

describe('GET /api/reactions/counts', () => {
  async function seeded(n: number) {
    const { app, repo } = appWith();
    for (let i = 0; i < n; i++) await post(app, LIKE, UA, `198.51.${i}.10`);
    return { app, repo };
  }
  it('LIKE 9 → null, 10 → 10(D9 임계)', async () => {
    const nine = await seeded(9);
    expect((await request(nine.app).get('/api/reactions/counts?targetType=PRODUCT&ids=cp-wheel-01,cp-x')).body).toEqual({
      counts: { 'cp-wheel-01': null, 'cp-x': null },
    });
    const ten = await seeded(10);
    expect((await request(ten.app).get('/api/reactions/counts?targetType=PRODUCT&ids=cp-wheel-01')).body).toEqual({
      counts: { 'cp-wheel-01': 10 },
    });
  });
  it('HELPFUL·RECHECK 수는 비공개 — PRODUCT 외 targetType 400', async () => {
    const { app } = appWith();
    for (const t of ['SUPPLY_ITEM', 'BUNDLE', '']) {
      expect((await request(app).get(`/api/reactions/counts?targetType=${t}&ids=cage`)).status).toBe(400);
    }
  });
  it('ids 0·21개·형식 위반 → 400, 20개 → 200', async () => {
    const { app } = appWith();
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `p-${i}`).join(',');
    expect((await request(app).get('/api/reactions/counts?targetType=PRODUCT')).status).toBe(400);
    expect((await request(app).get(`/api/reactions/counts?targetType=PRODUCT&ids=${ids(21)}`)).status).toBe(400);
    expect((await request(app).get('/api/reactions/counts?targetType=PRODUCT&ids=A,b')).status).toBe(400);
    expect((await request(app).get(`/api/reactions/counts?targetType=PRODUCT&ids=${ids(20)}`)).status).toBe(200);
  });
});

describe('import 그래프(불변식 ③): 노출·정렬 경로는 reaction/ 을 모른다', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
  const files = [...walk(join(SRC, 'engine')), ...walk(join(SRC, 'prerender')), ...walk(join(SRC, 'seed'))];
  it.each(files.map((f) => relative(SRC, f)))('%s 는 reaction 을 import 하지 않는다', (rel) => {
    const src = readFileSync(join(SRC, rel), 'utf8');
    expect(src).not.toMatch(/from\s+['"][^'"]*reaction[^'"]*['"]/);
    expect(src).not.toMatch(/import\s*\(\s*['"][^'"]*reaction/);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/likeCount|ReactionSignal|reactionSignal/);
  });
});

describe('PrismaReactionRepository(stub 클라이언트, DB 없음)', () => {
  it('add = 복합 유니크 upsert(update 없음), existsAny = findFirst IN, removeAny = deleteMany IN(500개씩), count = groupBy → 0 채움', async () => {
    const { PrismaReactionRepository } = await import('../reaction/reaction.prisma.repo.js');
    const calls: Array<[string, unknown]> = [];
    const stub = {
      reactionSignal: {
        upsert: async (a: unknown) => void calls.push(['upsert', a]),
        findFirst: async (a: unknown) => {
          calls.push(['findFirst', a]);
          return null;
        },
        deleteMany: async (a: unknown) => void calls.push(['deleteMany', a]),
        groupBy: async (a: unknown) => {
          calls.push(['groupBy', a]);
          return [{ targetId: 'p-1', _count: { _all: 12 } }, { targetId: 'not-asked', _count: { _all: 99 } }];
        },
      },
    };
    const repo = new PrismaReactionRepository(stub as never);
    const ref = { targetType: 'PRODUCT', targetId: 'p-1', kind: 'LIKE' } as const;
    await repo.add({ anonKey: 'k', ...ref, id: 'i', createdAt: '2026-10-02T00:00:00.000Z' });
    expect(calls[0]).toEqual([
      'upsert',
      {
        where: { anonKey_targetType_targetId_kind: { anonKey: 'k', targetType: 'PRODUCT', targetId: 'p-1', kind: 'LIKE' } },
        create: { id: 'i', anonKey: 'k', targetType: 'PRODUCT', targetId: 'p-1', kind: 'LIKE', createdAt: '2026-10-02T00:00:00.000Z' },
        update: {},
      },
    ]);
    const keys = Array.from({ length: 600 }, (_, i) => `k${i}`);
    calls.length = 0;
    expect(await repo.existsAny(keys, ref)).toBe(false);
    expect(calls.map((c) => c[0])).toEqual(['findFirst', 'findFirst']);
    expect(calls[0][1]).toMatchObject({ where: { anonKey: { in: keys.slice(0, 500) }, ...ref } });
    calls.length = 0;
    await repo.removeAny(keys, ref);
    expect(calls).toEqual([
      ['deleteMany', { where: { anonKey: { in: keys.slice(0, 500) }, ...ref } }],
      ['deleteMany', { where: { anonKey: { in: keys.slice(500) }, ...ref } }],
    ]);
    expect(await repo.count('PRODUCT', 'LIKE', ['p-1', 'p-2'])).toEqual({ 'p-1': 12, 'p-2': 0 });
  });
});
