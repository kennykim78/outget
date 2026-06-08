// 빈 상태(EmptyState) — 가짜 핀/데이터로 채우지 않는다(불변식: 시드 유도만).
// 첫 제보/시드를 유도하는 카피만 보여준다.
import './board.css';

interface EmptyStateProps {
  /** 레이어 맥락 카피(선택). */
  message?: string;
}

export default function EmptyState({
  message = '아직 소식이 없어요. 첫 제보를 남겨주세요!',
}: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-state__title">{message}</p>
      <p className="empty-state__hint">
        등록·제보 기능은 곧 열립니다. 가짜 정보 없이 실제 소식만 보여드려요.
      </p>
    </div>
  );
}
