// 공동대행 슬롯 개설 폼(S8) — 일정·지역·정원. 경고 모달 동의 후에만 POST(I2).
// 불변식:
//   - I2: 제출 시 경고 모달을 먼저 띄우고, "이해했어요, 계속" 동의 후에만 create 호출.
//   - ②/R2: 금액·대금·결제 입력란 없음(정원=자리 수).
//   - ⑤/R3: 좌표 입력란 없음(region 은 텍스트).
//   - ③: 통신판매중개 고지(IntermediaryNotice) 상시.
import { useState } from 'react';
import type { GroupSlotInput } from './groupslot.types';
import { useGroupSlotActions } from './useGroupSlotActions';
import GroupSlotWarningModal from './GroupSlotWarningModal';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import '../agent/agent.css';
import './groupslot.css';

interface GroupSlotFormProps {
  /** 개설 성공 후 콜백. */
  onSaved?: () => void;
  /** 취소/뒤로. */
  onCancel?: () => void;
}

interface FormState {
  scheduleText: string;
  region: string;
  capacity: string;
}

const EMPTY_FORM: FormState = { scheduleText: '', region: '', capacity: '' };

export default function GroupSlotForm({ onSaved, onCancel }: GroupSlotFormProps) {
  const { busy, error, create } = useGroupSlotActions();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 경고 모달 표시 여부 — 검증 통과 후 띄운다(동의 전 create 미호출 I2).
  const [warnOpen, setWarnOpen] = useState(false);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  // 입력 검증만 수행 — 통과 시 경고 모달을 띄운다(아직 전송 안 함).
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!form.scheduleText.trim()) {
      setSubmitError('출동 일정을 적어 주세요(예: 토 여주 출동).');
      return;
    }
    if (!form.region.trim()) {
      setSubmitError('활동지역을 적어 주세요(동/지역 텍스트).');
      return;
    }
    const cap = Number(form.capacity);
    if (!form.capacity.trim() || Number.isNaN(cap) || cap < 1) {
      setSubmitError('모집 정원은 1 이상 숫자로 적어 주세요.');
      return;
    }

    // 검증 통과 → 경고 모달 표시. 동의 전엔 create 미호출(I2).
    setWarnOpen(true);
  };

  // 모달 동의 후에만 실제 전송(I2).
  const handleConfirm = async () => {
    setWarnOpen(false);
    const payload: GroupSlotInput = {
      scheduleText: form.scheduleText.trim(),
      region: form.region.trim(),
      capacity: Number(form.capacity),
    };
    try {
      await create(payload);
      onSaved?.();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : '개설에 실패했습니다.',
      );
    }
  };

  return (
    <>
      <form
        className="agent-form"
        onSubmit={handleSubmit}
        aria-label="공동대행 슬롯 개설"
      >
        <h2 className="agent-form__heading">공동대행 슬롯 개설</h2>

        <label className="agent-form__field">
          <span className="agent-form__label">출동 일정</span>
          <input
            className="agent-form__input"
            type="text"
            value={form.scheduleText}
            onChange={(e) => patch({ scheduleText: e.target.value })}
            placeholder="예: 토 여주 출동"
            required
          />
        </label>

        <label className="agent-form__field">
          <span className="agent-form__label">활동지역</span>
          <input
            className="agent-form__input"
            type="text"
            value={form.region}
            onChange={(e) => patch({ region: e.target.value })}
            placeholder="예: 여주 프리미엄아울렛"
            required
          />
          <span className="agent-form__hint">
            동/지역 텍스트만 적어 주세요(좌표 아님).
          </span>
        </label>

        <label className="agent-form__field">
          <span className="agent-form__label">모집 정원 (자리)</span>
          <input
            className="agent-form__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={form.capacity}
            onChange={(e) => patch({ capacity: e.target.value })}
            placeholder="예: 5"
            required
          />
          <span className="agent-form__hint">함께 갈 인원 수(금액 아님).</span>
        </label>

        {/* ③ 통신판매중개 고지 상시. */}
        <IntermediaryNotice />

        {submitError && (
          <p className="agent-form__error" role="alert">
            {submitError}
          </p>
        )}
        {error && !submitError && (
          <p className="agent-form__error" role="alert">
            {error}
          </p>
        )}

        <div className="agent-form__actions">
          {onCancel && (
            <button
              type="button"
              className="agent-form__btn agent-form__btn--ghost"
              onClick={onCancel}
            >
              취소
            </button>
          )}
          <button
            type="submit"
            className="agent-form__btn agent-form__btn--primary"
            disabled={busy}
          >
            {busy ? '개설 중…' : '슬롯 개설'}
          </button>
        </div>
      </form>

      {/* I2: 동의 전 create 미호출 — 모달이 게이트. */}
      <GroupSlotWarningModal
        open={warnOpen}
        actionLabel="공동대행 슬롯 개설"
        onConfirm={handleConfirm}
        onCancel={() => setWarnOpen(false)}
      />
    </>
  );
}
