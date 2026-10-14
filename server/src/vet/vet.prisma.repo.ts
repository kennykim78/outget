// 병원 영속 리포지토리(Prisma) — 읽기는 VERIFIED 만. 쓰기는 사용자 제보(REPORTED·USER_REPORT·좌표 null) 1경로뿐. where 는 engine VET_LISTED_STATUS, 사후 필터는
//   isVetStatusListed(이중 방어, 불변식 7).
//   적재는 시드 로더(R2)가 담당한다.
import type { PrismaClient, VetClinic as VetClinicRow } from '@prisma/client';
import type { StoredVetClinic, VetClinic, VetQuery } from './vet.types.js';
import { toPublicVet } from './vet.types.js';
import type { VetClinicRepository, VetReportRecord, VetReportRepository } from './vet.repo.js';
import { matchesQuery } from './vet.repo.js';
import { VET_LISTED_STATUS, isVetSource, isVetStatus, isVetStatusListed } from '../engine/index.js';

function parseTreats(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToStored(r: VetClinicRow): StoredVetClinic | null {
  if (!isVetStatus(r.status) || !isVetSource(r.source)) return null;
  const out: StoredVetClinic = {
    id: r.id,
    name: r.name,
    region: r.region,
    address: r.address,
    phone: r.phone,
    treats: parseTreats(r.treats),
    source: r.source,
    status: r.status,
  };
  if (r.lat !== null) out.lat = r.lat;
  if (r.lng !== null) out.lng = r.lng;
  if (r.hours !== null) out.hours = r.hours;
  if (r.night !== null) out.night = r.night;
  if (r.emergency !== null) out.emergency = r.emergency;
  if (r.verificationMethod !== null) out.verificationMethod = r.verificationMethod;
  if (r.verifiedAt !== null) out.verifiedAt = r.verifiedAt;
  return out;
}

export class PrismaVetClinicRepository implements VetClinicRepository, VetReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query?: VetQuery): Promise<VetClinic[]> {
    const rows = await this.prisma.vetClinic.findMany({
      where: { status: VET_LISTED_STATUS, ...(query?.region ? { region: query.region } : {}) },
      orderBy: { id: 'asc' },
    });
    const out: VetClinic[] = [];
    for (const r of rows) {
      const c = rowToStored(r);
      if (c && isVetStatusListed(c.status) && matchesQuery(c, query)) out.push(toPublicVet(c));
    }
    return out;
  }

  async findById(id: string): Promise<VetClinic | null> {
    const r = await this.prisma.vetClinic.findFirst({ where: { id, status: VET_LISTED_STATUS } });
    if (!r) return null;
    const c = rowToStored(r);
    return c && isVetStatusListed(c.status) ? toPublicVet(c) : null;
  }

  async createReport(rec: VetReportRecord): Promise<void> {
    await this.prisma.vetClinic.create({
      data: {
        id: rec.id,
        name: rec.name,
        region: rec.region,
        address: rec.address,
        phone: rec.phone,
        treats: JSON.stringify(rec.treats),
        source: 'USER_REPORT',
        status: 'REPORTED',
        lat: null,
        lng: null,
      },
    });
  }
}
