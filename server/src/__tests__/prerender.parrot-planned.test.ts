// 271(268 단계 7) — 1차 종 골격(사랑앵무·왕관앵무·로보로브스키) 착지 후 실시드 프리렌더 노출 0(fail-closed).
//   새 행은 전부 DRAFT·AI_DRAFT 이고 타입은 PLANNED 다 → 페이지·경로·링크·ws-data·파일 어디에도 새 종·새 Taxon·새 사육 프로필·
//   앵무 용품이 실리면 안 된다(불변식 ⑦). 디스크 시드는 바꾸지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const AS_OF = '2026-11-02'; // 작업일(271).
const build = (): SiteBuild =>
  buildSite(realSeed(), { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: AS_OF });
const allText = (b: SiteBuild): string => [...b.pages.map((p) => p.html), ...[...b.files.values()].map((v) => (typeof v === 'string' ? v : ''))].join('\n');

const NEW_TYPES = ['budgie', 'cockatiel', 'hamster-robo'] as const;
const NEW_PATHS = ['/parrot/budgie', '/parrot/cockatiel', '/hamster/robo'] as const;
const PARROT_ITEMS = ['bird-cage', 'perch', 'bird-food', 'mineral', 'bird-bath', 'foraging-toy', 'cage-cover'] as const;

describe('디스크 골격 상태(사실값 0 · 공개 0 전제)', () => {
  const s = realSeed();
  it('새 타입 3 = PLANNED · DRAFT · AI_DRAFT · verifiedBy null', () => {
    for (const id of NEW_TYPES) {
      const t = s.animalTypes.find((x) => x.id === id);
      expect([id, t?.status, t?.reviewStatus, t?.reviewerType, t?.verifiedBy]).toEqual([id, 'PLANNED', 'DRAFT', 'AI_DRAFT', null]);
    }
  });
  it('새 Taxon 3·CareProfile 2·용품 7 = DRAFT · AI_DRAFT, 사육 프로필 facts·careNotes 비어 있음', () => {
    const rows = [
      ...s.taxa.filter((x) => ['phodopus-roborovskii', 'melopsittacus-undulatus', 'nymphicus-hollandicus'].includes(x.id)),
      ...s.careProfiles.filter((x) => x.id.startsWith('cp-parrot-')),
      ...s.supplyItems.filter((x) => (PARROT_ITEMS as readonly string[]).includes(x.id)),
    ];
    expect(rows).toHaveLength(12);
    for (const r of rows) expect([r.id, r.reviewStatus, r.reviewerType, r.verifiedBy]).toEqual([r.id, 'DRAFT', 'AI_DRAFT', null]);
    for (const cp of s.careProfiles.filter((x) => x.id.startsWith('cp-parrot-'))) {
      expect([cp.id, cp.facts, cp.careNotes]).toEqual([cp.id, {}, []]);
    }
  });
  it('앵무 사육 프로필의 요구사항 행 0(사실값 없는 행은 넣지 않는다 — 결정 ②)', () => {
    expect(s.supplyRequirements.filter((r) => r.careProfileId.startsWith('cp-parrot-'))).toEqual([]);
  });
});

describe('실시드 프리렌더 — 새 종 노출 0', () => {
  const b = build();
  it('노출 타입 모델에 새 타입 0, 페이지·경로 0, /parrot·/hamster/robo 링크 0', () => {
    for (const id of NEW_TYPES) expect([id, b.model.types.some((t) => t.id === id)]).toEqual([id, false]);
    expect(b.pages.filter((p) => (NEW_TYPES as readonly string[]).includes(p.route.typeId ?? '') || p.route.path.startsWith('/parrot'))).toEqual([]);
    for (const path of NEW_PATHS) {
      expect([path, b.pages.some((p) => p.route.path === path || p.route.path.startsWith(`${path}/`))]).toEqual([path, false]);
      for (const p of b.pages) expect([p.route.path, path, p.html.includes(`href="${path}`)]).toEqual([p.route.path, path, false]);
    }
  });
  it('모든 산출물(HTML·ws-data·sitemap 등 파일)에 새 학명·Taxon·프로필·용품 id·이름 0', () => {
    const text = allText(b);
    expect(text.length).toBeGreaterThan(0);
    const banned = [
      'Melopsittacus', 'Nymphicus', 'roborovskii', 'Roborovskii',
      'melopsittacus-undulatus', 'nymphicus-hollandicus', 'phodopus-roborovskii',
      'cp-parrot-', 'hamster-robo', 'hamster/robo', 'parrot/budgie', 'parrot/cockatiel',
      '사랑앵무', '왕관앵무', '로보로브스키',
      'bird-cage', 'bird-food', 'bird-bath', 'foraging-toy', 'cage-cover', '"perch"', '"mineral"',
      '새장', '횃대', '새 모이', '새 목욕통', '갑오징어뼈',
    ];
    for (const w of banned) expect([w, text.includes(w)]).toEqual([w, false]);
  });
  it('sitemap 에 새 경로 0', () => {
    const sm = b.files.get('sitemap.xml');
    expect(typeof sm).toBe('string');
    for (const path of NEW_PATHS) expect([path, String(sm).includes(path)]).toEqual([path, false]);
  });
});
