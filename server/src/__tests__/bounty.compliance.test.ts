import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Epic 8 ②무금전 — 바운티 소스/런타임에 금전 식별자 0, photo 외부URL 거부, 외부 fetch 0, 좌표 0.
// 주석은 deny-list 를 담으므로 **코드(주석 제거)** 만 검사한다(payment.compliance 패턴 복제).
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
const srcRoot = join(here, '..');

function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return noBlock
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/' && (i === 0 || line[i - 1] !== ':')) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

function readCode(...parts: string[]): string {
  return stripComments(readFileSync(join(srcRoot, ...parts), 'utf8'));
}

// 토큰 조립(이 테스트 파일도 server/src 스캔 대상).
const MONEY_IDENTIFIERS = [
  'es' + 'crow',
  'pay' + 'out',
  '정' + '산',
  '예' + '치',
  '환' + '불',
  're' + 'fund',
  'bal' + 'ance',
  'platform' + 'Price',
];

// validation 은 BANNED_MONEY_KEYS 를 토큰 조립으로만 구성하므로 코드에 금전 단어 리터럴 0 이어야 한다.
const SCANNED_CODE_FILES: string[][] = [
  ['bounty', 'bounty.types.ts'],
  ['bounty', 'bounty.repo.ts'],
  ['bounty', 'bounty.validation.ts'],
  ['bounty', 'bounty.routes.ts'],
  ['badge', 'badge.types.ts'],
  ['badge', 'badge.repo.ts'],
];

describe('② — 바운티/뱃지 코드에 자금 식별자 0', () => {
  for (const parts of SCANNED_CODE_FILES) {
    it(`${parts.join('/')} 코드에 자금 식별자가 없다`, () => {
      const code = readCode(...parts);
      for (const id of MONEY_IDENTIFIERS) {
        expect(code.includes(id)).toBe(false);
      }
    });
  }

  it('PG 가맹점 식별자 동반 0', () => {
    const merchant = 'merch' + 'antId';
    for (const parts of SCANNED_CODE_FILES) {
      expect(readCode(...parts).includes(merchant)).toBe(false);
    }
  });
});

describe('① — 바운티 소스에 외부 fetch/URL 0', () => {
  it('네트워크 호출 토큰(fetch/axios/got) 0', () => {
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      expect(/\b(fetch|axios|got)\s*\(/.test(code)).toBe(false);
    }
  });

  it('외부 절대 http(s) URL 리터럴 0', () => {
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      expect(/[`'"]https?:\/\//i.test(code)).toBe(false);
    }
  });
});

describe('⑤ — 바운티 소스에 좌표 토큰 0', () => {
  it('코드에 lat/lng 토큰 0(주석 제거 후)', () => {
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      // 좌표 토큰 + 영속/전송 동사 동반 0. 패턴은 토큰 조립으로 만든다(이 테스트도 스캔 대상).
      const coordTokens = ['l' + 'at', 'l' + 'ng', 'lati' + 'tude', 'longi' + 'tude', 'coo' + 'rds'].join('|');
      const persistVerbs = ['INS' + 'ERT', 's' + 'ave', 'cre' + 'ate', 'col' + 'umn', 'sch' + 'ema'].join('|');
      const coordPersist = new RegExp(`\\b(${coordTokens})\\b.*\\b(${persistVerbs})\\b`, 'i');
      expect(coordPersist.test(code)).toBe(false);
    }
  });
});

describe('① — photo 외부 URL 거부(런타임)', () => {
  it('제출 photo 가 외부 절대 http(s) URL 이면 400', async () => {
    const buyer = await tokenFor('btyc-buyer@example.com', '구매자');
    const solver = await tokenFor('btyc-solver@example.com', '소식알림자');
    const created = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ mission: '미션' });
    const ext = 'htt' + 'ps://example.com/x.jpg';
    const sub = await request(app)
      .post(`/api/bounties/${created.body.id}/submissions`)
      .set('Authorization', `Bearer ${solver}`)
      .send({ photo: ext });
    expect(sub.status).toBe(400);
  });
});

describe('② — 금전성 키 거부(런타임)', () => {
  it('발주 시 금액 키 포함 → 400', async () => {
    const buyer = await tokenFor('btyc-money@example.com', '구매자');
    const body: Record<string, unknown> = { mission: '미션' };
    body['amount'] = 10000;
    const res = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send(body);
    expect(res.status).toBe(400);
  });

  it('제출 시 reward 키 포함 → 400', async () => {
    const buyer = await tokenFor('btyc-reward-buyer@example.com', '구매자');
    const solver = await tokenFor('btyc-reward-solver@example.com', '소식알림자');
    const created = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send({ mission: '미션' });
    const body: Record<string, unknown> = {};
    body['reward'] = 5000;
    const sub = await request(app)
      .post(`/api/bounties/${created.body.id}/submissions`)
      .set('Authorization', `Bearer ${solver}`)
      .send(body);
    expect(sub.status).toBe(400);
  });
});

describe('⑤ — 좌표 키 거부(런타임)', () => {
  it('발주 시 좌표 키 포함 → 400', async () => {
    const buyer = await tokenFor('btyc-coord@example.com', '구매자');
    const body: Record<string, unknown> = { mission: '미션' };
    body['l' + 'at'] = 37.3;
    body['l' + 'ng'] = 127.6;
    const res = await request(app)
      .post('/api/bounties')
      .set('Authorization', `Bearer ${buyer}`)
      .send(body);
    expect(res.status).toBe(400);
  });
});
