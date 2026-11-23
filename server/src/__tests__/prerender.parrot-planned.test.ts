// 271(268 단계 7) — 1차 종 골격(사랑앵무·왕관앵무·로보로브스키) 착지 후 실시드 프리렌더 노출 0(fail-closed).
//   356(2026-11-23): 5 새 타입·앵무 프로필·용품·요구사항이 GENERAL_INFO(AI_DRAFT·검수자 없음)로 ACTIVE 가 됐다.
//   이 파일은 이제 「draftedAt(2026-11-23) 이전 asOf 로 빌드하면 GENERAL_INFO 체인이 하나도 실리지 않는다」(fail-closed)를 본다 —
//   AS_OF 2026-11-02 는 draftedAt 보다 앞이라 GENERAL_INFO 행은 노출 판정에서 무효다. Taxon 5 는 여전히 DRAFT(학명·법 문장 비노출).
//   디스크 시드는 바꾸지 않는다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { realSeed } from './fixtures/prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(here, '..', '..', '..', 'client', 'index.html'), 'utf8');
const AS_OF = '2026-11-02'; // 작업일(271). 356: GENERAL_INFO draftedAt(2026-11-23) 이전 — 미래 draftedAt 행은 무효(fail-closed).
const build = (): SiteBuild =>
  buildSite(realSeed(), { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf: AS_OF });
const allText = (b: SiteBuild): string => [...b.pages.map((p) => p.html), ...[...b.files.values()].map((v) => (typeof v === 'string' ? v : ''))].join('\n');

const NEW_TYPES = ['budgie', 'cockatiel', 'lovebird-peach', 'sun-conure', 'hamster-robo'] as const;
const NEW_PATHS = ['/parrot/budgie', '/parrot/cockatiel', '/parrot/lovebird-peach', '/parrot/sun-conure', '/hamster/robo'] as const;
const PARROT_ITEMS = ['bird-cage', 'perch', 'bird-food', 'mineral', 'bird-bath', 'foraging-toy', 'cage-cover'] as const;

describe('디스크 상태(356 활성화 후 — GENERAL_INFO, VERIFIED 아님)', () => {
  const s = realSeed();
  it('새 타입 5 = ACTIVE · GENERAL_INFO · AI_DRAFT · verifiedBy null · draftedAt 2026-11-23', () => {
    for (const id of NEW_TYPES) {
      const t = s.animalTypes.find((x) => x.id === id);
      expect([id, t?.status, t?.reviewStatus, t?.reviewerType, t?.verifiedBy, t?.draftedAt]).toEqual([id, 'ACTIVE', 'GENERAL_INFO', 'AI_DRAFT', null, '2026-11-23']);
    }
  });
  it('새 Taxon 5 = DRAFT · AI_DRAFT(GENERAL_INFO 대상 밖) · cp-parrot-large DRAFT 빈 묶음 · 앵무 프로필 2·용품 7 = GENERAL_INFO(VERIFIED 0)', () => {
    const taxa = s.taxa.filter((x) => ['phodopus-roborovskii', 'melopsittacus-undulatus', 'nymphicus-hollandicus', 'agapornis-roseicollis', 'aratinga-solstitialis'].includes(x.id));
    expect(taxa).toHaveLength(5);
    for (const r of taxa) expect([r.id, r.reviewStatus, r.reviewerType, r.verifiedBy]).toEqual([r.id, 'DRAFT', 'AI_DRAFT', null]);
    const large = s.careProfiles.find((x) => x.id === 'cp-parrot-large');
    expect([large?.reviewStatus, large?.facts, large?.careNotes]).toEqual(['DRAFT', {}, []]);
    const gi = [
      ...s.careProfiles.filter((x) => x.id === 'cp-parrot-small' || x.id === 'cp-parrot-medium'),
      ...s.supplyItems.filter((x) => (PARROT_ITEMS as readonly string[]).includes(x.id)),
    ];
    expect(gi).toHaveLength(9);
    for (const r of gi) expect([r.id, r.reviewStatus, r.reviewerType, r.verifiedBy]).toEqual([r.id, 'GENERAL_INFO', 'AI_DRAFT', null]);
  });
  it('앵무 사육 프로필 요구사항 행 = 소형 12 · 중형 12, 전부 GENERAL_INFO', () => {
    const rows = s.supplyRequirements.filter((r) => r.careProfileId.startsWith('cp-parrot-'));
    expect(rows.filter((r) => r.careProfileId === 'cp-parrot-small')).toHaveLength(12);
    expect(rows.filter((r) => r.careProfileId === 'cp-parrot-medium')).toHaveLength(12);
    expect(rows.filter((r) => r.reviewStatus !== 'GENERAL_INFO').map((r) => r.id)).toEqual([]);
  });
});

describe('실시드 프리렌더(asOf 2026-11-02 < draftedAt) — 새 종 노출 0(fail-closed)', () => {
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
      'agapornis-roseicollis', 'aratinga-solstitialis', 'Agapornis', 'Aratinga', '벚꽃모란앵무', '썬코뉴어', 'parrot/lovebird-peach', 'parrot/sun-conure',
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
