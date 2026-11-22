// seed:validate — budget-tips.json V-TIP-0~5·K + W-TIP-CAT·W-TIP-LEN(Kenny 2026-11-22, 302 r2). 시험 행은 메모리 사본(디스크 시드 무변경).
import { describe, expect, it } from 'vitest';
import type { RawSeed } from '../seed/common.js';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import { tipTextProblems } from '../seed/validate-tips.js';
import { textFieldsOf } from '../seed/lint.js';
import { SEED_DIR } from './fixtures/prerender-seed.js';

const NOW = '2026-11-22';
const REF = { title: '수납함으로 집 꾸민 기록', url: 'https://namu.wiki/w/test-1', siteName: '예시 블로그', checkedAt: '2026-11-20' };

function tip(p: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tip-test-cage',
    kind: 'REFERENCE',
    careProfileId: 'cp-hamster-syrian',
    supplyItemId: 'cage',
    substitute: '뚜껑 있는 대형 투명 수납함',
    sourceHint: 'LIVING_GOODS_STORE',
    materials: ['시험 물품 하나예요.', '시험 물품 둘이에요.'],
    steps: ['시험 단계 하나예요.', '시험 단계 둘이에요.', '시험 단계 셋이에요.'],
    dimensions: ['글쓴이는 가로 100cm 수납함을 썼어요.'],
    cautions: ['시험 주의점이에요.'],
    hazards: [],
    mustCheck: ['내 케이지 크기를 직접 재 보세요.'],
    references: [REF],
    reviewStatus: 'DRAFT',
    reviewerType: 'AI_DRAFT',
    verifiedBy: null,
    verifiedAt: null,
    reviewBasis: null,
    contentKind: 'CARE',
    source: [],
    ...p,
  };
}

const base = readSeedDirRaw(SEED_DIR);
function run(tips: unknown[], mutate?: (raw: RawSeed) => void) {
  const raw: RawSeed = structuredClone(base.raw);
  raw.budgetTips = tips;
  mutate?.(raw);
  return validateSeed(raw, { now: NOW, signatures: base.signatures });
}
const rules = (res: ReturnType<typeof run>, rule: string) => res.errors.filter((e) => e.rule === rule);

describe('seed:validate — budget-tips 기본', () => {
  it('빈 파일 [] 은 오류 0 · 현재 디스크(5행, 2026-11-22)도 오류 0', () => {
    expect(base.raw.budgetTips).toHaveLength(5);
    expect(run([]).errors).toEqual([]);
    expect(run(base.raw.budgetTips as unknown[]).errors).toEqual([]);
  });

  it('올바른 AI_DRAFT·DRAFT REFERENCE 행은 오류 0', () => {
    const res = run([tip()]);
    expect(res.errors).toEqual([]);
  });

  it('파일 누락은 S01', () => {
    const res = run([], (raw) => delete raw.budgetTips);
    expect(res.errors.some((e) => e.rule === 'S01' && e.file === 'budget-tips.json')).toBe(true);
  });
});

describe('V01·V09 — VERIFIED 규칙은 팁에도 그대로', () => {
  it('AI_DRAFT 를 VERIFIED 로 올리면 V01', () => {
    const res = run([tip({ reviewStatus: 'VERIFIED', reviewBasis: 'ROW_CHECKED', verifiedBy: 'x', verifiedAt: '2026-11-20' })]);
    expect(rules(res, 'V01').length).toBe(1);
  });
});

