// 저빌 126 S7 — 프리뷰 크기·fail-closed.
//   (1) 실시드(gerbil-mongolian PLANNED, 전부 DRAFT): 산출물에 저빌 타입 페이지 0, 'meriones'·Taxon 법 문장 0, /gerbil 링크 0.
//   (2) 강제 ACTIVE 미리보기(메모리 전용 — 타입·사육 프로필·요구사항 14·용품만 V 표기, Taxon 은 DRAFT 그대로):
//       타입 페이지 ws-data ≤ 28KB(경고선, 상한 32KB 불변), 구성안 0 → /gerbil/setup 링크·경로 0(QA118 D1),
//       Taxon 미검수라 학명·법 문장 0(C3-OUT-TAXON 과 같은 조건), L5 사료 '저빌용' 선택지 라벨이 실린다(라벨 누락이면 필드가 숨는다 — 126 R3).
//   디스크 시드는 바꾸지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { buildSite, type BuiltPage, type SiteBuild } from '../prerender/site.js';
import { WS_DATA_MAX_BYTES } from '../prerender/cli.js';
import { FIXTURE_AS_OF, V, realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const G = 'gerbil-mongolian';
const CP = 'cp-gerbil-mongolian';
const build = (seed: SeedBundle): SiteBuild =>
  buildSite(seed, { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: FIXTURE_AS_OF });
const allText = (b: SiteBuild): string => [...b.pages.map((p) => p.html), ...[...b.files.values()].map((v) => (typeof v === 'string' ? v : ''))].join('\n');
const pageAt = (b: SiteBuild, path: string): BuiltPage => {
  const p = b.pages.find((x) => x.route.path === path);
  if (!p) throw new Error(`페이지 없음: ${path}`);
  return p;
};
const TAXON_NOTE_FRAGMENT = '시·군·구에 신고하는 제도';

/** 저빌 강제 ACTIVE 미리보기(메모리 전용). 사실값은 디스크 그대로, 검수 표기만 V(픽스처). Taxon 은 건드리지 않는다. */
function gerbilPreview(): SeedBundle {
  const s = realSeed();
  const at = s.animalTypes.find((x) => x.id === G);
  if (!at || at.status !== 'PLANNED') throw new Error('fixture: 디스크 gerbil-mongolian 은 PLANNED 여야 한다');
  Object.assign(at, V, { status: 'ACTIVE' });
  const cp = s.careProfiles.find((x) => x.id === CP);
  if (!cp) throw new Error('fixture: cp-gerbil-mongolian 없음');
  Object.assign(cp, V);
  const items = new Set<string>();
  for (const r of s.supplyRequirements) {
    if (r.careProfileId !== CP) continue;
    Object.assign(r, V);
    items.add(r.supplyItemId);
  }
  for (const i of s.supplyItems) if (items.has(i.id)) Object.assign(i, V);
  for (const c of s.compatibilityRules) if (c.careProfileId === CP) Object.assign(c, V);
  return s;
}

describe('실시드 — 저빌 PLANNED 라 산출물 0(fail-closed)', () => {
  const b = build(realSeed());
  it('저빌 타입 페이지·경로 0, /gerbil 링크 0', () => {
    expect(realSeed().animalTypes.find((t) => t.id === G)?.status).toBe('PLANNED');
    expect(b.model.types.some((t) => t.id === G)).toBe(false);
    expect(b.pages.filter((p) => p.route.typeId === G || p.route.path.startsWith('/gerbil'))).toEqual([]);
    for (const p of b.pages) expect([p.route.path, p.html.includes('href="/gerbil')]).toEqual([p.route.path, false]);
  });
  it("모든 산출물(HTML·파일)에 'meriones'·저빌 Taxon·사육 프로필·요구사항 id·법 문장 0", () => {
    const text = allText(b);
    expect(text.length).toBeGreaterThan(0);
    for (const w of ['meriones', 'Meriones', 'cp-gerbil-mongolian', 'req-gerbil-', 'cr-gerbil-', TAXON_NOTE_FRAGMENT, '야생생물법']) expect([w, text.includes(w)]).toEqual([w, false]);
  });
});

describe('저빌 강제 ACTIVE 미리보기(메모리) — 크기·D1·Taxon 비노출', () => {
  const b = build(gerbilPreview());
  const typePages = b.pages.filter((p) => p.route.typeId === G);

  it('노출 타입 = 저빌 1, 요구사항 14 경로(L4·L5) 생성', () => {
    expect(b.model.types.map((t) => t.id)).toEqual([G]);
    const paths = new Set(b.pages.map((p) => p.route.path));
    expect(paths.has('/gerbil')).toBe(true);
    for (const item of ['cage', 'food', 'sand-bath', 'wheel', 'hay']) {
      expect([item, paths.has(`/gerbil/supplies/${item}`), paths.has(`/gerbil/check/${item}`)]).toEqual([item, true, true]);
    }
  });

  it('ws-data: 상한(32KB) 초과 0, 최대 < 28KB(경고선)', () => {
    expect(typePages.length).toBeGreaterThan(0);
    const max = Math.max(...b.pages.map((p) => p.wsDataBytes));
    expect(max).toBeLessThanOrEqual(WS_DATA_MAX_BYTES);
    expect(max).toBeLessThan(28 * 1024);
  });

  it('구성안 0 → /gerbil/setup 경로·링크 0(QA118 D1)', () => {
    const paths = new Set(b.pages.map((p) => p.route.path));
    expect(paths.has('/gerbil/setup')).toBe(false);
    for (const p of b.pages) expect([p.route.path, p.html.includes('href="/gerbil/setup"')]).toEqual([p.route.path, false]);
  });

  it('Taxon DRAFT → Taxon id·법 문장 0(C3-OUT-TAXON 조건), 학명은 노출 사육 프로필의 ADW 출처 표기에만', () => {
    const text = allText(b);
    for (const w of ['meriones-unguiculatus', TAXON_NOTE_FRAGMENT, '야생생물법', '제21조']) expect([w, text.includes(w)]).toEqual([w, false]);
    // 사육 프로필 출처(A1 Animal Diversity Web)의 url·title 은 노출 행의 출처 표기라 허용 — 그것을 지우면 학명 0.
    const adw = realSeed().careProfiles.find((c) => c.id === CP)?.source.find((x) => x.url.includes('animaldiversity.org'));
    if (!adw) throw new Error('fixture: ADW 출처 없음');
    expect(text.includes(adw.url)).toBe(true);
    expect(text.split(adw.url).join('').split(adw.title).join('')).not.toMatch(/meriones/i);
  });

  it("L5 사료 판정 페이지에 '저빌용' 선택지 라벨이 실린다(forSpecies 필드 표시)", () => {
    expect(pageAt(b, '/gerbil/check/food').html).toContain('저빌용');
  });

  it("L5 저빌 사료에 '포장 대상에 이 동물 표기' 라벨과 forSpecies=MULTI 조건 행이 실리고, 골든 사료 L5 엔 없다", () => {
    const html = pageAt(b, '/gerbil/check/food').html;
    expect(html).toContain('포장 대상에 이 동물 표기');
    expect(html).toContain('여러 동물용이면 포장 대상에 저빌이 적혀 있어야 해요');
    // 골든 사료 L5 는 이 빌드(실시드 골든 DRAFT)에 없으므로, 저빌 밖 어떤 L5 에도 라벨이 없음을 단언(골든 사료 L5 가 생기면 그대로 잡힌다).
    for (const p of b.pages) {
      if (p.route.typeId !== G) expect([p.route.path, p.html.includes('포장 대상에 이 동물 표기')]).toEqual([p.route.path, false]);
    }
  });
});
