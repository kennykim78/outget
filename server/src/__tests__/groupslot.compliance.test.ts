import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Epic 9 ②무금전·⑤좌표0 — 공동대행 소스/런타임에 금전 식별자·좌표 0.
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

const SCANNED_CODE_FILES: string[][] = [
  ['groupslot', 'groupslot.types.ts'],
  ['groupslot', 'groupslot.repo.ts'],
  ['groupslot', 'groupslot.validation.ts'],
  ['groupslot', 'groupslot.routes.ts'],
];

describe('② — 공동대행 코드에 자금 식별자 0', () => {
  for (const parts of SCANNED_CODE_FILES) {
    it(`${parts.join('/')} 코드에 자금 식별자가 없다`, () => {
      const code = readCode(...parts);
      for (const id of MONEY_IDENTIFIERS) {
        expect(code.includes(id)).toBe(false);
      }
    });
  }
});

describe('① — 공동대행 소스에 외부 fetch/URL 0', () => {
  it('네트워크 호출 토큰·외부 URL 0', () => {
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      expect(/\b(fetch|axios|got)\s*\(/.test(code)).toBe(false);
      expect(/[`'"]https?:\/\//i.test(code)).toBe(false);
    }
  });
});

describe('⑤ — 공동대행 소스에 좌표 영속/전송 0', () => {
  it('좌표 토큰 + 영속/전송 동사 동반 0', () => {
    for (const parts of SCANNED_CODE_FILES) {
      const code = readCode(...parts);
      const coordTokens = ['l' + 'at', 'l' + 'ng', 'lati' + 'tude', 'longi' + 'tude', 'coo' + 'rds'].join('|');
      const persistVerbs = ['INS' + 'ERT', 's' + 'ave', 'cre' + 'ate', 'col' + 'umn', 'sch' + 'ema'].join('|');
      const coordPersist = new RegExp(`\\b(${coordTokens})\\b.*\\b(${persistVerbs})\\b`, 'i');
      expect(coordPersist.test(code)).toBe(false);
    }
  });
});

describe('② — 금전성 키 거부(런타임)', () => {
  it('개설 시 fee 키 포함 → 400', async () => {
    const agent = await tokenFor('gsc-fee@example.com', '개인대행자');
    const body: Record<string, unknown> = { scheduleText: '토', region: '여주', capacity: 2 };
    body['fee'] = 1000;
    const res = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${agent}`)
      .send(body);
    expect(res.status).toBe(400);
  });
});

describe('⑤ — 좌표 키 거부(런타임)', () => {
  it('개설 시 좌표 키 포함 → 400', async () => {
    const agent = await tokenFor('gsc-coord@example.com', '전문대행자');
    const body: Record<string, unknown> = { scheduleText: '토', region: '여주', capacity: 2 };
    body['l' + 'at'] = 37.3;
    body['l' + 'ng'] = 127.6;
    const res = await request(app)
      .post('/api/group-slots')
      .set('Authorization', `Bearer ${agent}`)
      .send(body);
    expect(res.status).toBe(400);
  });
});
