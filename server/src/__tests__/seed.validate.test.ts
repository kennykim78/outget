// seed:validate 규칙 테이블 — 실제 server/seed 를 깊은 복사해 규칙마다 하나씩 주입한다(계획 §F).
//   시드 사실은 바꾸지 않는다: 주입은 메모리 복사본에만.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { isPhotoUsable } from '../engine/index.js';
import { lintText, numbersWithoutUnit, sentenceCount } from '../seed/lint.js';
import type { RawSeed, Rec, SeedKey } from '../seed/common.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_DIR = join(here, '..', '..', 'seed');
const NOW = '2026-11-03';

const loaded = readSeedDirRaw(SEED_DIR);
const BASE: RawSeed = loaded.raw;

function fresh(): Required<RawSeed> {
  return structuredClone(BASE) as Required<RawSeed>;
}

function row(s: RawSeed, key: SeedKey, id: string): Rec {
  const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
  if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
  return r as Rec;
}

/** enum 라벨 자리표시(메모리, 표기일 뿐 사실 아님) — W-OPTLABEL 게이트 통과용. */
function labelEnums(item: Rec): void {
  const fields = (item.specSchema as { fields: Array<Record<string, unknown>> }).fields;
  for (const f of fields) {
    if (f.type === 'enum') f.optionLabels = Object.fromEntries((f.options as string[]).map((o, i) => [o, `픽스처 라벨 ${i + 1}`]));
  }
}

/** enum 라벨 제거(메모리) — 라벨 누락 게이트 검증용. */
function unlabelEnums(item: Rec): void {
  for (const f of (item.specSchema as { fields: Array<Record<string, unknown>> }).fields) delete f.optionLabels;
}

function verify(r: Rec, reviewerType = 'EXPERIENCED_KEEPER'): void {
  r.reviewStatus = 'VERIFIED';
  r.reviewerType = reviewerType;
  r.verifiedBy = 'keeper-handle';
  r.verifiedAt = '2026-09-30';
  r.reviewBasis = 'ROW_CHECKED';
}

/** 주입용 정상 출처 1건(V04 동반 오류를 막는다). */
const SRC = { url: 'https://example.org/spec', title: 'spec', accessedAt: '2026-09-30' };

const errorRules = (r: ValidateResult): string[] => r.errors.map((i) => i.rule);
const warnRules = (r: ValidateResult): string[] => r.warnings.map((i) => i.rule);

describe('seed:validate — lint 원시 함수', () => {
  it('L01 정확 금지어 9개 + 전문가 N명 패턴', () => {
    for (const t of ['괜찮다', '안전하다', '최저가', '판매순', '베스트', '정확도', '회원가입', '구매']) {
      expect(lintText(`이건 ${t} 문장`).map((h) => h.rule)).toContain('L01');
    }
    expect(lintText('전문가 4명이 봤다').map((h) => h.rule)).toEqual(['L01']);
    expect(lintText('전문가4명').map((h) => h.rule)).toEqual(['L01']);
  });

  it('L02 어간은 WARN, 정확 금지어로 잡힌 부분은 어간 중복 보고 안 함', () => {
    expect(lintText('굴 유지력·안전')).toEqual([{ rule: 'L02', term: '안전' }]);
    expect(lintText('이건 안전하다')).toEqual([{ rule: 'L01', term: '안전하다' }]);
    expect(lintText('괜찮아요')).toEqual([{ rule: 'L02', term: '괜찮' }]);
    expect(lintText('바닥 면적이 우선')).toEqual([]);
  });

  it('문장 수 / 단위 없는 숫자', () => {
    expect(sentenceCount('달릴 때 등이 수평인지 확인. 발이 빠지지 않는 통면.')).toBe(2);
    expect(sentenceCount('1.5cm 간격.')).toBe(1);
    expect(numbersWithoutUnit('80×50 케이지 기준.')).toEqual(['80×50']);
    expect(numbersWithoutUnit('바닥 60×40cm 미만, 18~26℃, 조단백 15~20%, 주 1회')).toEqual([]);
  });
});

