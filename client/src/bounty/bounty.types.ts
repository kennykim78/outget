// Epic8 클라 바운티 계약 — 서버 bounty.types/validation 미러(병렬).
// 서버 트랙이 권위 소스이며 여기는 미러. shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - ②/R2: 바운티는 무금전이다. 금액·대금·정산·결제 필드가 DTO 에 없다.
//    보상은 뱃지/평판뿐(서버가 지급). 클라는 금액 토큰을 어디에도 두지 않는다.
//  - ①/R1: photo 외부 절대 URL 자동수집 0. 제출 본문은 식별자뿐(MVP 사진 미전송).
//  - ⑤/R3: 좌표(위경도) 필드 없음.

/** 바운티 상태(미러). 서버 권위 — 표시용. */
export type BountyStatus = '모집' | '완료';

/** 현장확인 미션(S7). 금액 필드 없음(무금전 ②). */
export interface Bounty {
  id: string;
  /** 미션 내용(예: "여주 나이키 270 재고 사진 부탁"). */
  mission: string;
  status: BountyStatus;
}

/** 바운티 제출 응답(미러) — 보상은 뱃지/평판뿐. 금액 0. */
export interface BountySubmission {
  id: string;
  bountyId: string;
  /** 서버가 지급한 뱃지 식별자(예: '확인러'). 금전 아님. */
  badgeAwarded?: string;
}

/**
 * 바운티 작성 입력(BountyInput) — 미션 텍스트뿐.
 * 금액·결제·좌표 필드 없음(②/⑤). 보상은 서버가 뱃지/평판으로 지급.
 */
export interface BountyInput {
  /** 현장확인 미션 내용(필수). */
  mission: string;
}
