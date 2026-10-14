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

/**
 * 노출 기준일(asOf) — 승격 픽스처를 쓰는 모든 테스트는 이 고정값을 프리렌더 --now·buildSite asOf·computeExposure 에 넣는다.
 *   실시계(io.today·localToday)와 결합 금지(F14 시한폭탄: V.verifiedAt + 180일 = 2027-03-29 이후 강등).
 */
export const FIXTURE_AS_OF = '2026-10-01';
/** V.verifiedAt + 180일(마지막 노출일) / + 181일(강등 첫날). */
export const FIXTURE_LAST_FRESH = '2027-03-29';
export const FIXTURE_FIRST_STALE = '2027-03-30';

export type Row = Record<string, unknown>;
export function patch(seed: SeedBundle, key: keyof SeedBundle, id: string, p: Row): void {
  const row = (seed[key] as unknown as Row[]).find((r) => r.id === id);
  if (!row) throw new Error(`fixture: ${key}#${id} 없음`);
  Object.assign(row, p);
}

/**
 * LEGAL 승격 값(K-4, R7 A6) — Taxon 은 contentKind LEGAL 이라 validate V03 이 OFFICIAL_SOURCE 정확 등급을 요구한다.
 *   검수 표기만 바꾼다(legal 사실값·학명은 디스크 시드 그대로).
 */
export const V_LEGAL = { ...V, reviewerType: 'OFFICIAL_SOURCE' } as const;
export const GOLDEN_TAXON_ID = 'mesocricetus-auratus';

/**
 * golden 체인 승격(메모리): taxon(K-4)·type·profile·cage/wheel 요구사항·항목·cp-001·번들 1·병원 1·CC_BY 사진 1·후기 1.
 *   taxonDraft: Taxon 만 디스크 상태(DRAFT) 그대로 — 타입 이하 전부 비노출이어야 한다(K-4).
 */
export function promoted(opts: { typeDraft?: boolean; taxonDraft?: boolean } = {}): SeedBundle {
  const s = clone(realSeed());
  if (!opts.taxonDraft) patch(s, 'taxa', GOLDEN_TAXON_ID, { ...V_LEGAL });
  patch(s, 'animalTypes', 'hamster-golden', opts.typeDraft ? {} : { ...V });
  patch(s, 'careProfiles', 'cp-hamster-syrian', { ...V });
  for (const id of ['req-syrian-cage', 'req-syrian-wheel']) patch(s, 'supplyRequirements', id, { ...V });
  for (const id of ['cage', 'wheel']) {
    patch(s, 'supplyItems', id, { ...V });
    labelEnums(s, id);
  }
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
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    downloadedAt: '2026-09-27',
    status: 'READY',
  });
  patch(s, 'testimonials', 't-001', { status: 'APPROVED', verifiedUsage: true, quote: '픽스처 후기 문장이에요', consentAt: '2026-09-26' });
  return s;
}

/** promotedTwo() 의 합성 두 번째 타입 식별자(다동물 감사 54 M1). 실제 시드 행(hamster-dwarf 등)이 아니다. */
export const SECOND = {
  typeId: 'fixture-second',
  slug: 'hamster/fixture',
  careProfileId: 'cp-fixture-second',
  requirementIds: ['req-fixture-cage', 'req-fixture-wheel'],
  productId: 'cp-fixture-2',
  bundleId: 'sb-fixture-second',
} as const;

/**
 * 2타입 픽스처(메모리, 감사 54 M1): promoted()(골든) + 합성 두 번째 타입.
 *   두 번째 타입은 골든 행을 복제해 id·slug·표시명만 바꾼 자리표시다 — 드워프 등 실제 종의 사실값을 만들지 않고,
 *   실제 PLANNED 행(hamster-dwarf)을 승격하지도 않는다. 요구사항 2행(cage·wheel)은 골든 행을 id·careProfileId 만 바꿔 복제.
 *   상품 cp-fixture-2(B 프로필 전용)·번들 sb-fixture-second(B 프로필) 추가. 골든 쪽은 promoted() 그대로.
 */
export function promotedTwo(): SeedBundle {
  const s = promoted();
  const golden = s.animalTypes.find((x) => x.id === 'hamster-golden');
  const profile = s.careProfiles.find((x) => x.id === 'cp-hamster-syrian');
  if (!golden || !profile) throw new Error('fixture: 골든 체인 없음');
  s.animalTypes.push({
    ...clone(golden),
    id: SECOND.typeId,
    slug: SECOND.slug,
    displayName: '픽스처 두번째',
    aliases: ['픽스처 별칭'],
    careProfileId: SECOND.careProfileId,
    careOverrides: {},
    mascot: null,
    oneLiner: null,
    seoTitle: null,
    seoDescription: null,
    ...V,
  });
  s.careProfiles.push({ ...clone(profile), id: SECOND.careProfileId, name: '픽스처 두번째 프로필', ...V });
  const reqSrc: Record<string, string> = { 'req-fixture-cage': 'req-syrian-cage', 'req-fixture-wheel': 'req-syrian-wheel' };
  for (const id of SECOND.requirementIds) {
    const src = s.supplyRequirements.find((x) => x.id === reqSrc[id]);
    if (!src) throw new Error(`fixture: supplyRequirements#${reqSrc[id]} 없음`);
    s.supplyRequirements.push({ ...clone(src), id, careProfileId: SECOND.careProfileId, ...V });
  }
  const prod = s.curatedProducts.find((x) => x.id === 'cp-001');
  const bundle = s.setupBundles.find((x) => x.id === 'sb-syrian-budget');
  if (!prod || !bundle) throw new Error('fixture: cp-001·sb-syrian-budget 없음');
  s.curatedProducts.push({ ...clone(prod), id: SECOND.productId, title: '픽스처 쳇바퀴 B', careProfileIds: [SECOND.careProfileId] });
  s.setupBundles.push({ ...clone(bundle), id: SECOND.bundleId, name: '픽스처 세트 B', careProfileId: SECOND.careProfileId });
  return s;
}


/**
 * enum 표시 라벨(메모리, W-OPTLABEL 게이트 통과용) — 자리표시 "픽스처 라벨 N". 표기일 뿐 규격 사실이 아니다.
 */
export function labelEnums(seed: SeedBundle, itemId: string): void {
  const item = seed.supplyItems.find((x) => x.id === itemId);
  if (!item) throw new Error(`fixture: supplyItems#${itemId} 없음`);
  for (const f of item.specSchema.fields) {
    if (f.type === 'enum') f.optionLabels = Object.fromEntries(f.options.map((o, i) => [o, `픽스처 라벨 ${i + 1}`]));
  }
}

/** 시드 묶음을 디렉터리에 JSON 으로 쓴다(CLI·spa 테스트용 임시 시드). */
export function writeSeedDir(dir: string, seed: SeedBundle): void {
  mkdirSync(dir, { recursive: true });
  for (const [key, file] of Object.entries(SEED_FILES)) {
    writeFileSync(join(dir, file), `${JSON.stringify(seed[key as keyof SeedBundle], null, 2)}
`);
  }
}
