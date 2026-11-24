import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Collector, type Rec, type SeedKey } from '../seed/common.js';
import { compatDigits, lintRecord, lintText, normalizeLintText, textFieldsOf } from '../seed/lint.js';
import { readSeedDirRaw } from '../seed/read.js';

// 위반 문자열은 런타임 조립 — compliance 스캐너가 테스트 파일을 잡지 않게.
const safeWord = ['안전', '하다'].join('');
const lowest = ['최', '저가'].join('');
const signup = ['회원', '가입'].join('');
const expert = ['전문가', ' 열 ', '명'].join('');
const buy = ['구', '매'].join('');
const zw = String.fromCharCode(0x200b);
const fullwidth4 = String.fromCharCode(0xff14);

const rules = (t: string) => lintText(t).map((h) => h.rule);

describe('lintText — 정규화·L01/L02/L06', () => {
  it('NFD 분해 입력도 L01', () => {
    expect(rules(safeWord.normalize('NFD'))).toContain('L01');
  });
  it('제로폭 문자 삽입 → L01', () => {
    expect(rules(lowest.slice(0, 1) + zw + lowest.slice(1))).toContain('L01');
  });
  it('띄어쓰기 삽입 → L01', () => {
    expect(rules(signup.split('').join(' '))).toContain('L01');
  });
  it('한글 수사 전문가 N명 → L01', () => {
    expect(rules(expert)).toContain('L01');
  });
  it('전각 숫자 전문가 N명 → L01', () => {
    expect(rules(`전문가${fullwidth4}명`)).toContain('L01');
  });
  it('단어 경계 걸침(길이 2) → L06, L01 아님', () => {
    const r = rules('가' + buy.slice(0, 1) + ' ' + buy.slice(1) + '장');
    expect(r).toContain('L06');
    expect(r).not.toContain('L01');
  });
  it('구 매 → L06', () => {
    expect(rules(buy.slice(0, 1) + ' ' + buy.slice(1))).toEqual(['L06']);
  });
  it('어간 + 구분자 → L02', () => {
    expect(rules('안전·세척')).toEqual(['L02']);
  });
  it('깨끗한 문장 → []', () => {
    expect(lintText('케이지는 환기가 잘 되는 것을 고르세요.')).toEqual([]);
  });
  it('반환형 호환 — {rule, term}', () => {
    const hits = lintText(safeWord);
    expect(hits[0]).toEqual({ rule: 'L01', term: safeWord });
    expect(normalizeLintText(' a­  b ', 'spaced')).toBe(' a b ');
    expect(normalizeLintText('a ​b', 'stripped')).toBe('ab');
  });
});

// L07 — 정규화 전 원문의 호환 숫자 표기(Kenny 2026-11-16 결정 5). 문자는 코드포인트로 조립(소스에 호환 문자 리터럴 없음).
const cp = (...xs: number[]): string => String.fromCodePoint(...xs);
const COMPAT_FAMILIES: ReadonlyArray<[string, string]> = [
  ['전각 ０-９', cp(0xff16, 0xff10)],
  ['원문자 ①-⑳', cp(0x2460)],
  ['괄호 숫자 ⑴-⒇', cp(0x2474)],
  ['숫자 마침표 ⒈-⒛', cp(0x2488)],
  ['원문자 ㉑-㊿', cp(0x3251)],
  ['원문자 ⓪', cp(0x24ea)],
  ['수학 굵은 𝟎-𝟿', cp(0x1d7d4, 0x1d7ce)],
  ['위첨자 ²', cp(0x00b2)],
  ['아래첨자 ₂', cp(0x2082)],
  ['분수 ½', cp(0x00bd)],
  ['단위 ㎡', cp(0x33a1)],
  ['검은 원문자 ❶', cp(0x2776)],
  ['겹원문자 ⓵', cp(0x24f5)],
  ['아라비아-인도 ٩', cp(0x0669)],
  ['한자 영 〇', cp(0x3007)],
];
const lintOne = (key: SeedKey, r: Rec) => {
  const out = new Collector();
  lintRecord(key, 'x', r, out);
  return out.issues.filter((i) => i.rule === 'L07').map((i) => `${i.severity} ${i.path}`);
};

