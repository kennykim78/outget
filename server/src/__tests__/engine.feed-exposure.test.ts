// 362 N5 — selectFeedRows(피드 노출 결정 단일 함수) + D-7 + 변이 시험. 실제 시드(DRAFT 포함 현 상태) + 손으로 만든 행만.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchKeyword, createCatalog, resolveRequirement, selectFeedRows } from '../engine/index.js';
import type { AnimalTypeRec, CareProfileRec, CompatibilityRuleRec, SupplyItemRec, SupplyRequirementRec } from '../engine/index.js';
import type { FeedRowIn } from '../engine/feed-types.js';
import { lintText } from '../seed/lint.js';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed');
const read = <T>(f: string): T[] => JSON.parse(readFileSync(join(SEED, f), 'utf8')) as T[];
const seed = {
  animalTypes: read<AnimalTypeRec>('animal-types.json'),
  careProfiles: read<CareProfileRec>('care-profiles.json'),
  supplyItems: read<SupplyItemRec>('supply-items.json'),
  supplyRequirements: read<SupplyRequirementRec>('supply-requirements.json'),
  compatibilityRules: read<CompatibilityRuleRec>('compatibility-rules.json'),
};
const cat = createCatalog(seed);

const AS_OF = '2026-11-25';
const GEN = '2026-11-23T09:12:00+09:00';
const GEN_MS = Date.UTC(2026, 10, 23, 0, 12, 0);
const H = 3_600_000;
const isTitleBanned = (t: string): boolean => lintText(t).length > 0;
const opts = (over: Partial<{ buildAtMs: number; generatedAt: string | null }> = {}) => ({
  asOf: AS_OF,
  buildAtMs: GEN_MS + H,
  generatedAt: GEN,
  isTitleBanned,
  ...over,
});

function kw(animalTypeId: string, supplyItemId: string): string {
  const at = seed.animalTypes.find((a) => a.id === animalTypeId) as AnimalTypeRec;
  const r = resolveRequirement(cat, animalTypeId, supplyItemId);
  if (!r) throw new Error(`no requirement ${animalTypeId}/${supplyItemId}`);
  return buildSearchKeyword(at, r);
}

let seq = 0;
function row(animalTypeId: string, supplyItemId: string, title: string, over: Partial<FeedRowIn> = {}): FeedRowIn {
  seq += 1;
  return {
    provider: 'ALIEXPRESS',
    animalTypeId,
    supplyItemId,
    keyword: kw(animalTypeId, supplyItemId),
    rank: (seq % 10) + 1,
    title,
    url: `https://s.click.aliexpress.com/e/_Row${seq}x`,
    imageUrl: null,
    price: { amount: 12900, currency: 'KRW' },
    fetchedAt: GEN,
    ...over,
  };
}

const G = 'hamster-golden';
const titlesOf = (s: ReturnType<typeof selectFeedRows>) => (s ? s.rows.map((r) => r.title) : null);

