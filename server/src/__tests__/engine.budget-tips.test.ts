// 저렴 대체 팁 노출(REFERENCE 별도 경로, Kenny 2026-11-22) — isBudgetTipExposable + 면제 경로가 다른 콘텐츠로 새지 않음.
import { describe, expect, it } from 'vitest';
import {
  STALE_DAYS,
  createCatalog,
  isAnimalTypeExposable,
  isBudgetTipExposable,
  isRequirementExposable,
  isTipReferenceValid,
  isVerified,
  resolveRequirement,
  tipReferenceUrlProblem,
  type BudgetTipRec,
  type SeedBundle,
  type TipVetReview,
} from '../engine/index.js';
import { realSeed } from './fixtures/prerender-seed.js';
import { TEST_CHECKED_BY, testSummaryCheck, testVetReview, withTipChecks } from './fixtures/tip-records.js';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  TIP_ARTICLE_HOSTS,
  TIP_COMMERCE_HOSTS,
  TIP_HAZARDS,
  TIP_MULTI_LABEL_SUFFIXES,
  TIP_SECTION_CATEGORIES,
  TIP_VET_REVIEWER_TYPES,
  TIP_VET_REVIEW_REQUIRED,
  isIpLiteralHost,
  isTipArticleHost,
  isTipSummaryCheckValid,
  isTipVetReviewValid,
  isTipCommerceHost,
  tipDistinctDomainCount,
  tipHazardSourcesOk,
  tipReferenceDomain,
} from '../engine/index.js';
import { MULTI_LABEL_SUFFIXES, registrableDomainOfUrl } from '../seed/hostname.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'seed-exposure.mjs')).href)) as {
  TIP_ARTICLE_HOSTS: readonly string[];
  TIP_COMMERCE_HOSTS: readonly string[];
  TIP_SECTION_CATEGORIES: readonly string[];
  TIP_HAZARDS: Set<string>;
  TIP_MULTI_LABEL_SUFFIXES: Set<string>;
  tipDomainCount: (refs: unknown) => number;
  tipReferenceUrlAllowed: (u: unknown) => boolean;
  computeExposure: (seed: Record<string, unknown[]>, asOf: string) => { ids: Record<string, Set<string>>; tipTypes: Set<string> };
};

const AS_OF = '2026-11-22';
// 312: 참조 URL 은 글 사이트 허용 목록(TIP_ARTICLE_HOSTS) 안이어야 한다.
const REF = { title: '햄스터 수납함 집 만들기 기록', url: 'https://namu.wiki/w/test-123', siteName: '예시 위키', checkedAt: '2026-11-20' };
const REF2 = { title: '다른 사이트 기록', url: 'https://brunch.co.kr/@someone/42', siteName: '다른 블로그', checkedAt: '2026-11-20' };

// 총괄 ORDERS 11/22 18:4x: 노출 경로 시험은 시험용 검수 기록(summaryCheck·vetReview)을 채운다 — p 에 키가 있으면(null 포함) 그대로.
function tipFixture(p: Partial<BudgetTipRec> = {}): BudgetTipRec {
  return withTipChecks({
    id: 'tip-fixture-cage',
    kind: 'REFERENCE',
    careProfileId: 'cp-hamster-syrian',
    supplyItemId: 'cage',
    substitute: '뚜껑 있는 대형 투명 수납함',
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
    ...p,
  });
}

const cat = () => createCatalog(realSeed());

