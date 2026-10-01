// 알림 레코드 — GET /api/notifications 폴링으로 노출(자사 상대경로).
//   (R1: 삭제된 request/request.types.ts 에서 그대로 이전.)
export interface StoredNotification {
  id: string;
  userId: string; // 수신자(JWT sub).
  type: string; // '블라인드' | '이의' | '복구' | '삭제' 등.
  refId: string; // 관련 레코드 id(신고 id 등).
  message: string;
  createdAt: string; // ISO 시각.
  read?: boolean;
}
