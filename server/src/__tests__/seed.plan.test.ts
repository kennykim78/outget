// R2-7 — planSeedWrites(순수) + map: 실제 시드 기반 연산 목록, SLOT 건너뜀, meetsMinSpec 재계산, prune 범위.
import { describe, expect, it } from 'vitest';
import { checkProfileMinSpec, createCatalog } from '../engine/index.js';
import type { CuratedProductRec, SeedBundle, SpecValues, TestimonialRec, VetClinicSeedRec } from '../engine/index.js';
import { DEFAULT_SEED_DIR } from '../seed/cli-validate.js';
import { mapCuratedProduct, mapVetClinic, stableJson } from '../seed/map.js';
import { planSeedWrites, type MeetsMinSpecRecompute, type WriteOp } from '../seed/plan.js';
import { readSeedDir } from '../seed/read.js';

const real = (): SeedBundle => readSeedDir(DEFAULT_SEED_DIR);
const engineRecompute = (b: SeedBundle): MeetsMinSpecRecompute => {
  const cat = createCatalog(b);
  return (cp, item, values) => checkProfileMinSpec(cat, cp, item, values as SpecValues).meets;
};
const upserts = (ops: WriteOp[], model: string) =>
  ops.filter((o): o is Extract<WriteOp, { op: 'upsert' }> => o.op === 'upsert' && o.model === model);
const deletes = (ops: WriteOp[], model: string) =>
  ops.filter((o): o is Extract<WriteOp, { op: 'deleteMany' }> => o.op === 'deleteMany' && o.model === model);

