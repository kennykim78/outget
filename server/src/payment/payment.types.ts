// Epic 5 거래방식·외부 안전결제 안내 계약 원본 — client 가 이 형태를 미러한다.
//
// 불변식 ②(자금 미보유, 이 에픽의 생존조건): 서버는 자금을 경유/보유/추적하지 않는다.
//   소비자 → 외부 안전결제 → 대행자 직행. 서버는 **안내 텍스트**만 제공한다.
//   금액 필드 0 · PG 가맹점 0 · 잔액 0 · 정산/예치/환불 처리 0.
// DealMethod 는 단순 **라벨**일 뿐 — 이행/완료/정산을 추적하지 않는다.
// R4: 사용자가 붙인 외부 링크를 검증·보증하지 않는다(주의의무 미인수).

// 거래방식 라벨. '직접' = 직접거래, '안전결제' = 외부 안전결제 사용(서버 미경유).
export type DealMethod = '직접' | '안전결제';

// 안내 생성 입력. matchId 만 — **금액 필드 없음**(서버는 금액을 다루지 않는다).
export interface DealContext {
  matchId: string;
}

// 결제 안내. mode 는 항상 '안내'(서버는 안내만 한다). message 는 안내 텍스트.
//   딥링크/URL 이 아니다 — 실제 외부 결제는 사용자가 외부에서 처리한다.
export interface PaymentGuidance {
  mode: '안내';
  message: string;
}

// 결제 레일 상태. provider 는 항상 null(연동 제공자 없음 — 안내 모드).
//   제공자 도입(M1)은 약관 서면확답 이후 guidance.rail → provider.rail 교체로 처리한다.
export interface PaymentRailStatus {
  provider: null;
  mode: '안내';
}
