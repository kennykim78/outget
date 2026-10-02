// 빈 상태(EmptyState) — 가짜 데이터로 채우지 않는다. 문구는 호출부가 넘긴다(카피 단일 소스 @ws/copy, D3).
//   F0: board/ 에서 이동만(구 board.css 의존 제거). 시각 규칙은 F3 styles/app.css.
interface EmptyStateProps {
  /** 제목 문구(필수 — 기본 카피를 이 파일에 두지 않는다). */
  message: string;
  /** 보조 문구(선택). */
  hint?: string;
}

export default function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-state__title">{message}</p>
      {hint ? <p className="empty-state__hint">{hint}</p> : null}
    </div>
  );
}