describe('V-TIP-0 형식·참조', () => {
  it.each([
    ['kind 누락', { kind: undefined }, 'V-TIP-0'],
    ['kind 다른 값', { kind: 'GUIDE' }, 'V-TIP-0'],
    ['참조 0건', { references: [] }, 'V-TIP-0'],
    ['참조 판매처 URL', { references: [{ ...REF, url: 'https://www.coupang.com/vp/products/1' }] }, 'V-TIP-0'],
    ['참조 제휴 쿼리', { references: [{ ...REF, url: 'https://namu.wiki/w/p?aff=1' }] }, 'V-TIP-0'],
    // 312(310 MED-2): 글 사이트 허용 목록 밖·IP 리터럴 → V-TIP-0
    ['허용 목록 밖 글 사이트', { references: [{ ...REF, url: 'https://blog.example.com/post/1' }] }, 'V-TIP-0'],
    ['아마존 단축', { references: [{ ...REF, url: 'https://amzn.asia/x' }] }, 'V-TIP-0'],
    ['a.co 단축', { references: [{ ...REF, url: 'https://a.co/x' }] }, 'V-TIP-0'],
    ['t.ly 단축', { references: [{ ...REF, url: 'https://t.ly/x' }] }, 'V-TIP-0'],
    ['구글 리다이렉트', { references: [{ ...REF, url: 'https://www.google.com/url?q=https://namu.wiki/w/x' }] }, 'V-TIP-0'],
    ['웹 보관소 감싸기', { references: [{ ...REF, url: 'https://web.archive.org/web/2026/https://namu.wiki/w/x' }] }, 'V-TIP-0'],
    ['IP 리터럴', { references: [{ ...REF, url: 'https://1.2.3.4/w/x' }] }, 'V-TIP-0'],
    ['참조 http', { references: [{ ...REF, url: 'http://blog.example.com/p' }] }, 'V-TIP-0'],
    ['참조 알 수 없는 키', { references: [{ ...REF, price: 1 }] }, 'V-TIP-0'],
    ['참조 siteName 빈 값', { references: [{ ...REF, siteName: '' }] }, 'V-TIP-0'],
    ['없는 프로필', { careProfileId: 'cp-nope' }, 'V-TIP-0'],
    ['요구사항 없는 용품', { supplyItemId: 'bird-cage' }, 'V-TIP-0'],
    ['다른 프로필 타입', { animalTypeIds: ['hamster-dwarf'] }, 'V-TIP-0'],
    ['알 수 없는 위험 태그', { hazards: ['FIRE'] }, 'V-TIP-0'],
    ['빈 문자열 단계', { steps: ['시험 단계예요.', ' '] }, 'V-TIP-0'],
  ])('%s → %s', (_n, p, rule) => {
    const t = tip(p as Record<string, unknown>);
    for (const [k, v] of Object.entries(p)) if (v === undefined) delete t[k];
    expect(rules(run([t]), rule).length).toBeGreaterThan(0);
  });

  it('참조 확인일 미래는 S07', () => {
    expect(run([tip({ references: [{ ...REF, checkedAt: '2026-12-01' }] })]).errors.some((e) => e.rule === 'S07')).toBe(true);
  });

  it('가격·판매처·링크 키는 S08(허용목록)', () => {
    for (const k of ['price', 'link', 'seller', 'url', 'href']) {
      expect(run([tip({ [k]: 'x' })]).errors.some((e) => e.rule === 'S08' && e.path === k)).toBe(true);
    }
  });
});

describe('V-TIP-1 위험 태그 → HEALTH', () => {
  it('TOXIC_MATERIAL·INGESTION 인데 CARE 면 ERROR, HEALTH 면 통과', () => {
    expect(rules(run([tip({ hazards: ['TOXIC_MATERIAL'] })]), 'V-TIP-1').length).toBe(1);
    expect(rules(run([tip({ hazards: ['INGESTION'] })]), 'V-TIP-1').length).toBe(1);
    expect(run([tip({ hazards: ['INGESTION'], contentKind: 'HEALTH' })]).errors).toEqual([]);
  });
  it('contentKind SPEC·FOOD 는 ERROR', () => {
    expect(rules(run([tip({ contentKind: 'SPEC' })]), 'V-TIP-1').length).toBe(1);
    expect(rules(run([tip({ contentKind: 'FOOD' })]), 'V-TIP-1').length).toBe(1);
  });
});