describe('planSeedWrites — real seed', () => {
  const b = real();
  const ops = planSeedWrites(b, engineRecompute(b));

  it('is deterministic', () => {
    const again = planSeedWrites(real(), engineRecompute(real()));
    expect(stableJson(again)).toBe(stableJson(ops));
  });

  it('upsert counts match the plan (SLOT rows skipped)', () => {
    const count = (m: string) => upserts(ops, m).length;
    expect({
      taxon: count('taxon'),
      careProfile: count('careProfile'),
      animalType: count('animalType'),
      supplyItem: count('supplyItem'),
      supplyRequirement: count('supplyRequirement'),
      compatibilityRule: count('compatibilityRule'),
      setupBundle: count('setupBundle'),
      curatedProduct: count('curatedProduct'),
      vetClinic: count('vetClinic'),
      testimonial: count('testimonial'),
    }).toEqual({
      taxon: 10, // 271: 1차 종 골격 phodopus-roborovskii·melopsittacus-undulatus·nymphicus-hollandicus(DRAFT, legal 미확인) +3 · R7 A4: 드워프 Taxon 2행(phodopus-sungorus·campbelli, DRAFT) 추가, 기니피그 S7: cavia-porcellus(DRAFT), 저빌 126: meriones-unguiculatus(DRAFT)
      careProfile: 7, // 271: cp-parrot-budgie·cp-parrot-cockatiel(DRAFT, facts {}) +2 · R7 A4: cp-hamster-dwarf(DRAFT) 추가, 기니피그 S7: cp-guineapig(DRAFT), 저빌 126: cp-gerbil-mongolian(DRAFT)
      animalType: 9, // 271: hamster-robo(PLANNED, DRAFT) +1
      supplyItem: 27, // 271: 앵무 공통 7(bird-cage·perch·bird-food·mineral·bird-bath·foraging-toy·cage-cover, 구조만·DRAFT) · R7-B: sand-bath-box 신설(모래목욕 통·모래 분리, 안 A), 기니피그 S8: playpen·hay·hay-rack·nail-clipper·brush
      supplyRequirement: 59, // R7-B: 드워프 15(서명 11 + 모래 2(v0.3) + 사료·저울 DRAFT) · 기니피그 S9 +16(DRAFT) · 저빌 126 +14(DRAFT)
      compatibilityRule: 4, // R7-B: cr-dwarf-wheel-cage-bedding·cr-dwarf-tubes-cage, BE92: 공용 2·골든 튜브 삭제 + cr-syrian-wheel-cage-bedding, 저빌 126: cr-gerbil-wheel-cage-bedding
      setupBundle: 6, // R7-B: sb-dwarf-budget·balanced·reuse(v0.3)
      curatedProduct: 17, // R7-B: cp-dw-001~017(v0.3, SLOT 아님)
      vetClinic: 0,
      testimonial: 0,
    });
    const items = ops.filter((o) => o.op === 'insertMany');
    expect(items).toHaveLength(1);
    expect(items[0].op === 'insertMany' && items[0].rows.length).toBe(53); // R7-B: 골든 25 + 드워프 25(7·11·7), BE92: 드워프 3종에 사료 +3(8·12·8)
  });

  it('fixed order: leaf prunes → upserts in dependency order → bundle items → parent prunes', () => {
    const seq = ops.map((o) => `${o.op}:${o.model}`).filter((s, i, a) => s !== a[i - 1]);
    expect(seq).toEqual([
      'deleteMany:setupBundleItem',
      'deleteMany:setupBundle',
      'deleteMany:curatedProduct',
      'deleteMany:compatibilityRule',
      'deleteMany:supplyRequirement',
      'deleteMany:testimonial',
      'deleteMany:vetClinic',
      'upsert:taxon',
      'upsert:careProfile',
      'upsert:animalType',
      'upsert:supplyItem',
      'upsert:supplyRequirement',
      'upsert:compatibilityRule',
      'upsert:setupBundle',
      'insertMany:setupBundleItem',
      'upsert:curatedProduct', // R7-B: 비SLOT 상품이 처음 생겨 upsert 단계가 나타난다
      'deleteMany:animalType',
      'deleteMany:supplyItem',
      'deleteMany:careProfile',
      'deleteMany:taxon',
    ]);
  });

  it('never touches runtime tables', () => {
    const models = new Set(ops.map((o) => o.model));
    for (const m of ['reactionSignal', 'taxonLegalRevision', 'user', 'refreshToken', 'report']) expect(models.has(m as never)).toBe(false);
  });

  it('VetClinic prune is limited to source SEED; testimonial prune spares IN_APP', () => {
    expect(deletes(ops, 'vetClinic')[0].where).toEqual({ source: 'SEED', id: { notIn: [] } });
    expect(deletes(ops, 'testimonial')[0].where).toEqual({ source: { not: 'IN_APP' }, id: { notIn: [] } });
  });

  it('bundle items keep seed order as position', () => {
    const ins = ops.find((o) => o.op === 'insertMany');
    const rows = ins && ins.op === 'insertMany' ? ins.rows : [];
    const budget = rows.filter((r) => r.bundleId === 'sb-syrian-budget');
    expect(budget.map((r) => [r.position, r.supplyItemId])).toEqual(
      b.setupBundles[0].itemIds.map((id, i) => [i, id]),
    );
  });

  it('JSON columns are strings; SupplyItem carries no requirement fields', () => {
    const cage = upserts(ops, 'supplyItem').find((o) => o.id === 'cage')!.data;
    expect(typeof cage.specSchema).toBe('string');
    expect(JSON.parse(String(cage.specSchema))).toEqual(b.supplyItems.find((x) => x.id === 'cage')!.specSchema);
    for (const k of ['priority', 'minSpec', 'recommendedSpec', 'orderHint', 'searchKeyword', 'notNowReason']) {
      expect(cage).not.toHaveProperty(k);
    }
    const golden = upserts(ops, 'animalType').find((o) => o.id === 'hamster-golden')!.data;
    expect(JSON.parse(String(golden.aliases))).toContain('골햄');
  });
});

