// 개인(비사업자) 선택 시 상시 고지(③) — 폼·카드 양쪽에서 재사용.
// 색 단독 의존 금지: 경고 아이콘(주의) + 텍스트 병행, role="note".
import './agent.css';

interface PersonalNoticeProps {
  /** 카드 내부 인라인용 컴팩트 모드. */
  compact?: boolean;
}

export default function PersonalNotice({ compact = false }: PersonalNoticeProps) {
  return (
    <p
      className={'personal-notice' + (compact ? ' personal-notice--compact' : '')}
      role="note"
    >
      <span className="personal-notice__icon" aria-hidden="true">
        주의
      </span>
      <span>
        지속·반복적인 영리 대행 시 사업자 등록 의무가 발생할 수 있습니다.
      </span>
    </p>
  );
}
