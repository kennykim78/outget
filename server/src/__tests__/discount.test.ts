import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { createDiscountRouter } from '../board/discount.routes.js';
import { InMemoryDiscountRepository } from '../board/discount.repo.js';
import type { ShoppingPriceRail } from '../shopping/shopping.port.js';
import type { ShoppingPriceResult } from '../shopping/shopping.types.js';

// 앱 import 전 JWT 시크릿 주입(변수 경유 더미만 — 하드코딩 운영 시크릿 금지).
const ACCESS_SECRET = 'test-access-secret-do-not-use-in-prod';
const REFRESH_SECRET = 'test-refresh-secret-do-not-use-in-prod';
process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../app.js');
  app = createApp();
});

async function tokenFor(email: string, role: string): Promise<string> {
  const reg = await request(app)
    .post('/auth/register')
    .send({ email, password: 'pw-12345', role });
  return reg.body.accessToken as string;
}

const validInput = {
  storeBrand: '나이키 팩토리',
  discountRate: 40,
  discountPrice: 78000,
  listPrice: 130000,
  source: '현장 가격표',
};

describe('POST /api/discounts (할인소식 작성)', () => {
  it('비인가 → 401', async () => {
    const res = await request(app).post('/api/discounts').send(validInput);
    expect(res.status).toBe(401);
  });

  it('구매자 토큰 → 403(역할 불일치)', async () => {
    const token = await tokenFor('disc-buyer@example.com', '구매자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send(validInput);
    expect(res.status).toBe(403);
  });

  it('소식알림자 작성 → 201, authorId·status 미노출', async () => {
    const token = await tokenFor('disc-news@example.com', '소식알림자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validInput, status: '삭제' }); // status 는 무시되어야 함
    expect(res.status).toBe(201);
    expect(res.body.storeBrand).toBe('나이키 팩토리');
    expect(res.body.id).toBeTypeOf('string');
    expect(res.body.unverifiedBase).toBe(false);
    expect(res.body.authorId).toBeUndefined();
    expect(res.body.status).toBeUndefined();
  });

  it('대행자도 작성 가능 → 201', async () => {
    const token = await tokenFor('disc-agent@example.com', '전문대행자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send(validInput);
    expect(res.status).toBe(201);
  });

  it('storeBrand 누락 → 400', async () => {
    const token = await tokenFor('disc-bad@example.com', '소식알림자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ source: '제보' });
    expect(res.status).toBe(400);
  });

  it('정가(listPrice) 미입력 → unverifiedBase=true 서버 강제(클라가 false 로 못 덮음)', async () => {
    const token = await tokenFor('disc-unverified@example.com', '소식알림자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      // 클라가 unverifiedBase=false 를 보내도 서버가 무시하고 true 로 강제해야 한다.
      .send({ storeBrand: '아디다스', discountRate: 30, source: '제보', unverifiedBase: false });
    expect(res.status).toBe(201);
    expect(res.body.unverifiedBase).toBe(true);
  });
});

// 참고가 스탬프 흐름은 mock ShoppingPriceRail 로 검증한다.
//   createApp() 은 test env(키 없음)에서 Noop 을 쓰므로, 스탬프 성공 경로는 라우터를
//   직접 마운트해 mock port 를 주입한다(실제 외부 호출 0 — naver 어댑터 미사용).
function appWithPort(port: ShoppingPriceRail): Express {
  const a = express();
  a.use(express.json());
  a.use('/api', createDiscountRouter(new InMemoryDiscountRepository(), port));
  return a;
}

class StubPort implements ShoppingPriceRail {
  constructor(private readonly result: ShoppingPriceResult | null) {}
  async lookupLowest(query: string): Promise<ShoppingPriceResult | null> {
    void query;
    return this.result;
  }
}

describe('네이버쇼핑 참고가(referenceQuery) 흐름', () => {
  it('referenceQuery + port 성공 → 참고가 4필드 서버 스탬프(201)', async () => {
    const fetchedAt = new Date().toISOString();
    const a = appWithPort(new StubPort({ price: 99000, fetchedAt }));
    const token = await tokenFor('disc-ref-ok@example.com', '소식알림자');
    const res = await request(a)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '나이키', source: '제보', referenceQuery: '나이키 운동화' });
    expect(res.status).toBe(201);
    expect(res.body.referencePrice).toBe(99000);
    expect(res.body.referenceSource).toBe('네이버쇼핑');
    expect(res.body.referenceQuery).toBe('나이키 운동화');
    expect(res.body.referenceFetchedAt).toBe(fetchedAt);
  });

  it('referenceQuery + port null(폴백) → 참고가 4필드 전부 미스탬프(201)', async () => {
    const a = appWithPort(new StubPort(null));
    const token = await tokenFor('disc-ref-null@example.com', '소식알림자');
    const res = await request(a)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '아디다스', source: '제보', referenceQuery: '없는상품' });
    expect(res.status).toBe(201);
    expect(res.body.referencePrice).toBeUndefined();
    expect(res.body.referenceSource).toBeUndefined();
    expect(res.body.referenceQuery).toBeUndefined();
    expect(res.body.referenceFetchedAt).toBeUndefined();
  });

  it('referenceQuery 미전송 → 참고가 미스탬프(201)', async () => {
    const a = appWithPort(new StubPort({ price: 1, fetchedAt: new Date().toISOString() }));
    const token = await tokenFor('disc-ref-absent@example.com', '소식알림자');
    const res = await request(a)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '브랜드', source: '제보' });
    expect(res.status).toBe(201);
    expect(res.body.referencePrice).toBeUndefined();
    expect(res.body.referenceSource).toBeUndefined();
  });

  it('클라가 referencePrice 직접 주입 시도 → 400(서버 권위 위반)', async () => {
    const token = await tokenFor('disc-ref-inject@example.com', '소식알림자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '브랜드', source: '제보', referencePrice: 1 });
    expect(res.status).toBe(400);
  });

  it('클라가 referenceSource/FetchedAt 주입 시도 → 400', async () => {
    const token = await tokenFor('disc-ref-inject2@example.com', '소식알림자');
    const a = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '브랜드', source: '제보', referenceSource: '네이버쇼핑' });
    expect(a.status).toBe(400);
    const b = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '브랜드', source: '제보', referenceFetchedAt: '2026-01-01T00:00:00Z' });
    expect(b.status).toBe(400);
  });
});