describe('isBudgetTipExposable — REFERENCE 경로', () => {
  it('전제: 골든햄스터 노출, cage 요구사항 노출', () => {
    const c = cat();
    expect(isAnimalTypeExposable(c, 'hamster-golden', AS_OF)).toBe(true);
    expect(isRequirementExposable(c, resolveRequirement(c, 'hamster-golden', 'cage')!, AS_OF)).toBe(true);
  });

  it('AI_DRAFT·DRAFT 팁도 REFERENCE ∧ 참조 ∧ ACTIVE 동물이면 노출(검수 면제 — 명시 예외)', () => {
    const t = tipFixture();
    expect(isVerified(t)).toBe(false);
    expect(isBudgetTipExposable(cat(), 'hamster-golden', t, AS_OF)).toBe(true);
  });

  it('kind 가 REFERENCE 가 아니면 비노출', () => {
    for (const kind of [undefined, 'VERIFIED', 'reference', 'GUIDE']) {
      expect(isBudgetTipExposable(cat(), 'hamster-golden', tipFixture({ kind: kind as never }), AS_OF)).toBe(false);
    }
  });

  it('참조 0건·형식 오류·미래·오래된 확인일은 비노출', () => {
    const c = cat();
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: undefined as never }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [{ ...REF, title: ' ' }] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [{ ...REF, siteName: '' }] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [{ ...REF, checkedAt: '2026-11-23' }] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [{ ...REF, checkedAt: '2026-05-01' }] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [REF, { ...REF, url: 'http://blog.example.com/a' }] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ references: [{ ...REF, extra: 1 } as never] }), AS_OF)).toBe(false);
  });

  it('확인 나이 경계 = STALE_DAYS', () => {
    const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
    const back = (n: number) => new Date((day(AS_OF) - n) * 86400000).toISOString().slice(0, 10);
    const ok = { ...REF, checkedAt: back(STALE_DAYS) };
    const stale = { ...REF, checkedAt: back(STALE_DAYS + 1) };
    expect(isBudgetTipExposable(cat(), 'hamster-golden', tipFixture({ references: [ok] }), AS_OF)).toBe(true);
    expect(isBudgetTipExposable(cat(), 'hamster-golden', tipFixture({ references: [stale] }), AS_OF)).toBe(false);
  });

  it('PLANNED 동물(난쟁이)·다른 프로필·animalTypeIds 밖이면 비노출', () => {
    const c = cat();
    expect(isBudgetTipExposable(c, 'hamster-dwarf', tipFixture({ careProfileId: 'cp-hamster-dwarf' }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ careProfileId: 'cp-hamster-dwarf' }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ animalTypeIds: ['hamster-dwarf'] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ animalTypeIds: ['hamster-golden'] }), AS_OF)).toBe(true);
    expect(isBudgetTipExposable(c, 'no-such-type', tipFixture(), AS_OF)).toBe(false);
  });

  it('요구사항 비노출(scale DRAFT)·없는 용품이면 비노출', () => {
    const c = cat();
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: 'scale' }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: 'nope' }), AS_OF)).toBe(false);
  });

  it('ETC·BATH 등 /tips 섹션 밖 카테고리는 비노출(O-1)', () => {
    const c = cat();
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: 'carrier' }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: 'sand-bath' }), AS_OF)).toBe(false);
    for (const item of ['hideout', 'water', 'bedding']) {
      expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: item }), AS_OF)).toBe(true);
    }
    // 312: TOY(chew)는 지시 범위(케이지·은신처·급수·바닥재) 밖 — 비노출
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: 'chew' }), AS_OF)).toBe(false);
    expect(TIP_SECTION_CATEGORIES).toEqual(['CAGE', 'HIDE', 'WATER', 'BEDDING']);
  });

  it('독성·섭취 위험 태그는 contentKind HEALTH 일 때만, 모르는 위험 태그는 비노출', () => {
    const c = cat();
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ hazards: ['TOXIC_MATERIAL'], references: [REF, REF2] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ hazards: ['INGESTION'], contentKind: 'HEALTH', references: [REF, REF2] }), AS_OF)).toBe(true);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ hazards: ['ESCAPE'], references: [REF, REF2] }), AS_OF)).toBe(true);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ hazards: ['FIRE' as never] }), AS_OF)).toBe(false);
  });

  it('동물 타입이 강등되면(검수 만료) 팁도 비노출 — 동물 체인은 VERIFIED 규칙 그대로', () => {
    expect(isBudgetTipExposable(cat(), 'hamster-golden', tipFixture({ references: [{ ...REF, checkedAt: '2027-05-30' }] }), '2027-06-01')).toBe(false);
  });

  it('asOf 형식 오류는 RangeError', () => {
    expect(() => isBudgetTipExposable(cat(), 'hamster-golden', tipFixture(), '2026/11/22')).toThrow(RangeError);
  });
});

describe('면제 경로가 다른 콘텐츠로 새지 않는다', () => {
  it('REFERENCE 표시를 단 AI_DRAFT 동물·요구사항·용품은 여전히 비노출(okMeta 그대로)', () => {
    const s: SeedBundle = realSeed();
    const leak = { kind: 'REFERENCE', references: [REF] };
    s.animalTypes = s.animalTypes.map((a) => (a.id === 'hamster-dwarf' ? ({ ...a, ...leak, status: 'ACTIVE', reviewStatus: 'DRAFT', reviewerType: 'AI_DRAFT' } as never) : a));
    s.supplyRequirements = s.supplyRequirements.map((r) => (r.id === 'req-syrian-scale' ? ({ ...r, ...leak } as never) : r));
    const c = createCatalog(s);
    expect(isAnimalTypeExposable(c, 'hamster-dwarf', AS_OF)).toBe(false);
    expect(isRequirementExposable(c, resolveRequirement(c, 'hamster-golden', 'scale')!, AS_OF)).toBe(false);
    // 그 동물·요구사항 위의 팁도 비노출
    expect(isBudgetTipExposable(c, 'hamster-dwarf', tipFixture({ careProfileId: 'cp-hamster-dwarf' }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ supplyItemId: 'scale' }), AS_OF)).toBe(false);
  });

  it('isVerified 는 REFERENCE 표시와 무관(AI_DRAFT 는 어떤 경우에도 VERIFIED 아님)', () => {
    expect(isVerified({ reviewStatus: 'VERIFIED', reviewerType: 'AI_DRAFT', kind: 'REFERENCE' } as never)).toBe(false);
  });
});

