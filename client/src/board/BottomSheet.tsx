// 바텀시트(S1): 핀 클릭 시 해당 항목 카드를 하단에서 띄운다.
// 레이어별 카드 + 통신판매중개 고지(compact) 상시.
import type { ReactNode } from 'react';
import './board.css';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: BottomSheetProps) {
  if (!open) return null;
  return (
    <div className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title ?? '상세'}>
      <button
        type="button"
        className="bottom-sheet__scrim"
        aria-label="닫기"
        onClick={onClose}
      />
      <div className="bottom-sheet__panel">
        <div className="bottom-sheet__grip" aria-hidden="true" />
        <button
          type="button"
          className="bottom-sheet__close"
          aria-label="닫기"
          onClick={onClose}
        >
          ✕
        </button>
        <div className="bottom-sheet__body">{children}</div>
      </div>
    </div>
  );
}
