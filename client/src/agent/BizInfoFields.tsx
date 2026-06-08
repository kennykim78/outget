// 전문(사업자) 추가 입력(③ 의뢰자정보) — 상호·사업자번호·연락처·증빙 식별자.
// 사업자번호 형식 안내 XXX-XX-XXXXX(형식만; 외부 진위 API 호출 0 — Epic3 밖).
// 증빙은 파일 업로드가 아니라 "식별자 텍스트"(placeholder) — 외부 수집 없음.
import type { AgentProfileInput } from './agent.types';
import './agent.css';

interface BizInfoFieldsProps {
  value: Pick<AgentProfileInput, 'bizName' | 'bizNo' | 'contact' | 'bizDocRef'>;
  onChange: (
    patch: Partial<
      Pick<AgentProfileInput, 'bizName' | 'bizNo' | 'contact' | 'bizDocRef'>
    >,
  ) => void;
  /** 사업자번호 형식 오류 표시(부모가 검증). */
  bizNoError?: string | null;
}

export default function BizInfoFields({
  value,
  onChange,
  bizNoError,
}: BizInfoFieldsProps) {
  return (
    <div className="agent-biz" role="group" aria-label="사업자 정보">
      <label className="agent-form__field">
        <span className="agent-form__label">상호</span>
        <input
          className="agent-form__input"
          type="text"
          value={value.bizName ?? ''}
          onChange={(e) => onChange({ bizName: e.target.value })}
          placeholder="예: 아웃겟무역"
          autoComplete="organization"
        />
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">사업자번호</span>
        <input
          className="agent-form__input"
          type="text"
          inputMode="numeric"
          value={value.bizNo ?? ''}
          onChange={(e) => onChange({ bizNo: e.target.value })}
          placeholder="XXX-XX-XXXXX"
          aria-describedby="bizno-hint"
          aria-invalid={bizNoError ? true : undefined}
        />
        <span id="bizno-hint" className="agent-form__hint">
          형식: XXX-XX-XXXXX (숫자 10자리)
        </span>
        {bizNoError && (
          <span className="agent-form__error" role="alert">
            {bizNoError}
          </span>
        )}
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">연락처</span>
        <input
          className="agent-form__input"
          type="text"
          value={value.contact ?? ''}
          onChange={(e) => onChange({ contact: e.target.value })}
          placeholder="채팅·연락 식별(전화/메신저 ID 등)"
          autoComplete="tel"
        />
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">증빙 식별자</span>
        <input
          className="agent-form__input"
          type="text"
          value={value.bizDocRef ?? ''}
          onChange={(e) => onChange({ bizDocRef: e.target.value })}
          placeholder="증빙 참조값(접수번호 등) — 파일 업로드 아님"
        />
        <span className="agent-form__hint">
          파일 업로드가 아니라 증빙 참조 식별자만 입력합니다.
        </span>
      </label>
    </div>
  );
}