describe('tipReferenceUrlProblem — 글 페이지만(O-4)', () => {
  it.each([
    'https://namu.wiki/w/%ED%96%84',
    'https://brunch.co.kr/@famtimes/375',
    'https://mirochuu.com/a-b/',
    'https://gall.dcinside.com/board/view/?id=animal&no=1',
    'https://www.vegannews.co.kr/news/article.html?no=12',
    'https://m.namu.wiki/w/x',
  ])('허용 %s', (u) => expect(tipReferenceUrlProblem(u)).toBeNull());

  it.each([
    'http://blog.example.com/a',
    'https://www.coupang.com/vp/products/123',
    'https://link.coupang.com/a/xyz',
    'https://ko.aliexpress.com/item/100.html',
    'https://smartstore.naver.com/shop/products/1',
    'https://www.daisomall.co.kr/x',
    'https://bit.ly/abc',
    'https://blog.example.com/products/cage-1',
    'https://blog.example.com/post?aff=abc',
    'https://blog.example.com/post?utm_source=x',
    'https://blog.example.com/post?ref=me',
    'https://blog.example.com/post#frag',
    'https://user:pw@blog.example.com/post',
    'https://blog.example.com:8443/post',
    'https://BLOG.example.com/post',
    'https://localhost/post',
    ' https://blog.example.com/a',
    // 312: 허용 목록 밖(글 사이트여도) — 추가는 PM 결정 행
    'https://blog.naver.com/someone/223456789012',
    'https://someone.tistory.com/42',
    'https://cafe.naver.com/hamsterlove/12345',
    'https://notnamu.wiki/w/x',
    'https://namu.wiki.evil.com/w/x',
    'https://dcinside.com/board/1',
  ])('거부 %s', (u) => expect(tipReferenceUrlProblem(u)).not.toBeNull());

  it('isTipReferenceValid 는 키 정확히 4개', () => {
    const d = Date.UTC(2026, 10, 22) / 86400000;
    expect(isTipReferenceValid(REF, d)).toBe(true);
    expect(isTipReferenceValid({ ...REF, url: 'https://blog.example.com/post/1' }, d)).toBe(false);
    const three = { title: REF.title, url: REF.url, checkedAt: REF.checkedAt }; // siteName 뺀 3개(306 D3: 미사용 구조분해 변수 제거)
    expect(isTipReferenceValid(three, d)).toBe(false);
  });
});

