// seed:validate CLI — runValidateCli 를 io 주입으로 호출(프로세스 spawn 없음). 임시 디렉터리에 시드 복사 후 주입.
import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runValidateCli, type CliIo } from '../seed/cli-validate.js';
import { writeUnsignedSeedDir } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = ['--now', '2026-11-22']; // 팁 checkedAt(2026-11-22) 이상 · 실서명일 이상(옛 값 2026-11-03) — 디스크 verifiedAt S07 방지

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

type Row = Record<string, unknown>;

function tempSeed(mutate: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'withsmall-seed-'));
  temps.push(dir);
  cpSync(SEED_DIR, dir, { recursive: true });
  mutate(dir);
  return dir;
}

function editJson(dir: string, file: string, id: string, edit: (r: Row) => void): void {
  const path = join(dir, file);
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[];
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`${file}#${id} 없음`);
  edit(r);
  writeFileSync(path, JSON.stringify(rows, null, 2));
}

async function run(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { stdout: (l) => out.push(l), stderr: (l) => err.push(l), today: () => '2026-11-22' };
  const code = await runValidateCli(argv, io);
  return { code, out, err };
}

describe('seed:validate CLI', () => {
  it('실제 시드(2026-11-16 서명 후) → exit 0, errors 0, warnings 25(308 W-TIP-CAT +1 · 315 W-TIP-SC 5 · W-TIP-VET 1), 노출 3타입(골든·드워프·기니피그, 2026-11-23 활성화)·요구사항 42·상품 14, W-EXPOSURE-ZERO 없음', async () => {
    const r = await run(NOW);
    expect(r.code).toBe(0);
    const summary = r.out[r.out.length - 1];
    expect(summary).toBe('seed:validate — errors 0, warnings 25, exposable: types 3, requirements 42, products 14, testimonials 0, vets 0');
    expect(r.out.some((l) => l.includes('W-EXPOSURE-ZERO'))).toBe(false);
  });

  it('--strict 실제 시드(서명 후) → exit 0(W-EXPOSURE-ZERO 없음)', async () => {
    const r = await run([...NOW, '--strict']);
    expect(r.code).toBe(0);
    expect(r.out.some((l) => l.startsWith('ERROR'))).toBe(false);
  });

  it('서명 전 기준 시드 디렉터리(4 패킷 미서명·매니페스트 []) → exit 0·노출 0·W-EXPOSURE-ZERO 경고, --strict 이면 exit 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'withsmall-seed-unsigned-'));
    temps.push(dir);
    writeUnsignedSeedDir(dir);
    const r = await run([...NOW, '--dir', dir]);
    expect(r.code).toBe(0);
    expect(r.out[r.out.length - 1]).toBe('seed:validate — errors 0, warnings 26, exposable: types 0, requirements 0, products 0, testimonials 0, vets 0');
    expect(r.out.some((l) => l.startsWith('WARN [W-EXPOSURE-ZERO] animal-types.json#hamster-golden'))).toBe(true);
    const s = await run([...NOW, '--dir', dir, '--strict']);
    expect(s.code).toBe(1);
    expect(s.out.some((l) => l.startsWith('ERROR [W-EXPOSURE-ZERO]'))).toBe(true);
  });

  it('잘못된 인자 → exit 2', async () => {
    expect((await run(['--bogus'])).code).toBe(2);
    expect((await run(['--now', '2026/10/01'])).code).toBe(2);
  });

  const cases: Array<[string, string, (dir: string) => void]> = [
    ['V01 AI_DRAFT+VERIFIED', 'V01', (d) => editJson(d, 'supply-items.json', 'cage', (r) => Object.assign(r, { reviewStatus: 'VERIFIED', reviewerType: 'AI_DRAFT', verifiedBy: 'x', verifiedAt: '2026-09-30' }))],
    ['L01 금지어', 'L01', (d) => editJson(d, 'supply-requirements.json', 'req-syrian-cage', (r) => { r.why = '최저가로 고르면 돼요.'; })],
    [
      'P01 meetsMinSpec 불일치',
      'P01',
      (d) => editJson(d, 'curated-products.json', 'cp-004', (r) => Object.assign(r, { status: 'REVIEW', meetsMinSpec: false })),
    ],
    [
      'T01 후기 APPROVED 미검증',
      'T01',
      (d) => editJson(d, 'testimonials.json', 't-001', (r) => Object.assign(r, { status: 'APPROVED', quote: '도움이 됐어요', consentAt: '2026-09-30' })),
    ],
    ['P03 사용권 없는 이미지', 'P03', (d) => editJson(d, 'curated-products.json', 'cp-001', (r) => { r.imageAsset = 'p/cp-001.jpg'; })],
    ['S01 파일 누락', 'S01', (d) => unlinkSync(join(d, 'testimonials.json'))],
    ['S01 JSON 깨짐', 'S01', (d) => writeFileSync(join(d, 'photos.json'), '[{')],
  ];

  for (const [name, rule, mutate] of cases) {
    it(`${name} → exit 1 + [${rule}]`, async () => {
      const dir = tempSeed(mutate);
      const r = await run([...NOW, '--dir', dir]);
      expect(r.code).toBe(1);
      expect(r.out.some((l) => l.startsWith(`ERROR [${rule}]`))).toBe(true);
    });
  }
});
