import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import { InMemoryVetClinicRepository } from '../vet/vet.repo.js';
import type { StoredVetClinic } from '../vet/vet.types.js';
import { isVetStatusListed } from '../engine/index.js';

// 불변식 7: VERIFIED(전화 확인) 병원만 노출. REPORTED/BLINDED 는 목록·상세 모두 비노출.
const verified: StoredVetClinic = {
  id: 'vc-test-verified',
  name: '테스트 동물병원 A',
  region: '서울 마포구',
  address: '서울 마포구 테스트로 1',
  phone: '02-000-0001',
  treats: ['hamster-golden'],
  night: false,
  emergency: false,
  source: 'SEED',
  status: 'VERIFIED',
  verificationMethod: 'PHONE_CALL',
  verifiedAt: '2026-10-01',
  verificationNote: '운영자 메모',
};

const reported: StoredVetClinic = {
  id: 'vc-test-reported',
  name: '테스트 동물병원 B',
  region: '서울 마포구',
  address: '서울 마포구 테스트로 2',
  phone: '02-000-0002',
  treats: ['hamster-golden'],
  source: 'USER_REPORT',
  status: 'REPORTED',
};

const blinded: StoredVetClinic = {
  ...verified,
  id: 'vc-test-blinded',
  status: 'BLINDED',
};

// 런타임에 들어온 알 수 없는 상태(SLOT 등) — 타입 밖 값도 노출하지 않는다.
const slot = { ...verified, id: 'vc-test-slot', status: 'SLOT' } as unknown as StoredVetClinic;

function appWith(rows: StoredVetClinic[]) {
  const repos = makeInMemoryRepos();
  repos.vet = new InMemoryVetClinicRepository(rows);
  return createApp(repos);
}

describe('GET /api/vets — VERIFIED 만 노출', () => {
  it('목록에는 VERIFIED 병원만 있다', async () => {
    const res = await request(appWith([verified, reported])).get('/api/vets');
    expect(res.status).toBe(200);
    const ids = (res.body.clinics as { id: string }[]).map((c) => c.id);
    expect(ids).toEqual(['vc-test-verified']);
  });

  it('VERIFIED 상세 → 200, 운영자 메모는 응답에 없다', async () => {
    const res = await request(appWith([verified, reported])).get(
      '/api/vets/vc-test-verified',
    );
    expect(res.status).toBe(200);
    expect(res.body.clinic.name).toBe('테스트 동물병원 A');
    expect(res.body.clinic.treats).toEqual(['hamster-golden']);
    expect(res.body.clinic).not.toHaveProperty('verificationNote');
  });

  it('REPORTED 상세 → 404', async () => {
    const res = await request(appWith([verified, reported])).get(
      '/api/vets/vc-test-reported',
    );
    expect(res.status).toBe(404);
  });

  it('BLINDED·REPORTED·SLOT 은 목록·상세 모두 없다', async () => {
    const app = appWith([verified, reported, blinded, slot]);
    const list = await request(app).get('/api/vets');
    expect((list.body.clinics as { id: string }[]).map((c) => c.id)).toEqual(['vc-test-verified']);
    for (const id of ['vc-test-blinded', 'vc-test-reported', 'vc-test-slot']) {
      expect((await request(app).get(`/api/vets/${id}`)).status).toBe(404);
    }
  });

  it('InMemory repo 도 engine isVetStatusListed 를 따른다', async () => {
    const repo = new InMemoryVetClinicRepository([verified, reported, blinded, slot]);
    const listed = (await repo.list()).map((c) => c.id);
    expect(listed).toEqual([verified, reported, blinded, slot].filter((c) => isVetStatusListed(c.status)).map((c) => c.id));
    expect(await repo.findById('vc-test-slot')).toBeNull();
  });

  it('기본 인메모리 repo 는 비어 있다(미검증 자동 시드 없음)', async () => {
    const res = await request(createApp()).get('/api/vets');
    expect(res.status).toBe(200);
    expect(res.body.clinics).toEqual([]);
  });

  it('지역(시군구) 필터 — region 일치만', async () => {
    const other: StoredVetClinic = {
      ...verified,
      id: 'vc-test-other',
      region: '부산 남구',
    };
    const res = await request(appWith([verified, other]))
      .get('/api/vets')
      .query({ region: '부산 남구' });
    expect(res.status).toBe(200);
    expect((res.body.clinics as { id: string }[]).map((c) => c.id)).toEqual([
      'vc-test-other',
    ]);
  });
});

// 단일 소스 규칙: vet 소스는 'VERIFIED' 리터럴 없이 engine VET_LISTED_STATUS/isVetStatusListed 를 참조한다.
describe('vet 노출 상태 단일 소스(소스 스캔)', () => {
  const vetDir = fileURLToPath(new URL('../vet/', import.meta.url));
  const read = (f: string): string => readFileSync(vetDir + f, 'utf8');
  const files = readdirSync(vetDir).filter((f) => f.endsWith('.ts'));

  it('vet/*.ts 에 VERIFIED 문자열 리터럴이 없다', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(read(f), f).not.toMatch(/['"`]VERIFIED['"`]/);
    }
  });

  it.each(['vet.repo.ts', 'vet.prisma.repo.ts'])('%s 는 엔진 상수/함수를 참조한다', (f) => {
    expect(read(f)).toMatch(/VET_LISTED_STATUS|isVetStatusListed/);
  });
});
