// M-1 패리티(R4 A1): 엔진(engine/domain.ts·exposure.ts → projectSite) ↔ 독립 재구현(scripts/lib/seed-exposure.mjs)
//   STALE_DAYS 상수·날짜 해석·stale 주입 결과가 같아야 한다. 고정 기준일만 쓴다(실시계 0).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PHOTO_USABLE_STATUSES, STALE_DAYS, isPhotoUsable, isoDayNumber, parseCcLicenseUrl, type SeedBundle } from '../engine/index.js';
import { SEED_FILES } from '../seed/common.js';
import { projectSite } from '../prerender/project.js';
import { FIXTURE_AS_OF, FIXTURE_FIRST_STALE, FIXTURE_LAST_FRESH, patch, promoted } from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  STALE_DAYS: number;
  dayNumber: (v: unknown) => number | null;
  ccLicenseOfUrl: (v: unknown) => string | null;
  isPhotoUsableRow: (p: unknown) => boolean;
  PHOTO_USABLE_STATUSES: Set<string>;
  computeExposure: (seed: Record<string, unknown[]>, asOf: string) => { ids: Record<string, Set<string>> };
};

const rawOf = (seed: SeedBundle): Record<string, unknown[]> =>
  Object.fromEntries(Object.keys(SEED_FILES).map((k) => [k, seed[k as keyof SeedBundle] as unknown[]]));

/** 엔진 쪽 노출 집합(프리렌더 모델에서). */
function engineIds(seed: SeedBundle, asOf: string) {
  const m = projectSite(seed, asOf);
  return {
    animalTypes: m.types.map((t) => t.id).sort(),
    curatedProducts: [...new Set(m.types.flatMap((t) => t.requirements.flatMap((r) => r.products.map((p) => p.id))))].sort(),
    setupBundles: [...new Set(m.types.flatMap((t) => t.bundles.map((b) => b.id)))].sort(),
    supplyRequirements: m.types.flatMap((t) => t.requirements.map((r) => r.requirementId)).sort(),
    compatibilityRules: m.catalog.compatibilityRules.map((c) => c.id).sort(),
  };
}
function mjsIds(seed: SeedBundle, asOf: string) {
  const ex = mjs.computeExposure(rawOf(seed), asOf);
  const sorted = (k: string): string[] => [...ex.ids[k]].sort();
  return {
    animalTypes: sorted('animalTypes'),
    curatedProducts: sorted('curatedProducts'),
    setupBundles: sorted('setupBundles'),
    supplyRequirements: sorted('supplyRequirements'),
    compatibilityRules: sorted('compatibilityRules'),
  };
}

describe('STALE_DAYS · 날짜 해석 패리티', () => {
  it('scripts/lib/seed-exposure.mjs STALE_DAYS === engine STALE_DAYS === 180', () => {
    expect(mjs.STALE_DAYS).toBe(STALE_DAYS);
    expect(STALE_DAYS).toBe(180);
  });

  it('dayNumber(mjs) 와 isoDayNumber(engine) 이 같은 값·같은 거부', () => {
    const cases = [
      '2026-01-01', '2026-06-30', '2026-12-31', '2027-03-29', '2028-02-29', '2027-02-29', '2100-02-29', '2000-02-29',
      '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', '20260101', ' 2026-01-01', '2026-01-01T00:00',
      '0999-01-01', '', null, undefined, 20260101,
    ];
    for (const c of cases) expect(mjs.dayNumber(c), String(c)).toBe(isoDayNumber(c));
    expect(isoDayNumber('2026-06-30')! - isoDayNumber('2026-01-01')!).toBe(180);
  });
});

describe('CC 증서 URL 패리티(S1 M-3) — engine parseCcLicenseUrl ↔ mjs ccLicenseOfUrl', () => {
  it('같은 분류·같은 거부', () => {
    const cases = [
      'https://creativecommons.org/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by-sa/4.0/',
      'https://creativecommons.org/licenses/by/2.0/deed.ko',
      'https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hant',
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://creativecommons.org/licenses/by/4.0',
      'https://creativecommons.org/licenses/by-nc/4.0/',
      'http://creativecommons.org/licenses/by/4.0/',
      'https://CreativeCommons.org/licenses/by/4.0/',
      'https://creativecommons.org:443/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by/4.0/?a=1',
      'https://creativecommons.org/licenses/by/4.0/#x',
      'https://creativecommons.org@evil.example/licenses/by/4.0/',
      'https://evil.creativecommons.org/licenses/by/4.0/',
      'https://creativecommons.org.evil.example/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by/4.0/../../x/',
      'https://creativecommons.org/licenses/by/40/',
      '',
      null,
      42,
    ];
    for (const c of cases) expect(mjs.ccLicenseOfUrl(c), String(c)).toBe(parseCcLicenseUrl(c)?.license ?? null);
  });
});

