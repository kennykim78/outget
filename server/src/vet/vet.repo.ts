import type { VetClinic } from './vet.types.js';
import { SEED_VET_CLINICS } from './vet.seed.js';

export interface VetClinicRepository {
  list(query?: string): Promise<VetClinic[]>;
  findById(id: string): Promise<VetClinic | null>;
}

export class InMemoryVetClinicRepository implements VetClinicRepository {
  private clinics: VetClinic[] = [...SEED_VET_CLINICS];

  async list(query?: string): Promise<VetClinic[]> {
    if (!query) return this.clinics;
    const q = query.toLowerCase();
    return this.clinics.filter(
      c => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q) || c.targetPets.toLowerCase().includes(q)
    );
  }

  async findById(id: string): Promise<VetClinic | null> {
    return this.clinics.find(c => c.id === id) ?? null;
  }
}
