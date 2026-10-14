// 이벤트 수집(PRD US-018) — 계약 C-3. event-contract(순수, 클라이언트 공용) + POST /api/events.
//   불변식 ⑤⑧: 좌표·이메일·전화·IP·UA 는 props 에도 저장소에도 들어가지 않는다.
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import { InMemoryEventRepository, type EventRow } from '../analytics/event.repo.js';
import { PrismaEventRepository } from '../analytics/event.prisma.repo.js';
import { makeEventsLimiter, makeEventsRoutes, toEventRows } from '../analytics/events.routes.js';
import {
  EVENT_NAMES,
  EVENT_PROP_SPECS,
  FORBIDDEN_PROP_KEYS,
  MAX_BATCH,
  MAX_PROPS_BYTES,
  QUERY_MAX_LEN,
  sanitizeQuery,
  utf8ByteLength,
  validateBatch,
  validateEvent,
} from '../shared/event-contract.js';
import {
  ANIMAL_GROUPS,
  BUNDLE_TIERS,
  PRIORITIES,
  REACTION_TARGETS,
  VERDICTS,
} from '../engine/domain.js';

const SK = '3f2b8c1e-9a4d-4c7e-8f10-2b3c4d5e6f70';
const TS = 1_790_000_000_000; // 2026-09 근처

function ev(name: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { name, ts: TS, sessionKey: SK, props, ...extra };
}

// 13종 각각의 유효 예시(PRD 원문 props).
const VALID: Record<string, Record<string, unknown>> = {
  species_selected: { animalTypeId: 'hamster-golden', group: 'SMALL_MAMMAL', via: 'picker' },
  unknown_species_clicked: { query: '페럿' },
  setup_started: { animalTypeId: 'hamster-golden', firstTime: true, ownedCount: 2 },
  item_checked: {
    animalTypeId: 'hamster-golden',
    supplyItemId: 'cage',
    priority: 'REQUIRED',
    readySource: 'OWNED',
  },
  item_unchecked: {
    animalTypeId: 'hamster-golden',
    supplyItemId: 'wheel',
    priority: 'RECOMMENDED',
    readySource: 'UNKNOWN',
  },
  setup_100_reached: { animalTypeId: 'hamster-golden', elapsedSec: 600 },
  bundle_viewed: { animalTypeId: 'hamster-golden', tier: 'BALANCED' },
  spec_checker_used: { animalTypeId: 'hamster-golden', supplyItemId: 'cage', verdict: 'CHECK' },
  compatibility_checked: { animalTypeId: 'hamster-golden', ruleId: 'cr-wheel-cage', verdict: 'OK' },
  external_product_clicked: { animalTypeId: 'hamster-golden', supplyItemId: 'cage', merchant: 'NAVER' },
  vet_clicked: { clinicId: 'vc-mapo-01', action: 'call' },
  reaction_helpful: { targetType: 'SUPPLY_ITEM', targetId: 'cage' },
  reaction_recheck: { targetType: 'GUIDE', targetId: 'cp-001' },
  save_prompt_view: { entry: 'home_band' },
  save_email_submit: {},
  save_link_confirm: {},
  save_merge: { winner: 'mixed' },
  product_viewed: { productId: 'cp-wheel-01', supplyItemId: 'wheel' },
  reaction_like: { productId: 'cp-wheel-01' },
};

