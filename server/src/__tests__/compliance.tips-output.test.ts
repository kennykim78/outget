// 301 C9-TIPS — 팁 있는 실제 프리렌더 산출물을 compliance 산출물 규칙(scanOutputs·scanAffiliateOutputs)에 통과시키고,
//   변이(고지 삭제·rel 누락·검수 라벨·팁 id 누출·노출 팁 없는 /tips)는 C9-TIPS FAIL 로 잡히는지 본다.
//   노출 판단은 scripts/lib/seed-exposure.mjs(독립 재구현)의 computeExposure — 엔진과 다른 구현이 같은 결과를 내야 통과.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSite } from '../prerender/site.js';
import { COPY } from '../prerender/copy.js';
import type { BudgetTipRec, SeedBundle } from '../engine/index.js';
import { SEED_FILES } from '../seed/common.js';
import { realSeed } from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const imp = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(join(ROOT, ...rel.split('/'))).href)) as T;
type Finding = { rule: string; severity: string; file: string; message: string };
type Add = (rule: string, severity: string, file: string, line: number | null, message: string) => void;
const out = await imp<{ scanOutputs: (o: Record<string, unknown>) => string; TIPS_DISCLAIMER: string; TIPS_HAZARD_LABEL: string; TIPS_HAZARD_NOTES: Record<string, string> }>('scripts/lib/rules-output.mjs');
const aff = await imp<{ scanAffiliateOutputs: (o: Record<string, unknown>) => void }>('scripts/lib/rules-affiliate.mjs');
const exm = await imp<{ computeExposure: (s: Record<string, unknown[]>, asOf: string) => unknown }>('scripts/lib/seed-exposure.mjs');
const norm = await imp<{ loadBannedWords: (p: string) => unknown }>('scripts/lib/normalize.mjs');
const BW = norm.loadBannedWords(join(ROOT, 'server', 'src', 'seed', 'banned-words.json'));

const TEMPLATE = readFileSync(join(ROOT, 'client', 'index.html'), 'utf8');
const AS_OF = '2026-11-22';
const DIGEST = 'd'.repeat(64);
const REF = { title: '수납함 집 만들기 기록', url: 'https://namu.wiki/w/test-123', siteName: '예시 블로그', checkedAt: '2026-11-20' };
const TIP: BudgetTipRec = {
  id: 'tip-test-cage',
  kind: 'REFERENCE',
  careProfileId: 'cp-hamster-syrian',
  supplyItemId: 'cage',
  substitute: '시험 대체물',
  sourceHint: 'LIVING_GOODS_STORE',
  materials: ['시험 물품'],
  steps: ['시험 단계'],
  dimensions: [],
  cautions: ['시험 주의'],
  hazards: [],
  mustCheck: ['시험 확인'],
  references: [REF],
  reviewStatus: 'DRAFT',
  reviewerType: 'AI_DRAFT',
  verifiedBy: null,
  verifiedAt: null,
  reviewBasis: null,
  contentKind: 'CARE',
  source: [],
};

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const raw = (s: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, (s[k as keyof SeedBundle] ?? []) as unknown[]]));

/** buildSite(팁 있는 시드) → 임시 dist, mutate 로 파일 변이 → 산출물 규칙(exSeed 기준 노출) 결과. */
function scanBuilt(mutate: (files: Map<string, string>) => void = () => {}, exSeed?: SeedBundle, tips: BudgetTipRec[] = [TIP]): Finding[] {
  const seed: SeedBundle = { ...realSeed(), budgetTips: tips };
  const b = buildSite(seed, { template: TEMPLATE, origin: 'https://withsmall.example', seedDigest: DIGEST, asOf: AS_OF });
  const files = new Map(b.files);
  mutate(files);
  const root = mkdtempSync(join(tmpdir(), 'ws-301-'));
  temps.push(root);
  const dist = join(root, 'dist');
  // C9-PRIVACY 기간 대조용 단일 출처(실파일 사본 — 이 시험은 팁 규칙만 본다).
  mkdirSync(join(root, 'server', 'src', 'privacy'), { recursive: true });
  writeFileSync(join(root, 'server', 'src', 'privacy', 'policy.ts'), readFileSync(join(ROOT, 'server', 'src', 'privacy', 'policy.ts')));
  for (const [rel, c] of files) {
    const abs = join(dist, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, c);
  }
  const findings: Finding[] = [];
  const add: Add = (rule, severity, file, _line, message) => findings.push({ rule, severity, file, message });
  const ex = exm.computeExposure(raw(exSeed ?? seed), AS_OF);
  expect(out.scanOutputs({ root, dist, ex, digest: DIGEST, bw: BW, add, requireOutput: true, seed: raw(exSeed ?? seed) })).toBe('RUN');
  aff.scanAffiliateOutputs({ root, dist, add });
  return findings.filter((f) => f.severity === 'FAIL');
}
const edit = (path: string, f: (s: string) => string) => (files: Map<string, string>) => files.set(path, f(files.get(path) as string));
const TIPS = 'hamster/golden/tips/index.html';

