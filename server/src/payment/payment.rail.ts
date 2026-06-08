// Epic 5 결제 레일 포트(추상화). PRD §9-1: 제공자 추상화 — 약관 서면확답 전까지 교체 가능.
//
// 자금 미경유 계약(불변식 ②, 이 에픽의 생존조건):
//   이 포트의 어떤 구현도 자금을 경유/보유/이동시키지 않는다. 서버 명의 계좌·PG 가맹점·
//   잔액·정산·예치·환불을 다루지 않는다. 소비자 → 외부 안전결제 → 대행자 직행이며,
//   서버는 **안내**(텍스트)만 제공한다.
//   createCheckoutLink 는 결제 링크를 "생성·보증"하지 않는다 — 안내 텍스트만 반환한다.
//   getStatus 는 연동 제공자 상태가 아니라 항상 '안내' 모드(provider:null)를 보고한다.
//   제공자 도입(M1)은 약관 서면확답 이후 guidance.rail → provider.rail 교체로 처리한다.
import type { DealContext, PaymentGuidance, PaymentRailStatus } from './payment.types.js';

export interface PaymentRail {
  // 안내 텍스트 생성. 금액을 받지 않으며(DealContext 에 금액 없음), URL/딥링크가 아니다.
  createCheckoutLink(deal: DealContext): Promise<PaymentGuidance>;
  // 레일 상태 — 안내 모드(provider:null). 외부 상태 조회·자금 조회가 아니다.
  getStatus(): Promise<PaymentRailStatus>;
}
