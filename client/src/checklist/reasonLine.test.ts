import { describe, expect, it } from 'vitest';
import { firstSentence } from './reasonLine';

describe('firstSentence(D9 ① 기계적 절단)', () => {
  it('첫 문장만, 원문 글자 그대로', () => {
    expect(firstSentence('바닥을 넓게 쓰는 동물이에요. 두 번째 문장이에요.')).toBe('바닥을 넓게 쓰는 동물이에요.');
    expect(firstSentence('항상 신선한 물이 있어야 해요.')).toBe('항상 신선한 물이 있어야 해요.');
  });

  it('소수점은 문장 끝이 아니다', () => {
    expect(firstSentence('가로를 몸길이의 2.5배 이상으로 정해요. 다음 문장.')).toBe('가로를 몸길이의 2.5배 이상으로 정해요.');
  });

  it('문장 끝이 없으면 전체, 빈 값은 null', () => {
    expect(firstSentence('w')).toBe('w');
    expect(firstSentence('  ')).toBeNull();
    expect(firstSentence(null)).toBeNull();
  });
});