describe('C9-TIPS 산출물', () => {
  it('고지 원문 = COPY.tips.disclaimer(단일 문구)', () => {
    expect(out.TIPS_DISCLAIMER).toBe(COPY.tips.disclaimer);
  });

  it('팁 있는 실제 빌드 — 산출물 FAIL 0(C3-OUT-ID·C8·C9-TIPS·C10-AFF-OUT 포함)', () => {
    expect(scanBuilt()).toEqual([]);
  });

  it.each([
    ['고지 삭제', edit(TIPS, (s) => s.replace(`<p class="ws-tips-disclaimer">${COPY.tips.disclaimer}</p>`, '<p class="ws-tips-disclaimer">외부 글을 모았어요</p>'))],
    ['rel ugc 누락', edit(TIPS, (s) => s.replace('rel="noopener noreferrer nofollow ugc"', 'rel="noopener noreferrer nofollow"'))],
    ['target 누락', edit(TIPS, (s) => s.replace('target="_blank" rel="noopener noreferrer nofollow ugc"', 'rel="noopener noreferrer nofollow ugc"'))],
    ['검수 라벨', edit(TIPS, (s) => s.replace('</h1>', '</h1><p>검수됨</p>'))],
    ['팁 id 가 /tips 밖', edit('hamster/golden/index.html', (s) => s.replace('</main>', '<div data-ws-id="budgetTips#tip-test-cage"></div></main>'))],
    // 312 ⑧(310 MED-2): 외부 <a> href 가 글 사이트 허용 목록 밖(rel·target 은 정상)
    ['외부 링크 허용 목록 밖(amzn.asia)', edit(TIPS, (s) => s.replace('href="https://namu.wiki/w/test-123"', 'href="https://amzn.asia/x"'))],
    ['외부 링크 IP 리터럴', edit(TIPS, (s) => s.replace('href="https://namu.wiki/w/test-123"', 'href="https://1.2.3.4/w/x"'))],
    ['외부 링크 리다이렉트 감싸기', edit(TIPS, (s) => s.replace('href="https://namu.wiki/w/test-123"', 'href="https://web.archive.org/web/2026/https://namu.wiki/w/x"'))],
  ])('%s → C9-TIPS FAIL', (_n, mutate) => {
    const f = scanBuilt(mutate);
    expect(f.some((x) => x.rule === 'C9-TIPS'), JSON.stringify(f)).toBe(true);
  });

  it('노출 팁 없는 시드 기준이면 /tips 라우트·팁 id 가 FAIL', () => {
    const f = scanBuilt(undefined, { ...realSeed(), budgetTips: [{ ...TIP, references: [] }] });
    expect(f.filter((x) => x.rule === 'C9-TIPS').length).toBeGreaterThan(0);
    expect(f.some((x) => x.rule === 'C3-OUT-ID' && x.message.includes('budgetTips#tip-test-cage'))).toBe(true);
  });
});

// 308 총괄 ②: 위험 태그 팁 = 상단 고정 주의 상자(라벨 + 태그별 고정 한 줄) — 산출물에서 빠지면 C9-TIPS FAIL.
describe('C9-TIPS ⑦ 위험 태그 고정 주의 상자', () => {
  const REF2 = { title: '다른 기록', url: 'https://brunch.co.kr/@other/9', siteName: '다른 블로그', checkedAt: '2026-11-20' };
  const HZ: BudgetTipRec = { ...TIP, id: 'tip-test-hz', hazards: ['VENTILATION', 'ESCAPE'], references: [REF, REF2] };
  const scanHz = (mutate?: (files: Map<string, string>) => void) => scanBuilt(mutate, undefined, [HZ]);

  it('스크립트 고정 문구 = COPY.tips.hazardLabel·hazardNotes(7 태그 전부, 단일 문구)', () => {
    expect(out.TIPS_HAZARD_LABEL).toBe(COPY.tips.hazardLabel);
    expect(out.TIPS_HAZARD_NOTES).toEqual({ ...COPY.tips.hazardNotes });
    expect(Object.keys(out.TIPS_HAZARD_NOTES).sort()).toEqual(['ENTRAPMENT', 'ESCAPE', 'HEAT', 'INGESTION', 'TIP_OVER', 'TOXIC_MATERIAL', 'VENTILATION']);
  });

  it('위험 태그 팁 빌드 — 산출물 FAIL 0', () => {
    expect(scanHz()).toEqual([]);
  });

  it.each([
    ['라벨 삭제', edit(TIPS, (s) => s.replace(`<p class="ws-tip-hazard-label">${COPY.tips.hazardLabel}</p>`, ''))],
    ['태그 한 줄 삭제', edit(TIPS, (s) => s.replace(`<li data-ws-hazard="ESCAPE">${COPY.tips.hazardNotes.ESCAPE}</li>`, ''))],
    ['태그 문구 바꿈', edit(TIPS, (s) => s.replace(COPY.tips.hazardNotes.VENTILATION, '통기는 신경 쓰지 않아도 돼요.'))],
  ])('%s → C9-TIPS FAIL', (_n, mutate) => {
    const f = scanHz(mutate);
    expect(f.some((x) => x.rule === 'C9-TIPS' && x.message.includes('tip-test-hz')), JSON.stringify(f)).toBe(true);
  });
});
