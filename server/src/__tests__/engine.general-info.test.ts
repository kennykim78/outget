// 356 M1~M5 — reviewStatus GENERAL_INFO(일반 참고 정보) 등급. VERIFIED 승격이 아니다(V01 유지).
//   코드 고정 6종(GENERAL_INFO_TYPE_IDS)의 체인 메타(type·requirement·item·careProfile)만 이 등급으로 노출될 수 있다.
//   상품·구성안·호환·Taxon·후기는 자기 메타가 VERIFIED 여야 한다(그대로). 값은 테스트 전용 자리표시 — 사육 사실 아님.
import { describe, expect, it } from 'vitest';
import {
  GENERAL_INFO_STATUS,
  GENERAL_INFO_TYPE_IDS,
  REVIEW_STATUSES,
  createCatalog,
  isAnimalTypeExposable,
  isBundleExposable,
  isCompatRuleExposable,
  isGeneralInfoMeta,
  isGeneralInfoTypeId,
  isProductExposable,
  isRequirementExposable,
  isTaxonExposable,
  isTestimonialPublic,
  isVerified,
  listResolvedRequirements,
  resolveRequirement,
  type ContentMeta,
  type SeedBundle,
} from '../engine/index.js';
import { makeBundle } from './fixtures/engine-catalog.js';

const AS_OF = '2026-11-22';
const DRAFTED = '2026-11-20';
const CC = { tool: 'CODEX_DISCUSS', checkedAt: '2026-11-21', result: 'AGREE' } as const;

type Meta = Partial<ContentMeta> & Record<string, unknown>;
const GI = (extra: Meta = {}): Meta => ({
  reviewStatus: 'GENERAL_INFO',
  reviewerType: 'AI_DRAFT',
  verifiedBy: null,
  verifiedAt: null,
  contentKind: 'CARE',
  source: [{ url: 'https://example.org/placeholder', title: '자리표시', accessedAt: DRAFTED }],
  draftedAt: DRAFTED,
  ...extra,
});
const V = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: 'keeper-1', verifiedAt: '2026-11-16' } as const;

describe('M1 domain — REVIEW_STATUSES 에 GENERAL_INFO', () => {
  it('GENERAL_INFO 가 있고 VERIFIED 와 다르다', () => {
    expect(REVIEW_STATUSES).toContain('GENERAL_INFO');
    expect(GENERAL_INFO_STATUS).toBe('GENERAL_INFO');
    expect(REVIEW_STATUSES).toEqual(['DRAFT', 'NEEDS_REVIEW', 'VERIFIED', 'GENERAL_INFO']);
  });
  it('isVerified 는 GENERAL_INFO 를 VERIFIED 로 보지 않는다(어떤 검수자 유형이든)', () => {
    for (const t of ['AI_DRAFT', 'OPERATOR', 'VET'] as const) {
      expect(isVerified({ reviewStatus: 'GENERAL_INFO' as ContentMeta['reviewStatus'], reviewerType: t })).toBe(false);
    }
  });
});

describe('M2 GENERAL_INFO_TYPE_IDS — 코드 고정 6종', () => {
  it('정확히 6종·고정(freeze)', () => {
    expect([...GENERAL_INFO_TYPE_IDS]).toEqual(['hamster-robo', 'gerbil-mongolian', 'budgie', 'cockatiel', 'lovebird-peach', 'sun-conure']);
    expect(Object.isFrozen(GENERAL_INFO_TYPE_IDS)).toBe(true);
  });
  it('isGeneralInfoTypeId — 목록 밖·형식 변형은 false(골든·드워프·기니피그 포함)', () => {
    for (const id of GENERAL_INFO_TYPE_IDS) expect(isGeneralInfoTypeId(id)).toBe(true);
    for (const id of ['hamster-golden', 'hamster-dwarf', 'guinea-pig', 'Budgie', ' budgie', 'budgie ', '', null, undefined, 42, 'constructor', '__proto__']) {
      expect(isGeneralInfoTypeId(id)).toBe(false);
    }
  });
});

