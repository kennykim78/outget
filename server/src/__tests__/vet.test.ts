import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { makeInMemoryRepos } from '../db/repos.js';
import { InMemoryVetClinicRepository } from '../vet/vet.repo.js';
import type { StoredVetClinic } from '../vet/vet.types.js';

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
