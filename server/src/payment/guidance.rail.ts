// Epic 5 안내 모드 결제 레일 — PaymentRail 의 기본 구현(자금 미경유).
//
// 불변식 ②(생존조건): 자금 코드 0. 외부 fetch 0. 키 0. 금액 0. PG 가맹점 0.
//   createCheckoutLink 는 **안내 텍스트만** 반환한다 — 딥링크/URL 을 생성하지 않는다.
//   getStatus 는 항상 { provider: null, mode: '안내' } — 연동 제공자가 없다.
// R4: 사용자가 외부에서 붙이는 안전결제 수단을 서버가 검증·보증하지 않는다(주의의무 미인수).
//   안내 카피는 "환"+"불" 등 자금 처리 약속 단어를 쓰지 않는다(R2). 경고 문구는 프론트 소관.
import type { PaymentRail } from './payment.rail.js';
import type {
  DealContext,
  PaymentGuidance,
  PaymentRailStatus,
} from './payment.types.js';

// 안내 텍스트(고정 카피). URL/딥링크가 아니며 금액·자금 정보를 담지 않는다.
//   외부 안전결제는 사용자가 외부 앱/서비스에서 직접 처리하고, 그 수단을 채팅에 공유한다.
const GUIDANCE_MESSAGE =
  '안전결제는 외부 서비스에서 직접 진행해 주세요. 서버는 자금을 거치지 않으며 거래 이행을 대행하지 않습니다. 문제가 있으면 채팅 내 신고 동선을 이용하세요.';

export class GuidancePaymentRail implements PaymentRail {
  // 안내 텍스트만 반환한다(자금 미경유). deal.matchId 는 사용하지 않아도 계약상 받는다.
  async createCheckoutLink(deal: DealContext): Promise<PaymentGuidance> {
    void deal; // 금액·자금 정보를 다루지 않는다 — matchId 만 받고 안내만 한다.
    return { mode: '안내', message: GUIDANCE_MESSAGE };
  }

  // 연동 제공자가 없으므로 provider 는 항상 null, 모드는 '안내'.
  async getStatus(): Promise<PaymentRailStatus> {
    return { provider: null, mode: '안내' };
  }
}