describe('M2 isGeneralInfoMeta — fail-closed', () => {
  it('CARE·SPEC: GENERAL_INFO ∧ draftedAt 0~180일 → true', () => {
    expect(isGeneralInfoMeta(GI(), AS_OF)).toBe(true);
    expect(isGeneralInfoMeta(GI({ contentKind: 'SPEC' }), AS_OF)).toBe(true);
    expect(isGeneralInfoMeta(GI({ draftedAt: AS_OF }), AS_OF)).toBe(true); // 0일
    expect(isGeneralInfoMeta(GI({ draftedAt: '2026-05-26' }), AS_OF)).toBe(true); // 180일
  });
  it('draftedAt 181일·미래·누락·형식 오류 → false', () => {
    for (const d of ['2026-05-25', '2026-11-23', null, undefined, '', '2026-02-30', '2026/11/20', '2026-11-20T00:00']) {
      expect(isGeneralInfoMeta(GI({ draftedAt: d }), AS_OF), String(d)).toBe(false);
    }
  });
  it('reviewStatus ≠ GENERAL_INFO → false(VERIFIED 행도 이 경로로는 false)', () => {
    for (const s of ['VERIFIED', 'DRAFT', 'NEEDS_REVIEW', 'general_info', 'GENERAL_INFO ', undefined]) {
      expect(isGeneralInfoMeta(GI({ reviewStatus: s }), AS_OF), String(s)).toBe(false);
    }
  });
  it('LEGAL·알 수 없는 contentKind → false', () => {
    for (const k of ['LEGAL', 'legal', 'OTHER', undefined, null]) expect(isGeneralInfoMeta(GI({ contentKind: k }), AS_OF), String(k)).toBe(false);
  });
  it('알 수 없는 reviewerType → false', () => {
    for (const t of ['HUMAN', '', undefined, null]) expect(isGeneralInfoMeta(GI({ reviewerType: t }), AS_OF), String(t)).toBe(false);
  });
  it('FOOD·HEALTH 는 crossCheck{CODEX_DISCUSS, checkedAt, AGREE|REVISED} 필수', () => {
    for (const kind of ['FOOD', 'HEALTH']) {
      expect(isGeneralInfoMeta(GI({ contentKind: kind }), AS_OF)).toBe(false);
      expect(isGeneralInfoMeta(GI({ contentKind: kind, crossCheck: null }), AS_OF)).toBe(false);
      expect(isGeneralInfoMeta(GI({ contentKind: kind, crossCheck: CC }), AS_OF)).toBe(true);
      expect(isGeneralInfoMeta(GI({ contentKind: kind, crossCheck: { ...CC, result: 'REVISED' } }), AS_OF)).toBe(true);
    }
  });
  it.each([
    ['tool 다름', { ...CC, tool: 'CODEX' }],
    ['result DISAGREE', { ...CC, result: 'DISAGREE' }],
    ['result 소문자', { ...CC, result: 'agree' }],
    ['checkedAt 누락', { tool: CC.tool, result: CC.result }],
    ['checkedAt 형식 오류', { ...CC, checkedAt: '2026-11-31' }],
    ['checkedAt < draftedAt', { ...CC, checkedAt: '2026-11-19' }],
    ['checkedAt > asOf', { ...CC, checkedAt: '2026-11-23' }],
    ['알 수 없는 키', { ...CC, note: 'x' }],
    ['배열', [CC]],
    ['문자열', 'AGREE'],
  ])('FOOD crossCheck %s → false', (_n, cc) => {
    expect(isGeneralInfoMeta(GI({ contentKind: 'FOOD', crossCheck: cc as never }), AS_OF)).toBe(false);
  });
  it('asOf 가 YYYY-MM-DD 가 아니면 RangeError', () => {
    expect(() => isGeneralInfoMeta(GI(), '2026-11-2')).toThrow(RangeError);
    expect(() => isGeneralInfoMeta(GI(), undefined as unknown as string)).toThrow(RangeError);
  });
  it('null·배열·원시값 → false', () => {
    for (const m of [null, undefined, [], 'GENERAL_INFO', 1]) expect(isGeneralInfoMeta(m as never, AS_OF)).toBe(false);
  });
});

/**
 * pf-test × box 체인을 typeId 로 복제한 타입(critter-plain 사본)에 붙인다. 체인 메타는 mode 로:
 *   'GI' = 네 메타 전부 GENERAL_INFO, 'V' = 전부 VERIFIED, 'MIX' = 타입·프로필 VERIFIED + 요구사항·용품 GENERAL_INFO.
 */
function chain(typeId: string, mode: 'GI' | 'V' | 'MIX', over: { req?: Meta; item?: Meta; profile?: Meta; type?: Meta } = {}): SeedBundle {
  const b = makeBundle() as SeedBundle;
  const src = b.animalTypes.find((x) => x.id === 'critter-plain')!;
  const at = { ...structuredClone(src), id: typeId };
  b.animalTypes = [...b.animalTypes.filter((x) => x.id !== typeId), at];
  const req = b.supplyRequirements.find((x) => x.careProfileId === 'pf-test' && x.supplyItemId === 'box')!;
  const item = b.supplyItems.find((x) => x.id === 'box')!;
  const profile = b.careProfiles.find((x) => x.id === 'pf-test')!;
  const g = mode === 'V' ? V : GI();
  Object.assign(at, mode === 'MIX' ? V : g, over.type ?? {});
  Object.assign(profile, mode === 'MIX' ? V : g, over.profile ?? {});
  Object.assign(req, g, over.req ?? {});
  Object.assign(item, g, over.item ?? {});
  return b;
}