describe('event-contract — 이름(PRD US-018 원문 13종)', () => {
  it('EVENT_NAMES 는 PRD 목록과 정확히 같다', () => {
    expect([...EVENT_NAMES]).toEqual([
      'species_selected',
      'unknown_species_clicked',
      'setup_started',
      'item_checked',
      'item_unchecked',
      'setup_100_reached',
      'bundle_viewed',
      'spec_checker_used',
      'compatibility_checked',
      'external_product_clicked',
      'vet_clicked',
      'reaction_helpful',
      'reaction_recheck',
      // R5 C-R5-7(D18): US-025 저장 4종 + US-022 상품·♥ 2종
      'save_prompt_view',
      'save_email_submit',
      'save_link_confirm',
      'save_merge',
      'product_viewed',
      'reaction_like',
    ]);
    expect(EVENT_NAMES.length).toBe(19);
    expect(Object.keys(EVENT_PROP_SPECS).sort()).toEqual([...EVENT_NAMES].sort());
  });

  it.each(Object.keys(VALID))('%s 유효 예시 통과', (name) => {
    const r = validateEvent(ev(name, VALID[name]));
    expect(r).toMatchObject({ ok: true });
  });

  it('13종 외 이름 거부', () => {
    expect(validateEvent(ev('page_view', {}))).toEqual({ ok: false, error: 'unknown_name' });
    expect(validateEvent(ev('helpful_clicked', {}))).toEqual({ ok: false, error: 'unknown_name' });
    expect(validateEvent(ev('__proto__', {}))).toEqual({ ok: false, error: 'unknown_name' });
    expect(validateEvent(ev('toString', {}))).toEqual({ ok: false, error: 'unknown_name' });
  });
});

describe('event-contract — R5 +6(C-R5-7)', () => {
  it('save_prompt_view.entry 는 진입점 3종만(스펙33 §5.9)', () => {
    for (const entry of ['home_band', 'l2_footer', 'deeplink']) {
      expect(validateEvent(ev('save_prompt_view', { entry }))).toMatchObject({ ok: true });
    }
    expect(validateEvent(ev('save_prompt_view', { entry: 'popup' }))).toEqual({ ok: false, error: 'bad_prop_value' });
    expect(validateEvent(ev('save_prompt_view', {}))).toEqual({ ok: false, error: 'missing_prop' });
  });
  it('save_merge.winner 는 local·server·mixed·none 만', () => {
    for (const winner of ['local', 'server', 'mixed', 'none']) {
      expect(validateEvent(ev('save_merge', { winner }))).toMatchObject({ ok: true });
    }
    expect(validateEvent(ev('save_merge', { winner: 'tie' }))).toEqual({ ok: false, error: 'bad_prop_value' });
  });
  it('save_email_submit·save_link_confirm 은 props 없음 — email·token 등 어떤 키도 거부(불변식 ⑧)', () => {
    for (const name of ['save_email_submit', 'save_link_confirm']) {
      expect(validateEvent(ev(name, { email: 'a@b.co' }))).toEqual({ ok: false, error: 'unknown_prop' });
      expect(validateEvent(ev(name, { token: 'abc' }))).toEqual({ ok: false, error: 'unknown_prop' });
      expect(validateEvent(ev(name, {}))).toMatchObject({ ok: true, event: { props: {} } });
    }
  });
  it('product_viewed·reaction_like — productId slug, 이메일 모양 값 거부', () => {
    expect(validateEvent(ev('product_viewed', { productId: 'cp-wheel-01' }))).toEqual({ ok: false, error: 'missing_prop' });
    expect(validateEvent(ev('reaction_like', { productId: 'A B' }))).toEqual({ ok: false, error: 'bad_prop_value' });
    expect(validateEvent(ev('reaction_like', { productId: 'x@y.kr' }))).toEqual({ ok: false, error: 'pii_pattern' });
    expect(validateEvent(ev('reaction_like', { productId: 'cp-1', likeCount: 3 }))).toEqual({ ok: false, error: 'unknown_prop' });
  });
});

