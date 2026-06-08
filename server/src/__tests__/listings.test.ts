import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// 앱 import 전 JWT 시크릿 주입(createApp 이 auth 라우터를 함께 구성하므로 필요).
// 하드코딩 운영 시크릿 사용 금지 — 변수 경유로 테스트 더미만 주입.
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp();
});

describe('읽기 전용 보드 엔드포인트', () => {
  it('GET /api/agents → 200 + 배열 shape(대행자 계약 필드)', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const first = res.body[0];
    expect(typeof first.id).toBe('string');
    expect(['개인', '전문']).toContain(first.status);
    expect(typeof first.activeRegion).toBe('string');
    expect(typeof first.scheduleText).toBe('string');
    expect(typeof first.reputation).toBe('number');
  });

  it('GET /api/requests → 200 + 배열 shape(역경매 요청 계약 필드)', async () => {
    const res = await request(app).get('/api/requests');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const first = res.body[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.item).toBe('string');
    expect(typeof first.hopePrice).toBe('number');
    expect(typeof first.deadline).toBe('string');
    expect(typeof first.region).toBe('string');
    expect(typeof first.status).toBe('string');
  });

  it('GET /api/discounts → 200 + 배열 shape(할인소식 계약 필드)', async () => {
    const res = await request(app).get('/api/discounts');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const first = res.body[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.storeBrand).toBe('string');
    expect(typeof first.source).toBe('string');
    expect(typeof first.createdAt).toBe('string');
    expect(typeof first.unverifiedBase).toBe('boolean');
  });
});

describe('?region= 필터', () => {
  it('?region=여주 → 전체의 부분집합이며 모두 해당 지역', async () => {
    const all = await request(app).get('/api/agents');
    const yeoju = await request(app).get('/api/agents').query({ region: '여주' });
    expect(yeoju.status).toBe(200);
    expect(yeoju.body.length).toBeGreaterThan(0);
    expect(yeoju.body.length).toBeLessThan(all.body.length);
    for (const agent of yeoju.body) {
      expect(agent.activeRegion).toBe('여주');
    }
  });

  it('?region=여주 (requests) → 모두 해당 지역', async () => {
    const yeoju = await request(app).get('/api/requests').query({ region: '여주' });
    expect(yeoju.status).toBe(200);
    expect(yeoju.body.length).toBeGreaterThan(0);
    for (const reqItem of yeoju.body) {
      expect(reqItem.region).toBe('여주');
    }
  });

  it('미일치 region → 빈 배열(agents)', async () => {
    const res = await request(app).get('/api/agents').query({ region: '존재하지않는지역' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('미일치 region → 빈 배열(requests)', async () => {
    const res = await request(app).get('/api/requests').query({ region: '존재하지않는지역' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('등록 요청이 GET /api/requests 에 병합 노출', () => {
  async function tokenFor(email: string, role: string): Promise<string> {
    const reg = await request(app).post('/auth/register').send({ email, password: 'pw-12345', role });
    return reg.body.accessToken as string;
  }

  it('구매자 작성 요청이 보드 목록에 포함되며 ownerUserId 는 없다', async () => {
    const token = await tokenFor('req-merge@example.com', '구매자');
    const created = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        item: '병합테스트 품목',
        hopePrice: 12345,
        deadline: '2026-07-01',
        region: '병합요청지역',
      });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/requests');
    expect(list.status).toBe(200);
    const found = list.body.find((r: { id: string }) => r.id === created.body.id);
    expect(found).toBeTruthy();
    expect(found.item).toBe('병합테스트 품목');
    expect(found.ownerUserId).toBeUndefined();

    // region 필터도 병합분에 적용된다.
    const filtered = await request(app).get('/api/requests').query({ region: '병합요청지역' });
    expect(filtered.body.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
  });
});

describe('할인소식 서버 스탬프 규칙', () => {
  it('정가(listPrice) 미입력 건은 unverifiedBase=true 로 스탬프된다', async () => {
    const res = await request(app).get('/api/discounts');
    expect(res.status).toBe(200);
    const missing = res.body.filter(
      (d: { listPrice?: number }) => d.listPrice === undefined,
    );
    const present = res.body.filter(
      (d: { listPrice?: number }) => d.listPrice !== undefined,
    );
    expect(missing.length).toBeGreaterThan(0);
    for (const d of missing) {
      expect(d.unverifiedBase).toBe(true);
    }
    for (const d of present) {
      expect(d.unverifiedBase).toBe(false);
    }
  });
});
