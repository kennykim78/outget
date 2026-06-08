// Epic 4 계약 원본 — client/src/request/request.types.ts 가 이 형태를 미러한다.
// 구매자 역경매 요청 쓰기/채택/확인가/상태 + 알림에서 다루는 저장/입력 shape.
//
// status: 거래 상태머신 라벨(대기→채택→매칭→진행→종료). Epic4 는 대기→채택 전이만.
// hopePrice·verifiedPrice.price 는 **표시값**일 뿐 — 결제·자금 흐름이 아니다(불변식 ②).
//   서버는 정산·예치·환불을 처리하지 않으며 자금 흐름 필드를 일절 보유하지 않는다.
// 위치는 **동/지역 단위 텍스트(region)** 만 받는다 — 좌표(lat/lng/coords) 필드 없음(불변식 ⑤).

// 확인가(VerifiedPrice): 현장 확인한 가격. 대행자 책임 동반(agentId·verifiedAt).
//   플랫폼 단정가 아님(platformPrice/ourPrice 변수 금지, 불변식 ④/R5).
export interface VerifiedPrice {
  price: number; // 현장 확인가(표시값). 결제 아님.
  agentId: string; // 확인한 대행자(JWT sub) — 책임 귀속.
  verifiedAt: string; // ISO 시각 — 책임 동반.
  note?: string; // 선택 메모(텍스트).
}

export interface StoredRequest {
  id: string;
  ownerUserId: string; // 작성자(JWT sub). 응답에는 절대 노출하지 않는다(toPublicRequest).
  item: string;
  options?: string;
  hopePrice: number; // 희망가(표시값). 결제·자금 흐름 아님.
  deadline: string; // ISO 날짜 문자열.
  region: string; // 동/지역 단위 텍스트(좌표 아님).
  status: '대기' | '채택' | '매칭' | '진행' | '종료';
  verifiedPrice?: VerifiedPrice; // 현장 확인가(대행자 입력) — 선택.
  adoptedBy?: string; // 채택한 대행자(JWT sub) — 선택.
  matchId?: string; // 채택 시 발급된 매칭 식별자 — 선택.
}

// 작성 입력 — ownerUserId/id/status/verifiedPrice 는 서버가 결정(클라가 보내지 않는다).
export interface RequestInput {
  item: string;
  options?: string;
  hopePrice: number;
  deadline: string;
  region: string;
}

// 알림 — 인메모리 레코드. GET /api/notifications 폴링으로 노출(자사 상대경로).
export interface StoredNotification {
  id: string;
  userId: string; // 수신자(JWT sub).
  type: string; // '채택' | '확인가' | '거절' 등.
  refId: string; // 관련 요청 id 등.
  message: string;
  createdAt: string; // ISO 시각.
  read?: boolean;
}