describe('패리티 — engine ↔ scripts/lib/seed-exposure.mjs(독립 재구현)', () => {
  it('상수 집합이 같다', () => {
    expect([...mjs.TIP_ARTICLE_HOSTS]).toEqual([...TIP_ARTICLE_HOSTS]);
    expect([...TIP_ARTICLE_HOSTS]).toEqual(['namu.wiki', 'brunch.co.kr', 'mirochuu.com', 'gall.dcinside.com', 'vegannews.co.kr']);
    expect([...mjs.TIP_COMMERCE_HOSTS]).toEqual([...TIP_COMMERCE_HOSTS]);
    expect([...mjs.TIP_SECTION_CATEGORIES]).toEqual([...TIP_SECTION_CATEGORIES]);
    expect([...mjs.TIP_HAZARDS].sort()).toEqual([...TIP_HAZARDS].sort());
  });

  it.each([
    'https://blog.naver.com/someone/223456789012',
    'https://someone.tistory.com/42',
    'http://blog.example.com/a',
    'https://www.coupang.com/vp/products/123',
    'https://x.smartstore.naver.com/a',
    'https://blog.example.com/item/1',
    'https://blog.example.com/post?UTM_campaign=x',
    'https://blog.example.com/post?page=2',
    'https://blog.example.com/post#a',
    'https://blog.example.com./post',
    'https://www.coupang.com./vp/a',
    'https://www.ikea.com./kr/ko/a',
    'https://tinyurl.com/abc',
    'https://me2.do/abc',
    'https://linktr.ee/someone',
    'https://link.inpock.co.kr/someone',
    'https://ohou.se/contents/1',
    'https://shopee.com.my/x',
    'https://user@blog.example.com/post',
    'https://namu.wiki/w/x',
    'https://m.namu.wiki/w/x',
    'https://brunch.co.kr/@a/1',
    'https://gall.dcinside.com/board/view/?id=animal&no=1',
    'https://www.vegannews.co.kr/news/article.html?no=1',
    'https://mirochuu.com/a/',
    'https://namu.wiki./w/x',
    'https://notnamu.wiki/w/x',
    'https://namu.wiki.evil.com/x',
    'https://amzn.asia/x',
    'https://a.co/x',
    'https://t.ly/x',
    'https://www.google.com/url?q=https://namu.wiki/w/x',
    'https://web.archive.org/web/2026/https://namu.wiki/w/x',
    'https://namu-wiki.translate.goog/w/x',
    'https://1.2.3.4/x',
    'https://[::1]/x',
    'https://0x7f.0.0.1/x',
    'https://127.1/x',
    '',
    42,
  ])('URL 판정 같음 %s', (u) => {
    expect(mjs.tipReferenceUrlAllowed(u)).toBe(tipReferenceUrlProblem(u) === null);
  });

  it('노출 팁 id 집합이 같다(유효·무효 혼합)', () => {
    const s = realSeed();
    const tips: BudgetTipRec[] = [
      tipFixture({ id: 't-ok' }),
      tipFixture({ id: 't-hide', supplyItemId: 'hideout' }),
      tipFixture({ id: 't-noref', references: [] }),
      tipFixture({ id: 't-etc', supplyItemId: 'carrier' }),
      tipFixture({ id: 't-toxic', hazards: ['TOXIC_MATERIAL'] }),
      tipFixture({ id: 't-toxic-h', hazards: ['TOXIC_MATERIAL'], contentKind: 'HEALTH', references: [REF, REF2] }),
      tipFixture({ id: 't-toxic-1dom', hazards: ['TOXIC_MATERIAL'], contentKind: 'HEALTH' }),
      tipFixture({ id: 't-vent-sub', hazards: ['VENTILATION'], references: [REF, { ...REF, url: 'https://m.namu.wiki/x' }] }),
      tipFixture({ id: 't-vent-2', hazards: ['VENTILATION'], references: [REF, REF2] }),
      tipFixture({ id: 't-dwarf', careProfileId: 'cp-hamster-dwarf' }),
      tipFixture({ id: 't-scale', supplyItemId: 'scale' }),
      tipFixture({ id: 't-other', animalTypeIds: ['hamster-dwarf'] }),
      tipFixture({ id: 't-kind', kind: 'GUIDE' as never }),
      tipFixture({ id: 't-aff', references: [{ ...REF, url: 'https://namu.wiki/p?aff=1' }] }),
      tipFixture({ id: 't-offlist', references: [{ ...REF, url: 'https://someone.tistory.com/7' }] }),
      tipFixture({ id: 't-ip', references: [{ ...REF, url: 'https://1.2.3.4/x' }] }),
      tipFixture({ id: 't-toy', supplyItemId: 'chew' }),
    ];
    s.budgetTips = tips;
    const c = createCatalog(s);
    const engine = new Set(tips.filter((t) => isBudgetTipExposable(c, 'hamster-golden', t, AS_OF)).map((t) => t.id));
    const raw = Object.fromEntries(Object.entries(s)) as Record<string, unknown[]>;
    const ex = mjs.computeExposure(raw, AS_OF);
    expect([...ex.ids.budgetTips].sort()).toEqual([...engine].sort());
    expect([...engine].sort()).toEqual(['t-hide', 't-ok', 't-toxic-h', 't-vent-2']);
    expect([...ex.tipTypes].sort()).toEqual(['hamster-golden|t-hide', 'hamster-golden|t-ok', 'hamster-golden|t-toxic-h', 'hamster-golden|t-vent-2']);
  });
});

