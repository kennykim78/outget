// 안전결제 안내(S5) — 안전결제 선택 시 GET payment-guidance 안내 텍스트를 표시한다.
// 링크 검증/보증 UI 0: verifyLink 류 호출·외부 링크 검사기·보증 배지를 두지 않는다.
//   사용자가 외부에서 받은 결제 링크는 별도 검증 경로 없이 채팅 메시지로 붙이는 형태다.
// 안내 텍스트는 React 보간으로만 출력(XSS 방어). 자금 경로 아님(②: mode='안내').
import type { PaymentGuidance } from './chat.types';
import './chat.css';

interface SafePaymentGuidanceProps {
  guidance: PaymentGuidance | null;
}

export default function SafePaymentGuidance({ guidance }: SafePaymentGuidanceProps) {
  if (!guidance) return null;

  return (
    <section className="pay-guide" aria-label="안전결제 안내">
      <p className="pay-guide__title">
        <span aria-hidden="true">🛡 </span>안전결제 안내
      </p>
      {/* 서버 안내 텍스트 — 텍스트 노드로만 출력(외부 본문 수집·딥링크 없음). */}
      <p className="pay-guide__msg">{guidance.message}</p>
      {/* 링크 검증기·보증 UI 없음. 안내·권장만(R4). */}
      <p className="pay-guide__note">
        외부에서 받은 결제 안내는 채팅으로 직접 확인하세요.
      </p>
    </section>
  );
}