describe('V-TIP-2 자유 텍스트 URL·가격·상호명 금지', () => {
  it.each([
    ['URL', { steps: ['https://example.com 를 참고해요.'] }],
    ['도메인', { materials: ['example.co.kr 수납함'] }],
    ['가격', { materials: ['3,000원짜리 수납함'] }],
    ['천원', { dimensions: ['5천원 정도예요.'] }],
    ['상호', { substitute: '다이소 수납함' }],
    ['알리에서', { cautions: ['알리에서 산 물건은 확인해요.'] }],
    ['참조 제목 상호', { references: [{ ...REF, title: '쿠팡 수납함 후기' }] }],
  ])('%s → V-TIP-2', (_n, p) => {
    expect(rules(run([tip(p)]), 'V-TIP-2').length).toBeGreaterThan(0);
  });

  it('일반 문장·치수는 통과(알리다·원형 등 오탐 없음)', () => {
    expect(tipTextProblems('바닥이 원형인 그릇을 써요. 3 원형 틀')).toEqual([]);
    expect(tipTextProblems('사용자에게 알리는 문장이에요.')).toEqual([]);
    expect(tipTextProblems('가로 100cm, 높이 50cm 이상인지 재 보세요.')).toEqual([]);
  });
});

describe('V-TIP-3 specExample 최소 규격 미달 금지', () => {
  it('미달 예시는 ERROR, 충족 예시는 통과', () => {
    const below = { type: 'LIVING_BOX', floorType: 'SOLID', floorWcm: 60, floorDcm: 40, heightCm: 35 };
    const ok = { type: 'LIVING_BOX', floorType: 'SOLID', floorWcm: 100, floorDcm: 50, heightCm: 50 };
    expect(rules(run([tip({ specExample: below })]), 'V-TIP-3').length).toBe(1);
    expect(rules(run([tip({ specExample: ok })]), 'V-TIP-3')).toEqual([]);
  });
});

describe('V-TIP-4 최소 구성', () => {
  it('steps·materials 0 은 ERROR', () => {
    expect(rules(run([tip({ steps: [] })]), 'V-TIP-4').length).toBe(1);
    expect(rules(run([tip({ materials: [] })]), 'V-TIP-4').length).toBe(1);
  });
  it('위험 태그 없음 ∧ 주의점·꼭 확인할 것 0 은 ERROR, 위험 태그 있음 ∧ 주의점 0 도 ERROR', () => {
    expect(rules(run([tip({ cautions: [], mustCheck: [] })]), 'V-TIP-4').length).toBe(1);
    expect(rules(run([tip({ hazards: ['ESCAPE'], cautions: [] })]), 'V-TIP-4').length).toBe(1);
  });
});

describe('V-TIP-5 길이 상한(넉넉) · W-TIP-LEN 분량', () => {
  it('문자열 1500자까지 통과, 1501자 ERROR', () => {
    const s1500 = '가'.repeat(1499) + '.';
    expect(rules(run([tip({ steps: [s1500] })]), 'V-TIP-5')).toEqual([]);
    expect(rules(run([tip({ steps: [s1500 + '나'] })]), 'V-TIP-5').length).toBe(1);
  });
  it('개요 10문장 분량(약 1000자)은 오류·경고 0', () => {
    const sent = (i: number) => `시험 문장 ${i}번은 단계와 치수를 길게 설명하는 운영자 요약 문장이에요.`.padEnd(90, ' ').trim();
    const res = run([tip({ steps: Array.from({ length: 6 }, (_, i) => sent(i)), cautions: Array.from({ length: 4 }, (_, i) => sent(i + 6)) })]);
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.rule === 'W-TIP-LEN')).toEqual([]);
  });
  it('5문장 미만은 W-TIP-LEN 경고(하드 실패 아님)', () => {
    const res = run([tip({ materials: ['물품이에요.'], steps: ['단계예요.'], dimensions: [], cautions: [], mustCheck: ['확인해요.'] })]);
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.rule === 'W-TIP-LEN').length).toBe(1);
  });
  it('합계 6000자 초과 ERROR', () => {
    const s = '가'.repeat(1400) + '.';
    expect(rules(run([tip({ steps: [s, s, s, s, s] })]), 'V-TIP-5').length).toBe(1);
  });
});

