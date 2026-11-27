// 356 M11~M12: GENERAL_INFO(일반 참고 정보) 6종의 공개 투영·와이어·lastmod·반응 대상.
//   - PublicAnimalType: 자기 메타가 GENERAL_INFO 면 review 키 없음(AI_DRAFT 문자열 ws-data 미노출), 페이지에 GENERAL_INFO 체인이 하나라도 있으면 generalInfo: true.
//   - PublicRequirement: 체인(type·profile·requirement·item) 중 GENERAL_INFO 가 있으면 generalInfo: true · lastVerifiedAt ''(검수일 표기 0).
//   - VERIFIED 만인 타입·요구사항은 키 자체가 없다(기존 ws-data 바이트 불변).
//   - lastmod: verifiedAt 이 없으면 GENERAL_INFO 행의 draftedAt.
//   - known-ids: GENERAL_INFO 타입(코드 고정 6종)·용품도 반응·제보 대상(상위집합 규칙).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog, createEngine, decodeWsPage, encodeWsPage, type CatalogInput, type WsPageData } from '../engine/index.js';
import { readSeedDir } from '../seed/read.js';
import { projectSite } from '../prerender/project.js';
import { planRoutes } from '../prerender/routes.js';
import { knownTargetIdsFrom, knownTypeIdsFrom } from '../boot/known-ids.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const AS_OF = '2026-11-23';
const seed = readSeedDir(SEED_DIR);
const site = projectSite(seed, AS_OF);
const typeOf = (id: string) => {
  const t = site.types.find((x) => x.id === id);
  if (!t) throw new Error(`type ${id} 비노출`);
  return t;
};
const GI_TYPES = ['hamster-robo', 'budgie', 'cockatiel', 'lovebird-peach', 'sun-conure'];

describe('356 M11 — PublicAnimalType', () => {
  it('노출 타입 9(기존 3 + 6종)', () => {
    expect(site.types.map((t) => t.id).sort()).toEqual(
      ['budgie', 'cockatiel', 'gerbil-mongolian', 'guinea-pig', 'hamster-dwarf', 'hamster-golden', 'hamster-robo', 'lovebird-peach', 'sun-conure'],
    );
  });

  it.each(GI_TYPES)('%s: review 키 없음 + generalInfo true, AI_DRAFT 문자열 없음', (id) => {
    const pub = typeOf(id).pub;
    expect(Object.prototype.hasOwnProperty.call(pub, 'review')).toBe(false);
    expect(pub.generalInfo).toBe(true);
    expect(JSON.stringify(pub)).not.toContain('AI_DRAFT');
  });

  it('VERIFIED 타입(골든): review 그대로, generalInfo 키 없음', () => {
    const pub = typeOf('hamster-golden').pub;
    expect(pub.review).toEqual({ verifiedAt: '2026-11-16', reviewerType: 'EXPERIENCED_KEEPER' });
    expect(Object.prototype.hasOwnProperty.call(pub, 'generalInfo')).toBe(false);
  });

  it('저빌: 타입은 VERIFIED(review 유지)지만 사료 행이 GENERAL_INFO → 페이지 generalInfo true', () => {
    const pub = typeOf('gerbil-mongolian').pub;
    expect(pub.review?.reviewerType).toBe('EXPERIENCED_KEEPER');
    expect(pub.generalInfo).toBe(true);
  });
});

