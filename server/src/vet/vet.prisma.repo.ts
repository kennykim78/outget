import type { PrismaClient } from '@prisma/client';
import type { VetClinic } from './vet.types.js';
import type { VetClinicRepository } from './vet.repo.js';
import { SEED_VET_CLINICS } from './vet.seed.js';

export class PrismaVetClinicRepository implements VetClinicRepository {
  private seeded = false;

  constructor(private prisma: PrismaClient) {}

  private async ensureSeed() {
    if (this.seeded) return;
    const count = await this.prisma.vetClinic.count();
    if (count === 0) {
      for (const clinic of SEED_VET_CLINICS) {
        await this.prisma.vetClinic.create({
          data: {
            id: clinic.id,
            name: clinic.name,
            targetPets: clinic.targetPets,
            address: clinic.address,
            phone: clinic.phone,
            lat: clinic.lat,
            lng: clinic.lng,
            operatingHours: clinic.operatingHours,
          },
        });
      }
    }
    this.seeded = true;
  }

  async list(query?: string): Promise<VetClinic[]> {
    await this.ensureSeed();
    const where: any = {};
    if (query) {
      where.OR = [
        { name: { contains: query } },
        { address: { contains: query } },
        { targetPets: { contains: query } },
      ];
    }
    const rows = await this.prisma.vetClinic.findMany({ where });
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      targetPets: r.targetPets,
      address: r.address,
      phone: r.phone,
      lat: r.lat,
      lng: r.lng,
      operatingHours: r.operatingHours ?? undefined,
    }));
  }

  async findById(id: string): Promise<VetClinic | null> {
    await this.ensureSeed();
    const r = await this.prisma.vetClinic.findUnique({ where: { id } });
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      targetPets: r.targetPets,
      address: r.address,
      phone: r.phone,
      lat: r.lat,
      lng: r.lng,
      operatingHours: r.operatingHours ?? undefined,
    };
  }
}
