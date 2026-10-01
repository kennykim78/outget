// 채팅 메시지 계약 — 서버 chat/message.types 미러. 현재 비활성 셸(렌더되지 않음).
// 서버 트랙이 권위 소스이며 여기는 미러. shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - ①: 채팅 호출은 모두 자사 상대경로만.
//    외부 절대 URL(http(s)://...)은 절대 구성/호출하지 않는다(폴링 포함).
//  - ②: 메시지 본문은 텍스트뿐 — 결제·금액·정산·예치 필드 없음.
//    플랫폼은 자금을 보유/추적하지 않는다(④).
//  - 링크 검증/보증 경로 없음(R4): 사용자가 외부에서 받은 링크는 채팅 메시지로
//    붙이는 형태이며, 별도 검증기(verifyLink 류)·보증 UI 를 두지 않는다.

/** 저장된 채팅 메시지(미러). 서버가 id·senderId·createdAt 를 결정한다. */
export interface StoredMessage {
  id: string;
  threadId: string;
  /** 발신자 식별자(서버가 JWT sub 로 강제). 본문에 싣지 않는다. */
  senderId: string;
  /** 메시지 본문 — 텍스트만(결제·금액 필드 없음). */
  body: string;
  /** 생성 시각(ISO 문자열). */
  createdAt: string;
}

/** 메시지 작성 입력 — 본문 텍스트만(②: 금액·결제 필드 없음). */
export interface MessageInput {
  body: string;
}