describe('306 D2·D4 — 끝 점 호스트·단축 URL·쇼핑 호스트', () => {
  it.each([
    'https://www.coupang.com./vp/a',
    'https://coupang.com../a',
    'https://WWW.IKEA.COM./kr',
    'https://smartstore.naver.com./a',
    'https://tinyurl.com/abc',
    'https://me2.do/abc',
    'https://linktr.ee/someone',
    'https://bit.ly/abc',
    'https://link.inpock.co.kr/someone',
    'https://www.ikea.com/kr/ko/p',
    'https://ohou.se/contents/card_collections/1',
    'https://prod.danawa.com/info/?pcode=1',
    'https://www.costco.co.kr/p',
    'https://www.qoo10.com/g/1',
    'https://shopee.co.id/x',
    'https://kr.iherb.com/pr/1',
    'https://www.daiso.co.kr/x',
    'https://www.11st.co.kr/x',
    'https://www.gmarket.co.kr/x',
    'https://www.auction.co.kr/x',
    'https://www.ssg.com/x',
    'https://ko.aliexpress.com/x',
    'https://www.temu.com/x',
  ])('거부 %s', (u) => {
    expect(tipReferenceUrlProblem(u)).not.toBeNull();
    expect(mjs.tipReferenceUrlAllowed(u)).toBe(false);
  });

  it('끝 점은 판매처 판정 전에 제거된다(판매처면 판매처 사유로 거부)', () => {
    expect(tipReferenceUrlProblem('https://www.coupang.com./vp/a')).toContain('판매처');
    expect(tipReferenceUrlProblem('https://namu.wiki./w/x')).toContain('끝 점');
    expect(tipReferenceUrlProblem('https://blog.example.com/post')).toContain('허용 글 사이트 밖');
    expect(isTipCommerceHost('www.ikea.com...')).toBe(true);
    expect(isTipCommerceHost('notikea.com')).toBe(false);
  });

  it('쿠팡 단축 도메인 리터럴은 엔진 목록에 없다(C10-AFF-HOST — scripts compliance-tips 시험이 시드 유입을 FAIL 로 잡는다)', () => {
    expect(TIP_COMMERCE_HOSTS.some((h) => h.startsWith('coupa.'))).toBe(false);
  });
});

describe('총괄 ②(b) — 위험 태그 팁은 서로 다른 사이트 도메인 2곳 이상', () => {
  it('2단계 접미사 목록 = seed/hostname.ts(엔진·mjs 셋 다 같음)', () => {
    expect([...TIP_MULTI_LABEL_SUFFIXES].sort()).toEqual([...MULTI_LABEL_SUFFIXES].sort());
    expect([...mjs.TIP_MULTI_LABEL_SUFFIXES].sort()).toEqual([...MULTI_LABEL_SUFFIXES].sort());
  });

  it.each([
    'https://namu.wiki/w/x',
    'https://m.namu.wiki/w/x',
    'https://brunch.co.kr/@a/1',
    'https://www.vegannews.co.kr/news/article.html?no=1',
    'https://gall.dcinside.com/board/view/?id=a&no=1',
    'https://mirochuu.com/a/',
  ])('도메인 = seed registrableDomainOfUrl %s', (u) => {
    expect(tipReferenceDomain(u)).toBe(registrableDomainOfUrl(u));
  });

  it('서브도메인은 같은 곳, 무효 URL 은 세지 않음 — 엔진·mjs 같은 수', () => {
    const cases: unknown[][] = [
      [REF, REF2],
      [REF, { ...REF, url: 'https://m.namu.wiki/x' }],
      [REF, { ...REF, url: 'https://www.coupang.com/vp/1' }],
      [REF, { ...REF, url: 'https://brunch.co.kr./x' }],
      [REF, { ...REF, url: 'https://someone.tistory.com/1' }],
      [],
    ];
    expect(cases.map((c) => tipDistinctDomainCount(c))).toEqual([2, 1, 1, 1, 1, 0]);
    expect(cases.map((c) => mjs.tipDomainCount(c))).toEqual([2, 1, 1, 1, 1, 0]);
  });

  it('태그 없으면 1곳도 노출, 태그 있으면 2곳부터', () => {
    expect(tipHazardSourcesOk([], [REF])).toBe(true);
    expect(tipHazardSourcesOk(['ESCAPE'], [REF])).toBe(false);
    expect(tipHazardSourcesOk(['ESCAPE'], [REF, REF2])).toBe(true);
    const s = realSeed();
    const c = createCatalog(s);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ hazards: ['HEAT'] }), AS_OF)).toBe(false);
    expect(isBudgetTipExposable(c, 'hamster-golden', tipFixture({ hazards: ['HEAT'], references: [REF, REF2] }), AS_OF)).toBe(true);
  });
});