describe('event-contract — props 허용목록', () => {
  it('허용목록 외 키 거부', () => {
    const r = validateEvent(ev('vet_clicked', { ...VALID.vet_clicked, extra: 'x' }));
    expect(r).toEqual({ ok: false, error: 'unknown_prop' });
  });

  it('필수 키 누락 거부', () => {
    expect(validateEvent(ev('vet_clicked', { clinicId: 'vc-mapo-01' }))).toEqual({
      ok: false,
      error: 'missing_prop',
    });
  });

  it('값 형식 위반 거부(enum·int·bool·slug)', () => {
    const bad = [
      ev('species_selected', { ...VALID.species_selected, via: 'search' }),
      ev('setup_started', { ...VALID.setup_started, ownedCount: -1 }),
      ev('setup_started', { ...VALID.setup_started, ownedCount: 1.5 }),
      ev('setup_started', { ...VALID.setup_started, firstTime: 'yes' }),
      ev('item_checked', { ...VALID.item_checked, supplyItemId: 'Cage Big' }),
      ev('item_checked', { ...VALID.item_checked, readySource: 'BOUGHT' }),
      ev('vet_clicked', { clinicId: { nested: 1 }, action: 'call' }),
    ];
    for (const b of bad) expect(validateEvent(b)).toEqual({ ok: false, error: 'bad_prop_value' });
  });

  it('금지 키(lat/lng/coords/email/phone/ip/ua)는 어떤 이벤트의 허용목록에도 없고 거부된다', () => {
    for (const k of ['lat', 'lng', 'latitude', 'longitude', 'coords', 'email', 'phone', 'ip', 'ua', 'userAgent']) {
      expect(FORBIDDEN_PROP_KEYS).toContain(k);
    }
    for (const name of EVENT_NAMES) {
      const keys = Object.keys(EVENT_PROP_SPECS[name]).map((k) => k.toLowerCase());
      for (const f of FORBIDDEN_PROP_KEYS) expect(keys, `${name}.${f}`).not.toContain(f.toLowerCase());
    }
    for (const k of FORBIDDEN_PROP_KEYS) {
      const r = validateEvent(ev('vet_clicked', { ...VALID.vet_clicked, [k]: 'x' }));
      expect(r.ok, k).toBe(false);
    }
  });

  it('이메일·전화 패턴 값 거부(slug 형식을 통과하는 전화번호 포함)', () => {
    expect(validateEvent(ev('vet_clicked', { clinicId: '010-1234-5678', action: 'call' }))).toEqual({
      ok: false,
      error: 'pii_pattern',
    });
    expect(validateEvent(ev('vet_clicked', { clinicId: '01012345678', action: 'call' }))).toEqual({
      ok: false,
      error: 'pii_pattern',
    });
    expect(validateEvent(ev('reaction_helpful', { targetType: 'GUIDE', targetId: 'a@b.co' })).ok).toBe(false);
    expect(validateEvent(ev('unknown_species_clicked', { query: 'me@example.com' })).ok).toBe(false);
  });

  it(`props > ${MAX_PROPS_BYTES}B 거부(UTF-8 바이트 기준)`, () => {
    const r = validateEvent(ev('vet_clicked', { ...VALID.vet_clicked, pad: '가'.repeat(400) }));
    expect(r).toEqual({ ok: false, error: 'props_too_large' });
    expect(utf8ByteLength('가')).toBe(3);
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('props 는 평범한 객체여야 한다(배열·null 거부)', () => {
    expect(validateEvent(ev('vet_clicked', [] as unknown as Record<string, unknown>)).ok).toBe(false);
    expect(validateEvent({ name: 'vet_clicked', ts: TS, sessionKey: SK, props: null }).ok).toBe(false);
  });

  it('enum 값은 엔진 domain 과 동기(단일 의미)', () => {
    const enumOf = (name: string, key: string) => {
      const s = (EVENT_PROP_SPECS as Record<string, Record<string, { kind: string; values?: readonly string[] }>>)[
        name
      ][key];
      expect(s.kind).toBe('enum');
      return [...(s.values ?? [])];
    };
    expect(enumOf('species_selected', 'group')).toEqual([...ANIMAL_GROUPS]);
    expect(enumOf('item_checked', 'priority')).toEqual([...PRIORITIES]);
    expect(enumOf('bundle_viewed', 'tier')).toEqual([...BUNDLE_TIERS]);
    expect(enumOf('reaction_helpful', 'targetType')).toEqual([...REACTION_TARGETS]);
    expect(enumOf('spec_checker_used', 'verdict')).toEqual([...VERDICTS, 'NONE']);
  });
});

describe('event-contract — 봉투(name, ts, animalTypeId?, props, sessionKey)', () => {
  it('봉투 외 필드 거부(ip·ua·headers 등)', () => {
    for (const k of ['ip', 'ua', 'userAgent', 'headers', 'lat']) {
      expect(validateEvent(ev('vet_clicked', VALID.vet_clicked, { [k]: 'x' }))).toEqual({
        ok: false,
        error: 'unknown_field',
      });
    }
  });

  it('ts 는 정수 epoch ms, sessionKey 는 UUID', () => {
    expect(validateEvent(ev('vet_clicked', VALID.vet_clicked, { ts: 'now' }))).toEqual({ ok: false, error: 'bad_ts' });
    expect(validateEvent(ev('vet_clicked', VALID.vet_clicked, { ts: 12 }))).toEqual({ ok: false, error: 'bad_ts' });
    expect(validateEvent(ev('vet_clicked', VALID.vet_clicked, { ts: Number.NaN }))).toEqual({
      ok: false,
      error: 'bad_ts',
    });
    expect(validateEvent(ev('vet_clicked', VALID.vet_clicked, { sessionKey: 'me@example.com' }))).toEqual({
      ok: false,
      error: 'bad_session_key',
    });
  });

  it('animalTypeId 봉투값과 props 값이 다르면 거부, 하나만 있으면 정규화', () => {
    expect(
      validateEvent(ev('bundle_viewed', VALID.bundle_viewed, { animalTypeId: 'budgie' })),
    ).toEqual({ ok: false, error: 'animal_type_mismatch' });
    const r = validateEvent(ev('bundle_viewed', VALID.bundle_viewed));
    expect(r.ok && r.event.animalTypeId).toBe('hamster-golden');
    const v = validateEvent(ev('vet_clicked', VALID.vet_clicked, { animalTypeId: 'hamster-golden' }));
    expect(v.ok && v.event.animalTypeId).toBe('hamster-golden');
    const n = validateEvent(ev('vet_clicked', VALID.vet_clicked));
    expect(n.ok && n.event.animalTypeId).toBeUndefined();
    expect(validateEvent(ev('vet_clicked', VALID.vet_clicked, { animalTypeId: 'Bad Id' }))).toEqual({
      ok: false,
      error: 'bad_animal_type',
    });
  });

  it('통과한 이벤트는 허용 필드만 복사한다(원본 참조 공유 없음)', () => {
    const input = ev('vet_clicked', { ...VALID.vet_clicked });
    const r = validateEvent(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.event).sort()).toEqual(['name', 'props', 'sessionKey', 'ts']);
    expect(r.event.props).not.toBe(input.props);
  });
});

describe('sanitizeQuery', () => {
  it(`[가-힣a-zA-Z ]만, 공백 정리, ${QUERY_MAX_LEN}자`, () => {
    expect(sanitizeQuery('  페럿!! 010-1234-5678 ')).toBe('페럿');
    expect(sanitizeQuery('me@example.com')).toBe('meexamplecom');
    expect(sanitizeQuery('Sugar   Glider')).toBe('Sugar Glider');
    expect(sanitizeQuery('가'.repeat(30))).toHaveLength(QUERY_MAX_LEN);
    expect(sanitizeQuery(42)).toBe('');
    expect(sanitizeQuery(null)).toBe('');
  });

  it('query 는 이미 정제된 값만 수용(정제 전 값 거부)', () => {
    expect(validateEvent(ev('unknown_species_clicked', { query: '페럿!' })).ok).toBe(false);
    expect(validateEvent(ev('unknown_species_clicked', { query: '' })).ok).toBe(false);
    expect(validateEvent(ev('unknown_species_clicked', { query: '가'.repeat(21) })).ok).toBe(false);
  });
});

describe('validateBatch', () => {
  it(`{events: [...]} 1~${MAX_BATCH}건`, () => {
    const one = ev('vet_clicked', VALID.vet_clicked);
    expect(validateBatch({ events: [one] })).toMatchObject({ ok: true });
    expect(validateBatch({ events: Array.from({ length: MAX_BATCH }, () => one) })).toMatchObject({ ok: true });
    expect(validateBatch({ events: Array.from({ length: MAX_BATCH + 1 }, () => one) })).toEqual({
      ok: false,
      error: 'batch_too_large',
    });
    expect(validateBatch({ events: [] })).toEqual({ ok: false, error: 'batch_empty' });
    expect(validateBatch([one])).toEqual({ ok: false, error: 'bad_batch' });
    expect(validateBatch({ events: [one], extra: 1 })).toEqual({ ok: false, error: 'bad_batch' });
  });

  it('하나라도 무효면 전체 거부 + index', () => {
    const one = ev('vet_clicked', VALID.vet_clicked);
    expect(validateBatch({ events: [one, ev('nope', {})] })).toEqual({
      ok: false,
      error: 'unknown_name',
      index: 1,
    });
  });
});

// ─────────────────────────────────────────────────────────────
// B2 — POST /api/events (EventLog, IP·UA 없음, rate-limit, sendBeacon text/plain)
// ─────────────────────────────────────────────────────────────
const ROW_KEYS = ['animalTypeId', 'id', 'name', 'props', 'receivedDate', 'sessionKey', 'ts'];

function setup() {
  const repos = makeInMemoryRepos();
  const app = createApp(repos);
  return { app, store: repos.event as InMemoryEventRepository };
}

const batch = (events: unknown[]) => ({ events });
const valid = (name = 'vet_clicked') => ev(name, VALID[name]);

describe('POST /api/events', () => {
  it('유효 배치(application/json) → 204, 행 수 일치, 행 필드는 계약 C-3 만', async () => {
    const { app, store } = setup();
    const body = batch([valid('species_selected'), valid('setup_started'), valid('vet_clicked')]);
    const res = await request(app)
      .post('/api/events')
      .set('User-Agent', 'Mozilla/5.0 test-agent')
      .set('X-Forwarded-For', '203.0.113.7')
      .send(body);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const rows = store.all();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(ROW_KEYS);
      expect(r.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.ts).toBe(new Date(TS).toISOString());
      expect(r.id).toMatch(/^evt-/);
      const dump = JSON.stringify(r);
      expect(dump).not.toContain('203.0.113.7');
      expect(dump).not.toContain('Mozilla');
      expect(dump).not.toContain('test-agent');
    }
    expect(rows[0].animalTypeId).toBe('hamster-golden');
    expect(rows[2].animalTypeId).toBeNull();
    expect(JSON.parse(rows[1].props)).toEqual(VALID.setup_started);
  });

  it('sendBeacon(text/plain;charset=UTF-8) 수용 → 204', async () => {
    const { app, store } = setup();
    const res = await request(app)
      .post('/api/events')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify(batch([valid('bundle_viewed'), valid('unknown_species_clicked')])));
    expect(res.status).toBe(204);
    expect(store.all().map((r) => r.name)).toEqual(['bundle_viewed', 'unknown_species_clicked']);
  });

  it('잘못된 이름·키·크기 → 400, 아무것도 저장하지 않음(전체 거부)', async () => {
    const { app, store } = setup();
    const cases: Array<[object, string]> = [
      [batch([valid(), ev('page_view', {})]), 'unknown_name'],
      [batch([ev('vet_clicked', { ...VALID.vet_clicked, lat: 37.5 })]), 'unknown_prop'],
      [batch([ev('vet_clicked', { ...VALID.vet_clicked, pad: '가'.repeat(400) })]), 'props_too_large'],
      [batch([ev('vet_clicked', VALID.vet_clicked, { ip: '203.0.113.7' })]), 'unknown_field'],
      [batch(Array.from({ length: MAX_BATCH + 1 }, () => valid())), 'batch_too_large'],
      [batch([]), 'batch_empty'],
      [{ events: 'x' }, 'bad_batch'],
    ];
    for (const [body, error] of cases) {
      const res = await request(app).post('/api/events').send(body);
      expect(res.status, error).toBe(400);
      expect(res.body.error).toBe(error);
    }
    expect(store.all()).toHaveLength(0);
  });

  it('JSON 아님 → 400, 본문 > 16KB → 413, 지원 안 하는 타입 → 415', async () => {
    const { app, store } = setup();
    const bad = await request(app).post('/api/events').set('Content-Type', 'text/plain').send('{not json');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('bad_json');

    const big = JSON.stringify({ events: [valid()], pad: 'x'.repeat(17 * 1024) });
    const tooBig = await request(app).post('/api/events').set('Content-Type', 'text/plain').send(big);
    expect(tooBig.status).toBe(413);
    const tooBigJson = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/json')
      .send(big);
    expect(tooBigJson.status).toBe(413);

    const form = await request(app)
      .post('/api/events')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('name=vet_clicked');
    expect(form.status).toBe(415);
    const none = await request(app).post('/api/events');
    expect(none.status).toBe(415);
    expect(store.all()).toHaveLength(0);
  });

  it('읽기 경로 없음(GET → 404)', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/events')).status).toBe(404);
  });

  it('레이트 초과 → 429', async () => {
    const store = new InMemoryEventRepository();
    const app = express();
    app.use('/api/events', makeEventsRoutes(store, { limiter: makeEventsLimiter({ limit: 2, windowMs: 60_000 }) }));
    const send = () => request(app).post('/api/events').send(batch([valid()]));
    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(204);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.body.error).toBe('rate_limited');
    expect(store.all()).toHaveLength(2);
  });

  it('저장소 실패 → 500(본문에 상세 없음)', async () => {
    const app = express();
    app.use(
      '/api/events',
      makeEventsRoutes({
        append: async () => {
          throw new Error('db down at /secret/path');
        },
      }),
    );
    const res = await request(app).post('/api/events').send(batch([valid()]));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('toEventRows', () => {
  it('receivedDate 는 Asia/Seoul 일자, ts 는 ISO', () => {
    const r = validateEvent(valid());
    if (!r.ok) throw new Error('fixture');
    // 2026-10-01T15:30Z = 2026-10-02 00:30 KST
    const [row] = toEventRows([r.event], new Date('2026-10-01T15:30:00Z'), () => 'evt-1');
    expect(row).toEqual({
      id: 'evt-1',
      name: 'vet_clicked',
      ts: new Date(TS).toISOString(),
      animalTypeId: null,
      props: JSON.stringify(VALID.vet_clicked),
      sessionKey: SK,
      receivedDate: '2026-10-02',
    });
  });
});

describe('PrismaEventRepository', () => {
  it('createMany 에 EventRow 필드만 전달', async () => {
    const calls: Array<{ data: EventRow[] }> = [];
    const prisma = {
      eventLog: {
        createMany: async (args: { data: EventRow[] }) => {
          calls.push(args);
          return { count: args.data.length };
        },
      },
    } as unknown as PrismaClient;
    const repo = new PrismaEventRepository(prisma);
    const rows: EventRow[] = [
      {
        id: 'evt-1',
        name: 'vet_clicked',
        ts: '2026-10-01T00:00:00.000Z',
        animalTypeId: null,
        props: '{}',
        sessionKey: SK,
        receivedDate: '2026-10-01',
      },
    ];
    expect(await repo.append(rows)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0].data[0]).sort()).toEqual(ROW_KEYS);
  });
});

describe('POST /api/events — 경로 대소문자·후행 슬래시', () => {
  it('/API/Events/ 도 같은 파서·검증 경로(application/json) → 204', async () => {
    const { app, store } = setup();
    const res = await request(app).post('/API/Events/').send(batch([valid()]));
    expect(res.status).toBe(204);
    expect(store.all()).toHaveLength(1);
  });
});