describe('M3~M4 exposure — 체인 메타(type·requirement·item·careProfile) GENERAL_INFO 허용(코드 고정 6종만)', () => {
  it.each(GENERAL_INFO_TYPE_IDS.map((id) => [id]))('%s: 전부 GENERAL_INFO → 타입·요구사항 노출', (id) => {
    const cat = createCatalog(chain(id, 'GI'));
    expect(isAnimalTypeExposable(cat, id, AS_OF)).toBe(true);
    const r = resolveRequirement(cat, id, 'box')!;
    expect(isRequirementExposable(cat, r, AS_OF)).toBe(true);
    // box 외 요구사항(DRAFT·AI_DRAFT)은 여전히 비노출.
    const others = listResolvedRequirements(cat, id).filter((x) => x.supplyItemId !== 'box');
    expect(others.length).toBeGreaterThan(0);
    expect(others.some((x) => isRequirementExposable(cat, x, AS_OF))).toBe(false);
  });

  it('VERIFIED·GENERAL_INFO 섞인 체인도 노출(저빌 사료 1행 같은 경우)', () => {
    const cat = createCatalog(chain('gerbil-mongolian', 'MIX'));
    expect(isAnimalTypeExposable(cat, 'gerbil-mongolian', AS_OF)).toBe(true);
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'gerbil-mongolian', 'box')!, AS_OF)).toBe(true);
  });

  it.each(['critter-plain', 'hamster-golden', 'hamster-dwarf', 'guinea-pig'])('목록 밖 타입 %s: 같은 GENERAL_INFO 체인 → 비노출', (id) => {
    const cat = createCatalog(chain(id, 'GI'));
    expect(isAnimalTypeExposable(cat, id, AS_OF)).toBe(false);
    expect(isRequirementExposable(cat, resolveRequirement(cat, id, 'box')!, AS_OF)).toBe(false);
  });

  it('목록 밖 타입: 타입·프로필 VERIFIED 여도 요구사항·용품이 GENERAL_INFO 면 그 요구사항 비노출(공유 행 누수 차단)', () => {
    const cat = createCatalog(chain('critter-plain', 'MIX'));
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'critter-plain', 'box')!, AS_OF)).toBe(false);
    expect(isAnimalTypeExposable(cat, 'critter-plain', AS_OF)).toBe(false);
  });

  it.each([
    ['req', { req: { draftedAt: '2026-05-25' } }],
    ['item', { item: { draftedAt: null } }],
    ['profile', { profile: { draftedAt: '2026-11-23' } }],
    ['type', { type: { reviewerType: 'HUMAN' } }],
  ] as const)('체인 하나라도 무효(%s) → 비노출', (_n, over) => {
    const cat = createCatalog(chain('budgie', 'GI', over));
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'budgie', 'box')!, AS_OF)).toBe(false);
  });

  it('FOOD 요구사항은 crossCheck 없으면 비노출, 있으면 노출', () => {
    let cat = createCatalog(chain('gerbil-mongolian', 'MIX', { req: { contentKind: 'FOOD' } }));
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'gerbil-mongolian', 'box')!, AS_OF)).toBe(false);
    cat = createCatalog(chain('gerbil-mongolian', 'MIX', { req: { contentKind: 'FOOD', crossCheck: CC } }));
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'gerbil-mongolian', 'box')!, AS_OF)).toBe(true);
  });

  it('PLANNED 타입은 GENERAL_INFO 체인이어도 비노출(활성화는 시드 status 로만)', () => {
    const b = chain('budgie', 'GI');
    b.animalTypes.find((x) => x.id === 'budgie')!.status = 'PLANNED';
    const cat = createCatalog(b);
    expect(isAnimalTypeExposable(cat, 'budgie', AS_OF)).toBe(false);
  });

  it('AI_DRAFT ∧ VERIFIED 위장 체인은 목록 안 타입이어도 비노출(V01 경로 그대로)', () => {
    const cat = createCatalog(chain('budgie', 'GI', { req: { reviewStatus: 'VERIFIED', verifiedAt: '2026-11-16' } }));
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'budgie', 'box')!, AS_OF)).toBe(false);
  });
});

