// 154 B안(보안 144 LOW-2) — seed:validate P06(coversThisAnimal 증빙·상대 의미).
//   실제 server/seed 를 깊은 복사해 합성 상품 행을 메모리에만 주입한다(시드 사실 불변 — 값·증빙은 검수자 몫).
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { unsignRaw } from './fixtures/prerender-seed.js';
import { validateSeed } from '../seed/validate.js';
import type { RawSeed, Rec } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-25'; // 356: 6종 GENERAL_INFO draftedAt(2026-11-23) 이상 — S07 미래 날짜 방지. // 팁 references checkedAt(2026-11-22) 이상 · 실서명일(2026-11-16) 이상 — 디스크 verifiedAt S07 방지(옛 값 2026-11-03, 277: 출처 접근일 2026-11-02 이상) // 368: 2026-11-25 = 8행 출처 접근일(S07 미래 날짜 방지, 옛 값 2026-11-23).
/** 디스크 시드 그대로(2026-11-16 확인표 5종 서명 후). */
const DISK_READ = readSeedDirRaw(SEED_DIR);
const DISK: RawSeed = DISK_READ.raw;
/** 규칙 주입 바탕 = 서명 전 기준(4 패킷 미서명, 메모리 — 주입 시험 의미 보존). */
const BASE: RawSeed = unsignRaw(DISK);
const GERBIL_CP = 'cp-gerbil-mongolian';
const SRC = [{ url: 'https://example.com/package-label', title: '포장 표기 원문 사진 — 운영자 확인', accessedAt: '2026-10-28' }];

const fresh = (): Required<RawSeed> => structuredClone(BASE) as Required<RawSeed>;

/** 저빌 사료 합성 행(REVIEW·DRAFT·AI_DRAFT — 다른 규칙 오류 없이 P06 만 보이게). */
function product(over: Partial<Rec> = {}): Rec {
  return {
    id: 'cp-test-covers',
    supplyItemId: 'food',
    careProfileIds: [GERBIL_CP],
    title: '합성 겸용 사료',
    imageAsset: null,
    specValues: { form: 'PELLET', forSpecies: 'MULTI', proteinPct: 18 },
    targetSpecLabel: null,
    meetsMinSpec: false,
    specVerifiedBy: null,
    specVerifiedAt: null,
    status: 'REVIEW',
    imageLicense: 'NONE',
    curationReasons: [],
    note: null,
    reviewStatus: 'DRAFT',
    reviewerType: 'AI_DRAFT',
    verifiedBy: null,
    verifiedAt: null,
    reviewBasis: null,
    contentKind: 'SPEC',
    source: [],
    ...over,
  };
}

function p06(s: RawSeed) {
  const r = validateSeed(s, { now: NOW });
  const pick = (xs: typeof r.errors) => xs.filter((i) => i.rule === 'P06').map((i) => ({ id: i.id, path: i.path }));
  return { errors: pick(r.errors), warnings: pick(r.warnings), allErrors: r.errors };
}

function withProduct(p: Rec, mutate?: (s: Required<RawSeed>) => void): Required<RawSeed> {
  const s = fresh();
  mutate?.(s);
  (s.curatedProducts as Rec[]).push(p);
  return s;
}

const HIT = [{ id: 'cp-test-covers', path: 'specValues.coversThisAnimal' }];

describe('P06 실제 시드', () => {
  it('errors 0, P06 오류·경고 0(대상 행 0) — 디스크(서명 후)·서명 전 기준 둘 다', () => {
    const pre = p06(BASE);
    expect(pre.allErrors).toEqual([]);
    expect([pre.errors, pre.warnings]).toEqual([[], []]);
    const r = p06(DISK);
    expect(r.allErrors).toEqual([]);
    expect([r.errors, r.warnings]).toEqual([[], []]);
  });
});

