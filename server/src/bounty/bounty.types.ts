// Epic 8 계약 원본 — client/src/bounty/types.ts 가 이 형태를 미러한다.
// 바운티는 **무금전**(불변식 ②): 미션 수행 보상은 뱃지·평판뿐이고 금액·결제 필드 0.
//   requesterId/solverId 는 내부 식별자이며 응답에는 절대 노출하지 않는다(toPublic).
//
// 불변식 ⑤: 좌표를 받지/저장하지 않는다 — mission/photo 는 텍스트 식별자만.
// 불변식 ①: photo 는 자사 저장 식별자만(외부 절대 http(s) URL 은 검증에서 거부).

export type BountyStatus = '모집' | '완료';

export interface Bounty {
  id: string;
  requesterId: string; // 발주자(JWT sub). 응답에는 절대 노출하지 않는다.
  mission: string; // 확인 미션 텍스트.
  status: BountyStatus;
}

export interface BountySubmission {
  id: string;
  bountyId: string;
  solverId: string; // 제출자(JWT sub). 응답에는 절대 노출하지 않는다.
  photo?: string; // 자사 저장 식별자(선택). 외부 URL 은 검증에서 거부.
  createdAt: string; // ISO 제출 시각.
  badgeAwarded: boolean; // 무금전 보상(뱃지 부여 여부). 금액 아님.
}

// 작성 입력 — requesterId/id/status 는 서버가 부여(클라가 보내지 않는다).
export interface BountyInput {
  mission: string;
}

// 제출 입력 — solverId/id/createdAt/badgeAwarded 는 서버가 부여.
export interface BountySubmissionInput {
  photo?: string;
}
