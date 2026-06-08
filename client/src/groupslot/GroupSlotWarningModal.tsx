// 공동대행 경고 모달(S8) — 개설·참여 전 동의 강제(I2/I3).
// 카피(S8): 대량 구매는 사입(도소매)으로 간주되어 세무 리스크가 있습니다.
//           각 요청은 접수 후 구매하세요(선사입 금지). [이해했어요, 계속]
// 불변식:
//   - 동의("이해했어요, 계속") 전에는 onConfirm 을 절대 호출하지 않는다(액션 차단).
//   - ②/R2: 금액·결제·정산 언급 없음(세무·사입 경고만). 자금 흐름 카피 미사용(R2).
//   - 닫기/취소는 onCancel(액션 미실행).
import './groupslot.css';

interface GroupSlotWarningModalProps {
  /** 모달 표시 여부. */
  open: boolean;
  /** 어떤 동작에 대한 경고인지(헤더 보조 카피). */
  actionLabel?: string;
  /** 동의("이해했어요, 계속") 클릭 시에만 호출 — 그 전엔 액션 실행 금지. */
  onConfirm: () => void;
  /** 취소/닫기 — 액션 미실행. */
  onCancel: () => void;
}

export default function GroupSlotWarningModal({
  open,
  actionLabel,
  onConfirm,
  onCancel,
}: GroupSlotWarningModalProps) {
  if (!open) return null;

  return (
    <div
      className="gs-modal__backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="gs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gs-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gs-modal-title" className="gs-modal__title">
          <span aria-hidden="true">⚠</span> 공동대행 안내
        </h2>

        {actionLabel && (
          <p className="gs-modal__action" role="note">
            {actionLabel} 전에 꼭 확인해 주세요.
          </p>
        )}

        {/* S8 경고 카피 — 사입·세무·선사입 금지. 금액/결제 언급 없음(②). */}
        <p className="gs-modal__body">
          대량 구매는 <b>‘사입(도소매)’</b>으로 간주되어 세무 리스크가 있습니다.
          각 요청은 반드시 <b>‘요청 접수 후 구매’</b>하세요(선사입 금지).
        </p>

        <div className="gs-modal__actions">
          <button
            type="button"
            className="agent-form__btn agent-form__btn--ghost"
            onClick={onCancel}
          >
            취소
          </button>
          <button
            type="button"
            className="agent-form__btn agent-form__btn--primary"
            onClick={onConfirm}
          >
            이해했어요, 계속
          </button>
        </div>
      </div>
    </div>
  );
}