describe('P06a — coversThisAnimal=true 인데 증빙 출처(url) 없음', () => {
  const tv = { form: 'PELLET', forSpecies: 'MULTI', proteinPct: 18, coversThisAnimal: true };
  it('REVIEW·DRAFT → 경고', () => {
    const r = p06(withProduct(product({ specValues: tv, meetsMinSpec: true })));
    expect([r.errors, r.warnings]).toEqual([[], HIT]);
  });
  it('ACTIVE → 오류', () => {
    expect(p06(withProduct(product({ specValues: tv, meetsMinSpec: true, status: 'ACTIVE' }))).errors).toEqual(HIT);
  });
  it('VERIFIED → 오류', () => {
    const v = { reviewStatus: 'VERIFIED', reviewerType: 'EXPERIENCED_KEEPER', verifiedBy: 'keeper-test', verifiedAt: '2026-10-28' };
    expect(p06(withProduct(product({ specValues: tv, meetsMinSpec: true, ...v }))).errors).toEqual(HIT);
  });
  it('url 없는 source 항목만 있으면 여전히 오류(ACTIVE)', () => {
    const src = [{ url: '', title: '메모', accessedAt: '2026-10-28' }];
    expect(p06(withProduct(product({ specValues: tv, meetsMinSpec: true, status: 'ACTIVE', source: src }))).errors).toEqual(HIT);
  });
  it('source url 있으면 P06 0', () => {
    const r = p06(withProduct(product({ specValues: tv, meetsMinSpec: true, source: SRC })));
    expect([r.errors, r.warnings]).toEqual([[], []]);
  });
  it('false 는 증빙 요구 없음(fail-closed 쪽 값)', () => {
    const r = p06(withProduct(product({ specValues: { ...tv, coversThisAnimal: false } })));
    expect([r.errors, r.warnings]).toEqual([[], []]);
  });
  it('SLOT 행은 P06a 대상 아님', () => {
    const r = p06(withProduct(product({ specValues: tv, status: 'SLOT', meetsMinSpec: null, title: '' })));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe('P06b — 상대 의미 필드를 참조하는 프로필 2개 이상', () => {
  /** 기니피그 사료 minSpec 에도 같은 when 규칙을 메모리에서만 붙여 참조 프로필 2개를 만든다. */
  const secondRef = (s: Required<RawSeed>) => {
    const r = (s.supplyRequirements as Rec[]).find((x) => x.id === 'req-guineapig-food')!;
    (r.minSpec as { rules: unknown[] }).rules.push({ key: 'coversThisAnimal', op: 'eq', value: true, when: [{ key: 'forSpecies', op: 'eq', value: 'MULTI' }], reason: '합성 규칙' });
  };
  const sv = { form: 'PELLET', forSpecies: 'MULTI', proteinPct: 18, coversThisAnimal: true };
  it('2프로필 모두 참조 → 오류', () => {
    const r = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: [GERBIL_CP, 'cp-guineapig'] }), secondRef));
    expect(r.errors).toEqual(HIT);
  });
  it('2프로필 중 1개만 참조 → 통과', () => {
    const r = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: [GERBIL_CP, 'cp-guineapig'] })));
    expect(r.errors).toEqual([]);
  });
  it('1프로필(저빌) → 통과', () => {
    expect(p06(withProduct(product({ specValues: sv, source: SRC, meetsMinSpec: true }))).errors).toEqual([]);
  });
});

describe('P06c — 겸용 사료에 coversThisAnimal 없음', () => {
  it('forSpecies=MULTI · 저빌 → 경고', () => {
    const r = p06(withProduct(product()));
    expect([r.errors, r.warnings]).toEqual([[], HIT]);
  });
  it('forSpecies=GERBIL → 경고 없음', () => {
    const r = p06(withProduct(product({ specValues: { form: 'PELLET', forSpecies: 'GERBIL', proteinPct: 18 }, meetsMinSpec: true })));
    expect(r.warnings).toEqual([]);
  });
  it('참조 프로필 없는 동물(골든) MULTI → 경고 없음', () => {
    const r = p06(withProduct(product({ careProfileIds: ['cp-hamster-syrian'], meetsMinSpec: true })));
    expect(r.warnings).toEqual([]);
  });
});

