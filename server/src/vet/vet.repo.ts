// 병원 리포지토리 — 읽기 전용. VERIFIED 만 반환(불변식 7).
//   InMemory 는 빈 상태로 시작한다(미검증 자동 시드 없음). 테스트는 생성자에 행을 주입.
import type { StoredVetClinic, VetClinic, VetQuery } from './vet.types.js';
import { toPublicVet } from './vet.types.js';

export interface VetClinicRepository {
  list(query?: VetQuery): Promise<VetClinic[]>;
  findById(id: string): Promise<VetClinic | null>;
}

export function matchesQuery(c: StoredVetClinic, query?: VetQuery): boolean {
  if (query?.region && c.region !== query.region) return false;
  if (query?.q) {
    const q = query.q.toLowerCase();
    const hay = [c.name, c.address, c.region].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export class InMemoryVetClinicRepository implements VetClinicRepository {
  private readonly clinics: StoredVetClinic[];

  constructor(rows: StoredVetClinic[] = []) {
    this.clinics = [...rows];
  }

  async list(query?: VetQuery): Promise<VetClinic[]> {
    return this.clinics
      .filter((c) => c.status === 'VERIFIED' && matchesQuery(c, query))
      .map(toPublicVet);
  }

  async findById(id: string): Promise<VetClinic | null> {
    const found = this.clinics.find((c) => c.id === id && c.status === 'VERIFIED');
    return found ? toPublicVet(found) : null;
  }
}