describe('356 M11 — PublicRequirement', () => {
  it('6종 요구사항은 generalInfo true · lastVerifiedAt 빈 값 · AI_DRAFT 문자열 없음', () => {
    for (const id of GI_TYPES) {
      const reqs = typeOf(id).requirements;
      expect(reqs.length).toBeGreaterThan(0);
      for (const r of reqs) {
        expect(r.pub.generalInfo).toBe(true);
        expect(r.pub.lastVerifiedAt).toBe('');
        expect(JSON.stringify(r.pub)).not.toContain('AI_DRAFT');
      }
    }
  });

  it('저빌: 사료만 generalInfo(검수일 표기 없음), 나머지는 키 없음·검수일 유지', () => {
    for (const r of typeOf('gerbil-mongolian').requirements) {
      if (r.requirementId === 'req-gerbil-food') {
        expect(r.pub.generalInfo).toBe(true);
        expect(r.pub.lastVerifiedAt).toBe('');
      } else {
        expect(Object.prototype.hasOwnProperty.call(r.pub, 'generalInfo')).toBe(false);
        expect(r.pub.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('VERIFIED 3종(골든·드워프·기니피그) 요구사항에는 generalInfo 키 없음', () => {
    for (const id of ['hamster-golden', 'hamster-dwarf', 'guinea-pig']) {
      for (const r of typeOf(id).requirements) {
        expect(Object.prototype.hasOwnProperty.call(r.pub, 'generalInfo')).toBe(false);
        expect(r.pub.lastVerifiedAt).not.toBe('');
      }
    }
  });

  it('공유 저울(scale, DRAFT)은 6종에서도 비노출 그대로', () => {
    for (const id of GI_TYPES) expect(typeOf(id).requirements.some((r) => r.item.id === 'scale')).toBe(false);
  });
});

describe('356 M11 — ws-wire 왕복', () => {
  it('generalInfo 키·review 부재가 encode/decode 에서 그대로', () => {
    const t = typeOf('budgie');
    const page: WsPageData = {
      v: 1,
      route: { kind: 'TYPE', path: '/parrot/budgie', typeId: 'budgie' },
      layer: null,
      catalogUrl: '/data/catalog.v1.00000000.json',
      data: { types: [t.pub], requirements: t.requirements.map((r) => r.pub), products: [], bundles: [], vets: [], testimonials: [] },
    };
    const wire = encodeWsPage(page);
    expect(JSON.stringify(wire)).not.toContain('AI_DRAFT');
    expect(wire.data.requirements.every((r) => r.generalInfo === true)).toBe(true);
    const back = decodeWsPage(JSON.parse(JSON.stringify(wire)));
    expect(back).toEqual(JSON.parse(JSON.stringify(page)));
  });
});

describe('356 단계 10 — 공개 카탈로그 행 메타(PublicCatalogMeta)', () => {
  const KEYS = ['animalTypes', 'careProfiles', 'supplyItems', 'supplyRequirements', 'compatibilityRules'] as const;
  const rows = KEYS.flatMap((k) => (site.catalog[k] as unknown as Array<Record<string, unknown>>).map((r) => ({ k, r })));
  const gi = rows.filter(({ r }) => r.reviewStatus === 'GENERAL_INFO');

  it('GENERAL_INFO 행이 있다(6종 활성화) — 전부 reviewerType 키 없음 · generalInfo true', () => {
    expect(gi.length).toBeGreaterThan(0);
    for (const { k, r } of gi) {
      expect('reviewerType' in r, `${k}#${String(r.id)}`).toBe(false);
      expect(r.generalInfo, `${k}#${String(r.id)}`).toBe(true);
      expect(r.verifiedBy).toBe(null);
    }
  });

  it('그 밖 행은 reviewerType 유지 · generalInfo 키 없음(기존 바이트 형태)', () => {
    for (const { k, r } of rows.filter(({ r }) => r.reviewStatus !== 'GENERAL_INFO')) {
      expect(typeof r.reviewerType, `${k}#${String(r.id)}`).toBe('string');
      expect('generalInfo' in r, `${k}#${String(r.id)}`).toBe(false);
      expect(Object.keys(r).slice(0, 3)).toEqual(['reviewStatus', 'reviewerType', 'verifiedBy']);
    }
  });

  it('직렬화한 카탈로그에 AI_DRAFT 문자열 0 · draftedAt·crossCheck 0', () => {
    const text = JSON.stringify(site.catalog);
    expect(text).not.toContain('AI_DRAFT');
    expect(text).not.toContain('draftedAt');
    expect(text).not.toContain('crossCheck');
  });

  it('클라이언트 소비 경로(createCatalog → createEngine)로 6종 용품 규격 판정이 그대로 된다', () => {
    const engine = createEngine(createCatalog(JSON.parse(JSON.stringify(site.catalog)) as CatalogInput));
    const server = createEngine(site.cat);
    for (const id of ['budgie', 'hamster-robo', 'hamster-golden']) {
      const items = typeOf(id).requirements.map((q) => q.item.id);
      expect(items.length).toBeGreaterThan(0);
      for (const itemId of items) {
        expect(engine.specCheck(id, itemId, {}), `${id}/${itemId}`).toEqual(server.specCheck(id, itemId, {}));
      }
    }
  });
});

describe('356 M12 — lastmod 는 verifiedAt 없으면 draftedAt', () => {
  it('6종 TypeModel.lastmod = draftedAt(2026-11-23)', () => {
    for (const id of GI_TYPES) expect(typeOf(id).lastmod).toBe('2026-11-23');
  });

  it('/parrot(FAMILY) lastmod 가 null 이 아니다', () => {
    const routes = planRoutes(site);
    expect(routes.find((r) => r.path === '/parrot')?.lastmod).toBe('2026-11-23');
    expect(routes.find((r) => r.path === '/parrot/budgie')?.lastmod).toBe('2026-11-23');
  });

  it('앵무 전용 용품 페이지(/supplies/bird-cage) lastmod = draftedAt', () => {
    expect(site.items.find((i) => i.id === 'bird-cage')?.lastmod).toBe('2026-11-23');
  });

  it('VERIFIED 타입 lastmod 는 그대로(골든 = 검수일 최댓값)', () => {
    expect(typeOf('hamster-golden').lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeOf('hamster-golden').lastmod).not.toBe(null);
  });
});

describe('356 M11 — 반응·제보 대상(known-ids)', () => {
  const GI = { reviewStatus: 'GENERAL_INFO', reviewerType: 'AI_DRAFT' };
  it('GENERAL_INFO 타입은 코드 고정 6종만', () => {
    const ids = knownTypeIdsFrom([
      { id: 'budgie', ...GI },
      { id: 'hamster-robo', ...GI },
      { id: 'hamster-golden', ...GI }, // 6종 밖 — 거부
      { id: 'cockatiel', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT' },
      { id: 'parrot-x', ...GI },
    ]);
    expect([...ids].sort()).toEqual(['budgie', 'hamster-robo']);
  });

  it('GENERAL_INFO 용품은 반응 대상, 구성안·상품은 VERIFIED 만', () => {
    const ids = knownTargetIdsFrom({
      supplyItems: [{ id: 'bird-cage', ...GI }, { id: 'scale', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT' }],
      bundles: [{ id: 'gi-bundle', ...GI }],
      products: [{ id: 'gi-product', ...GI, status: 'ACTIVE', meetsMinSpec: true }],
    });
    expect([...ids]).toEqual(['bird-cage']);
  });

  it('알 수 없는 reviewerType 의 GENERAL_INFO 는 거부(fail-closed)', () => {
    expect(knownTargetIdsFrom({ supplyItems: [{ id: 'x', reviewStatus: 'GENERAL_INFO', reviewerType: 'NOPE' }], bundles: [], products: [] }).size).toBe(0);
  });
});
