// 통신판매중개 고지(③) — 보드/카드에 상시 노출.
// Outget 은 거래 당사자가 아니라 중개자임을 명시(법적 불변식).
import '../board.css';

interface IntermediaryNoticeProps {
  /** 카드 내부 인라인용 컴팩트 모드. */
  compact?: boolean;
}

export default function IntermediaryNotice({
  compact = false,
}: IntermediaryNoticeProps) {
  return (
    <p
      className={
        'intermediary-notice' +
        (compact ? ' intermediary-notice--compact' : '')
      }
      role="note"
    >
      Outget은 통신판매중개자이며 거래 당사자가 아닙니다.
    </p>
  );
}