describe('planSeedWrites — products, vets, testimonials (injected non-SLOT rows)', () => {
  function withRows(): SeedBundle {
    const b = real();
    const activate = (id: string, seedValue: boolean | null): CuratedProductRec => {
      const p = b.curatedProducts.find((x) => x.id === id)!;
      return { ...p, status: 'REVIEW', title: `제품 ${id}`, meetsMinSpec: seedValue };
    };
    b.curatedProducts = [
      activate('cp-001', false), // 시드 값이 틀려도 재계산값(true)을 쓴다
      // BE92: 철망 간격은 WIRE 만(85) + 목표 100×50×50 → 높이 40 으로 낮춰 재계산 false 를 만든다
      { ...activate('cp-003', true), specValues: { type: 'LIVING_BOX', floorWcm: 100, floorDcm: 50, heightCm: 40 } },
      { ...activate('cp-005', true), careProfileIds: [] },
      ...b.curatedProducts.filter((x) => x.status === 'SLOT').slice(0, 1),
    ];
    const vet: VetClinicSeedRec = {
      ...b.vetClinics[0],
      name: '테스트 동물병원',
      phone: '02-000-0000',
      address: '서울 마포구 어딘가',
      verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-30', note: '전화 확인' },
    };
    b.vetClinics = [vet, b.vetClinics[1]];
    const t: TestimonialRec = { ...b.testimonials[0], status: 'SUBMITTED', quote: '체크리스트가 도움이 됐어요' };
    b.testimonials = [t, b.testimonials[1]];
    return b;
  }

  it('meetsMinSpec is the engine recompute, not the seed value; empty profiles → false', () => {
    const b = withRows();
    const ops = planSeedWrites(b, engineRecompute(b));
    const got = Object.fromEntries(upserts(ops, 'curatedProduct').map((o) => [o.id, o.data.meetsMinSpec]));
    expect(got).toEqual({ 'cp-001': true, 'cp-003': false, 'cp-005': false });
  });

  it('recompute is ANDed over every careProfileId', () => {
    const b = withRows();
    b.curatedProducts = [{ ...b.curatedProducts[0], careProfileIds: ['cp-hamster-syrian', 'cp-other'] }];
    const seen: string[] = [];
    const ops = planSeedWrites(b, (cp) => {
      seen.push(cp);
      return cp === 'cp-hamster-syrian';
    });
    expect(seen).toEqual(['cp-hamster-syrian', 'cp-other']);
    expect(upserts(ops, 'curatedProduct')[0].data.meetsMinSpec).toBe(false);
  });

  it('curated drafting fields are dropped; vet verification is flattened with source SEED', () => {
    const b = withRows();
    const ops = planSeedWrites(b, engineRecompute(b));
    const p = upserts(ops, 'curatedProduct')[0].data;
    for (const k of ['note', 'targetSpecLabel', 'curationReasons']) expect(p).not.toHaveProperty(k);
    const v = upserts(ops, 'vetClinic');
    expect(v).toHaveLength(1);
    expect(v[0].data).toMatchObject({
      source: 'SEED',
      status: 'VERIFIED',
      verificationMethod: 'PHONE_CALL',
      verifiedAt: '2026-09-30',
      verificationNote: '전화 확인',
    });
    expect(v[0].data).not.toHaveProperty('verification');
    expect(deletes(ops, 'vetClinic')[0].where).toEqual({ source: 'SEED', id: { notIn: [v[0].id] } });
    expect(upserts(ops, 'testimonial').map((o) => o.id)).toEqual(['t-001']);
  });

  it('map helpers are pure', () => {
    const b = withRows();
    const before = JSON.stringify(b);
    mapCuratedProduct(b.curatedProducts[0], true);
    mapVetClinic(b.vetClinics[0]);
    planSeedWrites(b, engineRecompute(b));
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('planSeedWrites — prune: false', () => {
  it('no prunes; bundle items cleared only for seed bundles', () => {
    const b = real();
    const ops = planSeedWrites(b, engineRecompute(b), { prune: false });
    const dels = ops.filter((o) => o.op === 'deleteMany');
    expect(dels).toEqual([
      {
        op: 'deleteMany',
        model: 'setupBundleItem',
        where: { bundleId: { in: b.setupBundles.map((x) => x.id) } },
      },
    ]);
  });
});

describe('runLoadCli — validate first, zero writes on error', () => {
  it('validation error → exit 1 and the Prisma factory is never called', async () => {
    const { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runLoadCli } = await import('../seed/cli-load.js');
    const dir = mkdtempSync(join(tmpdir(), 'ws-seed-'));
    try {
      cpSync(DEFAULT_SEED_DIR, dir, { recursive: true });
      const f = join(dir, 'supply-items.json');
      const rows = JSON.parse(readFileSync(f, 'utf8')) as Array<Record<string, unknown>>;
      rows[0].reviewStatus = 'VERIFIED';
      rows[0].reviewerType = 'AI_DRAFT'; // AI_DRAFT + VERIFIED → V01(R7-B: 디스크 cage 는 이미 EXPERIENCED_KEEPER VERIFIED)
      writeFileSync(f, JSON.stringify(rows));
      let opened = 0;
      const err: string[] = [];
      const code = await runLoadCli(['--dir', dir, '--now', '2026-10-24'], {
        stdout: () => undefined,
        stderr: (l) => err.push(l),
        today: () => '2026-10-24',
        prisma: async () => {
          opened += 1;
          throw new Error('must not open the database');
        },
      });
      expect(code).toBe(1);
      expect(opened).toBe(0);
      expect(err.some((l) => l.includes('[V01]'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('bad arguments → exit 2 without opening the database', async () => {
    const { runLoadCli } = await import('../seed/cli-load.js');
    let opened = 0;
    const code = await runLoadCli(['--bogus'], {
      stdout: () => undefined,
      stderr: () => undefined,
      today: () => '2026-10-24',
      prisma: async () => {
        opened += 1;
        throw new Error('no');
      },
    });
    expect(code).toBe(2);
    expect(opened).toBe(0);
  });
});
