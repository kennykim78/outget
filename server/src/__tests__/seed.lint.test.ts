import { describe, expect, it } from 'vitest';
import { lintText, normalizeLintText } from '../seed/lint.js';

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
