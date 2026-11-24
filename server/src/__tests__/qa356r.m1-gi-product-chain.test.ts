// 356r M1(불변식 3·7) — VERIFIED 상품이 GENERAL_INFO 체인(AI 초안 minSpec)에 연결되면
//   (a) 엔진 exposedVerdict 가 비노출(null) · (c) seed-exposure.mjs 도 비노출(패리티) · (b) seed:validate V13 ERROR.
//   픽스처: 디스크 VERIFIED 드워프 케이지 상품 cp-dw-001 의 careProfileIds 에 GENERAL_INFO 프로필 cp-hamster-robo 를
//   메모리에서만 더한다(디스크·사육 내용 0 변경). 로보 체인(타입·프로필·req-robo-cage)은 디스크에서 GENERAL_INFO.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkAnimalMinSpec,
  createCatalog,
  isProductExposable,
  isRequirementExposable,
  orderExposableProducts,
  resolveRequirement,
  type CuratedProductRec,
  type SeedBundle,
} from '../engine/index.js';
import { projectSite } from '../prerender/project.js';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import { SEED_FILES, type RawSeed, type Rec } from '../seed/common.js';
import { FIXTURE_AS_OF, realSeed } from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SEED_DIR = join(ROOT, 'server', 'seed');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  computeExposure: (seed: Record<string, unknown[]>, asOf: string) => { ids: Record<string, Set<string>>; productTypes: Set<string> };
};

const AS_OF = FIXTURE_AS_OF;
const PID = 'cp-dw-001';

function linked(): SeedBundle {
  const s = structuredClone(realSeed());
  const p = s.curatedProducts.find((x) => x.id === PID) as CuratedProductRec;
  p.careProfileIds = ['cp-hamster-dwarf', 'cp-hamster-robo'];
  return s;
}
const rawOf = (seed: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]]));
const roboProducts = (seed: SeedBundle): string[] => {
  const t = projectSite(seed, AS_OF).types.find((x) => x.id === 'hamster-robo');
  return t ? t.requirements.flatMap((r) => r.products.map((p) => p.id)) : [];
};

describe('픽스처 전제 — 구멍이 실제로 열려 있었다(비공허)', () => {
  it('로보 체인은 GENERAL_INFO 로 노출 가능하고 cp-dw-001 은 로보 minSpec(AI 초안)을 충족한다', () => {
    const s = linked();
    const cat = createCatalog(s);
    const r = resolveRequirement(cat, 'hamster-robo', 'cage');
    expect(r).not.toBeNull();
    expect(r!.review.requirement.reviewStatus).toBe('GENERAL_INFO');
    expect(isRequirementExposable(cat, r!, AS_OF)).toBe(true);
    const p = s.curatedProducts.find((x) => x.id === PID) as CuratedProductRec;
    expect(p.reviewStatus).toBe('VERIFIED');
    expect(p.status).toBe('ACTIVE');
    expect(p.meetsMinSpec).toBe(true);
    expect(checkAnimalMinSpec(cat, 'hamster-robo', 'cage', p.specValues).meets).toBe(true);
  });
});

describe('(a) 엔진 — GENERAL_INFO 체인 연결 상품 비노출', () => {
  it('로보에선 비노출, 드워프(VERIFIED 체인)에선 그대로 노출', () => {
    const s = linked();
    const cat = createCatalog(s);
    const p = s.curatedProducts.find((x) => x.id === PID) as CuratedProductRec;
    expect(isProductExposable(cat, 'hamster-robo', p, AS_OF)).toBe(false);
    expect(isProductExposable(cat, 'hamster-dwarf', p, AS_OF)).toBe(true);
    expect(orderExposableProducts(cat, 'hamster-robo', [p], AS_OF)).toEqual([]);
  });

  it('프리렌더 투영(projectSite) 로보 상품 0 · 엔진 ↔ mjs 패리티', () => {
    const s = linked();
    expect(roboProducts(s)).toEqual([]);
    const ex = mjs.computeExposure(rawOf(s), AS_OF);
    expect(ex.productTypes.has(`hamster-robo|${PID}`)).toBe(false);
    expect(ex.productTypes.has(`hamster-dwarf|${PID}`)).toBe(true);
    const engineProducts = [...new Set(projectSite(s, AS_OF).types.flatMap((t) => t.requirements.flatMap((r) => r.products.map((x) => x.id))))].sort();
    expect([...ex.ids.curatedProducts].sort()).toEqual(engineProducts);
  });

  it('디스크 그대로: 로보 상품 0 · 양쪽 상품 집합 동일', () => {
    const s = realSeed();
    expect(roboProducts(s)).toEqual([]);
    const ex = mjs.computeExposure(rawOf(s), AS_OF);
    const engineProducts = [...new Set(projectSite(s, AS_OF).types.flatMap((t) => t.requirements.flatMap((r) => r.products.map((x) => x.id))))].sort();
    expect([...ex.ids.curatedProducts].sort()).toEqual(engineProducts);
  });
});

describe('(b) seed:validate V13', () => {
  const base = (): Required<RawSeed> => structuredClone(readSeedDirRaw(SEED_DIR).raw) as Required<RawSeed>;
  const v13 = (s: RawSeed) => validateSeed(s, { now: AS_OF, strict: false }).errors.filter((i) => i.rule === 'V13');

  it('디스크 시드 → V13 0', () => {
    expect(v13(readSeedDirRaw(SEED_DIR).raw)).toEqual([]);
  });

  it('VERIFIED 상품 careProfileIds 에 GENERAL_INFO 프로필 → V13 ERROR 1건(프로필·요구사항·타입 명시)', () => {
    const s = base();
    const p = (s.curatedProducts as Rec[]).find((x) => x.id === PID) as Rec;
    p.careProfileIds = ['cp-hamster-dwarf', 'cp-hamster-robo'];
    const e = v13(s);
    expect(e.length).toBe(1);
    expect(e[0].id).toBe(PID);
    expect(e[0].file).toBe(SEED_FILES.curatedProducts);
    expect(e[0].message).toContain('CareProfile cp-hamster-robo');
    expect(e[0].message).toContain('SupplyRequirement req-robo-cage');
    expect(e[0].message).toContain('AnimalType hamster-robo');
  });

  it('VERIFIED 상품의 용품이 GENERAL_INFO → V13', () => {
    const s = base();
    const item = (s.supplyItems as Rec[]).find((x) => x.id === 'cage') as Rec;
    Object.assign(item, { reviewStatus: 'GENERAL_INFO', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null, draftedAt: '2026-11-20' });
    expect(v13(s).map((i) => i.id).sort()).toEqual(['cp-dw-001', 'cp-dw-002']);
  });

  it('비VERIFIED(DRAFT) 상품은 대상 아님', () => {
    const s = base();
    const p = (s.curatedProducts as Rec[]).find((x) => x.id === 'cp-003') as Rec;
    p.careProfileIds = ['cp-hamster-syrian', 'cp-hamster-robo'];
    expect(v13(s)).toEqual([]);
  });
});
