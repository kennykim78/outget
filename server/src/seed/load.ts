// 쓰기 적용 + 읽기 검증 digest(A-14). Prisma 를 쓰는 유일한 seed 모듈.
//   applyWrites: 연산 목록을 단일 $transaction 으로(하나라도 실패하면 전부 롤백).
//   digest: 시드 소유 테이블을 결정적 순서로 다시 읽어 sha256 — 같은 시드면 몇 번을 적재해도 같은 값.
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { stableJson } from './map.js';
import { MODEL_NAMES, SEED_MODELS, type SeedModel, type WriteOp } from './plan.js';

/** 이 모듈이 쓰는 Prisma 델리게이트 메서드의 최소 형태(모델별 타입 차이를 한 곳에서 흡수). */
interface Delegate {
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  upsert(args: { where: { id: string }; create: Record<string, unknown>; update: Record<string, unknown> }): Promise<unknown>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  findMany(args: { orderBy: Record<string, 'asc'>[] }): Promise<Record<string, unknown>[]>;
  count(): Promise<number>;
}

type Client = Pick<PrismaClient, SeedModel>;

function delegate(client: Client, model: SeedModel): Delegate {
  return (client as unknown as Record<SeedModel, Delegate>)[model];
}

export interface ApplySummary {
  deleted: number;
  upserted: number;
  inserted: number;
}

export async function applyWrites(prisma: PrismaClient, ops: readonly WriteOp[]): Promise<ApplySummary> {
  return prisma.$transaction(
    async (tx) => {
      const sum: ApplySummary = { deleted: 0, upserted: 0, inserted: 0 };
      for (const o of ops) {
        const d = delegate(tx, o.model);
        if (o.op === 'deleteMany') {
          sum.deleted += (await d.deleteMany({ where: o.where })).count;
        } else if (o.op === 'upsert') {
          const { id, ...rest } = o.data;
          await d.upsert({ where: { id: o.id }, create: { id, ...rest }, update: rest });
          sum.upserted += 1;
        } else {
          sum.inserted += (await d.createMany({ data: o.rows })).count;
        }
      }
      return sum;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

const ORDER: Record<SeedModel, Record<string, 'asc'>[]> = {
  taxon: [{ id: 'asc' }],
  careProfile: [{ id: 'asc' }],
  animalType: [{ id: 'asc' }],
  supplyItem: [{ id: 'asc' }],
  supplyRequirement: [{ id: 'asc' }],
  compatibilityRule: [{ id: 'asc' }],
  setupBundle: [{ id: 'asc' }],
  setupBundleItem: [{ bundleId: 'asc' }, { position: 'asc' }],
  curatedProduct: [{ id: 'asc' }],
  vetClinic: [{ id: 'asc' }],
  testimonial: [{ id: 'asc' }],
};

export interface Readback {
  counts: Record<string, number>;
  digest: string;
}

/** 시드 소유 테이블 전부를 읽어 행 수와 sha256(모델 순서·정렬 고정, 키 정렬 JSON). */
export async function readback(prisma: PrismaClient): Promise<Readback> {
  const hash = createHash('sha256');
  const counts: Record<string, number> = {};
  for (const model of SEED_MODELS) {
    const rows = await delegate(prisma, model).findMany({ orderBy: ORDER[model] });
    counts[MODEL_NAMES[model]] = rows.length;
    hash.update(`${model}\n`);
    for (const r of rows) hash.update(`${stableJson(r)}\n`);
  }
  return { counts, digest: hash.digest('hex') };
}

/** 계획 §B 이름: digest(prisma) → sha256 hex. */
export async function digest(prisma: PrismaClient): Promise<string> {
  return (await readback(prisma)).digest;
}