describe('사진 사용 가능 패리티(S-R4 L-C·L-D·L-E) — engine isPhotoUsable ↔ mjs isPhotoUsableRow', () => {
  const base = {
    id: 'ph-x', scene: 's', slot: 'intro-1', query: 'q', source: 'WIKIMEDIA', license: 'CC_BY', author: 'A',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    downloadedAt: '2026-09-30', modified: false, status: 'READY',
  };
  const variants: Array<Record<string, unknown>> = [
    {},
    { status: 'SLOT' }, { status: 'ACTIVE' }, { status: 'ready' }, { status: undefined }, { status: '' }, { status: null },
    { downloadedAt: '2026-02-30' }, { downloadedAt: '2026/09/30' }, { downloadedAt: '2026-9-30' }, { downloadedAt: ' ' }, { downloadedAt: null }, { downloadedAt: '0999-01-01' },
    { sourceUrl: 'https://localhost/x.jpg' }, { sourceUrl: 'https://x' }, { sourceUrl: 'http://e.org/x' }, { sourceUrl: 'https://e.org' },
    { sourceUrl: 'https://e.org/a b' }, { sourceUrl: 'https://e.org?x=1' }, { sourceUrl: 'HTTPS://e.org/x' }, { sourceUrl: 'https:///e.org' },
    { licenseUrl: 'https://creativecommons.org/licenses/by/9.9/' }, { licenseUrl: 'https://creativecommons.org/licenses/by/2.5/' },
    { licenseUrl: 'https://creativecommons.org/licenses/by/1.0/' }, { licenseUrl: null },
    { license: 'CC0', author: null, licenseUrl: null }, { license: 'CC_BY_SA' }, { license: 'SITE_LICENSE', licenseUrl: null },
    { license: 'UNKNOWN' }, { author: ' ' }, { source: '' },
  ];
  it.each(variants.map((v) => [JSON.stringify(v), v] as const))('%s', (_n, v) => {
    const p = { ...base, ...v };
    expect(mjs.isPhotoUsableRow(p)).toBe(isPhotoUsable(p as never));
  });
  it('상태 허용목록 동일', () => {
    expect([...mjs.PHOTO_USABLE_STATUSES]).toEqual([...PHOTO_USABLE_STATUSES]);
  });
});

describe('stale 주입 — 엔진·독립 구현 결과 동일', () => {
  const dates = ['2026-09-29', FIXTURE_AS_OF, FIXTURE_LAST_FRESH, FIXTURE_FIRST_STALE, '2027-12-31'];
  it.each(dates)('기준일 %s', (asOf) => {
    const s = promoted();
    expect(engineIds(s, asOf)).toEqual(mjsIds(s, asOf));
  });

  const OLD = '2026-03-31'; // FIXTURE_AS_OF 기준 184일
  const links: Array<[keyof SeedBundle, string]> = [
    ['animalTypes', 'hamster-golden'],
    ['careProfiles', 'cp-hamster-syrian'],
    ['supplyItems', 'cage'],
    ['supplyItems', 'wheel'],
    ['supplyRequirements', 'req-syrian-cage'],
    ['supplyRequirements', 'req-syrian-wheel'],
    ['curatedProducts', 'cp-001'],
    ['setupBundles', 'sb-syrian-budget'],
  ];
  it.each(links)('%s#%s 만 오래됨', (key, id) => {
    const s = promoted();
    const before = engineIds(s, FIXTURE_AS_OF);
    patch(s, key, id, { verifiedAt: OLD });
    const after = engineIds(s, FIXTURE_AS_OF);
    expect(after).toEqual(mjsIds(s, FIXTURE_AS_OF));
    expect(after).not.toEqual(before); // 주입이 실제로 무언가를 숨겼다
  });

  it('verifiedAt 누락·미래 날짜 주입도 동일(fail-closed)', () => {
    for (const v of [null, '2026-10-02', 'bad']) {
      const s = promoted();
      patch(s, 'careProfiles', 'cp-hamster-syrian', { verifiedAt: v });
      expect(engineIds(s, FIXTURE_AS_OF)).toEqual(mjsIds(s, FIXTURE_AS_OF));
      expect(engineIds(s, FIXTURE_AS_OF).animalTypes).toEqual([]);
    }
  });
});