describe('selectFeedRows — 규칙 있는 품목(LISTED_PASS)', () => {
  it('쳇바퀴 30cm 통면 → LISTED_PASS·OK, 28cm → BELOW_RECOMMENDED, 규격 값 동봉', () => {
    const s = selectFeedRows(cat, G, 'wheel', [row(G, 'wheel', '햄스터 쳇바퀴 28cm 통면 스탠드', { rank: 1 }), row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면', { rank: 2 })], opts());
    expect(s?.badge).toBe('LISTED_PASS');
    expect(s?.generalInfo).toBe(false);
    expect(s?.rows.map((r) => r.verdict)).toEqual(['OK', 'BELOW_RECOMMENDED']);
    expect(s?.rows[0].specValues).toEqual({ diameterCm: 30, surface: 'SOLID' });
  });

  const drops: Array<[string, string, Partial<FeedRowIn>?]> = [
    ['최소 미달 25cm', '햄스터 쳇바퀴 25cm 통면'],
    ['최소 미달 메쉬', '햄스터 쳇바퀴 30cm 메쉬'],
    ['규칙 키 못 채움(표면 없음)', '햄스터 쳇바퀴 30cm'],
    ['옵션 나열', '햄스터 쳇바퀴 21/27/30cm 통면'],
    ['S/M/L', '햄스터 쳇바퀴 S/M/L 30cm 통면'],
    ['금지어(lintText 주입)', '최저가 햄스터 쳇바퀴 30cm 통면'],
    ['금지어 공백 우회', '특 가 햄스터 쳇바퀴 30cm 통면'],
    ['의료 효능어', '햄스터 쳇바퀴 30cm 통면 스트레스 예방'],
    ['avoid 사전어(런닝볼)', '햄스터 쳇바퀴 30cm 통면 런닝볼 겸용'],
    ['검색어 불일치', '햄스터 쳇바퀴 30cm 통면', { keyword: '골든햄스터 쳇바퀴' }],
    ['다른 품목 행', '햄스터 쳇바퀴 30cm 통면', { supplyItemId: 'cage' }],
    ['다른 타입 행', '햄스터 쳇바퀴 30cm 통면', { animalTypeId: 'hamster-dwarf' }],
  ];
  it.each(drops)('버림: %s', (_n, title, over) => {
    const keep = row(G, 'wheel', '햄스터 쳇바퀴 30cm 통면 대형');
    const s = selectFeedRows(cat, G, 'wheel', [keep, row(G, 'wheel', title, over ?? {})], opts());
    expect(titlesOf(s)).toEqual(['햄스터 쳇바퀴 30cm 통면 대형']);
  });

  it('베딩: not_in 사전어(소나무)·avoid(솜)·향 첨가 버림, 종이 무향 통과', () => {
    const s = selectFeedRows(
      cat,
      G,
      'bedding',
      [
        row(G, 'bedding', '햄스터 종이 베딩 무향 10L'),
        row(G, 'bedding', '햄스터 소나무 베딩 무향'),
        row(G, 'bedding', '햄스터 종이 베딩 무향 솜 포함'),
        row(G, 'bedding', '햄스터 종이 베딩 라벤더'),
        row(G, 'bedding', '햄스터 종이 베딩'),
      ],
      opts(),
    );
    expect(s?.badge).toBe('LISTED_PASS');
    expect(titlesOf(s)).toEqual(['햄스터 종이 베딩 무향 10L']);
  });

  it('부정 접두 「무」 는 avoid 사전어로 보지 않는다(무도색)', () => {
    const s = selectFeedRows(cat, G, 'chew', [row(G, 'chew', '햄스터 무도색 원목 갉기 장난감')], opts());
    expect(titlesOf(s)).toEqual(['햄스터 무도색 원목 갉기 장난감']);
  });
});

describe('selectFeedRows — 규칙 0 품목·GENERAL_INFO(398: 불변식 7 — 체인 상품 노출 0, 362 D-7 폐기)', () => {
  it('규칙 0(은신처) → CHECK_NEEDED, verdict·규격 값 null', () => {
    const s = selectFeedRows(cat, G, 'hideout', [row(G, 'hideout', '햄스터 나무 은신처')], opts());
    expect(s?.badge).toBe('CHECK_NEEDED');
    expect(s?.rows[0].verdict).toBeNull();
    expect(s?.rows[0].specValues).toBeNull();
  });

  it('GENERAL_INFO 체인(로보 쳇바퀴·은신처) → null(블록 없음 — 행이 규칙을 통과해도)', () => {
    const J = 'hamster-robo';
    const r = resolveRequirement(cat, J, 'wheel');
    expect(r?.minSpec.rules.length).toBeGreaterThan(0);
    expect(selectFeedRows(cat, J, 'wheel', [row(J, 'wheel', '쳇바퀴 30cm 통면'), row(J, 'wheel', '쳇바퀴 30cm 메쉬')], opts())).toBeNull();
    expect(selectFeedRows(cat, J, 'hideout', [row(J, 'hideout', '햄스터 나무 은신처')], opts())).toBeNull();
  });
});

describe('selectFeedRows — 블록 null·시간', () => {
  it('FOOD·HEALTH 품목 → null', () => {
    expect(selectFeedRows(cat, G, 'food', [row(G, 'food', '햄스터 사료')], opts())).toBeNull();
    expect(selectFeedRows(cat, 'guinea-pig', 'nail-clipper', [row('guinea-pig', 'nail-clipper', '발톱깎이')], opts())).toBeNull();
  });
  it('없는 타입·요구사항 → null', () => {
    expect(selectFeedRows(cat, 'nope', 'wheel', [], opts())).toBeNull();
    expect(selectFeedRows(cat, G, 'bird-cage', [], opts())).toBeNull();
  });
  it('168h 초과·generatedAt null → null', () => {
    expect(selectFeedRows(cat, G, 'hideout', [row(G, 'hideout', '은신처')], opts({ buildAtMs: GEN_MS + 168 * H + 1 }))).toBeNull();
    expect(selectFeedRows(cat, G, 'hideout', [row(G, 'hideout', '은신처')], opts({ generatedAt: null }))).toBeNull();
    expect(selectFeedRows(cat, G, 'hideout', [row(G, 'hideout', '은신처')], opts({ buildAtMs: GEN_MS + 168 * H }))).not.toBeNull();
  });
  it('72h 이하 showPrice true(가격 그대로), 초과 false(행 price null)', () => {
    const a = selectFeedRows(cat, G, 'hideout', [row(G, 'hideout', '은신처')], opts({ buildAtMs: GEN_MS + 72 * H }));
    expect(a?.showPrice).toBe(true);
    expect(a?.rows[0].price).toEqual({ amount: 12900, currency: 'KRW' });
    const b = selectFeedRows(cat, G, 'hideout', [row(G, 'hideout', '은신처')], opts({ buildAtMs: GEN_MS + 72 * H + 1 }));
    expect(b?.showPrice).toBe(false);
    expect(b?.rows[0].price).toBeNull();
  });
  it('asOf 형식 오류 → RangeError', () => {
    expect(() => selectFeedRows(cat, G, 'hideout', [], { ...opts(), asOf: '2026/11/25' })).toThrow(RangeError);
  });
});

describe('selectFeedRows — 정렬(가격 무관)', () => {
  it('verdict → 공급자(쿠팡 먼저) → rank, 가격을 바꿔도 순서 불변', () => {
    const base = [
      row(G, 'wheel', 'A 쳇바퀴 28cm 통면', { provider: 'COUPANG', rank: 1 }),
      row(G, 'wheel', 'B 쳇바퀴 30cm 통면', { provider: 'ALIEXPRESS', rank: 1 }),
      row(G, 'wheel', 'C 쳇바퀴 32cm 통면', { provider: 'COUPANG', rank: 3 }),
      row(G, 'wheel', 'D 쳇바퀴 31cm 통면', { provider: 'COUPANG', rank: 2 }),
    ];
    const expected = ['D 쳇바퀴 31cm 통면', 'C 쳇바퀴 32cm 통면', 'B 쳇바퀴 30cm 통면', 'A 쳇바퀴 28cm 통면'];
    expect(titlesOf(selectFeedRows(cat, G, 'wheel', base, opts()))).toEqual(expected);
    const repriced = base.map((r, i) => ({ ...r, price: i % 2 === 0 ? { amount: 100 + i, currency: 'KRW' as const } : null }));
    expect(titlesOf(selectFeedRows(cat, G, 'wheel', [...repriced].reverse(), opts()))).toEqual(expected);
  });
  it('입력 배열을 바꾸지 않는다', () => {
    const rows = [row(G, 'hideout', '은신처 2', { rank: 2 }), row(G, 'hideout', '은신처 1', { rank: 1 })];
    const copy = JSON.stringify(rows);
    selectFeedRows(cat, G, 'hideout', rows, opts());
    expect(JSON.stringify(rows)).toBe(copy);
  });
});