// 173 — P06b/P06c 참조 수집: careOverrides 반영(resolveRequirement) · when 전용 참조 · recommendedSpec · dedupe.
describe('P06 참조 수집(173)', () => {
  const sv = { form: 'PELLET', forSpecies: 'MULTI', proteinPct: 18, coversThisAnimal: true };
  const TWO = [GERBIL_CP, 'cp-guineapig'];
  const coverRule = { key: 'coversThisAnimal', op: 'eq', value: true, reason: '합성 규칙' };
  const gpReq = (s: Required<RawSeed>) => (s.supplyRequirements as Rec[]).find((x) => x.id === 'req-guineapig-food')!;
  const gpType = (s: Required<RawSeed>) => (s.animalTypes as Rec[]).find((x) => x.id === 'guinea-pig')!;
  const rules = (rs: unknown) => (rs as { rules: unknown[] }).rules;

  it('M10: careProfileIds 중복(저빌 2회) → P06b 오탐 없음(중복 제거)', () => {
    const r = p06(withProduct(product({ specValues: sv, source: SRC, meetsMinSpec: true, careProfileIds: [GERBIL_CP, GERBIL_CP] })));
    expect(r.errors).toEqual([]);
  });

  it('M11: 참조 프로필 2개 · coversThisAnimal 없음 → P06b 오류 아님, P06c 경고만', () => {
    const second = (s: Required<RawSeed>) => rules(gpReq(s).minSpec).push({ ...coverRule });
    const r = p06(withProduct(product({ careProfileIds: TWO }), second));
    expect([r.errors, r.warnings]).toEqual([[], HIT]);
  });

  it('override(careOverrides)에서만 참조 → P06b 오류', () => {
    const viaOverride = (s: Required<RawSeed>) => {
      gpType(s).careOverrides = { requirements: { food: { minSpec: { rules: [{ ...coverRule }] } } } };
    };
    const r = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: TWO }), viaOverride));
    expect(r.allErrors.filter((i) => i.rule !== 'P06')).toEqual([]);
    expect(r.errors).toEqual(HIT);
  });

  it('when 조건에서만 참조 → 참조로 계산(P06b 오류)', () => {
    const viaWhen = (s: Required<RawSeed>) =>
      rules(gpReq(s).minSpec).push({ key: 'form', op: 'eq', value: 'PELLET', when: [{ key: 'coversThisAnimal', op: 'eq', value: true }], reason: '합성 규칙' });
    const r = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: TWO }), viaWhen));
    expect(r.allErrors.filter((i) => i.rule !== 'P06')).toEqual([]);
    expect(r.errors).toEqual(HIT);
  });

  it('recommendedSpec 에서만 참조 → P06b 오류(권장 표시 증빙 재사용 차단), P06c 는 minSpec 기준이라 경고 없음', () => {
    const viaRec = (s: Required<RawSeed>) => rules(gpReq(s).recommendedSpec).push({ ...coverRule });
    const hit = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: TWO }), viaRec));
    expect(hit.allErrors.filter((i) => i.rule !== 'P06')).toEqual([]);
    expect(hit.errors).toEqual(HIT);
    // 기니피그 단독 · MULTI · 키 없음 · recommendedSpec 만 참조 → P06c 대상 아님.
    const noKey = p06(withProduct(product({ careProfileIds: ['cp-guineapig'] }), viaRec));
    expect([noKey.errors, noKey.warnings]).toEqual([[], []]);
  });

  // 175 — 합집합 ① 항(프로필 기본 행)만이 잡는 경우. 기본 행이 참조해도 override 해석 결과가 참조하지 않거나, 타입이 없으면 ② 항만으론 놓친다.
  it('기본 행만 참조(override 가 같은 (key, op) 규칙을 비참조로 교체) → P06b 오류(합집합 ① 항)', () => {
    const baseOnly = (s: Required<RawSeed>) => {
      rules(gpReq(s).minSpec).push({ key: 'form', op: 'eq', value: 'PELLET', when: [{ key: 'coversThisAnimal', op: 'eq', value: true }], reason: '합성 규칙' });
      gpType(s).careOverrides = { requirements: { food: { minSpec: { rules: [{ key: 'form', op: 'eq', value: 'PELLET', reason: '합성 교체 규칙' }] } } } };
    };
    const r = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: TWO }), baseOnly));
    expect(r.allErrors.filter((i) => i.rule !== 'P06')).toEqual([]);
    expect(r.errors).toEqual(HIT);
  });

  it('AnimalType 이 하나도 없는 프로필이 참조해도 참조로 계산 → P06b 오류', () => {
    const noType = (s: Required<RawSeed>) => {
      rules(gpReq(s).minSpec).push({ ...coverRule });
      gpType(s).careProfileId = 'cp-hamster-syrian'; // cp-guineapig 를 쓰는 AnimalType 0개.
    };
    const r = p06(withProduct(product({ specValues: sv, source: SRC, careProfileIds: TWO }), noType));
    expect(r.allErrors.filter((i) => i.rule !== 'P06')).toEqual([]);
    expect(r.errors).toEqual(HIT);
  });

  it('두 프로필 공유 + 값 false → P06b 오류(값 무관 보수 규칙)', () => {
    const second = (s: Required<RawSeed>) => rules(gpReq(s).minSpec).push({ ...coverRule });
    const r = p06(withProduct(product({ specValues: { ...sv, coversThisAnimal: false }, careProfileIds: TWO }), second));
    expect(r.errors).toEqual(HIT);
  });
});
