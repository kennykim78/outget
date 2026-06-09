// 컴플라이언스 UI 회귀 잠금(불변식 ④/R5, ③). build 갈음 → 자동 테스트로 고정.
// 검증 대상:
//   1) 음수 할인율 가드 — 제보가 >= 참고가면 "참고가 대비 N% 저렴"·음수% 렌더 금지.
//      제보가 < 참고가 & 양수면 "참고가 대비 N% 저렴" 렌더.
//   2) 면책 강제 — 참고가 존재 시 면책 3요소(동일 상품 보증 아님·시세 변동·출처) 항상 렌더.
//   3) 미검증 칩 — "미검증 제보" 칩 텍스트로 단정(색 단독 의존 아님).
//   4) 기준가 미확인 — 참고가/정가 없으면 `[기준가 미확인·사용자 제보가]` 라벨 렌더.
// 외부 출처 0(불변식 ①): 폰트/네트워크 없이 로컬 jsdom 렌더만 검증.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiscountPost from './DiscountPost';
import IntermediaryNotice from './IntermediaryNotice';
import type { DiscountPost as DiscountPostData } from '../board.types';

// board.types.ts 의 DiscountPost props 계약 기준 베이스 픽스처. 필요한 필드만 케이스별 override.
function makePost(overrides: Partial<DiscountPostData> = {}): DiscountPostData {
  return {
    id: 'd1',
    storeBrand: '나이키 여주점',
    unverifiedBase: false,
    source: '현장 제보',
    createdAt: '2026-06-09',
    ...overrides,
  };
}

describe('DiscountPost — 컴플라이언스 회귀 잠금', () => {
  describe('1) 음수 할인율 가드', () => {
    it('제보가가 참고가보다 비싸면(음수%) "참고가 대비" 문구·할인율을 렌더하지 않는다', () => {
      // referenceBasePrice(50,000) < discountPrice(60,000) → 가짜 할인율 금지.
      render(
        <DiscountPost
          post={makePost({
            referenceBasePrice: 50000,
            discountPrice: 60000,
            referenceSource: '네이버쇼핑',
          })}
        />,
      );
      expect(screen.queryByText(/참고가 대비/)).not.toBeInTheDocument();
      // 음수 퍼센트 토큰이 어디에도 노출되면 안 된다.
      expect(screen.queryByText(/-\d+%/)).not.toBeInTheDocument();
    });

    it('제보가가 참고가보다 싸고 양수면 "참고가 대비 N% 저렴"을 렌더한다', () => {
      // referenceBasePrice(100,000), discountPrice(70,000) → 30% 저렴.
      render(
        <DiscountPost
          post={makePost({
            referenceBasePrice: 100000,
            discountPrice: 70000,
            referenceSource: '네이버쇼핑',
          })}
        />,
      );
      expect(screen.getByText(/참고가 대비 30% 저렴/)).toBeInTheDocument();
    });
  });

  describe('2) 면책 강제', () => {
    it('참고가가 있으면 면책 문구(동일 상품 보증 아님·시세 변동·출처)를 항상 렌더한다', () => {
      render(
        <DiscountPost
          post={makePost({
            referenceBasePrice: 100000,
            discountPrice: 70000,
            referenceSource: '네이버쇼핑',
            referenceQuery: '나이키 운동화',
            referenceFetchedAt: '2026-06-09T00:00:00.000Z',
          })}
        />,
      );
      const note = screen.getByRole('note');
      expect(note).toHaveTextContent(/동일 상품 보증 아님/);
      expect(note).toHaveTextContent(/시세 변동/);
      expect(note).toHaveTextContent(/네이버쇼핑/);
    });
  });

  describe('3) 미검증 칩', () => {
    it('"미검증 제보" 칩을 텍스트로 단정 렌더한다(색 단독 의존 아님)', () => {
      render(<DiscountPost post={makePost()} />);
      // aria-label + 본문 텍스트 양쪽으로 노출.
      expect(screen.getByLabelText('미검증 제보')).toBeInTheDocument();
      expect(screen.getByText(/미검증 제보/)).toBeInTheDocument();
    });
  });

  describe('4) 기준가 미확인', () => {
    it('참고가/정가가 모두 없으면 `[기준가 미확인·사용자 제보가]` 라벨을 렌더한다', () => {
      render(
        <DiscountPost
          post={makePost({ unverifiedBase: true, discountRate: 40 })}
        />,
      );
      expect(
        screen.getByText('[기준가 미확인·사용자 제보가]'),
      ).toBeInTheDocument();
    });

    it('참고가가 있으면 기준가 미확인 라벨 대신 참고가 비교를 보여준다', () => {
      render(
        <DiscountPost
          post={makePost({
            referenceBasePrice: 100000,
            discountPrice: 70000,
            referenceSource: '네이버쇼핑',
          })}
        />,
      );
      expect(
        screen.queryByText('[기준가 미확인·사용자 제보가]'),
      ).not.toBeInTheDocument();
    });
  });
});

describe('IntermediaryNotice — 통신판매중개 고지(③)', () => {
  it('중개자·거래 당사자 아님 고지를 렌더한다', () => {
    render(<IntermediaryNotice />);
    expect(
      screen.getByText(/통신판매중개자이며 거래 당사자가 아닙니다/),
    ).toBeInTheDocument();
  });
});
