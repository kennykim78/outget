// Epic 4 클라 역경매 요청 계약 — 서버 request.types.ts 미러(병렬 진행).
// 서버 트랙이 권위 소스이며 여기는 미러. shape 변경 시 양쪽 동기.
//
// 불변식 메모:
//  - ⑤/R3: 요청에는 위경도(좌표) 필드가 없다. 위치는 region(동/지역 텍스트)뿐.
//    폼 DTO·전송 본문 어디에도 좌표 토큰을 두지 않는다.
//  - ②: hopePrice·verifiedPrice.price 는 "표시 금액"일 뿐 결제/정산/예치 흐름이 아니다.
//    balance/escrow/payout/refund 류 자금 흐름 키는 두지 않는다.
//  - ④: verifiedPrice 는 항상 agentId·verifiedAt(대행자 책임) 동반. 플랫폼 단정가 아님.
//    platformPrice/ourPrice/officialPrice 류 변수는 금지(R5).

/** 요청 진행 상태. */
export type RequestStatus = '대기' | '채택' | '매칭' | '진행' | '종료';

/**
 * 확인가(VerifiedPrice) — 대행자가 현장에서 제시한 금액(미러).
 * 대행자 책임 표기를 위해 agentId·verifiedAt 를 항상 동반한다(④).
 * 플랫폼이 단정한 가격이 아니다(R5 — platform/our/official 류 변수 금지).
 */
export interface VerifiedPrice {
  /** 대행자가 제시한 확인 금액(표시값 — 플랫폼 단정가 아님). */
  price: number;
  /** 제시한 대행자 식별자(책임 주체). */
  agentId: string;
  /** 확인 시각(ISO 문자열). */
  verifiedAt: string;
  /** 대행자 메모(선택). */
  note?: string;
}

/**
 * 저장된 역경매 요청(미러). 서버가 id·status·verifiedPrice 를 결정한다.
 * ownerUserId 는 응답에서 제외된다(여기 타입에도 없음). 좌표 필드 없음(⑤/R3).
 */
export interface StoredRequest {
  id: string;
  item: string;
  options?: string;
  /** 희망가(대행료 포함). 표시 전용 — 플랫폼 산정가가 아님. */
  hopePrice: number;
  deadline: string;
  region: string;
  status: RequestStatus;
  /** 대행자 제시 확인가(있을 때만). */
  verifiedPrice?: VerifiedPrice;
}

/**
 * 요청 작성 폼 입력(RequestInput). status·verifiedPrice·owner 는 서버가 결정한다.
 * 좌표 필드 없음(⑤/R3) — region 텍스트로만 위치를 표현한다.
 */
export interface RequestInput {
  item: string;
  options?: string;
  hopePrice: number;
  deadline: string;
  region: string;
}

/** 인앱 알림(미러). 외부 푸시 아님 — 자사 /api 폴링으로 읽는다(①). */
export interface Notification {
  id: string;
  type: string;
  /** 참조 대상 식별자(예: requestId). */
  refId: string;
  message: string;
  createdAt: string;
  read?: boolean;
}
