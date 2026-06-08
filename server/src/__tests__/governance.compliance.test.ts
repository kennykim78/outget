import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { InMemoryReportRepository } from '../governance/report.repo.js';
import { InMemoryDisputeRepository } from '../governance/dispute.repo.js';

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

// 매칭 1건 생성: 구매자 요청 → 대행자 채택. { matchId, buyerToken, agentToken }.
async function createMatch(suffix: string): Promise<{
  matchId: string;
  buyerToken: string;
  agentToken: string;
}> {
  const buyerToken = await tokenFor(`gov-buyer-${suffix}@example.com`, '구매자');
  const created = await request(app)
    .post('/api/requests')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({ item: '운동화', hopePrice: 80000, deadline: '2026-06-20', region: '여주' });
  const agentToken = await tokenFor(`gov-agent-${suffix}@example.com`, '전문대행자');
  const adopt = await request(app)
    .post(`/api/requests/${created.body.id}/adopt`)
    .set('Authorization', `Bearer ${agentToken}`)
    .send({});
  return { matchId: adopt.body.matchId, buyerToken, agentToken };
}

const here = dirname(fileURLToPath(import.meta.url));
function readSrc(...parts: string[]): string {
  return readFileSync(join(here, '..', ...parts), 'utf8');
}

describe('신원정보 제공 — 당사자만', () => {
  it('당사자(구매자) 신원정보 요청 → 200', async () => {
    const { matchId, buyerToken } = await createMatch('party');
    const res = await request(app)
      .post(`/api/disputes/${matchId}/identity-request`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.kind).toBe('string');
  });

  it('제3자 신원정보 요청 → 403', async () => {
    const { matchId } = await createMatch('third');
    const stranger = await tokenFor('gov-stranger@example.com', '구매자');
    const res = await request(app)
      .post(`/api/disputes/${matchId}/identity-request`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('비인가 → 401', async () => {
    const { matchId } = await createMatch('noauth');
    const res = await request(app)
      .post(`/api/disputes/${matchId}/identity-request`)
      .send({});
    expect(res.status).toBe(401);
  });

  it('신원정보 응답에 자금/좌표 키 0', async () => {
    const { matchId, buyerToken } = await createMatch('clean');
    const res = await request(app)
      .post(`/api/disputes/${matchId}/identity-request`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({});
    const keys = Object.keys(res.body);
    const banned = [
      'amount', 'price', 'balance', 'settlement',
      'pay' + 'out', 'es' + 'crow', '정' + '산',
      'l' + 'at', 'l' + 'ng', 'latitude', 'longitude', 'coords',
    ];
    for (const k of banned) expect(keys).not.toContain(k);
  });
});

describe('불변식 ② — 거버넌스 저장 객체에 자금 키 0', () => {
  it('Report 에 자금 흐름 키가 없다', async () => {
    const repo = new InMemoryReportRepository();
    const r = await repo.create('reporter-1', {
      targetType: 'discount',
      targetId: 'd-1',
      reason: '허위',
    });
    const keys = Object.keys(r);
    const banned = ['amount', 'price', 'balance', 'pay' + 'out', 'es' + 'crow', '정' + '산'];
    for (const k of banned) expect(keys).not.toContain(k);
  });

  it('DisputeAuditEntry 에 자금/좌표 키가 없다', async () => {
    const repo = new InMemoryDisputeRepository();
    const e = await repo.appendAudit('m-1', 'actor-1', '신원정보요청', '요약');
    const keys = Object.keys(e);
    const banned = [
      'amount', 'price', 'balance', 'pay' + 'out', 'es' + 'crow',
      'l' + 'at', 'l' + 'ng', 'coords',
    ];
    for (const k of banned) expect(keys).not.toContain(k);
  });
});

describe('불변식 ① — 거버넌스 소스에 외부 fetch/URL 0', () => {
  it('governance 소스에 외부 http(s) URL·네트워크 호출 토큰이 없다', () => {
    for (const f of [
      ['governance', 'report.routes.ts'],
      ['governance', 'report.repo.ts'],
      ['governance', 'report.validation.ts'],
      ['governance', 'identity.routes.ts'],
      ['governance', 'dispute.repo.ts'],
    ]) {
      const src = readSrc(...f);
      expect(/[`'"]https?:\/\//i.test(src)).toBe(false);
      expect(/\b(fetch|axios|got)\s*\(/.test(src)).toBe(false);
    }
  });
});