describe('W-TIP-CAT ETC·BATH 미표시 경고', () => {
  it('carrier(ETC)·sand-bath(BATH) 팁은 WARN', () => {
    const res = run([tip({ id: 'tip-a', supplyItemId: 'carrier' }), tip({ id: 'tip-b', supplyItemId: 'sand-bath' })]);
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.rule === 'W-TIP-CAT').length).toBe(2);
  });
});

describe('V-TIP-K 면제 표지가 다른 파일로 새지 않는다', () => {
  it('다른 콘텐츠 행의 kind·references 키는 ERROR', () => {
    const res = run([], (raw) => {
      const at = raw.animalTypes as Record<string, unknown>[];
      at[0] = { ...at[0], kind: 'REFERENCE' };
      const rq = raw.supplyRequirements as Record<string, unknown>[];
      rq[0] = { ...rq[0], references: [REF] };
      const tm = raw.testimonials as Record<string, unknown>[];
      if (tm.length > 0) tm[0] = { ...tm[0], kind: 'REFERENCE' };
    });
    const k = rules(res, 'V-TIP-K');
    expect(k.some((e) => e.file === 'animal-types.json' && e.path === 'kind')).toBe(true);
    expect(k.some((e) => e.file === 'supply-requirements.json' && e.path === 'references')).toBe(true);
  });
});

describe('린트 — 팁 본문 전부가 금지어 대상(광고어 포함)', () => {
  it('textFieldsOf 가 팁 필드 전부를 돌려준다', () => {
    const paths = textFieldsOf('budgetTips', tip()).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['substitute', 'materials[0]', 'steps[0]', 'dimensions[0]', 'cautions[0]', 'mustCheck[0]', 'references[0].title', 'references[0].siteName']));
  });
  it.each(['가성비', '꿀템', '강추', '특가', '핫딜', '할인', '구매', '안전하다'])('「%s」 → L01', (w) => {
    expect(run([tip({ cautions: [`시험 ${w} 문장이에요.`] })]).errors.some((e) => e.rule === 'L01')).toBe(true);
  });
});

// 308 총괄 ②(b): 위험 태그 팁은 서로 다른 사이트 도메인 참조 2곳 이상일 때만 노출 — 1곳이면 숨김 + W-TIP-REF2(오류 아님).
describe('seed:validate — W-TIP-REF2 위험 태그 참조 도메인 2곳', () => {
  const REF_B = { ...REF, url: 'https://mirochuu.com/test-9/' };
  const REF_SAME = { ...REF, url: 'https://m.namu.wiki/w/other' }; // namu.wiki 같은 등록 도메인(서브도메인)
  const ref2 = (res: ReturnType<typeof run>) => res.warnings.filter((w) => w.rule === 'W-TIP-REF2').map((w) => w.id);

  it('위험 태그 + 도메인 1곳 → W-TIP-REF2 1(오류 0)', () => {
    const res = run([tip({ hazards: ['VENTILATION'] })]);
    expect(res.errors).toEqual([]);
    expect(ref2(res)).toEqual(['tip-test-cage']);
  });

  it('같은 등록 도메인 하위 호스트 2개도 1곳 → W-TIP-REF2', () => {
    expect(ref2(run([tip({ hazards: ['ESCAPE'], references: [REF, REF_SAME] })]))).toEqual(['tip-test-cage']);
  });

  it('위험 태그 + 도메인 2곳 → 경고 0 · 위험 태그 없음 + 1곳 → 경고 0', () => {
    expect(ref2(run([tip({ hazards: ['VENTILATION'], references: [REF, REF_B] })]))).toEqual([]);
    expect(ref2(run([tip()]))).toEqual([]);
  });

  it('실시드 위험 태그 2행(cage ESCAPE·VENTILATION · bedding INGESTION/HEALTH) 모두 도메인 2곳 → W-TIP-REF2 0', () => {
    const tips = base.raw.budgetTips as Array<Record<string, unknown>>;
    expect(tips.filter((t) => (t.hazards as unknown[]).length > 0).map((t) => [t.id, t.hazards, t.contentKind])).toEqual([
      ['tip-syrian-cage-storage-box', ['ESCAPE', 'VENTILATION'], 'CARE'],
      ['tip-syrian-bedding-plain-paper', ['INGESTION'], 'HEALTH'],
    ]);
    expect(ref2(run(tips))).toEqual([]);
  });
});

