// 할인소식 작성 액션 훅 — 신규 라이브러리 0(라우터/React Query 금지).
// 불변식:
//   - ①/R1: 자사 상대경로(`/api/discounts`)만 호출한다. 외부 절대 URL 0.
//     photo 등 외부 본문/이미지 자동수집 경로 없음(MVP 미전송).
//   - ⑤/R3: 어떤 본문에도 위치 좌표를 싣지 않는다(DTO 에 좌표 필드 자체가 없음).
//   - ④/R5: unverifiedBase 는 서버가 강제한다 — 클라가 보내지 않는다.
//     플랫폼 단정가(platform/our/official 류) 변수는 두지 않는다.
import { useState } from 'react';
import { apiFetch } from '../auth/apiFetch';
import type {
  DiscountInput,
  MyDiscountPost,
  ShoppingCandidate,
} from './discount.types';

// 자사 API 상대 경로(절대 URL 금지). 인증 헤더는 apiFetch 가 부착한다.
const DISCOUNTS_PATH = '/api/discounts';
// 네이버쇼핑 검색은 자사 API 만 호출한다 — 외부(네이버) 직접 호출 0(①/R1).
const SHOPPING_SEARCH_PATH = '/api/shopping/search';

export interface UseDiscountActionsResult {
  busy: boolean;
  error: string | null;
  /**
   * 네이버쇼핑 상품 검색(GET /api/shopping/search). 자사 API 만 호출(외부 호출 0, ①).
   * 결과는 표시 전용 후보 목록 — 가격은 서버가 등록 시 재조회로 확정한다(④).
   * 실패/미인증 등은 빈 배열로 graceful(폼이 깨지지 않게).
   */
  searchProducts: (query: string) => Promise<ShoppingCandidate[]>;
  /**
   * 새 할인소식 등록(POST /api/discounts). 본문은 폼 DTO 뿐 — 좌표 0, photo 미전송.
   * unverifiedBase·참고가(가격/출처/시각)는 서버가 강제/스탬프하므로 보내지 않는다.
   * 클라가 보내는 참고가 입력은 referenceQuery + referenceProductId 둘뿐(가격 0).
   */
  create: (input: DiscountInput) => Promise<MyDiscountPost>;
}

export function useDiscountActions(): UseDiscountActionsResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 자사 검색 API 호출 — 외부(네이버) 직접 호출 0(①). 결과는 표시 전용.
  // 가격은 등록 시 서버가 재조회로 재확정하므로 후보 lprice 는 화면 표시일 뿐(④).
  const searchProducts = async (
    query: string,
  ): Promise<ShoppingCandidate[]> => {
    const q = query.trim();
    if (!q) return [];
    const url = `${SHOPPING_SEARCH_PATH}?query=${encodeURIComponent(q)}`;
    try {
      const res = await apiFetch(url, { method: 'GET' });
      if (!res.ok) return [];
      const data = (await res.json()) as ShoppingCandidate[];
      return Array.isArray(data) ? data : [];
    } catch {
      // graceful — 검색 실패가 등록 흐름을 막지 않는다(참고가 없이 등록 가능).
      return [];
    }
  };

  const create = async (input: DiscountInput): Promise<MyDiscountPost> => {
    setBusy(true);
    setError(null);

    // 전송 본문 구성 — photo 는 MVP 에서 전송하지 않는다(외부 핫링크 차단 ①).
    // 좌표 키는 애초에 DTO 에 없다(⑤). unverifiedBase 는 서버 권위(④).
    // 참고가 입력은 referenceQuery + referenceProductId 둘뿐 — 서버가 네이버쇼핑을
    // 재조회해 대표가/온라인최저가를 스탬프한다. 클라는 가격/출처/시각을 절대 보내지
    // 않고 외부 호출도 0(①/④).
    const body: DiscountInput = {
      storeBrand: input.storeBrand,
      source: input.source,
      ...(input.discountRate != null ? { discountRate: input.discountRate } : {}),
      ...(input.discountPrice != null
        ? { discountPrice: input.discountPrice }
        : {}),
      ...(input.listPrice != null ? { listPrice: input.listPrice } : {}),
      ...(input.referenceQuery ? { referenceQuery: input.referenceQuery } : {}),
      ...(input.referenceProductId
        ? { referenceProductId: input.referenceProductId }
        : {}),
    };

    try {
      const res = await apiFetch(DISCOUNTS_PATH, {
        method: 'POST',
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

  return { busy, error, searchProducts, create };
}
