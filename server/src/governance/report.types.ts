// Epic 7 신고(Report) 계약 원본 — client governance 미러.
// notice-and-takedown: 신고 즉시 임시조치(블라인드) → 이의/복구/삭제 상태머신(불변식 ③).
//
// 불변식 ②: 신고에 금액·자금 흐름 필드를 두지 않는다(거버넌스 메타데이터일 뿐).
// 불변식 ⑤: 신고에 좌표(위경도) 필드를 두지 않는다 — 위치 토큰 0.
// 증거 보존: 신고/블라인드 레코드는 삭제 메서드를 제공하지 않는다(분쟁 동선 보전).

export type ReportTargetType = 'message' | 'profile';

export type ReportStatus = '정상' | '블라인드' | '이의' | '복구' | '삭제';

// 저장된 신고 레코드. reporterId 는 서버가 JWT sub 로 강제(클라가 보내지 못한다).
export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string; // 신고 사유(텍스트).
  status: ReportStatus; // 생성 즉시 '블라인드'(임시조치).
  reporterId: string; // 신고자(JWT sub) — 책임 귀속.
  createdAt: string; // ISO 시각.
}

// 작성 입력 — id/status/reporterId/createdAt 은 서버가 결정(클라가 보내지 않는다).
export interface ReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
}