// 총괄 ORDERS 11/22 18:4x — summaryCheck(요약 원문 대조 기록)·vetReview(HEALTH·섭취 위험 수의 검수 표시) 형식 검사.
describe('V-TIP-SC · W-TIP-SC — summaryCheck 형식', () => {
  const SC = { sources: [REF.url], checkedAt: '2026-11-21', checkedBy: '운영자 이름' };
  const sc = (res: ReturnType<typeof run>) => rules(res, 'V-TIP-SC').map((e) => e.path);
  const warnSc = (res: ReturnType<typeof run>) => res.warnings.filter((w) => w.rule === 'W-TIP-SC');

  it('올바른 기록은 오류·W-TIP-SC 0', () => {
    const res = run([tip({ summaryCheck: SC })]);
    expect(res.errors).toEqual([]);
    expect(warnSc(res)).toEqual([]);
  });

  it('null·생략은 ERROR 아님 · W-TIP-SC 경고(비노출)', () => {
    for (const t of [tip({ summaryCheck: null }), tip()]) {
      const res = run([t]);
      expect(res.errors).toEqual([]);
      expect(warnSc(res)).toHaveLength(1);
    }
  });

  it('D3·D4: 미래·만료·참조일보다 이른 대조일은 ERROR 아닌 경고(숨김)', () => {
    for (const checkedAt of ['2026-11-30', '2026-01-01', '2026-11-19']) {
      const res = run([tip({ summaryCheck: { ...SC, checkedAt } })]);
      expect(sc(res), checkedAt).toEqual([]);
      expect(warnSc(res).length, checkedAt).toBeGreaterThanOrEqual(1);
    }
  });

  it('checkedBy 가 AI_DRAFT(변형 포함)면 ERROR', () => {
    for (const by of ['AI_DRAFT', 'ai-draft', ' Ai Draft ']) {
      expect(sc(run([tip({ summaryCheck: { ...SC, checkedBy: by } })])), by).toEqual(['summaryCheck.checkedBy']);
    }
  });

  it.each([
    ['checkedBy 누락', { sources: SC.sources, checkedAt: SC.checkedAt }, ['summaryCheck.checkedBy']],
    ['checkedBy 빈 값', { ...SC, checkedBy: '  ' }, ['summaryCheck.checkedBy']],
    ['checkedAt 형식', { ...SC, checkedAt: '2026/11/21' }, ['summaryCheck.checkedAt']],
    ['checkedAt 없는 날짜', { ...SC, checkedAt: '2026-02-30' }, ['summaryCheck.checkedAt']],
    ['sources 비었음', { ...SC, sources: [] }, ['summaryCheck.sources']],
    ['sources 문자열 아님', { ...SC, sources: [3] }, ['summaryCheck.sources[0]']],
    ['sources 중복', { ...SC, sources: [REF.url, REF.url] }, ['summaryCheck.sources[1]']],
    ['참조 밖 주소', { ...SC, sources: [REF.url, 'https://brunch.co.kr/@x/1'] }, ['summaryCheck.sources[1]']],
    ['알 수 없는 키', { ...SC, note: 'x' }, ['summaryCheck.note']],
    ['객체 아님', 'checked', ['summaryCheck']],
  ] as Array<[string, unknown, string[]]>)('%s → V-TIP-SC', (_n, value, paths) => {
    expect(sc(run([tip({ summaryCheck: value })]))).toEqual(paths);
  });

  it('참조 일부만 대조하면 ERROR 아님 · W-TIP-SC(비노출)', () => {
    const res = run([tip({ references: [REF, { ...REF, url: 'https://brunch.co.kr/@a/1' }], summaryCheck: SC })]);
    expect(rules(res, 'V-TIP-SC')).toEqual([]);
    expect(warnSc(res).map((w) => w.path)).toEqual(['summaryCheck.sources']);
  });
});

