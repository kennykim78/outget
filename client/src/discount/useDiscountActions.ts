// 할인소식 작성 액션 훅 — 신규 라이브러리 0(라우터/React Query 금지).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/discounts`)만 호출한다. 외부 절대 URL 0.
//     photo 등 외부 본문/이미지 자동수집 경로 없음(MVP 미전송).
//   - ⑤/R3: 어떤 본문에도 위치 좌표를 싣지 않는다(DTO 에 좌표 필드 자체가 없음).
//   - ④/R5: unverifiedBase 는 서버가 강제한다 — 클라가 보내지 않는다.
//     플랫폼 단정가(platform/our/official 류) 변수는 두지 않는다.
import { useState } from 'react';
import type { DiscountInput, MyDiscountPost } from './discount.types';

// 자사 API 상대 경로(절대 URL 금지).
const DISCOUNTS_PATH = '/api/discounts';

const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

export interface UseDiscountActionsResult {
  busy: boolean;
  error: string | null;
  /**
   * 새 할인소식 등록(POST /api/discounts). 본문은 폼 DTO 뿐 — 좌표 0, photo 미전송.
   * unverifiedBase 는 서버가 강제하므로 보내지 않는다.
   */
  create: (input: DiscountInput) => Promise<MyDiscountPost>;
}

export function useDiscountActions(): UseDiscountActionsResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (input: DiscountInput): Promise<MyDiscountPost> => {
    setBusy(true);
    setError(null);

    // 전송 본문 구성 — photo 는 MVP 에서 전송하지 않는다(외부 핫링크 차단 ①).
    // 좌표 키는 애초에 DTO 에 없다(⑤). unverifiedBase 는 서버 권위(④).
    const body: DiscountInput = {
      storeBrand: input.storeBrand,
      source: input.source,
      ...(input.discountRate != null ? { discountRate: input.discountRate } : {}),
      ...(input.discountPrice != null
        ? { discountPrice: input.discountPrice }
        : {}),
      ...(input.listPrice != null ? { listPrice: input.listPrice } : {}),
    };

    try {
      const res = await fetch(DISCOUNTS_PATH, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        throw new Error('로그인 후 할인소식을 올릴 수 있어요.');
      }
      if (res.status === 403) {
        throw new Error('구매자 계정은 할인소식을 올릴 수 없어요.');
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as MyDiscountPost;
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : '할인소식 등록에 실패했습니다.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, create };
}
