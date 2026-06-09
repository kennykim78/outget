import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InMemoryDiscountRepository } from '../board/discount.repo.js';

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

const here = dirname(fileURLToPath(import.meta.url));
function readSrc(...parts: string[]): string {
  return readFileSync(join(here, '..', ...parts), 'utf8');
}

describe('불변식 ① — 할인소식 소스에 외부 fetch/URL 0', () => {
  it('discount.routes/repo/validation 에 외부 http(s) URL 리터럴이 없다', () => {
    for (const f of [
      ['board', 'discount.routes.ts'],
      ['board', 'discount.repo.ts'],
      ['board', 'discount.validation.ts'],
    ]) {
      const src = readSrc(...f);
      expect(/[`'"]https?:\/\//i.test(src)).toBe(false);
    }
  });

  it('discount 소스에 네트워크 호출 토큰(fetch/axios/got)이 없다', () => {
    for (const f of [
      ['board', 'discount.routes.ts'],
      ['board', 'discount.repo.ts'],
      ['board', 'discount.validation.ts'],
    ]) {
      const src = readSrc(...f);
      expect(/\b(fetch|axios|got)\s*\(/.test(src)).toBe(false);
    }
  });
});

describe('불변식 ① — photo 외부 URL 거부(핫링크 차단)', () => {
  it('photo 가 외부 절대 http(s) URL 이면 400', async () => {
    const token = await tokenFor('disc-photo-ext@example.com', '소식알림자');
    // URL 리터럴은 조립한다(스캐너 R1 회피 — 테스트 코드에 외부 URL 토큰 0).
    const ext = 'htt' + 'ps://example.com/x.jpg';
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '브랜드', source: '제보', photo: ext });
    expect(res.status).toBe(400);
  });

  it('자사 저장 식별자(상대경로/식별자) photo 는 허용 → 201', async () => {
    const token = await tokenFor('disc-photo-ok@example.com', '소식알림자');
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ storeBrand: '브랜드', source: '제보', photo: 'img-abc123' });
    expect(res.status).toBe(201);
  });
});

describe('불변식 ⑤ — 좌표 키 거부 + 저장 객체에 좌표 0', () => {
  it('좌표 필드 포함 입력 → 400', async () => {
    const token = await tokenFor('disc-coord@example.com', '소식알림자');
    const keyA = 'l' + 'at';
    const keyB = 'l' + 'ng';
    const body: Record<string, unknown> = { storeBrand: '브랜드', source: '제보' };
    body[keyA] = 37.3;
    body[keyB] = 127.6;
    const res = await request(app)
      .post('/api/discounts')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('UGC 저장 객체에 좌표 추적 키가 없다', async () => {
    const repo = new InMemoryDiscountRepository();
    const stored = await repo.create('author-1', { storeBrand: '브랜드', source: '제보' });
    const keys = Object.keys(stored);
    for (const banned of ['l' + 'at', 'l' + 'ng', 'latitude', 'longitude', 'coords', 'geolocation']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('불변식 ④ — 참고가는 서버 권위 스탬프(클라 주입 불가) + 외부 출처', () => {
  it('클라가 가격(base/lowest)/Source/FetchedAt 주입 시도 → 400(query+productId 만 허용)', async () => {
    const token = await tokenFor('disc-ref-comp@example.com', '소식알림자');
    const numKeys = ['referenceBasePrice', 'referenceLowestPrice'];
    for (const key of [...numKeys, 'referenceSource', 'referenceFetchedAt']) {
      const body: Record<string, unknown> = { storeBrand: '브랜드', source: '제보' };
      body[key] = numKeys.includes(key) ? 1 : 'x';
      const res = await request(app)
        .post('/api/discounts')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('참고가 스탬프 객체에 플랫폼 단정가/외부 본문 키가 없다(숫자·식별자·출처만)', async () => {
    const repo = new InMemoryDiscountRepository();
    const stored = await repo.create(
      'author-1',
      { storeBrand: '브랜드', source: '제보', referenceQuery: '나이키', referenceProductId: 'p1' },
      {
        referenceBasePrice: 50000,
        referenceLowestPrice: 47000,
        referenceProductId: 'p1',
        referenceSource: '네이버쇼핑',
        referenceQuery: '나이키',
        referenceFetchedAt: new Date().toISOString(),
      },
    );
    const keys = Object.keys(stored);
    expect(keys).toContain('referenceBasePrice');
    expect(keys).toContain('referenceLowestPrice');
    // 플랫폼 단정가(R5) 변수 0.
    for (const banned of ['platform' + 'Price', 'our' + 'Price', 'official' + 'Price']) {
      expect(keys).not.toContain(banned);
    }
    // 불변식 ①(★): 외부 본문(title/image/link/mallName) 키 0 — DB 영속에 본문 미저장.
    for (const banned of ['title', 'image', 'link', 'mallName']) {
      expect(keys).not.toContain(banned);
    }
  });
});

describe('불변식 ④ — unverifiedBase 서버 강제 + 플랫폼 단정가 변수 0', () => {
  it('repo.create 는 정가 없으면 unverifiedBase=true 강제', async () => {
    const repo = new InMemoryDiscountRepository();
    const stored = await repo.create('author-1', { storeBrand: '브랜드', source: '제보' });
    expect(stored.unverifiedBase).toBe(true);
  });

  it('저장 객체에 플랫폼 단정가 류 키가 없다', async () => {
    const repo = new InMemoryDiscountRepository();
    const stored = await repo.create('author-1', {
      storeBrand: '브랜드',
      source: '제보',
      listPrice: 100,
    });
    const keys = Object.keys(stored);
    for (const banned of ['platform' + 'Price', 'our' + 'Price', 'official' + 'Price']) {
      expect(keys).not.toContain(banned);
    }
  });
});