describe('seed:validate — 실제 시드 baseline', () => {
  const res = validateSeed(BASE, { now: NOW });

  it('읽기 이슈 0, errors 0', () => {
    expect(loaded.issues).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('경고 baseline 20 = W-EXPOSURE-ZERO 1 · W-RULESCOPED 2(271 bird-food.forSpecies +1 — 앵무 요구사항 행 0 · S9 요구사항이 S3 6필드 참조 → playpen floorType 1만 남음 — playpen 은 min 없음·rec 크기만, Kenny 2026-10-27) · L03 13(caution 6(S9 req-guineapig-cage Kenny 확정 2문장 +1) + 번들 note 단위 1 + Taxon note 5(S7 기니피그 +1, 햄스터와 같은 틀 · 저빌 126 신고 안내 제21조제3항 +1) + 드워프 hideout 1 — BE92 골든 초안 편집: caution 1문장 3건·번들 note 단위 1건 해소, 골든 Taxon note 드워프 문구로 +1) · L05 4 · L02 0(2026-10-14 Kenny: \'안전\' 2건 교체) · W-OPTLABEL 0(CU 라벨 입력 후) · W-COHERENCE 0(R7-B SupplyItem 13 VERIFIED) (R3 C5: W-SLUG 삭제, L06 0)', () => {
    const byRule: Record<string, number> = {};
    for (const r of warnRules(res)) byRule[r] = (byRule[r] ?? 0) + 1;
    // 규칙별 정확한 건수 — 다른 규칙(W-SLUG·L06·S09 …)이 끼어들면 toEqual 이 실패한다.
    expect(byRule).toEqual({ 'W-EXPOSURE-ZERO': 1, 'W-RULESCOPED': 2, L03: 13, L05: 4 });
    expect(res.warnings).toHaveLength(20);
    // 기니피그 S9: 요구사항 16행이 S3 ruleScoped 6필드를 참조 → playpen.floorType 만 남는다(playpen 은 rec 크기만).
    //   271: 앵무 bird-food.forSpecies(ruleScoped) 는 요구사항 행이 없어(사실값 대기) 참조 0 → +1.
    expect(res.warnings.filter((i) => i.rule === 'W-RULESCOPED').map((i) => `${i.id}.${i.path}`).sort()).toEqual([
      'bird-food.specSchema.forSpecies',
      'playpen.specSchema.floorType',
    ]);
    // S9: req-guineapig-cage caution = Kenny 확정 2문장(2026-10-27) → L03 1건(경고, 문장 그대로).
    expect(res.warnings.filter((i) => i.rule === 'L03' && i.id === 'req-guineapig-cage' && i.path === 'caution')).toHaveLength(1);
    // BE90: req-dwarf-food caution = Kenny 확정 문장 2문장(2026-10-25 '84 수령') → L03 caution 1문장 경고 1건(경고, 문장 그대로 둔다).
    expect(res.warnings.filter((i) => i.rule === 'L03' && i.id === 'req-dwarf-food' && i.path === 'caution')).toHaveLength(1);
    // R7-B 드워프 L03 3건 = 패킷 문장 그대로(값 변경 0): Taxon legal.note 2(DRAFT 초안 '제3조' 등) · req-dwarf-hideout why '3곳'(v0.2 5-8 서명).
    expect(res.warnings.filter((i) => i.rule === 'L03' && i.file === 'taxa.json' && i.path === 'legal.note').map((i) => i.id).sort()).toEqual(['cavia-porcellus', 'meriones-unguiculatus', 'mesocricetus-auratus', 'phodopus-campbelli', 'phodopus-sungorus']);
    expect(res.warnings.filter((i) => i.rule === 'L03' && i.id === 'req-dwarf-hideout' && i.path === 'why')).toHaveLength(1);
    expect(res.warnings.filter((i) => i.rule === 'L03' && i.path === 'caution')).toHaveLength(6);
    expect(res.warnings.filter((i) => i.rule === 'L03' && i.file === 'setup-bundles.json' && i.path === 'note')).toHaveLength(1);
  });

  it('노출 0(DRAFT 전량)', () => {
    expect(res.summary).toEqual({ types: 0, requirements: 0, products: 0, testimonials: 0, vets: 0 });
  });

  it('--strict 이면 W-EXPOSURE-ZERO 가 ERROR', () => {
    const strict = validateSeed(BASE, { now: NOW, strict: true });
    expect(errorRules(strict)).toEqual(['W-EXPOSURE-ZERO']);
  });

  it('입력 시드를 변경하지 않는다', () => {
    const copy = fresh();
    const snapshot = JSON.stringify(copy);
    validateSeed(copy, { now: NOW, strict: true });
    expect(JSON.stringify(copy)).toBe(snapshot);
  });
});

interface Case {
  name: string;
  rule: string;
  sev?: 'ERROR' | 'WARN';
  opts?: { now?: string; strict?: boolean };
  /**
   * 이 주입이 정당하게 함께 내는 ERROR 규칙(문서화된 동반 규칙). 이 집합 + rule 밖의 ERROR 가 나오면 실패한다
   * (QA R2 gap 3: toContain 만으로는 엉뚱한 규칙이 같이 터져도 통과했다).
   */
  also?: string[];
  inject: (s: Required<RawSeed>) => void;
}

const CASES: Case[] = [
  { name: 'S01 파일 누락', rule: 'S01', inject: (s) => { delete (s as RawSeed).testimonials; } },
  { name: 'S02 id 중복', rule: 'S02', inject: (s) => { s.supplyItems.push(structuredClone(row(s, 'supplyItems', 'cage'))); } },
  { name: 'S02 id 형식', rule: 'S02', inject: (s) => { row(s, 'photos', 'ph-01').id = 'Photo_1'; } },
  { name: 'S03 enum 밖 category', rule: 'S03', inject: (s) => { row(s, 'supplyItems', 'cage').category = 'HOUSING'; } },
  { name: 'S03 SLOT 은 상태 필드에만', rule: 'S03', inject: (s) => { row(s, 'animalTypes', 'budgie').status = 'SLOT'; } },
  { name: 'S04 contentKind 누락', rule: 'S04', also: ['V05'] /* Taxon 은 contentKind LEGAL 필수 — 누락은 V05 도 */, inject: (s) => { delete row(s, 'taxa', 'mesocricetus-auratus').contentKind; } },
  {
    name: 'S04 source url ftp:',
    rule: 'S04',
    inject: (s) => { ((row(s, 'supplyItems', 'wheel').source as Rec[])[0]).url = 'ftp://example.org/x'; },
  },
  {
    name: 'S05 min > max',
    rule: 'S05',
    // 잘못된 필드는 스키마 맵에 안 들어가므로 그 key 를 쓰는 요구사항 규칙이 있으면 S06 으로 연쇄된다.
    //   BE92: 소서 minSpec 삭제(85 근거 없음)로 saucer.diameterCm 을 쓰는 규칙이 없어 S06 연쇄 없음(also 비움).

    inject: (s) => {
      const f = ((row(s, 'supplyItems', 'saucer').specSchema as Rec).fields as Rec[])[0];
      f.min = 10;
      f.max = 5;
    },
  },
  {
    name: 'S06 값 타입 불일치 "28"',
    rule: 'S06',
    inject: (s) => { (((row(s, 'supplyRequirements', 'req-syrian-wheel').minSpec as Rec).rules as Rec[])[0]).value = '28'; },
  },
  {
    name: 'S06 스키마 밖 key',
    rule: 'S06',
    inject: (s) => { (((row(s, 'supplyRequirements', 'req-syrian-wheel').minSpec as Rec).rules as Rec[])[0]).key = 'foo'; },
  },
  {
    name: 'S06 enum in 값이 options 밖',
    rule: 'S06',
    inject: (s) => { (((row(s, 'supplyRequirements', 'req-syrian-bedding').minSpec as Rec).rules as Rec[])[0]).value = ['CEDAR']; },
  },
  {
    name: 'S06 when 조건 key 오류',
    rule: 'S06',
    inject: (s) => {
      (((row(s, 'supplyRequirements', 'req-syrian-cage').minSpec as Rec).rules as Rec[])[3]).when = [
        { key: 'kind', op: 'eq', value: 'WIRE' },
      ];
    },
  },
  { name: 'S07 날짜 형식', rule: 'S07', also: ['V02'] /* VERIFIED 는 ISO verifiedAt 필수 */, inject: (s) => { verify(row(s, 'supplyItems', 'cage')); row(s, 'supplyItems', 'cage').verifiedAt = '2026/10/05'; } },
  {
    name: 'S07 미래 날짜',
    rule: 'S07',
    inject: (s) => { ((row(s, 'supplyItems', 'cage').source as Rec[])[0]).accessedAt = '2026-12-01'; },
  },
  { name: 'S08 SupplyItem.priority', rule: 'S08', inject: (s) => { row(s, 'supplyItems', 'cage').priority = 'REQUIRED'; } },
  { name: 'S08 CuratedProduct 가격 키', rule: 'S08', inject: (s) => { row(s, 'curatedProducts', 'cp-001').priceKrw = 1000; } },
  { name: 'S08 curationReasons 비어있지 않음', rule: 'S08', inject: (s) => { row(s, 'curatedProducts', 'cp-001').curationReasons = ['인기']; } },
  { name: 'S08 후기 rating', rule: 'S08', inject: (s) => { row(s, 'testimonials', 't-001').rating = 5; } },
  { name: 'S09 알 수 없는 키', rule: 'S09', sev: 'WARN', inject: (s) => { row(s, 'supplyItems', 'cage').foo = 1; } },
  { name: 'R01 ACTIVE 인데 careProfileId null', rule: 'R01', inject: (s) => { row(s, 'animalTypes', 'hamster-golden').careProfileId = null; } },
  { name: 'R01 taxonId 없음', rule: 'R01', inject: (s) => { row(s, 'animalTypes', 'hamster-golden').taxonId = 'x'; } },
  { name: 'R02 별칭 중복', rule: 'R02', inject: (s) => { (row(s, 'animalTypes', 'budgie').aliases as string[]).push('저빌'); } },
  { name: 'R02 별칭 = 다른 displayName', rule: 'R02', inject: (s) => { (row(s, 'animalTypes', 'budgie').aliases as string[]).push('기니피그'); } },
  {
    name: 'R03 기본 요구사항 없는 override',
    rule: 'R03',
    inject: (s) => { row(s, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { saucer2: { priority: 'OPTIONAL' } } }; },
  },
  {
    name: 'R03 override 필드 타입',
    rule: 'R03',
    inject: (s) => { row(s, 'animalTypes', 'hamster-golden').careOverrides = { requirements: { saucer: { priority: 'SOMETIMES' } } }; },
  },
  {
    name: 'S06 override minSpec 규칙도 검사',
    rule: 'S06',
    inject: (s) => {
      row(s, 'animalTypes', 'hamster-golden').careOverrides = {
        requirements: { wheel: { minSpec: { rules: [{ key: 'diameterCm', op: 'gte', value: 'big', reason: 'x' }] } } },
      };
    },
  },
  { name: 'R04 taxonIds 없음', rule: 'R04', inject: (s) => { row(s, 'careProfiles', 'cp-hamster-syrian').taxonIds = ['x']; } },
  { name: 'R05 대안이 자기 자신', rule: 'R05', inject: (s) => { row(s, 'supplyItems', 'wheel').compatibleAlternativeIds = ['wheel']; } },
  {
    name: 'R06 (profile,item) 쌍 중복',
    rule: 'R06',
    inject: (s) => {
      const c = structuredClone(row(s, 'supplyRequirements', 'req-syrian-cage'));
      c.id = 'req-syrian-cage-2';
      s.supplyRequirements.push(c);
    },
  },
  { name: 'R07 a 항목 없음', rule: 'R07', inject: (s) => { row(s, 'compatibilityRules', 'cr-syrian-wheel-cage-bedding').a = 'ghost'; } },
  { name: 'R07 a == b', rule: 'R07', inject: (s) => { row(s, 'compatibilityRules', 'cr-syrian-wheel-cage-bedding').b = 'wheel'; } },
  {
    name: 'R07 expr 화이트리스트 밖 식별자',
    rule: 'R07',
    inject: (s) => { ((row(s, 'compatibilityRules', 'cr-syrian-wheel-cage-bedding').rules as Rec[])[0]).expr = 'a.diameterCm + process'; },
  },
  {
    name: 'R07 expr 호출 금지',
    rule: 'R07',
    inject: (s) => { ((row(s, 'compatibilityRules', 'cr-syrian-wheel-cage-bedding').rules as Rec[])[0]).expr = 'process.exit()'; },
  },
  {
    name: 'R07 enum 리터럴 options 밖',
    rule: 'R07',
    inject: (s) => { ((row(s, 'compatibilityRules', 'cr-syrian-wheel-cage-bedding').rules as Rec[])[0]).expr = "a.mount == 'HANG' ? b.type == 'WIRES' : true"; },
  },
  {
    name: 'R07 스키마 밖 참조',
    rule: 'R07',
    inject: (s) => { ((row(s, 'compatibilityRules', 'cr-syrian-wheel-cage-bedding').rules as Rec[])[0]).expr = 'a.mount == b.mount'; },
  },
  { name: 'R08 itemIds 없음', rule: 'R08', inject: (s) => { (row(s, 'setupBundles', 'sb-syrian-budget').itemIds as string[]).push('ghost'); } },
  { name: 'R08 (profile,tier) 중복', rule: 'R08', inject: (s) => { row(s, 'setupBundles', 'sb-syrian-reuse').tier = 'BUDGET'; } },
  {
    name: 'R09 specValues 타입(비SLOT)',
    rule: 'R09',
    inject: (s) => {
      const p = row(s, 'curatedProducts', 'cp-001');
      Object.assign(p, { status: 'REVIEW', title: '상품 A', meetsMinSpec: false });
      p.specValues = { diameterCm: '30', surface: 'SOLID', mount: 'STAND' };
    },
  },
  { name: 'R09 supplyItemId 없음', rule: 'R09', inject: (s) => { row(s, 'curatedProducts', 'cp-001').supplyItemId = 'ghost'; } },
  { name: 'R10 후기 animalTypeId 없음', rule: 'R10', inject: (s) => { row(s, 'testimonials', 't-001').animalTypeId = 'hamster-x'; } },
  { name: 'R10 사진 slot 중복', rule: 'R10', inject: (s) => { row(s, 'photos', 'ph-02').slot = 'intro-1'; } },
  { name: 'V01 AI_DRAFT + VERIFIED', rule: 'V01', inject: (s) => { verify(row(s, 'supplyItems', 'cage'), 'AI_DRAFT'); } },
  {
    name: 'V01 AI_DRAFT + VERIFIED (상품 SLOT 포함)',
    rule: 'V01',
    also: ['P04'], // SLOT 행 VERIFIED 자체가 P04
    inject: (s) => { const p = row(s, 'curatedProducts', 'cp-003'); verify(p, 'AI_DRAFT'); p.source = [SRC]; },
  },
  {
    name: 'V02 verifiedBy 없음',
    rule: 'V02',
    inject: (s) => { const r = row(s, 'supplyItems', 'cage'); verify(r); r.verifiedBy = null; },
  },
  { name: 'V03 FOOD 를 EXPERIENCED_KEEPER 가 검수', rule: 'V03' /* BE92 Q3: 디스크 출처에 국내 K1 → V08 동반 없음 */, inject: (s) => { verify(row(s, 'supplyRequirements', 'req-syrian-food')); } },
  { name: 'V03 LEGAL 은 OFFICIAL_SOURCE', rule: 'V03', inject: (s) => { verify(row(s, 'taxa', 'mesocricetus-auratus'), 'VET'); } },
  {
    name: 'V04 FOOD 출처 같은 호스트 2개',
    rule: 'V04',
    also: ['V08'], // 국외 도메인뿐
    inject: (s) => {
      const r = row(s, 'supplyRequirements', 'req-syrian-food');
      verify(r, 'VET_PUBLISHED_SOURCE');
      r.source = [
        { url: 'https://www.rspca.org.uk/a', title: 'a', accessedAt: '2026-09-30' },
        { url: 'https://rspca.org.uk/b', title: 'b', accessedAt: '2026-09-30' },
      ];
    },
  },
  {
    name: 'V08 FOOD VERIFIED 서로 다른 도메인 2개지만 국내(.kr) 0',
    rule: 'V08',
    inject: (s) => {
      const r = row(s, 'supplyRequirements', 'req-syrian-food');
      verify(r, 'VET_PUBLISHED_SOURCE');
      // BE92 Q3: 디스크 req-syrian-food 에 국내 K1(koreascience.kr)이 붙어 → 국외 출처만 남겨 V08 을 만든다.
      r.source = (r.source as Array<{ url: string }>).filter((x) => !x.url.includes('.kr/'));
    },
  },
  {
    name: 'V08 HEALTH VERIFIED — .kr 처럼 보이는 경로·서브도메인 우회(kr.example.com, example.com/kr)는 국내로 세지 않음',
    rule: 'V08',
    inject: (s) => {
      const r = row(s, 'supplyRequirements', 'req-syrian-scale');
      r.contentKind = 'HEALTH';
      verify(r, 'VET_PUBLISHED_SOURCE');
      r.source = [
        { url: 'https://kr.example.com/a', title: 'a', accessedAt: '2026-09-30' },
        { url: 'https://example.org/kr', title: 'b', accessedAt: '2026-09-30' },
      ];
    },
  },
  { name: 'V04 VERIFIED 인데 출처 0', rule: 'V04', inject: (s) => { verify(row(s, 'setupBundles', 'sb-syrian-budget')); } },
  { name: 'V05 요구사항 LEGAL', rule: 'V05', inject: (s) => { row(s, 'supplyRequirements', 'req-syrian-cage').contentKind = 'LEGAL'; } },
  {
    name: 'W-STALE 180일 경과',
    rule: 'W-STALE',
    sev: 'WARN',
    inject: (s) => { const r = row(s, 'supplyItems', 'cage'); verify(r); r.verifiedAt = '2026-01-01'; },
  },
  { name: 'W-COHERENCE 요구사항만 승격', rule: 'W-COHERENCE', sev: 'WARN', inject: (s) => { verify(row(s, 'supplyRequirements', 'req-syrian-cage')); } },
  {
    name: 'P02 ACTIVE 상품 제목 비어있음',
    rule: 'P02',
    also: ['L04'], // 빈 title 은 자리표시자 린트 L04 도

    inject: (s) => {
      const p = row(s, 'curatedProducts', 'cp-004');
      p.status = 'ACTIVE';
      p.meetsMinSpec = true;
      p.specVerifiedBy = 'op';
      p.specVerifiedAt = '2026-09-30';
    },
  },
  {
    name: 'P01 비SLOT meetsMinSpec=false 인데 재계산 true (cp-004)',
    rule: 'P01',
    inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-004'), { status: 'REVIEW', meetsMinSpec: false, title: '상품 A' }); },
  },
  {
    // BE92: 골든 철망 간격은 when type eq WIRE(85) + cp-003 목표 100×50×50 → 리빙박스는 재계산 true. 높이를 40으로 낮춰 재계산 false 를 만든다.
    name: 'P01 비SLOT meetsMinSpec=true 인데 재계산 false (cp-003 높이 40 < 50)',
    rule: 'P01',
    inject: (s) => {
      const p = row(s, 'curatedProducts', 'cp-003');
      Object.assign(p, { status: 'REVIEW', meetsMinSpec: true, title: '상품 B' });
      (p.specValues as Rec).heightCm = 40;
    },
  },
  { name: 'P01 비SLOT meetsMinSpec null', rule: 'P01', inject: (s) => { Object.assign(row(s, 'curatedProducts', 'cp-005'), { status: 'REVIEW', title: '상품 C' }); } },
  { name: 'P03 NONE 인데 imageAsset', rule: 'P03', inject: (s) => { row(s, 'curatedProducts', 'cp-001').imageAsset = '/assets/products/cp-001.jpg'; } },
  { name: 'P04 SLOT + VERIFIED', rule: 'P04', inject: (s) => { const p = row(s, 'curatedProducts', 'cp-001'); verify(p); p.source = [SRC]; } },
  { name: 'T01 APPROVED 인데 verifiedUsage false', rule: 'T01', inject: (s) => { const t = row(s, 'testimonials', 't-001'); t.status = 'APPROVED'; t.quote = '처음 준비할 때 도움이 됐어요'; t.consentAt = '2026-09-30'; } },
  { name: 'T01 APPROVED 80자 초과', rule: 'T01', inject: (s) => { const t = row(s, 'testimonials', 't-001'); t.status = 'APPROVED'; t.verifiedUsage = true; t.consentAt = '2026-09-30'; t.quote = '가'.repeat(81); } },
  { name: 'T02 이미지 동의 없음', rule: 'T02', inject: (s) => { row(s, 'testimonials', 't-002').reviewerImage = '/assets/reviewers/t-002.jpg'; } },
  {
    name: 'VC01 VERIFIED 인데 WEBSITE 확인',
    rule: 'VC01',
    inject: (s) => {
      const v = row(s, 'vetClinics', 'vc-mapo-01');
      Object.assign(v, { name: '가나 동물병원', phone: '02-000-0000', address: '서울 마포구 어딘가' });
      v.verification = { status: 'VERIFIED', method: 'WEBSITE', verifiedAt: '2026-09-30', note: null };
    },
  },
  {
    name: 'VC02 좌표 한쪽만',
    rule: 'VC02',
    inject: (s) => { row(s, 'vetClinics', 'vc-mapo-01').lat = 37.55; },
  },
  {
    name: 'I01 CC_BY 저작자 없음',
    rule: 'I01',
    inject: (s) => {
      Object.assign(row(s, 'photos', 'ph-01'), {
        status: 'READY',
        source: 'WIKIMEDIA',
        license: 'CC_BY',
        author: null,
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        downloadedAt: '2026-09-30',
      });
    },
  },
  ...([
    ['sourceUrl http', { sourceUrl: 'http://commons.wikimedia.org/wiki/File:x.jpg' }],
    ['sourceUrl 점 없는 호스트', { sourceUrl: 'https://localhost/x.jpg' }],
    ['sourceUrl 호스트만 한 단어', { sourceUrl: 'https://x' }],
    ['downloadedAt 2026-02-30', { downloadedAt: '2026-02-30' }],
    ['downloadedAt 0999-01-01', { downloadedAt: '0999-01-01' }],
  ] as const).map(([what, p]) => ({
    name: `I01 ${what} — engine isPhotoUsable 과 같은 엄격도`,
    rule: 'I01',
    // 달력상 없는 날짜는 S07(날짜 형식)도 함께 보고된다(문서화된 동반 규칙).
    ...(what === 'downloadedAt 2026-02-30' ? { also: ['S07'] } : {}),
    inject: (s: Required<RawSeed>) => {
      Object.assign(row(s, 'photos', 'ph-01'), {
        status: 'READY',
        source: 'WIKIMEDIA',
        license: 'CC0',
        author: null,
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
        downloadedAt: '2026-09-30',
        ...p,
      });
    },
  })),
  ...(['ACTIVE', 'ready', ''] as const).map((status) => ({
    name: `I01 사진 status 허용목록 밖(${JSON.stringify(status)}) — S-R4 L-E`,
    rule: 'I01',
    inject: (s: Required<RawSeed>) => {
      Object.assign(row(s, 'photos', 'ph-01'), {
        status,
        source: 'WIKIMEDIA',
        license: 'CC0',
        author: null,
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
        downloadedAt: '2026-09-30',
      });
    },
  })),
  ...([
    ['CC_BY licenseUrl 없음', 'CC_BY', undefined],
    ['CC_BY licenseUrl null', 'CC_BY', null],
    ['CC_BY 에 by-sa 증서', 'CC_BY', 'https://creativecommons.org/licenses/by-sa/4.0/'],
    ['CC_BY_SA 허용목록 밖 호스트', 'CC_BY_SA', 'https://creativecommons.org.evil.example/licenses/by-sa/4.0/'],
    ['SITE_LICENSE 에 허용목록 밖 licenseUrl', 'SITE_LICENSE', 'https://unsplash.com/license'],
  ] as const).map(([what, license, licenseUrl]) => ({
    name: `I02 ${what}`,
    rule: 'I02',
    inject: (s: Required<RawSeed>) => {
      const p = Object.assign(row(s, 'photos', 'ph-01'), {
        status: 'READY',
        source: 'WIKIMEDIA',
        license,
        author: 'Fixture Author',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
        downloadedAt: '2026-09-30',
      });
      if (licenseUrl !== undefined) p.licenseUrl = licenseUrl;
    },
  })),
  { name: 'L01 why 금지어', rule: 'L01', inject: (s) => { row(s, 'supplyRequirements', 'req-syrian-cage').why = '최저가로 고르면 돼요.'; } },
  { name: 'L01 전문가 N명', rule: 'L01', inject: (s) => { row(s, 'supplyItems', 'cage').description = '전문가 4명이 검토한 기준.'; } },
  { name: 'L04 avoid 자리표시자', rule: 'L04', inject: (s) => { row(s, 'supplyRequirements', 'req-syrian-water').avoid = '—'; } },
];

// 검증 통과 ⇔ 노출 가능(사진): non-SLOT 사진이 I01·I02 오류 0 이면 engine isPhotoUsable 도 true, 오류가 있으면 false.
describe('seed:validate I01·I02 ↔ engine isPhotoUsable 일치(사진이 통과하고 조용히 안 보이는 일 없음)', () => {
  const base = {
    status: 'READY', source: 'WIKIMEDIA', license: 'CC_BY', author: 'A',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:x.jpg', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', downloadedAt: '2026-09-30',
  };
  const variants: Array<Record<string, unknown>> = [
    {}, { sourceUrl: 'http://e.org/x' }, { sourceUrl: 'https://localhost/x' }, { sourceUrl: 'https://x' }, { sourceUrl: 'https://e.org' },
    { sourceUrl: 'https://e.org/a b' }, { sourceUrl: 'HTTPS://e.org/x' }, { sourceUrl: null },
    { downloadedAt: '2026-02-30' }, { downloadedAt: '2026-9-30' }, { downloadedAt: '0999-01-01' }, { downloadedAt: null },
    { status: 'ACTIVE' }, { license: 'CC0', author: null, licenseUrl: null }, { licenseUrl: null }, { licenseUrl: 'https://creativecommons.org/licenses/by/9.9/' },
    { author: null }, { source: '' }, { license: 'SITE_LICENSE', licenseUrl: null },
  ];
  it.each(variants.map((v) => [JSON.stringify(v), v] as const))('%s', (_n, v) => {
    const s = fresh();
    const p = Object.assign(row(s, 'photos', 'ph-01'), base, v);
    const res = validateSeed(s, { now: NOW });
    const photoErrs = res.errors.filter((i) => i.file === 'photos.json' && (i.rule === 'I01' || i.rule === 'I02' || i.rule === 'I03' || i.rule === 'S03'));
    expect(photoErrs.length === 0, JSON.stringify(photoErrs.map((i) => `${i.rule} ${i.path}`))).toBe(isPhotoUsable(p as never));
  });
});

describe('seed:validate — 규칙별 주입', () => {
  for (const c of CASES) {
    it(`${c.name} → ${c.sev ?? 'ERROR'} [${c.rule}]`, () => {
      const s = fresh();
      c.inject(s);
      const res = validateSeed(s, { now: c.opts?.now ?? NOW, strict: c.opts?.strict });
      if ((c.sev ?? 'ERROR') === 'ERROR') {
        expect(errorRules(res)).toContain(c.rule);
        const allowed = new Set([c.rule, ...(c.also ?? [])]);
        const unexpected = [...new Set(errorRules(res))].filter((r) => !allowed.has(r));
        expect(unexpected, `예상 밖 ERROR: ${res.errors.filter((i) => !allowed.has(i.rule)).map((i) => `${i.rule} ${i.file}#${i.id} ${i.path}`).join(' | ')}`).toEqual([]);
        for (const a of c.also ?? []) expect(errorRules(res), `문서화된 동반 규칙 ${a} 가 더 이상 나오지 않음 — also 갱신`).toContain(a);
      } else {
        expect(warnRules(res)).toContain(c.rule);
        expect(res.errors).toEqual([]);
      }
    });
  }

  it('P01 재계산은 when 을 반영 + S06 when 정상 형태는 통과', () => {
    const s = fresh();
    Object.assign(row(s, 'curatedProducts', 'cp-004'), { status: 'REVIEW', meetsMinSpec: true, title: '상품 A' });
    Object.assign(row(s, 'curatedProducts', 'cp-003'), { status: 'REVIEW', meetsMinSpec: false, title: '상품 B' });
    (((row(s, 'supplyRequirements', 'req-syrian-cage').minSpec as Rec).rules as Rec[])[3]).when = [
      { key: 'type', op: 'eq', value: 'WIRE' },
    ];
    // when 이 있으면 리빙박스(cp-003)는 barGapMm 규칙 n/a → 재계산 true 가 되어 false 기록은 P01.
    const res = validateSeed(s, { now: NOW });
    expect(errorRules(res)).toEqual(['P01']);
    expect(res.errors[0].id).toBe('cp-003');
  });

  /** golden 체인(요구사항·용품·프로필[·동물]) VERIFIED + cp-004(철망 100×50×50, 간격 9mm — BE92 목표 규격) ACTIVE·VERIFIED 승격. 메모리 복사본만. */
  function promoteGoldenChain(s: Required<RawSeed>, opts: { animalType: boolean; labels?: boolean }): void {
    verify(row(s, 'supplyRequirements', 'req-syrian-cage'));
    verify(row(s, 'supplyItems', 'cage'));
    if (opts.labels !== false) labelEnums(row(s, 'supplyItems', 'cage'));
    else unlabelEnums(row(s, 'supplyItems', 'cage'));
    verify(row(s, 'careProfiles', 'cp-hamster-syrian'));
    if (opts.animalType) verify(row(s, 'animalTypes', 'hamster-golden'));
    // K-4(R7 A6): 타입 노출은 Taxon(LEGAL) 검수도 요구 — LEGAL 정확 등급 OFFICIAL_SOURCE(V03). 사실값은 디스크 그대로.
    if (opts.animalType) verify(row(s, 'taxa', 'mesocricetus-auratus'), 'OFFICIAL_SOURCE');
    // X01(K-B4): cage 만 승격하므로 나머지 골든 REQUIRED 는 메모리에서 RECOMMENDED 로(비노출 행 — 노출 요약 불변).
    for (const r of s.supplyRequirements as Rec[]) {
      if (r.careProfileId === 'cp-hamster-syrian' && r.priority === 'REQUIRED' && r.id !== 'req-syrian-cage') r.priority = 'RECOMMENDED';
    }
    const p = row(s, 'curatedProducts', 'cp-004');
    Object.assign(p, {
      status: 'ACTIVE',
      meetsMinSpec: true,
      title: '철망 케이지 상품 A',
      specVerifiedBy: 'operator-handle',
      specVerifiedAt: '2026-09-30',
      source: [SRC],
    });
    verify(p);
  }

  it('정상 승격(요구사항·용품·프로필·동물 VERIFIED + 상품 cp-004) → errors 0, 노출 요구사항 1·타입 1·상품 1 (A6 회귀)', () => {
    const s = fresh();
    promoteGoldenChain(s, { animalType: true });
    const res = validateSeed(s, { now: NOW, strict: true });
    // 보안 79 M-1: cage 만 노출하는 부분 체인은 코드 고정 필수 항목(cage·food·water·bedding·hideout·wheel) 나머지 5개가 X01.
    //   X01 외 오류 0 — 노출 요약(A6 회귀)은 X01 과 무관하게 같은 값.
    expect(res.errors.filter((i) => i.rule !== 'X01')).toEqual([]);
    expect(res.errors.filter((i) => i.rule === 'X01').map((i) => i.path).sort()).toEqual(
      ['requirements.bedding', 'requirements.food', 'requirements.hideout', 'requirements.water', 'requirements.wheel'],
    );
    expect(res.summary.requirements).toBe(1);
    expect(res.summary.types).toBe(1);
    expect(res.summary.products).toBe(1);
    expect(warnRules(res)).not.toContain('W-EXPOSURE-ZERO');
    expect(warnRules(res)).not.toContain('W-COHERENCE');
  });

  // G7(스펙22 §4-3): 노출 요구사항이 조건으로 쓰는 enum 필드에 라벨이 없으면 ERROR, 비노출이면 WARN.
  it('W-OPTLABEL: 승격 체인의 enum 라벨 누락 → ERROR(노출 조건 필드), 노출 전이면 WARN', () => {
    const s = fresh();
    promoteGoldenChain(s, { animalType: true, labels: false });
    const res = validateSeed(s, { now: NOW });
    const errs = res.errors.filter((i) => i.rule === 'W-OPTLABEL');
    expect(errs.map((i) => `${i.id} ${i.path}`)).toContain('cage specSchema.type.optionLabels');
    const draft = fresh();
    promoteGoldenChain(draft, { animalType: false, labels: false });
    const res2 = validateSeed(draft, { now: NOW });
    expect(res2.errors).toEqual([]);
    expect(res2.warnings.filter((i) => i.rule === 'W-OPTLABEL' && i.id === 'cage').length).toBeGreaterThan(0);
  });

  it('W-OPTLABEL: 라벨을 다 달면 통과, 노출 조건 필드의 라벨이 하나라도 빠지면 ERROR', () => {
    const s = fresh();
    promoteGoldenChain(s, { animalType: true });
    const res = validateSeed(s, { now: NOW });
    expect(res.errors.filter((i) => i.rule !== 'X01')).toEqual([]); // X01 = 부분 체인(위 A6 회귀 참고)
    const cage = row(s, 'supplyItems', 'cage') as { specSchema: { fields: Array<Record<string, unknown>> } };
    const typeField = cage.specSchema.fields.find((f) => f.key === 'type') as { optionLabels: Record<string, string> };
    delete typeField.optionLabels.WIRE;
    const res2 = validateSeed(s, { now: NOW });
    expect(res2.errors.map((i) => i.rule)).toContain('W-OPTLABEL');
  });

  it('같은 승격이지만 hamster-golden DRAFT → 타입 0·상품 0 (M1: 동물 미검수면 상품도 비노출, A6 회귀)', () => {
    const s = fresh();
    promoteGoldenChain(s, { animalType: false });
    const res = validateSeed(s, { now: NOW });
    expect(res.errors).toEqual([]);
    expect(res.summary.types).toBe(0);
    expect(res.summary.products).toBe(0);
  });
});
