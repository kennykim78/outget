// Epic6 클라 할인소식 쓰기 계약 — 서버 discount.validation/discount.repo 미러(병렬).
// 서버 트랙이 권위 소스이며 여기는 미러. shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - ①/R1: 입력 DTO 에 photo 외부 절대 URL 을 싣지 않는다(MVP 미전송). 본문 자동수집 0.
//  - ⑤/R3: 입력 DTO 에 좌표(위경도) 필드가 없다. 사용자 등록분은 핀 없이 리스트.
//  - ④/R5: 정가(listPrice) 미입력 시 서버가 unverifiedBase 를 강제 스탬프한다.
//    클라는 unverifiedBase 를 보내지 않는다(서버 권위). 플랫폼 단정가 변수 금지(R5).

import type { DiscountPost } from '../board/board.types';

/**
 * 할인소식 작성 입력(DiscountInput) — 서버 권위 계약 미러.
 * 좌표·unverifiedBase·authorId·createdAt 는 없다(서버가 결정/거부).
 * photo 는 MVP 에서 전송하지 않는다(폼 안내만, 외부 핫링크 차단 ①).
 */
export interface DiscountInput {
  /** 매장·브랜드(필수). */
  storeBrand: string;
  /** 할인율(%) — 선택(할인율 또는 할인가 중 하나 이상). */
  discountRate?: number;
  /** 할인가 — 선택. 사용자 제보가이며 플랫폼 단정가 아님. */
  discountPrice?: number;
  /** 정가 — 선택. 미입력 시 서버가 [기준가 미확인] 라벨을 강제(④). */
  listPrice?: number;
  /** 출처(필수) — 미검증 제보 출처 표기. */
  source: string;
  /**
   * 네이버쇼핑 참고가 조회용 검색어 — 선택. 클라가 보내는 유일한 신규 입력.
   *  - 클라는 검색어만 보내고, 서버가 네이버쇼핑을 조회해 referencePrice/Source/
   *    FetchedAt 를 스탬프한다. 클라는 가격/출처/시각을 절대 보내지 않는다(④/R5).
   *  - 클라는 외부(네이버) 호출 0 — 자사 /api/discounts 에 검색어만 실어 보낸다(①/R1).
   *  - listPrice(사용자 UGC 정가)와 별개 — 섞지 않는다.
   */
  referenceQuery?: string;
  /** 직접 촬영분만 안내. MVP 에서 전송하지 않음(타입엔 두되 미사용). */
  photo?: string;
}

/**
 * 내가 올린 할인소식 응답(GET /api/discounts/me) — 공개 DiscountPost 미러.
 * lat/lng 는 옵셔널(사용자 등록분은 좌표 없음 → 핀 없이 리스트).
 */
export type MyDiscountPost = DiscountPost;
