// 서명 매니페스트(보안 79 H-1, Kenny 2026-10-25 'H-1 라벨') — G01~G06·V09·V10 + apply-review-signatures.mjs round-trip.
//   실시드는 임시 디렉터리 복사본에서만 변조한다(디스크 시드 변경 0). 기준일 고정(실시계 0).
import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { CONTENT_KEYS, SEED_FILES, type RawSeed } from '../seed/common.js';
import { runValidateCli, type CliIo } from '../seed/cli-validate.js';
import { readSeedDirRaw } from '../seed/read.js';
import { factHash, FACT_FIELDS, SIGNATURE_FIELDS, SIGNATURE_FILE, type SignatureEntry } from '../seed/signatures.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import {
  DWARF_PACKET_PATH,
  DWARF_PREVIEW_AS_OF,
  SEED_DIR,
  applyMjs,
  dwarfAllCheckedResult,
  dwarfPacket,
  dwarfSignedWith,
  filesOf,
  realSeed,
  type DwarfPacket,
} from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DRAFT_DIR = join(ROOT, 'docs', 'planning-artifacts', 'seed-draft');
const NOW = DWARF_PREVIEW_AS_OF;
const mjsSig = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'review-signature.mjs')).href)) as {
  factHash: (file: string, row: unknown) => string;
  FACT_FIELDS: readonly string[];
  SIGNATURE_FIELDS: readonly string[];
};
const equivMjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'seed-equivalence.mjs')).href)) as {
  FACT_FIELDS: readonly string[];
  compareDirs: (a: string, b: string) => string[];
};

type Row = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const rawOf = (s: SeedBundle): RawSeed => clone(s) as unknown as RawSeed;
const rowOf = (s: RawSeed | SeedBundle, key: keyof RawSeed, id: string): Row => {
  const r = ((s as Record<string, unknown[]>)[key] as Row[]).find((x) => x.id === id);
  if (!r) throw new Error(`${String(key)}#${id} 없음`);
  return r;
};
const run = (raw: RawSeed, manifest: unknown): ValidateResult =>
  validateSeed(raw, { now: NOW, signatures: { missing: false, data: manifest } });
const rules = (r: ValidateResult): string[] => [...new Set(r.errors.map((i) => i.rule))].sort();
const errsOf = (r: ValidateResult, rule: string) => r.errors.filter((i) => i.rule === rule);

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
function tempCopy(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'withsmall-sig-'));
  temps.push(dir);
  cpSync(src, dir, { recursive: true });
  return dir;
}
async function validateCli(dir: string): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => out.push(l), today: () => NOW };
  return { code: await runValidateCli(['--dir', dir, '--now', NOW], io), out };
}
function applyCli(argv: string[]): { code: number; out: string[] } {
  const out: string[] = [];
  const code = applyMjs.main(argv, { out: (l) => out.push(l), err: (l) => out.push(l) });
  return { code, out };
}
const writeJson = (dir: string, name: string, v: unknown): string => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(v, null, 2));
  return p;
};

describe('해시 단일 정의 — TS(signatures.ts) ↔ mjs(review-signature.mjs) ↔ seed-equivalence', () => {
  it('필드 목록 같음(fact-fields.json 단일 출처), seed-equivalence FACT_FIELDS 25종 그대로', () => {
    expect([...mjsSig.FACT_FIELDS]).toEqual([...FACT_FIELDS]);
    expect([...equivMjs.FACT_FIELDS]).toEqual([...FACT_FIELDS]);
    expect([...mjsSig.SIGNATURE_FIELDS]).toEqual([...SIGNATURE_FIELDS]);
    expect(FACT_FIELDS).toHaveLength(25);
    // 검수 메타·공개 상태는 해시 밖(재표기·게이트 G 가 서명을 깨지 않는다).
    for (const k of ['reviewStatus', 'reviewerType', 'verifiedBy', 'verifiedAt', 'reviewBasis', 'specVerifiedBy', 'specVerifiedAt', 'status', 'meetsMinSpec', 'glyph', 'slug']) {
      expect(SIGNATURE_FIELDS).not.toContain(k);
    }
  });
  it('실시드·메모리 서명 시드 전 콘텐츠 행에서 두 구현 해시 일치', () => {
    let n = 0;
    for (const s of [realSeed(), dwarfSignedWith().seed]) {
      for (const k of CONTENT_KEYS) {
        for (const r of s[k as keyof SeedBundle] as unknown as Row[]) {
          expect(mjsSig.factHash(SEED_FILES[k], r)).toBe(factHash(SEED_FILES[k], r));
          n++;
        }
      }
    }
    expect(n).toBe(2 * 149); // 콘텐츠 8파일 149행 × 2 (283 앵무 크기 묶음: Taxon +2 · CP 합침 2→3 +1 · AnimalType +2) (271: 1차 종 골격 Taxon +3 · CP +2 · SupplyItem +7 · AnimalType +1, BE92: 호환 규칙 5 → 3, 기니피그 S7 Taxon·CP +2 · S8 SupplyItem +5 · S9 요구사항 +16, 저빌 126 Taxon·CP +2 · 요구사항 +14 · 호환 규칙 +1)
  });
  it('해시는 키 순서·optionLabels·검수 메타와 무관, 사실 1글자 변경에는 반응', () => {
    const r = clone(rowOf(realSeed(), 'supplyRequirements', 'req-dwarf-cage'));
    const h = factHash('supply-requirements.json', r);
    const reordered = Object.fromEntries(Object.entries(r).reverse());
    expect(factHash('supply-requirements.json', reordered)).toBe(h);
    expect(factHash('supply-requirements.json', { ...r, reviewStatus: 'VERIFIED', verifiedBy: 'x', reviewBasis: 'ROW_CHECKED' })).toBe(h);
    expect(factHash('supply-requirements.json', { ...r, why: `${String(r.why)}.` })).not.toBe(h);
    expect(factHash('supply-items.json', r)).not.toBe(h); // 파일도 해시에 들어간다
    const item = clone(rowOf(realSeed(), 'supplyItems', 'cage'));
    const hi = factHash('supply-items.json', item);
    const fields = (item.specSchema as { fields: Row[] }).fields;
    const en = fields.find((f) => f.type === 'enum');
    if (!en) throw new Error('enum 없음');
    en.optionLabels = { [String((en.options as string[])[0])]: '라벨' };
    expect(factHash('supply-items.json', item)).toBe(hi);
    en.options = [...(en.options as string[]), 'NEW_OPTION'];
    expect(factHash('supply-items.json', item)).not.toBe(hi);
  });
});

describe('실시드(환원 후) — VERIFIED 0·매니페스트 []·errors 0', () => {
  it('server/seed 와 seed-draft 의 review-signatures.json = [] (바이트 동일)', () => {
    for (const d of [SEED_DIR, DRAFT_DIR]) expect(readFileSync(join(d, SIGNATURE_FILE), 'utf8')).toBe('[]');
  });
  it('seed:validate CLI(매니페스트 포함) errors 0', async () => {
    const r = await validateCli(SEED_DIR);
    expect(r.out.filter((l) => l.startsWith('ERROR'))).toEqual([]);
    expect(r.code).toBe(0);
  });
  it('모든 콘텐츠 행에 reviewBasis 키(null)', () => {
    const { raw } = readSeedDirRaw(SEED_DIR);
    for (const k of CONTENT_KEYS) for (const r of raw[k] as Row[]) expect([r.id, Object.prototype.hasOwnProperty.call(r, 'reviewBasis'), r.reviewBasis]).toEqual([r.id, true, null]);
  });
});

