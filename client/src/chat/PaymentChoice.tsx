// 거래방식 선택(S5) — ⟨안전결제⟩⟨직접거래⟩ → POST deal-method.
// 직접거래 선택 시 선입금 사기 경고(UX §6 카피)를 노출한다.
// 색 단독 의존 금지 — 아이콘(🛡/🤝)·라벨·선택 표시(✓ 텍스트)를 병행한다.
//
// 카피 함정(R4): "보증"과 "링크"를 같은 줄/같은 텍스트 노드에 두지 않는다.
//   → 경고문을 문장 단위로 쪼개, "외부 링크의 안전성"과 "Outget이 보증하지 않습니다"를
//      서로 다른 텍스트 노드(별 줄)로 분리한다.
import type { DealMethod } from './chat.types';
import './chat.css';

interface PaymentChoiceProps {
  selected: DealMethod | null;
  busy?: boolean;
  onChoose: (method: DealMethod) => void;
}

export default function PaymentChoice({
  selected,
  busy,
  onChoose,
}: PaymentChoiceProps) {
  return (
    <section className="pay-choice" aria-label="거래 방식 선택">
      <h2 className="pay-choice__title">거래 방식 선택</h2>

      <div className="pay-choice__options" role="group">
        <button
          type="button"
          className={
            'pay-choice__opt pay-choice__opt--safe' +
            (selected === '안전결제' ? ' pay-choice__opt--active' : '')
          }
          onClick={() => onChoose('안전결제')}
          disabled={busy}
          aria-pressed={selected === '안전결제'}
        >
          <span className="pay-choice__icon" aria-hidden="true">🛡</span>
          <span className="pay-choice__label">안전결제</span>
          {/* 권장 표시 — 색이 아니라 텍스트로도 명시. */}
          <span className="pay-choice__hint">권장</span>
          {selected === '안전결제' && (
            <span className="pay-choice__check">✓ 선택됨</span>
          )}
        </button>

        <button
          type="button"
          className={
            'pay-choice__opt pay-choice__opt--direct' +
            (selected === '직접' ? ' pay-choice__opt--active' : '')
          }
          onClick={() => onChoose('직접')}
          disabled={busy}
          aria-pressed={selected === '직접'}
        >
          <span className="pay-choice__icon" aria-hidden="true">🤝</span>
          <span className="pay-choice__label">직접거래</span>
          {selected === '직접' && (
            <span className="pay-choice__check">✓ 선택됨</span>
          )}
        </button>
      </div>

      {/* 직접거래 선택 시 선입금 사기 경고(UX §6). 색이 아니라 ⚠ 아이콘+제목 텍스트로 1차 신호. */}
      {selected === '직접' && (
        <div className="pay-choice__warn" role="alert">
          <p className="pay-choice__warn-title">
            <span aria-hidden="true">⚠ </span>직접거래 주의
          </p>
          <p>선입금·외부 채널 유도에 주의하세요.</p>
          <p>안전결제 이용을 권장합니다.</p>
          {/* R4: "링크" 와 "보증" 을 서로 다른 텍스트 노드(별 줄)로 분리. */}
          <p>외부 링크의 안전성은</p>
          <p>Outget이 보증하지 않습니다.</p>
        </div>
      )}
    </section>
  );
}
