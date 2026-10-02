// 프리렌더 테스트 픽스처 — 실시드를 읽어 메모리에서만 승격(디스크의 AI_DRAFT 를 VERIFIED 로 기록하지 않는다, 계획 §10-2).
//   승격 값(제목·병원명·후기 문장)은 테스트 전용 자리표시이며 사육·규격 사실이 아니다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedBundle } from '../../engine/index.js';
import { SEED_FILES } from '../../seed/common.js';
import { readSeedDir } from '../../seed/read.js';

export const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'seed');

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const realSeed = (): SeedBundle => readSeedDir(SEED_DIR);

const FIXTURE_SOURCE = [{ url: 'https://example.org/fixture-source', title: 'fixture source', accessedAt: '2026-09-30' }];

export const V = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: 'keeper-hidden-name', verifiedAt: '2026-09-30' } as const;

export type Row = Record<string, unknown>;
export function patch(seed: SeedBundle, key: keyof SeedBundle, id: string, p: Row): void {
  const row = (seed[key] as unknown as Row[]).find((r) => r.id === id);
  if (!row) throw new Error(`fixture: ${key}#${id} 없음`);
  Object.assign(row, p);
}

/** golden 체인 승격(메모리): type·profile·cage/wheel 요구사항·항목·cp-001·번들 1·병원 1·CC_BY 사진 1·후기 1. */
export function promoted(opts: { typeDraft?: boolean } = {}): SeedBundle {
  const s = clone(realSeed());
  patch(s, 'animalTypes', 'hamster-golden', opts.typeDraft ? {} : { ...V });
  patch(s, 'careProfiles', 'cp-hamster-syrian', { ...V });
  for (const id of ['req-syrian-cage', 'req-syrian-wheel']) patch(s, 'supplyRequirements', id, { ...V });
  for (const id of ['cage', 'wheel']) patch(s, 'supplyItems', id, { ...V });
  patch(s, 'curatedProducts', 'cp-001', {
    ...V,
    status: 'ACTIVE',
    meetsMinSpec: true,
    title: '픽스처 쳇바퀴 A',
    specVerifiedBy: 'keeper-hidden-name',
    specVerifiedAt: '2026-09-29',
    source: FIXTURE_SOURCE,
  });
  patch(s, 'setupBundles', 'sb-syrian-budget', { ...V, itemIds: ['cage', 'wheel'], source: FIXTURE_SOURCE });
  patch(s, 'vetClinics', 'vc-mapo-01', {
    name: '픽스처 동물병원',
    address: '서울 마포구 픽스처로 1',
    phone: '02-000-0000',
    verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-28', note: 'hidden-ops-note' },
  });
  patch(s, 'photos', 'ph-01', {
    source: 'WIKIMEDIA',
    license: 'CC_BY',
    author: 'Fixture Author',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg',
    downloadedAt: '2026-09-27',
    status: 'READY',
  });
  patch(s, 'testimonials', 't-001', { status: 'APPROVED', verifiedUsage: true, quote: '픽스처 후기 문장이에요', consentAt: '2026-09-26' });
  return s;
}


/** 시드 묶음을 디렉터리에 JSON 으로 쓴다(CLI·spa 테스트용 임시 시드). */
export function writeSeedDir(dir: string, seed: SeedBundle): void {
  mkdirSync(dir, { recursive: true });
  for (const [key, file] of Object.entries(SEED_FILES)) {
    writeFileSync(join(dir, file), `${JSON.stringify(seed[key as keyof SeedBundle], null, 2)}
`);
  }
}