describe('V-TIP-VET · W-TIP-VET — vetReview 형식', () => {
  const VR = { reviewerType: 'VET', reviewedAt: '2026-11-21', source: '수의 문헌 이름' };
  const HEALTH = { hazards: ['INGESTION'], contentKind: 'HEALTH', references: [REF, { ...REF, url: 'https://brunch.co.kr/@a/1' }] };
  const vet = (res: ReturnType<typeof run>) => rules(res, 'V-TIP-VET').map((e) => e.path);
  const warnVet = (res: ReturnType<typeof run>) => res.warnings.filter((w) => w.rule === 'W-TIP-VET');

  it('HEALTH·섭취 팁: vetReview null → W-TIP-VET 1(비노출) · 채우면 0 · CARE 무위험 팁은 null 이어도 경고 0', () => {
    expect(warnVet(run([tip({ ...HEALTH, vetReview: null })]))).toHaveLength(1);
    expect(warnVet(run([tip({ contentKind: 'HEALTH', vetReview: null })]))).toHaveLength(1);
    const ok = run([tip({ ...HEALTH, vetReview: VR })]);
    expect(ok.errors).toEqual([]);
    expect(warnVet(ok)).toEqual([]);
    expect(warnVet(run([tip({ vetReview: null })]))).toEqual([]);
  });

  it.each([
    ['reviewerType AI_DRAFT', { ...VR, reviewerType: 'AI_DRAFT' }, ['vetReview.reviewerType']],
    ['reviewerType OPERATOR', { ...VR, reviewerType: 'OPERATOR' }, ['vetReview.reviewerType']],
    ['reviewerType EXPERIENCED_KEEPER', { ...VR, reviewerType: 'EXPERIENCED_KEEPER' }, ['vetReview.reviewerType']],
    ['reviewedAt 형식', { ...VR, reviewedAt: '21-11-2026' }, ['vetReview.reviewedAt']],
    ['source 빈 값', { ...VR, source: '' }, ['vetReview.source']],
    ['source URL', { ...VR, source: 'https://vet.example.com/a' }, ['vetReview.source']],
    ['source 도메인', { ...VR, source: 'vet.example.co.kr 자료' }, ['vetReview.source']],
    ['알 수 없는 키', { ...VR, by: 'x' }, ['vetReview.by']],
    ['객체 아님', 'VET', ['vetReview']],
  ] as Array<[string, unknown, string[]]>)('%s → V-TIP-VET', (_n, value, paths) => {
    expect(vet(run([tip({ ...HEALTH, vetReview: value })]))).toEqual(paths);
  });

  it('허용 등급 VET_PUBLISHED_SOURCE·OFFICIAL_SOURCE·VET 는 오류 0', () => {
    for (const reviewerType of ['VET_PUBLISHED_SOURCE', 'OFFICIAL_SOURCE', 'VET']) {
      expect(run([tip({ ...HEALTH, vetReview: { ...VR, reviewerType } })]).errors, reviewerType).toEqual([]);
    }
  });

  it('현재 디스크 5행: 두 필드 모두 null(사람 대조·수의 검수 사실 없음 — 지어내지 않음) → W-TIP-SC 5 · W-TIP-VET 1(bedding)', () => {
    const tips = base.raw.budgetTips as Array<Record<string, unknown>>;
    for (const t of tips) {
      expect(t.summaryCheck, String(t.id)).toBeNull();
      expect(t.vetReview, String(t.id)).toBeNull();
    }
    const res = run(tips);
    expect(res.errors).toEqual([]);
    expect(res.warnings.filter((w) => w.rule === 'W-TIP-SC')).toHaveLength(5);
    expect(warnVet(res).map((w) => w.id)).toEqual(['tip-syrian-bedding-plain-paper']);
  });
});