describe('compatDigits · L07 — 정규화 전 원문 기준 호환 숫자', () => {
  it.each(COMPAT_FAMILIES)('%s → compatDigits 검출 · why 역할 L07 ERROR', (_n, ch) => {
    const text = `가로 ${ch}cm 이상이에요.`;
    expect(compatDigits(text)).toEqual([ch]);
    expect(lintOne('supplyRequirements', { why: text })).toEqual(['ERROR why']);
  });
  it('이어진 호환 숫자는 한 묶음, 떨어지면 따로', () => {
    expect(compatDigits(`${cp(0xff16, 0xff10)}x${cp(0x2460)}`)).toEqual([cp(0xff16, 0xff10), cp(0x2460)]);
  });
  it('역할: name·prose·caution·keyword·range = ERROR, quote(후기 원문 보존) = WARN', () => {
    const d = cp(0xff13);
    expect(lintOne('supplyItems', { name: `케이지 ${d}층` })).toEqual(['ERROR name']);
    expect(lintOne('setupBundles', { purpose: `${d}개 준비`, estimatedRangeText: `${d}만 원` })).toEqual(['ERROR purpose', 'ERROR estimatedRangeText']);
    expect(lintOne('supplyRequirements', { caution: `${d}cm 넘게 봐요.`, searchKeyword: `{animal} 케이지 ${d}` })).toEqual(['ERROR caution', 'ERROR searchKeyword']);
    expect(lintOne('testimonials', { status: 'APPROVED', quote: `${d}개월 썼어요.` })).toEqual(['WARN quote']);
  });
  it('정상 한글·ASCII 숫자·NFKC 변환이지만 숫자 아닌 문자(℃·ㆍ·…·호환 자모·㈀·㉠) → 0건', () => {
    const benign = ['가로 60×40cm 이상, 18~26℃ 유지해요.', '물ㆍ먹이…', 'ㄱㄴ ㈀ ㉠ 한글 문장이에요.', '하루 한 번 확인해요.', `${cp(0x2103)}${cp(0x318d)}${cp(0x2026)}`];
    for (const t of benign) {
      expect(compatDigits(t), t).toEqual([]);
      expect(lintOne('supplyRequirements', { why: t })).toEqual([]);
    }
  });
  it('실시드·seed-draft 전 텍스트 필드 호환 숫자 0건(NFKC 로 바뀌는 문자는 ℃·ㆍ·… 계열뿐)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const changed = new Set<string>();
    let fields = 0;
    for (const dir of [join(here, '..', '..', 'seed'), join(here, '..', '..', '..', 'docs', 'planning-artifacts', 'seed-draft')]) {
      const raw = readSeedDirRaw(dir).raw as Partial<Record<SeedKey, unknown[]>>;
      for (const [key, rows] of Object.entries(raw) as Array<[SeedKey, unknown[] | undefined]>) {
        for (const r of rows ?? []) {
          for (const f of textFieldsOf(key, r as Rec)) {
            fields += 1;
            expect(compatDigits(f.text), `${key} ${f.path}`).toEqual([]);
            for (const ch of f.text) if (ch.normalize('NFKC') !== ch) changed.add(ch);
          }
        }
      }
    }
    expect(fields).toBeGreaterThan(100);
    expect([...changed].every((ch) => [0x2103, 0x318d, 0x2026].includes(ch.codePointAt(0) as number)), [...changed].join(' ')).toBe(true);
  });
});

// N2(362) — 순위·판매 계열 금지어(불변식 5). 위반 문자열은 런타임 조립.
describe('lintText — 순위·판매 계열 금지어', () => {
  const words = [['랭', '킹'], ['판매', '량'], ['1', '위'], ['BE', 'ST']].map((p) => p.join(''));
  it.each(words)('%s → L01', (w) => {
    expect(lintText(`${w} 쳇바퀴`)).toContainEqual({ rule: 'L01', term: w });
  });
  it('소문자 best(코드 식별자)는 대상 아님', () => {
    expect(lintText('best')).toEqual([]);
  });
});