describe('312(310 MED-2) — 글 사이트 허용 목록 1차 · 차단 목록 2차 · IP 리터럴 별도 거부', () => {
  // 변이: 차단 목록에 없던 단축·리다이렉트·보관소·프록시 호스트와 IP 리터럴 — 엔진·미러 둘 다 거부.
  it.each([
    'https://amzn.asia/x',
    'https://a.co/x',
    'https://t.ly/x',
    'https://ow.ly/x',
    'https://rb.gy/x',
    'https://tiny.cc/x',
    'https://www.google.com/url?q=https://namu.wiki/w/x',
    'https://l.facebook.com/l.php?u=https://namu.wiki/w/x',
    'https://web.archive.org/web/2026/https://namu.wiki/w/x',
    'https://namu-wiki.translate.goog/w/x',
    'https://linkprice.com/x',
    'https://1.2.3.4/x',
    'https://127.0.0.1/w/x',
    'https://[::1]/x',
    'https://[2001:db8::1]/x',
    'https://0x7f.0.0.1/x',
    'https://127.1/x',
    'https://2130706433/x',
  ])('거부 %s', (u) => {
    expect(tipReferenceUrlProblem(u)).not.toBeNull();
    expect(mjs.tipReferenceUrlAllowed(u)).toBe(false);
  });

  it('IP 리터럴은 허용 목록 판정 전에 별도 사유로 거부', () => {
    expect(tipReferenceUrlProblem('https://1.2.3.4/x')).toContain('IP 리터럴');
    expect(isIpLiteralHost('1.2.3.4')).toBe(true);
    expect(isIpLiteralHost('[::1]')).toBe(true);
    expect(isIpLiteralHost('a.0x7f')).toBe(true);
    expect(isIpLiteralHost('namu.wiki')).toBe(false);
    expect(isIpLiteralHost('brunch.co.kr')).toBe(false);
  });

  it('접미사 일치: 서브도메인·끝 점 허용 판정, 이름 붙여 쓰기·뒤에 붙이기는 밖', () => {
    expect(isTipArticleHost('namu.wiki')).toBe(true);
    expect(isTipArticleHost('m.namu.wiki')).toBe(true);
    expect(isTipArticleHost('www.vegannews.co.kr')).toBe(true);
    expect(isTipArticleHost('namu.wiki.')).toBe(true);
    expect(isTipArticleHost('notnamu.wiki')).toBe(false);
    expect(isTipArticleHost('namu.wiki.evil.com')).toBe(false);
    expect(isTipArticleHost('dcinside.com')).toBe(false);
    expect(isTipArticleHost('blog.naver.com')).toBe(false);
  });

  it('차단 목록(2차)과 허용 목록은 겹치지 않는다 — 허용 호스트 중 판매처·단축 URL 0', () => {
    for (const h of TIP_ARTICLE_HOSTS) expect(isTipCommerceHost(h), h).toBe(false);
  });

  it('실시드 참조 URL 전부 허용 목록 안', () => {
    const urls = (realSeed().budgetTips ?? []).flatMap((t) => (t.references ?? []).map((r) => r.url));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(tipReferenceUrlProblem(u), u).toBeNull();
  });
});

