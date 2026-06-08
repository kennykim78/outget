// 지위 선택 세그먼트(UX-DR5) — 개인(비사업자) / 전문(사업자 인증).
// 색 단독 의존 금지: 라벨 텍스트 + aria-checked(라디오 시맨틱)로 1차 신호 전달.
import type { AgentStatus } from './agent.types';
import './agent.css';

interface StatusSelectProps {
  value: AgentStatus;
  onChange: (status: AgentStatus) => void;
}

const OPTIONS: { value: AgentStatus; label: string; hint: string }[] = [
  { value: '개인', label: '개인', hint: '비사업자' },
  { value: '전문', label: '전문', hint: '사업자 인증' },
];

export default function StatusSelect({ value, onChange }: StatusSelectProps) {
  return (
    <fieldset className="agent-status" role="radiogroup" aria-label="대행자 지위">
      <legend className="agent-form__label">지위</legend>
      <div className="agent-status__seg">
        {OPTIONS.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={
                'agent-status__btn' +
                (selected ? ' agent-status__btn--active' : '')
              }
              onClick={() => onChange(opt.value)}
            >
              <span className="agent-status__title">{opt.label}</span>
              <span className="agent-status__hint">{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