describe('GET /api/discounts/me', () => {
  it('비인가 → 401', async () => {
    const res = await request(app).get('/api/discounts/me');
    expect(res.status).toBe(401);
  });

  it('자신이 쓴 것만 본다(authorId·status 미노출)', async () => {
    const a = await tokenFor('disc-me-a@example.com', '소식알림자');
    const b = await tokenFor('disc-me-b@example.com', '소식알림자');
    await request(app).post('/api/discounts').set('Authorization', `Bearer ${a}`).send(validInput);
    await request(app).post('/api/discounts').set('Authorization', `Bearer ${b}`).send(validInput);

    const res = await request(app).get('/api/discounts/me').set('Authorization', `Bearer ${a}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    for (const d of res.body) {
      expect(d.authorId).toBeUndefined();
      expect(d.status).toBeUndefined();
    }
  });
});

describe('등록 할인소식이 GET /api/discounts 에 병합 노출', () => {
  it('작성한 할인소식이 보드 목록에 포함되며 authorId·status 는 없다', async () => {
    const token = await tokenFor('disc-merge@example.com', '소식알림자');
    const created = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '병합브랜드테스트', discountRate: 25, source: '제보' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/discounts');
    expect(list.status).toBe(200);
    const found = list.body.find((d: { id: string }) => d.id === created.body.id);
    expect(found).toBeTruthy();
    expect(found.storeBrand).toBe('병합브랜드테스트');
    expect(found.authorId).toBeUndefined();
    expect(found.status).toBeUndefined();
  });
});