// 총괄 ORDERS 11/22 18:4x — ① HEALTH·섭취 위험 팁은 수의 검수 표시(vetReview)가 있어야 노출 ② 요약 원문 대조 기록(summaryCheck)이 비면 팁 비노출.
describe('총괄 11/22 — summaryCheck·vetReview 노출 조건(엔진·미러 일치)', () => {
  const mx = mjs as unknown as {
    TIP_VET_REVIEW_REQUIRED: boolean;
    TIP_VET_REVIEWER_TYPES: readonly string[];
    tipSummaryCheckValid: (sc: unknown, refs: unknown, d: number) => boolean;
    tipVetReviewValid: (v: unknown, d: number) => boolean;
  };
  const D = Date.UTC(2026, 10, 22) / 86400000;
  const SC = { sources: [REF.url], checkedAt: '2026-11-21', checkedBy: TEST_CHECKED_BY };
  const VR = testVetReview('2026-11-21');
  const HEALTH = { hazards: ['INGESTION'] as BudgetTipRec['hazards'], contentKind: 'HEALTH' as const, references: [REF, REF2] };
  const exposed = (t: BudgetTipRec) => isBudgetTipExposable(cat(), 'hamster-golden', t, AS_OF);

  it('플래그·허용 등급 — 엔진 = 미러', () => {
    expect(TIP_VET_REVIEW_REQUIRED).toBe(true);
    expect(mx.TIP_VET_REVIEW_REQUIRED).toBe(TIP_VET_REVIEW_REQUIRED);
    expect([...mx.TIP_VET_REVIEWER_TYPES]).toEqual([...TIP_VET_REVIEWER_TYPES]);
    expect(TIP_VET_REVIEWER_TYPES).not.toContain('AI_DRAFT');
  });

  it('summaryCheck 채우면 노출, 비면(생략·null) 숨김', () => {
    expect(exposed(tipFixture())).toBe(true);
    expect(exposed(tipFixture({ summaryCheck: SC }))).toBe(true);
    expect(exposed(tipFixture({ summaryCheck: null }))).toBe(false);
    expect(exposed(tipFixture({ summaryCheck: undefined }))).toBe(false);
    const noKey: BudgetTipRec = { ...tipFixture() };
    delete noKey.summaryCheck;
    expect(Object.hasOwn(noKey, 'summaryCheck')).toBe(false);
    expect(exposed(noKey)).toBe(false);
  });

  it.each([
    ['sources 비었음', { ...SC, sources: [] }, [REF]],
    ['참조 밖 주소', { ...SC, sources: [REF.url, 'https://brunch.co.kr/@x/1'] }, [REF]],
    ['참조 일부만 대조', { ...SC }, [REF, REF2]],
    ['중복 주소', { ...SC, sources: [REF.url, REF.url] }, [REF]],
    ['checkedBy 빈 값', { ...SC, checkedBy: ' ' }, [REF]],
    ['checkedBy AI_DRAFT', { ...SC, checkedBy: 'AI_DRAFT' }, [REF]],
    ['checkedBy ai-draft 변형', { ...SC, checkedBy: ' ai-draft ' }, [REF]],
    ['checkedBy AI__DRAFT 변형', { ...SC, checkedBy: 'AI__DRAFT' }, [REF]],
    ['checkedBy AIDRAFT 변형', { ...SC, checkedBy: 'AIDRAFT' }, [REF]],
    ['checkedBy 괄호 덧붙임 변형', { ...SC, checkedBy: 'AI_DRAFT(검토)' }, [REF]],
    ['checkedBy 전각 변형', { ...SC, checkedBy: 'ＡＩ_ＤＲＡＦＴ' }, [REF]],
    ['checkedAt 형식 오류', { ...SC, checkedAt: '2026/11/21' }, [REF]],
    ['checkedAt 미래', { ...SC, checkedAt: '2026-11-23' }, [REF]],
    ['checkedAt 오래됨(STALE_DAYS+1)', { ...SC, checkedAt: '2026-05-25' }, [REF]],
    ['알 수 없는 키', { ...SC, note: 'x' }, [REF]],
    ['키 누락', { sources: SC.sources, checkedAt: SC.checkedAt }, [REF]],
    ['배열', [SC], [REF]],
  ] as Array<[string, unknown, BudgetTipRec['references']]>)('summaryCheck %s → 숨김(엔진·미러 같음)', (_n, sc, refs) => {
    const t = tipFixture({ references: refs, summaryCheck: sc as never });
    expect(exposed(t)).toBe(false);
    expect(isTipSummaryCheckValid(sc, refs, D)).toBe(false);
    expect(mx.tipSummaryCheckValid(sc, refs, D)).toBe(false);
  });

  it('summaryCheck 경계: STALE_DAYS 째 날은 유효, 참조 2곳을 모두 대조하면 유효', () => {
    const back = new Date((D - STALE_DAYS) * 86400000).toISOString().slice(0, 10);
    const cases: Array<[unknown, unknown]> = [
      [{ ...SC, checkedAt: back }, [REF]],
      [{ ...SC, sources: [REF2.url, REF.url] }, [REF, REF2]],
    ];
    for (const [sc, refs] of cases) {
      expect(isTipSummaryCheckValid(sc, refs, D)).toBe(true);
      expect(mx.tipSummaryCheckValid(sc, refs, D)).toBe(true);
    }
  });

  it('HEALTH·섭취 위험 팁: vetReview 채우면 노출, 비면 숨김 — CARE 무위험·비섭취 팁은 vetReview 불필요', () => {
    expect(exposed(tipFixture({ ...HEALTH, vetReview: VR }))).toBe(true);
    expect(exposed(tipFixture({ ...HEALTH, vetReview: null }))).toBe(false);
    expect(exposed(tipFixture({ ...HEALTH, vetReview: undefined }))).toBe(false);
    // HEALTH 만(태그 없음)도 수의 검수 대상
    expect(exposed(tipFixture({ contentKind: 'HEALTH', vetReview: null }))).toBe(false);
    expect(exposed(tipFixture({ contentKind: 'HEALTH', vetReview: VR }))).toBe(true);
    // 독성 태그(HEALTH 강제)도 대상
    expect(exposed(tipFixture({ ...HEALTH, hazards: ['TOXIC_MATERIAL'], vetReview: null }))).toBe(false);
    // CARE·비섭취 위험 태그(ESCAPE)는 대상 아님
    expect(exposed(tipFixture({ vetReview: null }))).toBe(true);
    expect(exposed(tipFixture({ hazards: ['ESCAPE'], references: [REF, REF2], vetReview: null }))).toBe(true);
  });

  it.each([
    ['AI_DRAFT 검수자', { ...VR, reviewerType: 'AI_DRAFT' }],
    ['OPERATOR 검수자', { ...VR, reviewerType: 'OPERATOR' }],
    ['EXPERIENCED_KEEPER 검수자', { ...VR, reviewerType: 'EXPERIENCED_KEEPER' }],
    ['출처 빈 값', { ...VR, source: '' }],
    ['검수일 형식 오류', { ...VR, reviewedAt: '2026-13-01' }],
    ['검수일 미래', { ...VR, reviewedAt: '2026-11-23' }],
    ['검수일 오래됨', { ...VR, reviewedAt: '2026-05-25' }],
    ['알 수 없는 키', { ...VR, extra: 1 }],
    ['키 누락', { reviewerType: 'VET', reviewedAt: '2026-11-21' }],
  ] as Array<[string, unknown]>)('vetReview %s → HEALTH 팁 숨김(엔진·미러 같음)', (_n, vr) => {
    expect(exposed(tipFixture({ ...HEALTH, vetReview: vr as never }))).toBe(false);
    expect(isTipVetReviewValid(vr, D)).toBe(false);
    expect(mx.tipVetReviewValid(vr, D)).toBe(false);
  });

  it('vetReview 허용 등급 3종 모두 유효', () => {
    for (const rt of TIP_VET_REVIEWER_TYPES) {
      const vr = { ...VR, reviewerType: rt as TipVetReview['reviewerType'] };
      expect(isTipVetReviewValid(vr, D)).toBe(true);
      expect(mx.tipVetReviewValid(vr, D)).toBe(true);
      expect(exposed(tipFixture({ ...HEALTH, vetReview: vr }))).toBe(true);
    }
  });

  it('노출 팁 id 집합 패리티(검수 기록 변이 혼합)', () => {
    const s = realSeed();
    const tips: BudgetTipRec[] = [
      tipFixture({ id: 'r-ok' }),
      tipFixture({ id: 'r-sc-null', summaryCheck: null }),
      tipFixture({ id: 'r-sc-ai', summaryCheck: { ...SC, checkedBy: 'AI_DRAFT' } }),
      tipFixture({ id: 'r-sc-part', references: [REF, REF2], summaryCheck: SC }),
      tipFixture({ id: 'r-h-ok', ...HEALTH, vetReview: VR }),
      tipFixture({ id: 'r-h-novet', ...HEALTH, vetReview: null }),
      tipFixture({ id: 'r-h-aivet', ...HEALTH, vetReview: { ...VR, reviewerType: 'AI_DRAFT' as never } }),
      tipFixture({ id: 'r-care-novet', vetReview: null }),
      tipFixture({ id: 'r-hk-novet', contentKind: 'HEALTH', vetReview: null }),
    ];
    s.budgetTips = tips;
    const c = createCatalog(s);
    const engine = new Set(tips.filter((t) => isBudgetTipExposable(c, 'hamster-golden', t, AS_OF)).map((t) => t.id));
    const ex = mjs.computeExposure(Object.fromEntries(Object.entries(s)) as Record<string, unknown[]>, AS_OF);
    expect([...ex.ids.budgetTips].sort()).toEqual([...engine].sort());
    expect([...engine].sort()).toEqual(['r-care-novet', 'r-h-ok', 'r-ok']);
  });

  it('실시드: 사람 대조·수의 검수 기록이 없어(null) 팁 전부 비노출 — 의도된 결과', () => {
    const s = realSeed();
    const tips = s.budgetTips ?? [];
    expect(tips.length).toBeGreaterThan(0);
    for (const t of tips) {
      expect(t.summaryCheck, t.id).toBeNull();
      expect(t.vetReview, t.id).toBeNull();
    }
    const c = createCatalog(s);
    expect(tips.filter((t) => isBudgetTipExposable(c, 'hamster-golden', t, AS_OF))).toEqual([]);
    expect([...mjs.computeExposure(Object.fromEntries(Object.entries(s)) as Record<string, unknown[]>, AS_OF).ids.budgetTips]).toEqual([]);
    // 같은 시드에 시험용 기록만 채우면 노출 경로가 살아난다(필드가 유일한 차이)
    const filled = tips.map((t) => ({ ...t, summaryCheck: testSummaryCheck(t), vetReview: testVetReview(testSummaryCheck(t).checkedAt) }));
    expect(filled.some((t) => isBudgetTipExposable(c, 'hamster-golden', t, AS_OF))).toBe(true);
  });
});
