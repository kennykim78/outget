// R5 B2-4(C-R5-4, D15): 병원 제보 → REPORTED·USER_REPORT·좌표 null, 목록·상세·프리렌더 비노출, 제보자 식별 정보 0.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InMemoryVetClinicRepository } from '../vet/vet.repo.js';
import { PrismaVetClinicRepository } from '../vet/vet.prisma.repo.js';
import { makeVetRoutes } from '../vet/vet.routes.js';
import { createVetReportRouter, parseVetReport } from '../vet/vet.report.routes.js';
import { buildSite } from '../prerender/site.js';
import { FIXTURE_AS_OF, promoted } from './fixtures/prerender-seed.js';

const OK = { name: '하늘 동물병원', address: '서울 마포구 어딘가로 1', phone: '02-123-4567', treats: ['hamster-golden'] };
const IP = '198.51.100.23';

function appWith(repo = new InMemoryVetClinicRepository()) {
  const app = express();
  app.set('trust proxy', true);
  app.use('/api/vets/reports', createVetReportRouter(repo));
  app.use('/api/vets', makeVetRoutes(repo));
  return { app, repo };
}
const send = (app: express.Express, body: unknown) =>
  request(app).post('/api/vets/reports').set('X-Forwarded-For', IP).set('User-Agent', 'ReporterAgent/9').send(body as object);

describe('POST /api/vets/reports', () => {
  it('202 {} → 저장 1행 REPORTED·USER_REPORT·좌표 없음, 제보자 IP·UA 0', async () => {
    const { app, repo } = appWith();
    const r = await send(app, OK);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({});
    const rows = repo.dump();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...OK, status: 'REPORTED', source: 'USER_REPORT', region: '' });
    expect(rows[0].id).toMatch(/^vr-[0-9a-f-]{36}$/);
    expect(rows[0].lat).toBeUndefined();
    expect(rows[0].lng).toBeUndefined();
    expect(rows[0].verifiedAt).toBeUndefined();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(IP);
    expect(dump).not.toContain('ReporterAgent');
  });

  it('이후 GET /api/vets·/api/vets/:id 에 그 id 0(D15 비노출)', async () => {
    const { app, repo } = appWith();
    await send(app, OK);
    const id = repo.dump()[0].id;
    const list = await request(app).get('/api/vets');
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(id);
    expect(JSON.stringify(list.body)).not.toContain('하늘 동물병원');
    expect((await request(app).get(`/api/vets/${id}`)).status).toBe(404);
  });

  it.each([
    ['이름 61자', { ...OK, name: '가'.repeat(61) }],
    ['이름 빈값', { ...OK, name: '   ' }],
    ['주소 121자', { ...OK, address: '가'.repeat(121) }],
    ['전화 문자 포함', { ...OK, phone: '02-123-456a' }],
    ['전화 8자', { ...OK, phone: '0212345' }],
    ['전화 14자', { ...OK, phone: '02-1234-5678-9' }],
    ['전화 하이픈 시작', { ...OK, phone: '-0212345678' }],
    ['treats 7개', { ...OK, treats: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['treats 형식', { ...OK, treats: ['Hamster Golden'] }],
    ['treats 배열 아님', { ...OK, treats: 'hamster-golden' }],
    ['좌표 동봉', { ...OK, lat: 37.5, lng: 126.9 }],
    ['제보자 이메일 동봉', { ...OK, email: 'a@b.co' }],
    ['필드 누락', { name: OK.name, address: OK.address, phone: OK.phone }],
    ['꺾쇠', { ...OK, name: '<b>병원</b>' }],
    ['URL', { ...OK, name: 'https://spam.example' }],
    ['제어 문자', { ...OK, address: '서울\u0000마포' }],
  ])('%s → 400, 저장 0', async (_l, body) => {
    const { app, repo } = appWith();
    expect((await send(app, body)).status).toBe(400);
    expect(repo.dump()).toHaveLength(0);
  });

  it('경계: 이름 60·주소 120·전화 9자·13자·treats 6(중복 제거) 통과', () => {
    expect(parseVetReport({ ...OK, name: '가'.repeat(60), address: '나'.repeat(120) })).not.toBeNull();
    expect(parseVetReport({ ...OK, phone: '021234567' })).not.toBeNull();
    expect(parseVetReport({ ...OK, phone: '010-1234-5678' })).not.toBeNull();
    expect(parseVetReport({ ...OK, treats: ['a', 'a', 'b', 'c', 'd', 'e'] })?.treats).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(parseVetReport({ ...OK, treats: [] })).not.toBeNull();
  });

  it('knownTypeIds 가 있으면 그 밖의 동물 id 거부', () => {
    const known = new Set(['hamster-golden']);
    expect(parseVetReport(OK, known)).not.toBeNull();
    expect(parseVetReport({ ...OK, treats: ['secret-species'] }, known)).toBeNull();
  });

  it('JSON 아니면 415, 리미터 옵션 적용', async () => {
    const { app } = appWith();
    expect((await request(app).post('/api/vets/reports').set('Content-Type', 'text/plain').send('x')).status).toBe(415);
    const limited = express();
    limited.use('/api/vets/reports', createVetReportRouter(new InMemoryVetClinicRepository(), { limiter: (_q, res) => void res.status(429).end() }));
    expect((await request(limited).post('/api/vets/reports').send(OK)).status).toBe(429);
  });

  it('Prisma: create data = REPORTED·USER_REPORT·lat/lng null, 운영 메모·검수일 없음', async () => {
    let data: Record<string, unknown> | undefined;
    const repo = new PrismaVetClinicRepository({ vetClinic: { create: async (a: { data: Record<string, unknown> }) => void (data = a.data) } } as never);
    await repo.createReport({ id: 'vr-1', region: '', ...OK, createdAt: '2026-11-02T03:00:00.000Z' });
    expect(data).toEqual({
      id: 'vr-1',
      name: OK.name,
      region: '',
      address: OK.address,
      phone: OK.phone,
      treats: '["hamster-golden"]',
      source: 'USER_REPORT',
      status: 'REPORTED',
      lat: null,
      lng: null,
      createdAt: '2026-11-02T03:00:00.000Z',
    });
  });
});

describe('프리렌더 비노출(D15)', () => {
  it('시드에 REPORTED 병원이 있어도 산출물 어디에도 id·이름 0', () => {
    const s = promoted();
    s.vetClinics = [
      {
        id: 'vc-reported-x',
        name: '제보 병원 엑스',
        region: '서울 마포구',
        treats: ['hamster-golden'],
        night: null,
        emergency: null,
        phone: '02-000-0000',
        address: '서울 마포구 1',
        lat: null,
        lng: null,
        verification: { status: 'REPORTED', method: 'USER_REPORT', verifiedAt: null, note: null },
      },
    ];
    const b = buildSite(s, {
      template: '<html><head><!--ws:head--></head><body><div id="root"><!--ws:body--></div></body></html>',
      origin: 'http://localhost:3001',
      seedDigest: 'a'.repeat(64),
      asOf: FIXTURE_AS_OF,
    });
    for (const [f, c] of b.files) {
      expect(c, f).not.toContain('vc-reported-x');
      expect(c, f).not.toContain('제보 병원 엑스');
    }
  });
});
