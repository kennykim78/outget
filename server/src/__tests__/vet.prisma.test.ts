// PrismaVetClinicRepository — stub 클라이언트(DB 없음). 불변식 7: 목록 상태는 engine VET_LISTED_STATUS 단일 소스.
//   where 필터가 전달되는지 + stub 이 where 를 무시하고 비노출 행을 돌려줘도 저장소가 걸러내는지(이중 방어).
import { describe, expect, it } from 'vitest';
import type { PrismaClient, VetClinic as VetClinicRow } from '@prisma/client';
import { VET_LISTED_STATUS } from '../engine/index.js';
import { PrismaVetClinicRepository } from '../vet/vet.prisma.repo.js';

function row(id: string, status: string, extra: Partial<VetClinicRow> = {}): VetClinicRow {
  return {
    id,
    name: `병원 ${id}`,
    region: '서울 마포구',
    address: `서울 마포구 ${id}`,
    phone: '02-000-0000',
    lat: null,
    lng: null,
    treats: '["hamster-golden"]',
    hours: null,
    night: null,
    emergency: null,
    source: 'SEED',
    status,
    verificationMethod: status === 'VERIFIED' ? 'PHONE_CALL' : null,
    verifiedAt: status === 'VERIFIED' ? '2026-10-01' : null,
    verificationNote: '운영자 메모',
    ...extra,
  };
}

const ROWS: VetClinicRow[] = [
  row('v-ok', 'VERIFIED'),
  row('v-blinded', 'BLINDED'),
  row('v-reported', 'REPORTED'),
  row('v-slot', 'SLOT'),
  row('v-bad-source', 'VERIFIED', { source: 'CRAWLED' }),
  row('v-ok-busan', 'VERIFIED', { region: '부산 남구', address: '부산 남구 1' }),
];

type Where = Record<string, unknown>;

/** where 를 기록만 하고 무시하는(전 행 반환) stub — 저장소의 사후 필터를 검증한다. */
function stub(rows: VetClinicRow[]) {
  const calls: { findMany: Where[]; findFirst: Where[] } = { findMany: [], findFirst: [] };
  const client = {
    vetClinic: {
      findMany: async (args: { where: Where }) => {
        calls.findMany.push(args.where);
        return rows;
      },
      findFirst: async (args: { where: Where }) => {
        calls.findFirst.push(args.where);
        return rows.find((r) => r.id === args.where.id) ?? null;
      },
    },
  };
  return { prisma: client as unknown as PrismaClient, calls };
}

describe('PrismaVetClinicRepository — VET_LISTED_STATUS 만', () => {
  it('list passes where.status = VET_LISTED_STATUS and drops non-listed rows even if returned', async () => {
    const { prisma, calls } = stub(ROWS);
    const out = await new PrismaVetClinicRepository(prisma).list();
    expect(calls.findMany[0]).toEqual({ status: VET_LISTED_STATUS });
    expect(out.map((c) => c.id)).toEqual(['v-ok', 'v-ok-busan']);
    for (const c of out) expect(c).not.toHaveProperty('verificationNote');
  });

  it('list with region adds region to where and filters', async () => {
    const { prisma, calls } = stub(ROWS);
    const out = await new PrismaVetClinicRepository(prisma).list({ region: '부산 남구' });
    expect(calls.findMany[0]).toEqual({ status: VET_LISTED_STATUS, region: '부산 남구' });
    expect(out.map((c) => c.id)).toEqual(['v-ok-busan']);
  });

  it.each(['v-blinded', 'v-reported', 'v-slot', 'v-bad-source', 'missing'])('findById(%s) → null', async (id) => {
    const { prisma, calls } = stub(ROWS);
    expect(await new PrismaVetClinicRepository(prisma).findById(id)).toBeNull();
    expect(calls.findFirst[0]).toEqual({ id, status: VET_LISTED_STATUS });
  });

  it('findById(VERIFIED) → public clinic without operator note', async () => {
    const { prisma } = stub(ROWS);
    const c = await new PrismaVetClinicRepository(prisma).findById('v-ok');
    expect(c).toMatchObject({ id: 'v-ok', status: 'VERIFIED', treats: ['hamster-golden'] });
    expect(c).not.toHaveProperty('verificationNote');
  });
});
