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
  realSeed,
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
    expect(n).toBe(2 * 93); // 콘텐츠 8파일 93행 × 2
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

  it('정상: 가짜 확인표(전 ☑·C) 서명 50행 + 매니페스트 50 → errors 0', () => {
    const { raw, manifest } = signed();
    expect(manifest).toHaveLength(50);
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
    Object.assign(rowOf(raw, 'supplyRequirements', 'req-dwarf-food'), { reviewStatus: 'VERIFIED', reviewerType: 'VET_PUBLISHED_SOURCE', verifiedBy: 'kenny', verifiedAt: NOW, reviewBasis: 'AI_RESEARCH_BULK' });
    expect(errsOf(run(raw, manifest), 'G02').map((i) => i.id)).toEqual(['req-dwarf-food']);
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
    rowOf(raw, 'supplyRequirements', 'req-dwarf-food').reviewBasis = 'AI_RESEARCH_BULK';
    rowOf(raw, 'supplyItems', 'chew').reviewBasis = null;
    expect(errsOf(v(raw), 'V09').map((i) => i.id).sort()).toEqual(['chew', 'req-dwarf-food']);
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

  it('round-trip: 가짜 확인표(전 ☑·C) → VERIFIED 50·매니페스트 50·validate 0 → 미서명 결과로 되돌리면 원래 바이트', async () => {
    const { seed, draft } = pair();
    const before = bytes(seed);
    const resDir = mkdtempSync(join(tmpdir(), 'withsmall-sigres-'));
    temps.push(resDir);
    const all = writeJson(resDir, 'all.json', dwarfAllCheckedResult(NOW));
    const a = applyCli([...packetArgs, '--result', all, '--seed', seed, '--draft', draft, ...NOW_ARGS]);
    expect(a.out.join('\n')).toContain('ROW_CHECKED 20 · AI_RESEARCH_BULK 30');
    expect(a.code).toBe(0);
    const m = JSON.parse(readFileSync(join(seed, SIGNATURE_FILE), 'utf8')) as SignatureEntry[];
    expect(m).toHaveLength(50);
    expect(readFileSync(join(draft, SIGNATURE_FILE), 'utf8')).toBe(readFileSync(join(seed, SIGNATURE_FILE), 'utf8'));
    const v = await validateCli(seed);
    expect(v.out.filter((l) => l.startsWith('ERROR'))).toEqual([]);
    expect(v.code).toBe(0);
    expect((await validateCli(draft)).code).toBe(0);
    expect(equivMjs.compareDirs(seed, draft)).toEqual([]);
    expect(equivMjs.compareDirs(SEED_DIR, seed).filter((x) => !x.startsWith(SIGNATURE_FILE))).toEqual([]); // 사실 필드 0 변경(매니페스트는 달라야 정상)
    const prods = JSON.parse(readFileSync(join(seed, 'curated-products.json'), 'utf8')) as Row[];
    const dw = prods.filter((p) => String(p.id).startsWith('cp-dw-'));
    expect(dw.every((p) => p.status === 'ACTIVE' && p.specVerifiedBy === 'kenny' && p.specVerifiedAt === NOW && p.reviewBasis === 'ROW_CHECKED')).toBe(true);

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

  it('C 만 서명 → 30행 AI_RESEARCH_BULK, 상품·최소 규격 행은 DRAFT', () => {
    const { seed, manifest } = dwarfSignedWith({ ...dwarfAllCheckedResult(NOW), checked: [], checkedAt: null });
    expect(manifest).toHaveLength(30);
    expect(manifest.every((e) => e.basis === 'AI_RESEARCH_BULK')).toBe(true);
    expect(rowOf(seed, 'supplyRequirements', 'req-dwarf-bedding').reviewStatus).toBe('DRAFT');
    expect(run(rawOf(seed), manifest).errors).toEqual([]);
  });

  it('--stage review: 서명 대상은 NEEDS_REVIEW·EXPERIENCED_KEEPER(검수자·basis null), 매니페스트 0 → validate 0', () => {
    const s = clone(realSeed());
    const files = Object.fromEntries(CONTENT_KEYS.map((k) => [SEED_FILES[k], s[k as keyof SeedBundle] as unknown[]]));
    const res = applyMjs.applySignatures(files, [], dwarfPacket(), dwarfAllCheckedResult(NOW), { now: NOW, stage: 'review' });
    expect(res.manifest).toEqual([]);
    expect(res.summary.needsReview).toBe(50);
    const raw = rawOf(s);
    for (const k of CONTENT_KEYS) (raw as Record<string, unknown[]>)[k] = res.files[SEED_FILES[k]];
    expect(rowOf(raw, 'curatedProducts', 'cp-dw-001')).toMatchObject({ reviewStatus: 'NEEDS_REVIEW', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: null, reviewBasis: null, status: 'REVIEW' });
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

  it('패킷 = 2026-10-24 착지 VERIFIED 50행(ROW_CHECKED 대상 20 = 최소 규격 3 + 상품 17, 일괄 30), 최소 규격 행 대응 A 항목', () => {
    const p = dwarfPacket();
    expect(p.rowChecked).toHaveLength(20);
    expect(p.bulk.rows).toHaveLength(30);
    const items = Object.fromEntries(p.rowChecked.filter((r) => r.file === 'supply-requirements.json').map((r) => [r.id, r.items]));
    expect(items).toEqual({ 'req-dwarf-cage': ['A1', 'A2', 'A3', 'A4'], 'req-dwarf-wheel': ['A5', 'A6', 'A9'], 'req-dwarf-bedding': ['A7', 'A8'] });
    // 확인표의 상품 행 id 집합 = 패킷 상품 집합
    const doc = readFileSync(join(ROOT, 'docs', 'planning-artifacts', '드워프햄스터-핵심행-확인표.md'), 'utf8');
    const docProducts = [...new Set([...doc.matchAll(/\| (cp-dw-\d{3}) \(/g)].map((x) => x[1]))].sort();
    expect(p.rowChecked.filter((r) => r.file === 'curated-products.json').map((r) => r.id).sort()).toEqual(docProducts);
    const docA = [...new Set([...doc.matchAll(/^\| (A\d) \|/gm)].map((x) => x[1]))].sort();
    expect(Object.values(items).flat().sort()).toEqual(docA);
  });
});