describe('G01~G06 — 서명 매니페스트 불일치는 각각 error', () => {
  const signed = (): { raw: RawSeed; manifest: SignatureEntry[] } => {
    const { seed, manifest } = dwarfSignedWith();
    return { raw: rawOf(seed), manifest: clone(manifest) };
  };
  const entry = (m: SignatureEntry[], file: string, id: string): SignatureEntry => {
    const e = m.find((x) => x.file === file && x.id === id);
    if (!e) throw new Error(`entry ${file}#${id} 없음`);
    return e;
  };

  it('정상: 가짜 확인표(전 ☑·C) 서명 52행(50 + 사료 D1 + 용품 사료 C) + 매니페스트 52 → errors 0', () => {
    const { raw, manifest } = signed();
    expect(manifest).toHaveLength(52);
    expect(run(raw, manifest).errors).toEqual([]);
  });
  it('G05 사실 변조(서명 뒤 why 1글자) → G05 만', () => {
    const { raw, manifest } = signed();
    const r = rowOf(raw, 'supplyRequirements', 'req-dwarf-cage');
    r.why = `${String(r.why)} `;
    const res = run(raw, manifest);
    expect(rules(res)).toEqual(['G05']);
    expect(errsOf(res, 'G05').map((i) => i.id)).toEqual(['req-dwarf-cage']);
  });
  it('G05 상품 규격값 변조(specValues) → G05 (P01 재계산과 별개로 서명 깨짐)', () => {
    const { raw, manifest } = signed();
    (rowOf(raw, 'curatedProducts', 'cp-dw-003').specValues as Row).diameterCm = 28.5;
    expect(errsOf(run(raw, manifest), 'G05').map((i) => i.id)).toEqual(['cp-dw-003']);
  });
  it('G05 매니페스트 factHash 변조 → G05', () => {
    const { raw, manifest } = signed();
    const e = entry(manifest, 'supply-items.json', 'wheel');
    e.factHash = e.factHash.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    expect(rules(run(raw, manifest))).toEqual(['G05']);
  });
  it('G02 누락: VERIFIED 행의 항목 삭제 → G02', () => {
    const { raw, manifest } = signed();
    const m = manifest.filter((x) => x.id !== 'cp-hamster-dwarf');
    const res = run(raw, m);
    expect(rules(res)).toEqual(['G02']);
    expect(errsOf(res, 'G02').map((i) => i.id)).toEqual(['cp-hamster-dwarf']);
  });
  it('G02 AI_DRAFT 를 사람 표기로 바꿔 VERIFIED 로 올려도 서명 없으면 → G02(V01 이 못 잡는 재표시 경로, H-1)', () => {
    const { raw, manifest } = signed();
    Object.assign(rowOf(raw, 'supplyRequirements', 'req-dwarf-scale'), { reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', verifiedBy: 'kenny', verifiedAt: NOW, reviewBasis: 'AI_RESEARCH_BULK' });
    expect(errsOf(run(raw, manifest), 'G02').map((i) => i.id)).toEqual(['req-dwarf-scale']);
  });
  it('G03 고아: 행을 DRAFT 로 되돌리고 항목은 남김 → G03 / 없는 id 항목 → G03', () => {
    const { raw, manifest } = signed();
    Object.assign(rowOf(raw, 'setupBundles', 'sb-dwarf-budget'), { reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
    const ghost = { ...entry(manifest, 'setup-bundles.json', 'sb-dwarf-reuse'), id: 'sb-dwarf-ghost' };
    const res = run(raw, [...manifest, ghost]);
    expect(rules(res)).toEqual(['G03']);
    expect(errsOf(res, 'G03').map((i) => i.id).sort()).toEqual(['sb-dwarf-budget', 'sb-dwarf-ghost']);
  });
  it('G04 basis 불일치(행 ROW_CHECKED ↔ 서명 AI_RESEARCH_BULK) → G04', () => {
    const { raw, manifest } = signed();
    entry(manifest, 'curated-products.json', 'cp-dw-010').basis = 'AI_RESEARCH_BULK';
    const res = run(raw, manifest);
    expect(rules(res)).toEqual(['G04', 'G06']); // 상품 규격 확인은 ROW_CHECKED 서명만(G06) 도 함께
    expect(errsOf(res, 'G04').map((i) => i.path)).toEqual(['reviewBasis']);
  });
  it('G04 basis 불일치(행 AI_RESEARCH_BULK 를 ROW_CHECKED 로 재표기, 매니페스트는 BULK) → G04', () => {
    const { raw, manifest } = signed();
    rowOf(raw, 'supplyItems', 'tubes').reviewBasis = 'ROW_CHECKED';
    expect(rules(run(raw, manifest))).toEqual(['G04']);
  });
  it('G04 verifiedBy·verifiedAt(=signedAt) 불일치 → G04 2건', () => {
    const { raw, manifest } = signed();
    Object.assign(rowOf(raw, 'compatibilityRules', 'cr-dwarf-tubes-cage'), { verifiedBy: 'someone', verifiedAt: '2026-10-23' });
    const res = run(raw, manifest);
    expect(rules(res)).toEqual(['G04']);
    expect(errsOf(res, 'G04').map((i) => i.path).sort()).toEqual(['verifiedAt', 'verifiedBy']);
  });
  it('G06 상품 specVerifiedAt ≠ signedAt / DRAFT 상품에 specVerifiedBy → G06', () => {
    const { raw, manifest } = signed();
    rowOf(raw, 'curatedProducts', 'cp-dw-001').specVerifiedAt = '2026-10-23';
    rowOf(raw, 'curatedProducts', 'cp-001').specVerifiedBy = 'kenny'; // 골든 SLOT·DRAFT
    const res = run(raw, manifest);
    expect(errsOf(res, 'G06').map((i) => `${String(i.id)}.${i.path}`).sort()).toEqual(['cp-001.specVerifiedBy', 'cp-dw-001.specVerifiedAt']);
  });
  it('G01 형식: 배열 아님 / 알 수 없는 키 / 잘못된 해시 / 중복 / 미래 signedAt / 콘텐츠 밖 file', () => {
    const { raw, manifest } = signed();
    expect(rules(run(raw, { entries: manifest }))).toContain('G01');
    const bad = (mut: (e: Row) => void): string[] => {
      const m = clone(manifest) as unknown as Row[];
      mut(m[0]);
      return rules(run(raw, m));
    };
    expect(bad((e) => { e.note = 'x'; })).toContain('G01');
    expect(bad((e) => { e.factHash = 'abc'; })).toContain('G01');
    expect(bad((e) => { e.signedAt = '2099-01-01'; })).toContain('G01');
    expect(bad((e) => { e.file = 'vet-clinics.json'; })).toContain('G01');
    expect(bad((e) => { e.basis = 'OPERATOR_SAID_SO'; })).toContain('G01');
    expect(rules(run(raw, [...manifest, clone(manifest[0])]))).toContain('G01');
  });
  it('G01 매니페스트 파일 없음(CLI) → exit 1', async () => {
    const dir = tempCopy(SEED_DIR);
    unlinkSync(join(dir, SIGNATURE_FILE));
    const r = await validateCli(dir);
    expect(r.code).toBe(1);
    expect(r.out.some((l) => l.startsWith('ERROR [G01]'))).toBe(true);
  });
  it('G01 매니페스트 JSON 파싱 실패(CLI) → exit 1', async () => {
    const dir = tempCopy(SEED_DIR);
    writeFileSync(join(dir, SIGNATURE_FILE), '[{');
    const r = await validateCli(dir);
    expect(r.code).toBe(1);
    expect(r.out.some((l) => l.startsWith('ERROR [G01]'))).toBe(true);
  });
});

describe('V09·V10 — reviewBasis 행 규칙(매니페스트 없이도)', () => {
  const base = (): RawSeed => rawOf(dwarfSignedWith().seed);
  const v = (raw: RawSeed): ValidateResult => validateSeed(raw, { now: NOW });
  it('S04 reviewBasis 키 누락 → S04', () => {
    const raw = rawOf(realSeed());
    delete rowOf(raw, 'taxa', 'mesocricetus-auratus').reviewBasis;
    expect(errsOf(v(raw), 'S04').map((i) => i.path)).toEqual(['reviewBasis']);
  });
  it('S03 reviewBasis 알 수 없는 값 → S03', () => {
    const raw = rawOf(realSeed());
    rowOf(raw, 'taxa', 'mesocricetus-auratus').reviewBasis = 'TRUST_ME';
    expect(rules(v(raw))).toContain('S03');
  });
  it('V09 DRAFT 인데 reviewBasis 값 / VERIFIED 인데 null → V09', () => {
    const raw = base();
    rowOf(raw, 'supplyRequirements', 'req-dwarf-scale').reviewBasis = 'AI_RESEARCH_BULK';
    rowOf(raw, 'supplyItems', 'chew').reviewBasis = null;
    expect(errsOf(v(raw), 'V09').map((i) => i.id).sort()).toEqual(['chew', 'req-dwarf-scale']);
  });
  it('V10 상품·최소 규격 행은 ROW_CHECKED 만(일괄 승인 불가)', () => {
    const raw = base();
    rowOf(raw, 'curatedProducts', 'cp-dw-012').reviewBasis = 'AI_RESEARCH_BULK';
    rowOf(raw, 'supplyRequirements', 'req-dwarf-wheel').reviewBasis = 'AI_RESEARCH_BULK';
    rowOf(raw, 'supplyRequirements', 'req-dwarf-hideout').reviewBasis = 'ROW_CHECKED'; // 최소 규격 없는 행은 둘 다 허용
    expect(errsOf(v(raw), 'V10').map((i) => i.id).sort()).toEqual(['cp-dw-012', 'req-dwarf-wheel']);
  });
});

describe('apply-review-signatures.mjs — 확인표 결과 → 시드·매니페스트', () => {
  const NOW_ARGS = ['--now', NOW];
  const packetArgs = ['--packet', DWARF_PACKET_PATH];
  const pair = (): { seed: string; draft: string } => ({ seed: tempCopy(SEED_DIR), draft: tempCopy(DRAFT_DIR) });
  const bytes = (dir: string): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

  it('round-trip: 가짜 확인표(전 ☑·C) → VERIFIED 52·매니페스트 52·validate 0 → 미서명 결과로 되돌리면 원래 바이트', async () => {
    const { seed, draft } = pair();
    const before = bytes(seed);
    const resDir = mkdtempSync(join(tmpdir(), 'withsmall-sigres-'));
    temps.push(resDir);
    const all = writeJson(resDir, 'all.json', dwarfAllCheckedResult(NOW));
    const a = applyCli([...packetArgs, '--result', all, '--seed', seed, '--draft', draft, ...NOW_ARGS]);
    expect(a.out.join('\n')).toContain('ROW_CHECKED 22 · AI_RESEARCH_BULK 30'); // 245: req-dwarf-tubes 일괄 → A11
    expect(a.code).toBe(0);
    const m = JSON.parse(readFileSync(join(seed, SIGNATURE_FILE), 'utf8')) as SignatureEntry[];
    expect(m).toHaveLength(52);
    expect(readFileSync(join(draft, SIGNATURE_FILE), 'utf8')).toBe(readFileSync(join(seed, SIGNATURE_FILE), 'utf8'));
    const v = await validateCli(seed);
    expect(v.out.filter((l) => l.startsWith('ERROR'))).toEqual([]);
    expect(v.code).toBe(0);
    expect((await validateCli(draft)).code).toBe(0);
    expect(equivMjs.compareDirs(seed, draft)).toEqual([]);
    expect(equivMjs.compareDirs(SEED_DIR, seed).filter((x) => !x.startsWith(SIGNATURE_FILE))).toEqual([]); // 사실 필드 0 변경(매니페스트는 달라야 정상)
    const prods = JSON.parse(readFileSync(join(seed, 'curated-products.json'), 'utf8')) as Row[];
    const dw = prods.filter((p) => String(p.id).startsWith('cp-dw-'));
    expect(dw.every((p) => p.status === (p.id === 'cp-dw-009' ? 'REVIEW' : 'ACTIVE') && p.specVerifiedBy === 'kenny' && p.specVerifiedAt === NOW && p.reviewBasis === 'ROW_CHECKED')).toBe(true); // cp-dw-009: meetsMinSpec=false(무향 근거 소멸) → 서명돼도 REVIEW 유지
    // 사료(확인표 D1): 행 reviewerType VET_PUBLISHED_SOURCE + ROW_CHECKED, 나머지는 패킷 기본 EXPERIENCED_KEEPER. V03·V04·V08 은 위 validate 0 으로 통과.
    const reqs = JSON.parse(readFileSync(join(seed, 'supply-requirements.json'), 'utf8')) as Row[];
    expect(reqs.find((r) => r.id === 'req-dwarf-food')).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', verifiedBy: 'kenny', verifiedAt: NOW, reviewBasis: 'ROW_CHECKED', contentKind: 'FOOD' });
    expect(m.find((e) => e.id === 'req-dwarf-food')).toMatchObject({ file: 'supply-requirements.json', basis: 'ROW_CHECKED', signedBy: 'kenny', signedAt: NOW });
    expect(reqs.filter((r) => r.reviewStatus === 'VERIFIED' && r.id !== 'req-dwarf-food').every((r) => r.reviewerType === 'EXPERIENCED_KEEPER')).toBe(true);
    expect(reqs.find((r) => r.id === 'req-dwarf-scale')).toMatchObject({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT' }); // 저울은 패킷 밖

    const unsigned = join(ROOT, 'scripts', 'review-packets', 'hamster-dwarf-core.result.unsigned.json');
    expect(applyCli([...packetArgs, '--result', unsigned, '--seed', seed, '--draft', draft, ...NOW_ARGS]).code).toBe(0);
    expect(bytes(seed)).toEqual(before);
  });

  it('부분 확인: A1 만 ☑ → 케이지 최소 규격 행은 DRAFT(A1~A4 전부 필요), ☑ 상품만 ROW_CHECKED, C 미서명이면 나머지 DRAFT', () => {
    const p = dwarfPacket();
    const result = { ...dwarfAllCheckedResult(NOW), checked: ['A1', 'A5', 'A6', 'A9', 'cp-dw-003'], bulkSignedAt: null };
    const { seed, manifest } = dwarfSignedWith(result);
    expect(manifest.map((e) => e.id).sort()).toEqual(['cp-dw-003', 'req-dwarf-wheel']);
    expect(rowOf(seed, 'supplyRequirements', 'req-dwarf-cage').reviewStatus).toBe('DRAFT');
    expect(rowOf(seed, 'curatedProducts', 'cp-dw-001')).toMatchObject({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', specVerifiedBy: null, status: 'REVIEW' });
    expect(rowOf(seed, 'curatedProducts', 'cp-dw-003')).toMatchObject({ reviewStatus: 'VERIFIED', reviewBasis: 'ROW_CHECKED', status: 'ACTIVE' });
    for (const r of p.bulk.rows) expect(rowOf(seed, (CONTENT_KEYS.find((k) => SEED_FILES[k] === r.file) as keyof RawSeed), r.id).reviewStatus).toBe('DRAFT');
    expect(run(rawOf(seed), manifest).errors).toEqual([]);
  });

  it('C 만 서명 → 30행 AI_RESEARCH_BULK(BE92: 용품 사료 포함, 245: 터널은 최소 규격 행이라 빠짐), 상품·최소 규격 행은 DRAFT', () => {
    const { seed, manifest } = dwarfSignedWith({ ...dwarfAllCheckedResult(NOW), checked: [], checkedAt: null });
    expect(manifest).toHaveLength(30);
    expect(rowOf(seed, 'supplyRequirements', 'req-dwarf-tubes').reviewStatus).toBe('DRAFT');
    expect(manifest.every((e) => e.basis === 'AI_RESEARCH_BULK')).toBe(true);
    expect(rowOf(seed, 'supplyRequirements', 'req-dwarf-bedding').reviewStatus).toBe('DRAFT');
    expect(run(rawOf(seed), manifest).errors).toEqual([]);
  });

  describe('사료 D1(확인표 D, Kenny 2026-10-25 \'84 수령\') — 행 reviewerType VET_PUBLISHED_SOURCE + ROW_CHECKED', () => {
    const allOk = (): Record<string, unknown> => dwarfAllCheckedResult(NOW);
    const without = (item: string): Record<string, unknown> => ({ ...allOk(), checked: (allOk().checked as string[]).filter((x) => x !== item) });
    /** 미리보기 사본: 서명 결과 + hamster-dwarf 만 ACTIVE(메모리). 매니페스트 없이 검증(status 는 서명 대상 아님). */
    const previewOf = (seed: SeedBundle): RawSeed => {
      const raw = rawOf(seed);
      rowOf(raw, 'animalTypes', 'hamster-dwarf').status = 'ACTIVE';
      return raw;
    };
    /** BE92 이전 패킷(SupplyItem food 가 C 일괄 밖) 사본 — 오케스트레이터 90 Q1 결정으로 실패킷은 food 를 포함한다. */
    const packetWithoutFoodItem = (): DwarfPacket => {
      const p = dwarfPacket();
      return { ...p, bulk: { ...p.bulk, rows: p.bulk.rows.filter((r) => !(r.file === 'supply-items.json' && r.id === 'food')) } };
    };
    const signWith = (packet: DwarfPacket, result: Record<string, unknown>): { seed: SeedBundle; manifest: SignatureEntry[] } => {
      const s = clone(realSeed());
      const res = applyMjs.applySignatures(filesOf(s), [], packet, result, { now: NOW });
      for (const k of CONTENT_KEYS) (s as unknown as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
      return { seed: s, manifest: res.manifest };
    };

    it('D1 ☑ → req-dwarf-food VERIFIED·VET_PUBLISHED_SOURCE·ROW_CHECKED, V03·V04·V08·G* 0(국내 koreascience.kr)', () => {
      const { seed, manifest } = dwarfSignedWith(allOk());
      const food = rowOf(seed, 'supplyRequirements', 'req-dwarf-food');
      expect(food).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', verifiedBy: 'kenny', verifiedAt: NOW, reviewBasis: 'ROW_CHECKED' });
      expect((food.source as Array<{ url: string }>).map((x) => x.url)).toContain('https://koreascience.kr/article/JAKO199972606584618.page');
      const res = run(rawOf(seed), manifest);
      expect(res.errors).toEqual([]);
      for (const rule of ['V03', 'V04', 'V08']) expect(errsOf(res, rule)).toEqual([]);
    });

    it('D1 ☑ 인데 행 reviewerType 을 EXPERIENCED_KEEPER 로 내리면 → V03(FOOD 최소 VET_PUBLISHED_SOURCE)', () => {
      const p = dwarfPacket();
      const q = { ...p, rowChecked: p.rowChecked.map((r) => (r.id === 'req-dwarf-food' ? { ...r, reviewerType: 'EXPERIENCED_KEEPER' } : r)) };
      const { seed, manifest } = signWith(q, allOk());
      expect(errsOf(run(rawOf(seed), manifest), 'V03').map((i) => i.id)).toEqual(['req-dwarf-food']);
    });

    it('D1 ☑ 인데 국내 출처(K1)를 빼면 → V08', () => {
      const { seed } = dwarfSignedWith(allOk());
      const raw = rawOf(seed);
      const food = rowOf(raw, 'supplyRequirements', 'req-dwarf-food');
      food.source = (food.source as Array<{ url: string }>).filter((x) => !x.url.includes('koreascience.kr'));
      expect(errsOf(validateSeed(raw, { now: NOW }), 'V08').map((i) => i.id)).toEqual(['req-dwarf-food']);
    });

    it('패킷 행 reviewerType 형식: AI_DRAFT·알 수 없는 값·알 수 없는 키 → 입력 거부', () => {
      const p = dwarfPacket();
      const bad = (patchRow: Record<string, unknown>) => ({ ...p, rowChecked: p.rowChecked.map((r) => (r.id === 'req-dwarf-food' ? { ...r, ...patchRow } : r)) });
      for (const q of [bad({ reviewerType: 'AI_DRAFT' }), bad({ reviewerType: 'DOCTOR' }), bad({ basis: 'ROW_CHECKED' })]) {
        expect(() => signWith(q as DwarfPacket, allOk())).toThrow(/패킷 오류/);
      }
    });

    it('D1 미☑ → req-dwarf-food DRAFT·AI_DRAFT 유지, 미리보기(ACTIVE) X01 차단 유지(사료 1건)', () => {
      const { seed, manifest } = dwarfSignedWith(without('D1'));
      expect(rowOf(seed, 'supplyRequirements', 'req-dwarf-food')).toMatchObject({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT', verifiedBy: null, verifiedAt: null, reviewBasis: null });
      expect(manifest.some((e) => e.id === 'req-dwarf-food')).toBe(false);
      expect(run(rawOf(seed), manifest).errors).toEqual([]);
      const x = errsOf(validateSeed(previewOf(seed), { now: NOW }), 'X01');
      expect(x.map((i) => `${String(i.id)} ${i.path}`)).toEqual(['hamster-dwarf requirements.food']);
      expect(x[0].message).toContain('req-dwarf-food');
      // 실패킷은 SupplyItem food 를 C 로 서명한다(Q1) — 그래도 D1 미☑ 면 X01 그대로.
      expect(rowOf(seed, 'supplyItems', 'food')).toMatchObject({ reviewStatus: 'VERIFIED', reviewBasis: 'AI_RESEARCH_BULK' });
    });

    it('food 를 C 일괄에서 뺀 패킷(BE92 이전)이면 D1 ☑ 여도 미리보기 X01 이 남는다 — 체인의 SupplyItem food(SPEC) DRAFT', () => {
      const { seed } = signWith(packetWithoutFoodItem(), allOk());
      expect(rowOf(seed, 'supplyItems', 'food')).toMatchObject({ reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT' });
      expect(errsOf(validateSeed(previewOf(seed), { now: NOW }), 'X01').map((i) => i.path)).toEqual(['requirements.food']);
    });

    it('D1 ☑ + 실패킷(SupplyItem food C 일괄, 90 Q1 반영) → 미리보기 ACTIVE 사본 errors 0(X01 해소), 매니페스트 포함 실시드 상태도 errors 0', () => {
      const { seed, manifest } = signWith(dwarfPacket(), allOk());
      expect(rowOf(seed, 'supplyItems', 'food')).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', reviewBasis: 'AI_RESEARCH_BULK' });
      expect(run(rawOf(seed), manifest).errors).toEqual([]);
      expect(validateSeed(previewOf(seed), { now: NOW }).errors).toEqual([]);
    });
  });

  it('--stage review: 서명 대상은 NEEDS_REVIEW·EXPERIENCED_KEEPER(검수자·basis null), 매니페스트 0 → validate 0', () => {
    const s = clone(realSeed());
    const files = Object.fromEntries(CONTENT_KEYS.map((k) => [SEED_FILES[k], s[k as keyof SeedBundle] as unknown[]]));
    const res = applyMjs.applySignatures(files, [], dwarfPacket(), dwarfAllCheckedResult(NOW), { now: NOW, stage: 'review' });
    expect(res.manifest).toEqual([]);
    expect(res.summary.needsReview).toBe(52);
    const raw = rawOf(s);
    for (const k of CONTENT_KEYS) (raw as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
    expect(rowOf(raw, 'curatedProducts', 'cp-dw-001')).toMatchObject({ reviewStatus: 'NEEDS_REVIEW', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: null, reviewBasis: null, status: 'REVIEW' });
    expect(rowOf(raw, 'supplyRequirements', 'req-dwarf-food')).toMatchObject({ reviewStatus: 'NEEDS_REVIEW', reviewerType: 'VET_PUBLISHED_SOURCE', verifiedBy: null, reviewBasis: null });
    expect(run(raw, res.manifest).errors).toEqual([]);
  });

  it('입력 거부(exit 1, 쓰기 0): 알 수 없는 항목·AI 핸들·미래 날짜·checkedAt 없음·패킷 이름 불일치·알 수 없는 키', () => {
    const { seed, draft } = pair();
    const before = bytes(seed);
    const resDir = mkdtempSync(join(tmpdir(), 'withsmall-sigres-'));
    temps.push(resDir);
    const ok = dwarfAllCheckedResult(NOW);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['unknown item', { ...ok, checked: ['A99'] }],
      ['ai handle', { ...ok, signedBy: 'claude' }],
      ['future', { ...ok, bulkSignedAt: '2099-01-01' }],
      ['no checkedAt', { ...ok, checkedAt: null }],
      ['packet', { ...ok, packet: 'other' }],
      ['extra key', { ...ok, reviewerType: 'VET' }],
      ['bad date', { ...ok, checkedAt: '2026-02-30' }],
    ];
    for (const [name, r] of cases) {
      const p = writeJson(resDir, `${name.replace(/\s/g, '-')}.json`, r);
      const res = applyCli([...packetArgs, '--result', p, '--seed', seed, '--draft', draft, ...NOW_ARGS]);
      expect([name, res.code]).toEqual([name, 1]);
    }
    expect(applyCli(['--bogus']).code).toBe(2);
    expect(bytes(seed)).toEqual(before);
    expect(existsSync(join(seed, SIGNATURE_FILE))).toBe(true);
  });

  it('정본·사본 변환 결과가 다르면 쓰지 않는다(exit 1)', () => {
    const { seed, draft } = pair();
    const rows = JSON.parse(readFileSync(join(draft, 'taxa.json'), 'utf8')) as Row[];
    rows[0].koreanName = `${String(rows[0].koreanName)}x`;
    writeFileSync(join(draft, 'taxa.json'), JSON.stringify(rows, null, 2));
    const before = bytes(seed);
    const resDir = mkdtempSync(join(tmpdir(), 'withsmall-sigres-'));
    temps.push(resDir);
    const p = writeJson(resDir, 'all.json', dwarfAllCheckedResult(NOW));
    expect(applyCli([...packetArgs, '--result', p, '--seed', seed, '--draft', draft, ...NOW_ARGS]).code).toBe(1);
    expect(bytes(seed)).toEqual(before);
  });

  it('패킷 = 2026-10-24 착지 VERIFIED 50행 + 사료 D1(ROW_CHECKED 대상 22 = 최소 규격 4(245: 터널 A11) + 사료 1 + 상품 17, 일괄 30 = 29 + 용품 사료(90 Q1)), 최소 규격 행 대응 A 항목', () => {
    const p = dwarfPacket();
    expect(p.rowChecked).toHaveLength(22);
    expect(p.bulk.rows).toHaveLength(30);
    expect(p.bulk.rows.some((r) => r.file === 'supply-items.json' && r.id === 'food')).toBe(true);
    const items = Object.fromEntries(p.rowChecked.filter((r) => r.file === 'supply-requirements.json').map((r) => [r.id, r.items]));
    expect(items).toEqual({ 'req-dwarf-cage': ['A1', 'A2', 'A3', 'A4', 'A10'], 'req-dwarf-wheel': ['A5', 'A6', 'A9'], 'req-dwarf-bedding': ['A7', 'A8'], 'req-dwarf-food': ['D1'], 'req-dwarf-tubes': ['A11'] });
    // 245(V10 과 같은 규칙): 최소 규격이 있는 드워프 요구사항은 전부 ROW_CHECKED 대상(일괄 승인 불가).
    const withMin = realSeed().supplyRequirements.filter((r) => r.careProfileId === 'cp-hamster-dwarf' && (r.minSpec?.rules?.length ?? 0) > 0).map((r) => r.id);
    expect(withMin.filter((id) => !(id in items))).toEqual([]);
    expect(withMin).toContain('req-dwarf-tubes');
    // 행 reviewerType 은 사료(FOOD, 확인표 D)만 VET_PUBLISHED_SOURCE — 나머지는 패킷 기본. 저울(req-dwarf-scale)은 패킷 밖.
    const withType = (p.rowChecked as Array<{ id: string; reviewerType?: string }>).filter((r) => r.reviewerType !== undefined);
    expect(withType.map((r) => [r.id, r.reviewerType])).toEqual([['req-dwarf-food', 'VET_PUBLISHED_SOURCE']]);
    expect([...p.rowChecked, ...p.bulk.rows].some((r) => r.id === 'req-dwarf-scale')).toBe(false);
    // 확인표의 상품 행 id 집합 = 패킷 상품 집합
    const doc = readFileSync(join(ROOT, 'docs', 'planning-artifacts', '드워프햄스터-핵심행-확인표.md'), 'utf8');
    const docProducts = [...new Set([...doc.matchAll(/\| (cp-dw-\d{3}) \(/g)].map((x) => x[1]))].sort();
    expect(p.rowChecked.filter((r) => r.file === 'curated-products.json').map((r) => r.id).sort()).toEqual(docProducts);
    const docA = [...new Set([...doc.matchAll(/^\| (A\d+) \|/gm)].map((x) => x[1]))].sort();
    expect(Object.values(items).flat().filter((x) => x.startsWith('A')).sort()).toEqual(docA);
    // 확인표 D 절: D1 의 출처 행(K1·K3·S1/S2)이 모두 있다.
    const docD = [...doc.matchAll(/^\| (D1-[a-z]) /gm)].map((x) => x[1]);
    expect(docD).toEqual(['D1-a', 'D1-b', 'D1-c']);
  });
});

// BE92(2026-10-25): 골든 서명 패킷(scripts/review-packets/hamster-golden-core.json) + 확인표(골든햄스터-핵심행-확인표.md).
describe('골든 패킷 — 확인표 A·C·D, 패킷 밖 행(저울·구성안·Taxon·용품) DRAFT 유지', () => {
  type Packet = DwarfPacket & { reviewerType: string };
  const GOLDEN_PACKET_PATH = join(ROOT, 'scripts', 'review-packets', 'hamster-golden-core.json');
  const goldenPacket = (): Packet => JSON.parse(readFileSync(GOLDEN_PACKET_PATH, 'utf8')) as Packet;
  const doc = (): string => readFileSync(join(ROOT, 'docs', 'planning-artifacts', '골든햄스터-핵심행-확인표.md'), 'utf8');
  const signGolden = (result: Record<string, unknown>) => {
    const s = clone(realSeed());
    const res = applyMjs.applySignatures(filesOf(s), [], goldenPacket(), result, { now: NOW });
    for (const k of CONTENT_KEYS) (s as unknown as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
    return { seed: s, manifest: res.manifest };
  };
  const allChecked = (): Record<string, unknown> => {
    const p = goldenPacket();
    return { format: applyMjs.RESULT_FORMAT, packet: p.packet, signedBy: 'kenny', checkedAt: NOW, checked: [...new Set(p.rowChecked.flatMap((r) => r.items))], bulkSignedAt: NOW };
  };

  it('구성: 최소 규격 3행(케이지 A6~A11·쳇바퀴 A1~A3·베딩 A4~A5) + 사료 D1(VET_PUBLISHED_SOURCE) + C 일괄 12행, 패킷 밖 행 0', () => {
    const p = goldenPacket();
    expect(p.reviewerType).toBe('EXPERIENCED_KEEPER');
    expect(Object.fromEntries(p.rowChecked.map((r) => [r.id, r.items]))).toEqual({
      'req-syrian-cage': ['A6', 'A7', 'A8', 'A9', 'A10', 'A11'],
      'req-syrian-wheel': ['A1', 'A2', 'A3'],
      'req-syrian-bedding': ['A4', 'A5'],
      'req-syrian-food': ['D1'],
    });
    expect((p.rowChecked as Array<{ id: string; reviewerType?: string }>).filter((r) => r.reviewerType !== undefined).map((r) => [r.id, r.reviewerType])).toEqual([['req-syrian-food', 'VET_PUBLISHED_SOURCE']]);
    expect([...doc().matchAll(/^\| (D1-[a-z]) /gm)].map((x) => x[1])).toEqual(['D1-a', 'D1-b', 'D1-c']);
    expect(p.bulk.rows).toHaveLength(12);
    const ids = [...p.rowChecked, ...p.bulk.rows].map((r) => `${r.file}#${r.id}`);
    for (const out of ['supply-requirements.json#req-syrian-scale', 'taxa.json#mesocricetus-auratus']) expect(ids).not.toContain(out);
    expect(ids.filter((x) => x.startsWith('supply-items.json#') || x.startsWith('setup-bundles.json#') || x.startsWith('curated-products.json#'))).toEqual([]);
    // 확인표 A 항목 집합 = 패킷 A 항목 집합
    const docA = [...new Set([...doc().matchAll(/^\| (A\d+) \|/gm)].map((x) => x[1]))].sort();
    expect(p.rowChecked.flatMap((r) => r.items).filter((x) => x.startsWith('A')).sort()).toEqual(docA);
  });

  it('미서명 결과 파일 → 대상 16행 DRAFT·매니페스트 0, 디스크 시드와 사실·검수 표기 동일', () => {
    const unsigned = JSON.parse(readFileSync(join(ROOT, 'scripts', 'review-packets', 'hamster-golden-core.result.unsigned.json'), 'utf8')) as Record<string, unknown>;
    const { seed, manifest } = signGolden(unsigned);
    expect(manifest).toEqual([]);
    expect(seed).toEqual(realSeed());
  });

  it('전 ☑·C·D1(가짜 결과, 메모리) → 16행 VERIFIED(ROW_CHECKED 4 · AI_RESEARCH_BULK 12), 사료만 VET_PUBLISHED_SOURCE, validate errors 0(V03·V04·V08 포함) — 저울·구성안·Taxon 은 DRAFT', () => {
    const { seed, manifest } = signGolden(allChecked());
    expect(manifest).toHaveLength(16);
    expect(manifest.filter((e) => e.basis === 'ROW_CHECKED').map((e) => e.id).sort()).toEqual(['req-syrian-bedding', 'req-syrian-cage', 'req-syrian-food', 'req-syrian-wheel']);
    expect(rowOf(seed, 'supplyRequirements', 'req-syrian-food')).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', reviewBasis: 'ROW_CHECKED', contentKind: 'FOOD' });
    expect(run(rawOf(seed), manifest).errors).toEqual([]);
    for (const [key, id] of [['supplyRequirements', 'req-syrian-scale'], ['setupBundles', 'sb-syrian-budget'], ['taxa', 'mesocricetus-auratus'], ['supplyItems', 'food']] as const) {
      expect([id, rowOf(seed, key, id).reviewStatus]).toEqual([id, 'DRAFT']);
    }
    // 사육 프로필은 습도 값 없이 VERIFIED 가능(V07 키 5개, 2026-10-25 Kenny 습도 삭제).
    expect(rowOf(seed, 'careProfiles', 'cp-hamster-syrian')).toMatchObject({ reviewStatus: 'VERIFIED' });
    expect((rowOf(seed, 'careProfiles', 'cp-hamster-syrian').facts as Row).humidityPct).toBeUndefined();
  });

  it('케이지 A11(법정 하한 문장)만 빠지면 케이지 행은 DRAFT', () => {
    const r = allChecked();
    const { seed } = signGolden({ ...r, checked: (r.checked as string[]).filter((x) => x !== 'A11') });
    expect(rowOf(seed, 'supplyRequirements', 'req-syrian-cage').reviewStatus).toBe('DRAFT');
    expect(rowOf(seed, 'supplyRequirements', 'req-syrian-wheel').reviewStatus).toBe('VERIFIED');
  });
});

// be-gp-s14(2026-10-27): 기니피그 서명 패킷(scripts/review-packets/guinea-pig-core.json) + 확인표(기니피그-핵심행-확인표.md).
describe('기니피그 패킷 — 확인표 A·C·D(건초·펠릿 VET_PUBLISHED_SOURCE), 패킷 밖(Taxon·저울·기존 용품) DRAFT 유지', () => {
  type Packet = DwarfPacket & { reviewerType: string };
  const PACKETS_DIR = join(ROOT, 'scripts', 'review-packets');
  const GP_PACKET_PATH = join(PACKETS_DIR, 'guinea-pig-core.json');
  const GP_UNSIGNED_PATH = join(PACKETS_DIR, 'guinea-pig-core.result.unsigned.json');
  const gpPacket = (): Packet => JSON.parse(readFileSync(GP_PACKET_PATH, 'utf8')) as Packet;
  const doc = (): string => readFileSync(join(ROOT, 'docs', 'planning-artifacts', '기니피그-핵심행-확인표.md'), 'utf8');
  const signGp = (result: Record<string, unknown>, packet: Packet = gpPacket()) => {
    const s = clone(realSeed());
    const res = applyMjs.applySignatures(filesOf(s), [], packet, result, { now: NOW });
    for (const k of CONTENT_KEYS) (s as unknown as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
    return { seed: s, manifest: res.manifest };
  };
  const allChecked = (): Record<string, unknown> => {
    const p = gpPacket();
    return { format: applyMjs.RESULT_FORMAT, packet: p.packet, signedBy: 'kenny', checkedAt: NOW, checked: [...new Set(p.rowChecked.flatMap((r) => r.items))], bulkSignedAt: NOW };
  };
  const bytes = (dir: string): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));

  it('구성: 최소 규격 3행(케이지 A1~A7·베딩 A8~A10·갉기 A11) + 건초 D1·펠릿 D2(VET_PUBLISHED_SOURCE) + C 일괄 17행, 패킷 밖 행 0', () => {
    const p = gpPacket();
    expect(p.reviewerType).toBe('EXPERIENCED_KEEPER');
    expect(Object.fromEntries(p.rowChecked.map((r) => [r.id, r.items]))).toEqual({
      'req-guineapig-cage': ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'],
      'req-guineapig-bedding': ['A8', 'A9', 'A10'],
      'req-guineapig-chew': ['A11'],
      'req-guineapig-hay': ['D1'],
      'req-guineapig-food': ['D2'],
    });
    expect((p.rowChecked as Array<{ id: string; reviewerType?: string }>).filter((r) => r.reviewerType !== undefined).map((r) => [r.id, r.reviewerType])).toEqual([
      ['req-guineapig-hay', 'VET_PUBLISHED_SOURCE'],
      ['req-guineapig-food', 'VET_PUBLISHED_SOURCE'],
    ]);
    expect(p.bulk.rows).toHaveLength(17);
    const ids = [...p.rowChecked, ...p.bulk.rows].map((r) => `${r.file}#${r.id}`);
    for (const out of ['supply-requirements.json#req-guineapig-scale', 'taxa.json#cavia-porcellus']) expect(ids).not.toContain(out);
    // 새 용품 5종만 — 기존 용품(드워프 C 일괄 소유)은 넣지 않는다.
    expect(ids.filter((x) => x.startsWith('supply-items.json#')).sort()).toEqual(['brush', 'hay', 'hay-rack', 'nail-clipper', 'playpen'].map((x) => `supply-items.json#${x}`));
    expect(ids.filter((x) => x.startsWith('setup-bundles.json#') || x.startsWith('curated-products.json#') || x.startsWith('compatibility-rules.json#'))).toEqual([]);
    // 기니피그 요구사항 16행 = 패킷 15행 + 저울(패킷 밖)
    const gpReqs = realSeed().supplyRequirements.filter((r) => r.careProfileId === 'cp-guineapig').map((r) => `supply-requirements.json#${r.id}`);
    expect(gpReqs).toHaveLength(16);
    expect(gpReqs.filter((x) => !ids.includes(x))).toEqual(['supply-requirements.json#req-guineapig-scale']);
    // 최소 규격이 있는 기니피그 요구사항은 전부 ROW_CHECKED 대상(V10 — 일괄 승인 불가)
    const withMin = realSeed().supplyRequirements.filter((r) => r.careProfileId === 'cp-guineapig' && (r.minSpec?.rules?.length ?? 0) > 0).map((r) => r.id);
    const rowIds = p.rowChecked.map((r) => r.id);
    expect(withMin.filter((id) => !rowIds.includes(id))).toEqual([]);
    // 확인표 A·D 항목 집합 = 패킷 항목 집합, B 상품 없음
    const docA = [...new Set([...doc().matchAll(/^\| (A\d+) \|/gm)].map((x) => x[1]))].sort();
    expect(p.rowChecked.flatMap((r) => r.items).filter((x) => x.startsWith('A')).sort()).toEqual(docA);
    expect([...doc().matchAll(/^\| (D\d-[a-z]) /gm)].map((x) => x[1])).toEqual(['D1-a', 'D1-b', 'D1-c', 'D2-a', 'D2-b', 'D2-c']);
    expect(doc()).toMatch(/## B\. 상품\r?\n\r?\n- 없음\./);
  });

  it('패킷끼리 대상 행이 겹치지 않는다(한 패킷의 미서명 결과가 다른 패킷의 서명 행을 DRAFT 로 되돌리지 않게)', () => {
    const owner = new Map<string, string>();
    for (const f of readdirSync(PACKETS_DIR).filter((x) => x.endsWith('.json') && !x.includes('.result.'))) {
      const p = JSON.parse(readFileSync(join(PACKETS_DIR, f), 'utf8')) as Packet;
      for (const r of [...p.rowChecked, ...p.bulk.rows]) {
        const k = `${r.file}#${r.id}`;
        expect([k, owner.get(k)]).toEqual([k, undefined]);
        owner.set(k, f);
      }
    }
    expect([...owner.values()].filter((f) => f === 'guinea-pig-core.json')).toHaveLength(22);
  });

  it('미서명 결과 파일 → 대상 22행 DRAFT·매니페스트 0, 디스크 시드와 사실·검수 표기 동일', () => {
    const unsigned = JSON.parse(readFileSync(GP_UNSIGNED_PATH, 'utf8')) as Record<string, unknown>;
    const { seed, manifest } = signGp(unsigned);
    expect(manifest).toEqual([]);
    expect(seed).toEqual(realSeed());
  });

  it('전 ☑·C·D1·D2(가짜 결과, 메모리) → 22행 VERIFIED(ROW_CHECKED 5 · AI_RESEARCH_BULK 17), 건초·펠릿만 VET_PUBLISHED_SOURCE, validate errors 0 — Taxon·저울·기존 용품 DRAFT', () => {
    const { seed, manifest } = signGp(allChecked());
    expect(manifest).toHaveLength(22);
    expect(manifest.filter((e) => e.basis === 'ROW_CHECKED').map((e) => e.id).sort()).toEqual(['req-guineapig-bedding', 'req-guineapig-cage', 'req-guineapig-chew', 'req-guineapig-food', 'req-guineapig-hay']);
    for (const id of ['req-guineapig-hay', 'req-guineapig-food']) {
      const r = rowOf(seed, 'supplyRequirements', id);
      expect(r).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', reviewBasis: 'ROW_CHECKED', contentKind: 'FOOD' });
      expect((r.source as Array<{ url: string }>).some((x) => x.url.startsWith('https://koreascience.kr/'))).toBe(true); // V08 국내 출처 K1
    }
    const res = run(rawOf(seed), manifest);
    expect(res.errors).toEqual([]);
    for (const [key, id] of [['supplyRequirements', 'req-guineapig-scale'], ['taxa', 'cavia-porcellus'], ['supplyItems', 'cage'], ['supplyItems', 'food']] as const) {
      expect([id, rowOf(seed, key, id).reviewStatus]).toEqual([id, 'DRAFT']);
    }
    expect(rowOf(seed, 'animalTypes', 'guinea-pig')).toMatchObject({ reviewStatus: 'VERIFIED', reviewBasis: 'AI_RESEARCH_BULK', status: 'PLANNED' }); // 공개 상태는 서명 대상 아님
  });

  it('부분 확인: 케이지 A7(법 문장)·베딩 A10(무분진 권장)·펠릿 D2 가 빠지면 그 행만 DRAFT', () => {
    const r = allChecked();
    const { seed } = signGp({ ...r, checked: (r.checked as string[]).filter((x) => !['A7', 'A10', 'D2'].includes(x)) });
    for (const id of ['req-guineapig-cage', 'req-guineapig-bedding', 'req-guineapig-food']) expect([id, rowOf(seed, 'supplyRequirements', id).reviewStatus]).toEqual([id, 'DRAFT']);
    for (const id of ['req-guineapig-chew', 'req-guineapig-hay']) expect([id, rowOf(seed, 'supplyRequirements', id).reviewStatus]).toEqual([id, 'VERIFIED']);
  });

  it('D1 ☑ 인데 건초 행 reviewerType 을 EXPERIENCED_KEEPER 로 내리면 → V03(FOOD 최소 VET_PUBLISHED_SOURCE)', () => {
    const p = gpPacket();
    const q = { ...p, rowChecked: p.rowChecked.map((r) => (r.id === 'req-guineapig-hay' ? { ...r, reviewerType: 'EXPERIENCED_KEEPER' } : r)) };
    const { seed, manifest } = signGp(allChecked(), q);
    expect(errsOf(run(rawOf(seed), manifest), 'V03').map((i) => i.id)).toEqual(['req-guineapig-hay']);
  });

  it('CLI round-trip(임시 사본): 가짜 전 ☑ → seed:validate 0 → 미서명 결과로 되돌리면 원래 바이트', async () => {
    const seed = tempCopy(SEED_DIR);
    const draft = tempCopy(DRAFT_DIR);
    const before = bytes(seed);
    const beforeDraft = bytes(draft);
    const resDir = mkdtempSync(join(tmpdir(), 'withsmall-sigres-'));
    temps.push(resDir);
    const all = writeJson(resDir, 'gp-all.json', allChecked());
    const args = ['--packet', GP_PACKET_PATH, '--seed', seed, '--draft', draft, '--now', NOW];
    const a = applyCli([...args, '--result', all]);
    expect(a.out.join('\n')).toContain('ROW_CHECKED 5 · AI_RESEARCH_BULK 17');
    expect(a.code).toBe(0);
    expect(JSON.parse(readFileSync(join(seed, SIGNATURE_FILE), 'utf8'))).toHaveLength(22);
    const v = await validateCli(seed);
    expect(v.out.filter((l) => l.startsWith('ERROR'))).toEqual([]);
    expect(v.code).toBe(0);
    expect((await validateCli(draft)).code).toBe(0);
    expect(equivMjs.compareDirs(seed, draft)).toEqual([]);
    expect(equivMjs.compareDirs(SEED_DIR, seed).filter((x) => !x.startsWith(SIGNATURE_FILE))).toEqual([]); // 사실 필드 0 변경
    expect(applyCli([...args, '--result', GP_UNSIGNED_PATH]).code).toBe(0);
    expect(bytes(seed)).toEqual(before);
    expect(bytes(draft)).toEqual(beforeDraft);
  });
});

// be-gerbil(2026-10-27, 126 S9): 저빌 서명 패킷(scripts/review-packets/gerbil-mongolian-core.json) + 확인표(저빌-핵심행-확인표.md).
//   법 안내 한 줄(Taxon legal.note, Kenny 2026-10-27)은 확인표 A1~A3 → Taxon 행 OFFICIAL_SOURCE. 사료(FOOD)는 국내 출처 0 이라 패킷 밖.
describe('저빌 패킷 — 확인표 A(법 정보 OFFICIAL_SOURCE + 최소 규격)·C, 패킷 밖(사료·기존 용품) DRAFT 유지', () => {
  type Packet = DwarfPacket & { reviewerType: string };
  const PACKETS_DIR = join(ROOT, 'scripts', 'review-packets');
  const GB_PACKET_PATH = join(PACKETS_DIR, 'gerbil-mongolian-core.json');
  const GB_UNSIGNED_PATH = join(PACKETS_DIR, 'gerbil-mongolian-core.result.unsigned.json');
  const gbPacket = (): Packet => JSON.parse(readFileSync(GB_PACKET_PATH, 'utf8')) as Packet;
  const doc = (): string => readFileSync(join(ROOT, 'docs', 'planning-artifacts', '저빌-핵심행-확인표.md'), 'utf8');
  const signGb = (result: Record<string, unknown>, packet: Packet = gbPacket()) => {
    const s = clone(realSeed());
    const res = applyMjs.applySignatures(filesOf(s), [], packet, result, { now: NOW });
    for (const k of CONTENT_KEYS) (s as unknown as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
    return { seed: s, manifest: res.manifest };
  };
  const allChecked = (packet: Packet = gbPacket()): Record<string, unknown> => ({
    format: applyMjs.RESULT_FORMAT,
    packet: packet.packet,
    signedBy: 'kenny',
    checkedAt: NOW,
    checked: [...new Set(packet.rowChecked.flatMap((r) => r.items))],
    bulkSignedAt: NOW,
  });
  const bytes = (dir: string): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
  const ROW_IDS = ['meriones-unguiculatus', 'req-gerbil-bedding', 'req-gerbil-cage', 'req-gerbil-hideout', 'req-gerbil-tubes', 'req-gerbil-wheel'];

  it('구성: 법 정보 A1~A3(OFFICIAL_SOURCE) + 최소 규격 5행(케이지 A4~A9·베딩 A10~A12·은신처 A13~A14·쳇바퀴 A15~A16·터널 A17) + C 일괄 11행, 사료 패킷 밖', () => {
    const p = gbPacket();
    expect(p.reviewerType).toBe('EXPERIENCED_KEEPER');
    expect(Object.fromEntries(p.rowChecked.map((r) => [`${r.file}#${r.id}`, r.items]))).toEqual({
      'taxa.json#meriones-unguiculatus': ['A1', 'A2', 'A3'],
      'supply-requirements.json#req-gerbil-cage': ['A4', 'A5', 'A6', 'A7', 'A8', 'A9'],
      'supply-requirements.json#req-gerbil-bedding': ['A10', 'A11', 'A12'],
      'supply-requirements.json#req-gerbil-hideout': ['A13', 'A14'],
      'supply-requirements.json#req-gerbil-wheel': ['A15', 'A16'],
      'supply-requirements.json#req-gerbil-tubes': ['A17'],
    });
    expect((p.rowChecked as Array<{ id: string; reviewerType?: string }>).filter((r) => r.reviewerType !== undefined).map((r) => [r.id, r.reviewerType])).toEqual([
      ['meriones-unguiculatus', 'OFFICIAL_SOURCE'],
    ]);
    expect(p.bulk.rows).toHaveLength(11);
    const ids = [...p.rowChecked, ...p.bulk.rows].map((r) => `${r.file}#${r.id}`);
    expect(ids).not.toContain('supply-requirements.json#req-gerbil-food');
    expect(ids.filter((x) => x.startsWith('supply-items.json#') || x.startsWith('setup-bundles.json#') || x.startsWith('curated-products.json#'))).toEqual([]);
    // 저빌 요구사항 14행 = 패킷 13행 + 사료(패킷 밖)
    const gbReqs = realSeed().supplyRequirements.filter((r) => r.careProfileId === 'cp-gerbil-mongolian').map((r) => `supply-requirements.json#${r.id}`);
    expect(gbReqs).toHaveLength(14);
    expect(gbReqs.filter((x) => !ids.includes(x))).toEqual(['supply-requirements.json#req-gerbil-food']);
    // 최소 규격이 있는 저빌 요구사항은 (사료 빼고) 전부 ROW_CHECKED 대상(V10 — 일괄 승인 불가)
    const rowIds = p.rowChecked.map((r) => r.id);
    const withMin = realSeed().supplyRequirements.filter((r) => r.careProfileId === 'cp-gerbil-mongolian' && (r.minSpec?.rules?.length ?? 0) > 0).map((r) => r.id);
    expect(withMin.filter((id) => !rowIds.includes(id))).toEqual(['req-gerbil-food']);
    // 확인표 A 항목 집합 = 패킷 항목 집합, B 상품 없음, D 는 패킷 밖 안내(표 행 0), 전부 ☐
    const docA = [...new Set([...doc().matchAll(/^\| (A\d+) \|/gm)].map((x) => x[1]))].sort();
    expect(p.rowChecked.flatMap((r) => r.items).sort()).toEqual(docA);
    expect([...doc().matchAll(/^\| (D\d-[a-z]) /gm)]).toHaveLength(0);
    expect(doc()).toMatch(/## B\. 상품\r?\n\r?\n- 없음\./);
    expect(doc()).toMatch(/## D\. 사료\(수의 출처\) — 이번 패킷 밖/);
    expect(doc()).not.toContain('| ☑ |');
    expect(doc().split('| ☐ |').length - 1).toBe(17); // A1~A17 확인 칸 전부 ☐
    // 법 안내 문장은 시드 그대로 확인표 A1 에 있다.
    const note = (realSeed().taxa.find((t) => t.id === 'meriones-unguiculatus')?.legal as { note?: string } | undefined)?.note;
    expect(typeof note).toBe('string');
    expect(doc()).toContain(note as string);
  });

  it('패킷끼리 대상 행 겹침 0 — 저빌 17행', () => {
    const owner = new Map<string, string>();
    for (const f of readdirSync(PACKETS_DIR).filter((x) => x.endsWith('.json') && !x.includes('.result.'))) {
      const p = JSON.parse(readFileSync(join(PACKETS_DIR, f), 'utf8')) as Packet;
      for (const r of [...p.rowChecked, ...p.bulk.rows]) {
        const k = `${r.file}#${r.id}`;
        expect([k, owner.get(k)]).toEqual([k, undefined]);
        owner.set(k, f);
      }
    }
    expect([...owner.values()].filter((f) => f === 'gerbil-mongolian-core.json')).toHaveLength(17);
  });

  it('미서명 결과 파일 → 대상 17행 DRAFT·매니페스트 0, 디스크 시드와 사실·검수 표기 동일', () => {
    const unsigned = JSON.parse(readFileSync(GB_UNSIGNED_PATH, 'utf8')) as Record<string, unknown>;
    const { seed, manifest } = signGb(unsigned);
    expect(manifest).toEqual([]);
    expect(seed).toEqual(realSeed());
  });

  it('전 ☑·C(가짜 결과, 메모리) → 17행 VERIFIED(ROW_CHECKED 6 · AI_RESEARCH_BULK 11), Taxon 만 OFFICIAL_SOURCE, validate errors 0 — 사료·기존 용품 DRAFT, 타입 PLANNED', () => {
    const { seed, manifest } = signGb(allChecked());
    expect(manifest).toHaveLength(17);
    expect(manifest.filter((e) => e.basis === 'ROW_CHECKED').map((e) => e.id).sort()).toEqual(ROW_IDS);
    expect(rowOf(seed, 'taxa', 'meriones-unguiculatus')).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'OFFICIAL_SOURCE', reviewBasis: 'ROW_CHECKED', contentKind: 'LEGAL' });
    expect(rowOf(seed, 'supplyRequirements', 'req-gerbil-cage')).toMatchObject({ reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', reviewBasis: 'ROW_CHECKED' });
    const res = run(rawOf(seed), manifest);
    expect(res.errors).toEqual([]);
    for (const [key, id] of [['supplyRequirements', 'req-gerbil-food'], ['supplyItems', 'cage'], ['supplyItems', 'food'], ['supplyItems', 'sand-bath']] as const) {
      expect([id, rowOf(seed, key, id).reviewStatus]).toEqual([id, 'DRAFT']);
    }
    expect(rowOf(seed, 'animalTypes', 'gerbil-mongolian')).toMatchObject({ reviewStatus: 'VERIFIED', reviewBasis: 'AI_RESEARCH_BULK', status: 'PLANNED' });
  });

  it('부분 확인: 법 문장 A1·쳇바퀴 지름 A16 이 빠지면 그 행만 DRAFT', () => {
    const r = allChecked();
    const { seed } = signGb({ ...r, checked: (r.checked as string[]).filter((x) => !['A1', 'A16'].includes(x)) });
    expect(rowOf(seed, 'taxa', 'meriones-unguiculatus').reviewStatus).toBe('DRAFT');
    expect(rowOf(seed, 'supplyRequirements', 'req-gerbil-wheel').reviewStatus).toBe('DRAFT');
    for (const id of ['req-gerbil-cage', 'req-gerbil-bedding', 'req-gerbil-hideout', 'req-gerbil-tubes']) expect([id, rowOf(seed, 'supplyRequirements', id).reviewStatus]).toEqual([id, 'VERIFIED']);
  });

  it('Taxon 행 reviewerType 을 빼면(패킷 기본 EXPERIENCED_KEEPER) → V03(LEGAL 은 정확히 OFFICIAL_SOURCE)', () => {
    const p = gbPacket();
    const q = { ...p, rowChecked: p.rowChecked.map((r) => (r.id === 'meriones-unguiculatus' ? { file: r.file, id: r.id, items: r.items } : r)) };
    const { seed, manifest } = signGb(allChecked(q), q);
    expect(errsOf(run(rawOf(seed), manifest), 'V03').map((i) => i.id)).toEqual(['meriones-unguiculatus']);
  });

  it('사료를 D1(VET_PUBLISHED_SOURCE)로 패킷에 넣으면 → V08(국내 출처 0) — 패킷 밖으로 둔 이유', () => {
    const p = gbPacket();
    const q = { ...p, rowChecked: [...p.rowChecked, { file: 'supply-requirements.json', id: 'req-gerbil-food', items: ['D1'], reviewerType: 'VET_PUBLISHED_SOURCE' }] };
    const { seed, manifest } = signGb(allChecked(q), q);
    expect(errsOf(run(rawOf(seed), manifest), 'V08').map((i) => i.id)).toEqual(['req-gerbil-food']);
  });

  it('CLI round-trip(임시 사본): 가짜 전 ☑ → seed:validate 0 → 미서명 결과로 되돌리면 원래 바이트', async () => {
    const seed = tempCopy(SEED_DIR);
    const draft = tempCopy(DRAFT_DIR);
    const before = bytes(seed);
    const beforeDraft = bytes(draft);
    const resDir = mkdtempSync(join(tmpdir(), 'withsmall-sigres-'));
    temps.push(resDir);
    const all = writeJson(resDir, 'gb-all.json', allChecked());
    const args = ['--packet', GB_PACKET_PATH, '--seed', seed, '--draft', draft, '--now', NOW];
    const a = applyCli([...args, '--result', all]);
    expect(a.out.join('\n')).toContain('ROW_CHECKED 6 · AI_RESEARCH_BULK 11');
    expect(a.code).toBe(0);
    expect(JSON.parse(readFileSync(join(seed, SIGNATURE_FILE), 'utf8'))).toHaveLength(17);
    const v = await validateCli(seed);
    expect(v.out.filter((l) => l.startsWith('ERROR'))).toEqual([]);
    expect(v.code).toBe(0);
    expect((await validateCli(draft)).code).toBe(0);
    expect(equivMjs.compareDirs(seed, draft)).toEqual([]);
    expect(equivMjs.compareDirs(SEED_DIR, seed).filter((x) => !x.startsWith(SIGNATURE_FILE))).toEqual([]); // 사실 필드 0 변경
    expect(applyCli([...args, '--result', GB_UNSIGNED_PATH]).code).toBe(0);
    expect(bytes(seed)).toEqual(before);
    expect(bytes(draft)).toEqual(beforeDraft);
  });
});