describe('M5 — 상품·구성안·호환·Taxon·후기는 자기 메타 VERIFIED 만(GENERAL_INFO 불가)', () => {
  const product = (meta: Meta) => ({
    status: 'ACTIVE' as const,
    meetsMinSpec: true,
    supplyItemId: 'box',
    careProfileIds: ['pf-test'],
    specValues: { type: 'BOX', widthCm: 90, heightCm: 40 },
    ...meta,
  });

  it('상품: 자기 메타 GENERAL_INFO → 비노출, VERIFIED 라도 GENERAL_INFO 체인이면 비노출(356r M1), VERIFIED 체인이면 노출', () => {
    const cat = createCatalog(chain('budgie', 'GI'));
    expect(isProductExposable(cat, 'budgie', product(GI({ contentKind: 'SPEC' })) as never, AS_OF)).toBe(false);
    expect(isProductExposable(cat, 'budgie', product({ ...V }) as never, AS_OF)).toBe(false);
    const vCat = createCatalog(chain('budgie', 'V'));
    expect(isProductExposable(vCat, 'budgie', product(GI({ contentKind: 'SPEC' })) as never, AS_OF)).toBe(false);
    expect(isProductExposable(vCat, 'budgie', product({ ...V }) as never, AS_OF)).toBe(true);
  });

  it.each(['type', 'profile', 'req', 'item'] as const)('356r M1: VERIFIED 체인 중 %s 하나만 GENERAL_INFO → VERIFIED 상품 비노출', (k) => {
    const cat = createCatalog(chain('budgie', 'V', { [k]: GI() }));
    expect(isRequirementExposable(cat, resolveRequirement(cat, 'budgie', 'box')!, AS_OF)).toBe(true); // 체인 자체는 노출(비공허)
    expect(isProductExposable(cat, 'budgie', product({ ...V }) as never, AS_OF)).toBe(false);
  });

  it('구성안: 자기 메타 GENERAL_INFO → 비노출', () => {
    const cat = createCatalog(chain('budgie', 'GI'));
    const b = { careProfileId: 'pf-test', itemIds: ['box'] };
    expect(isBundleExposable(cat, 'budgie', { ...b, ...GI() } as never, AS_OF)).toBe(false);
    expect(isBundleExposable(cat, 'budgie', { ...b, ...V } as never, AS_OF)).toBe(true);
  });

  it('호환 규칙: GENERAL_INFO → 비노출', () => {
    expect(isCompatRuleExposable(GI() as never, AS_OF)).toBe(false);
  });

  it('Taxon: GENERAL_INFO → 비노출(LEGAL 제외)', () => {
    const b = chain('budgie', 'GI');
    Object.assign(b.taxa!.find((t) => t.id === 'tx-test')!, GI({ contentKind: 'LEGAL' }));
    expect(isTaxonExposable(createCatalog(b), 'tx-test', AS_OF)).toBe(false);
    Object.assign(b.taxa!.find((t) => t.id === 'tx-test')!, GI({ contentKind: 'CARE' }));
    expect(isTaxonExposable(createCatalog(b), 'tx-test', AS_OF)).toBe(false);
  });

  it('후기: 상태 규칙(APPROVED ∧ verifiedUsage) 그대로 — 타입 노출만 GENERAL_INFO 체인을 따른다', () => {
    const cat = createCatalog(chain('budgie', 'GI'));
    expect(isTestimonialPublic(cat, { status: 'APPROVED', verifiedUsage: true, animalTypeId: 'budgie' }, AS_OF)).toBe(true);
    expect(isTestimonialPublic(cat, { status: 'APPROVED', verifiedUsage: false, animalTypeId: 'budgie' }, AS_OF)).toBe(false);
    expect(isTestimonialPublic(cat, { status: 'SUBMITTED', verifiedUsage: true, animalTypeId: 'budgie' }, AS_OF)).toBe(false);
  });
});

describe('FOOD·HEALTH 출처 1곳 이상(Kenny 2026-11-25) — 노출 쪽도 fail-closed', () => {
  it.each(['FOOD', 'HEALTH'] as const)('%s: https 출처 없으면 false', (contentKind) => {
    for (const source of [[], undefined, [{ title: 'x' }], [{ url: 'http://example.org/a', title: 'x' }], [{ url: '' }], 'https://example.org']) {
      expect(isGeneralInfoMeta(GI({ contentKind, crossCheck: CC, source: source as never }), AS_OF), JSON.stringify(source)).toBe(false);
    }
    expect(isGeneralInfoMeta(GI({ contentKind, crossCheck: CC }), AS_OF)).toBe(true);
  });
  it('SPEC·CARE 는 출처 0곳이어도 그대로', () => {
    expect(isGeneralInfoMeta(GI({ source: [] }), AS_OF)).toBe(true);
    expect(isGeneralInfoMeta(GI({ contentKind: 'SPEC', source: [] }), AS_OF)).toBe(true);
  });
});
