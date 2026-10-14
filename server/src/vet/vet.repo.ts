// 병원 리포지토리 — 읽기 전용. 목록 상태는 engine isVetStatusListed 단일 소스(불변식 7).
//   InMemory 는 빈 상태로 시작한다(미검증 자동 시드 없음). 테스트는 생성자에 행을 주입.
import type { StoredVetClinic, VetClinic, VetQuery } from './vet.types.js';
import { toPublicVet } from './vet.types.js';
import { isVetStatusListed } from '../engine/index.js';

export interface VetClinicRepository {
  list(query?: VetQuery): Promise<VetClinic[]>;
  findById(id: string): Promise<VetClinic | null>;
}

/**
 * 사용자 제보 쓰기(US-013, C-R5-4, D15) — 저장만, 비노출. 기록은 status REPORTED·source USER_REPORT·좌표 없음으로 고정되며
 *   목록·상세·프리렌더는 VERIFIED 만 보므로 운영자 전화 확인 전까지 어디에도 나오지 않는다.
 */
export interface VetReportRepository {
  createReport(rec: VetReportRecord): Promise<void>;
}

export interface VetReportRecord {
  id: string;
  name: string;
  region: string;
  address: string;
  phone: string;
  treats: string[];
}

export function reportToStored(r: VetReportRecord): StoredVetClinic {
  return { ...r, treats: [...r.treats], source: 'USER_REPORT', status: 'REPORTED' };
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

export class InMemoryVetClinicRepository implements VetClinicRepository, VetReportRepository {
  private readonly clinics: StoredVetClinic[];

  constructor(rows: StoredVetClinic[] = []) {
    this.clinics = [...rows];
  }

  async list(query?: VetQuery): Promise<VetClinic[]> {
    return this.clinics
      .filter((c) => isVetStatusListed(c.status) && matchesQuery(c, query))
      .map(toPublicVet);
  }

  async findById(id: string): Promise<VetClinic | null> {
    const found = this.clinics.find((c) => c.id === id && isVetStatusListed(c.status));
    return found ? toPublicVet(found) : null;
  }

  async createReport(rec: VetReportRecord): Promise<void> {
    this.clinics.push(reportToStored(rec));
  }

  /** 테스트 전용 — 저장 행 사본(비노출 포함). */
  dump(): StoredVetClinic[] {
    return this.clinics.map((c) => ({ ...c, treats: [...c.treats] }));
  }
}
