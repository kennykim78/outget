// Epic 5 인앱 채팅 계약 원본 — client/src/chat/chat.types.ts 가 이 형태를 미러한다.
// 채팅은 증빙·고지·신고 동선의 허브다. 본문은 **텍스트만**.
//
// 불변식 ②(자금 미보유): 메시지에 금액·결제·자금 흐름 필드를 두지 않는다.
//   채팅으로 안전결제 링크를 사용자가 붙일 수는 있으나, 서버는 자금을 경유/추적하지 않으며
//   링크를 검증/보증하지 않는다(주의의무 미인수).
// 불변식 ⑤: 메시지에 좌표(위경도) 필드를 두지 않는다 — 위치 토큰 0.
// 증거 보존: 메시지 삭제 메서드는 제공하지 않는다(신고/분쟁 동선 보전).

// 저장된 메시지 — senderId 는 서버가 JWT sub 로 강제(클라가 보내지 못한다).
export interface StoredMessage {
  id: string;
  threadId: string; // Match.chatThreadId.
  senderId: string; // 발신자(JWT sub) — 서버 강제.
  body: string; // 본문 텍스트(상한 2000자).
  createdAt: string; // ISO 시각.
}

// 작성 입력 — body 만. senderId/threadId/id/createdAt 는 서버가 결정한다.
export interface MessageInput {
  body: string;
}
