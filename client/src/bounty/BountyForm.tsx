// 바운티 작성 폼(S7): 현장확인 미션 텍스트만. 보상은 뱃지+평판(금전 아님 ②).
// 불변식:
//   - ②/R2: 금액·대금·정산·결제 입력란 없음. 보상 안내는 "금전 아님" 명시.
//   - ⑤/R3: 좌표 입력란 없음.
//   - ③: 통신판매중개 고지(IntermediaryNotice) 상시.
//   - ①: 사진은 직접 촬영분만(MVP 미전송) — 제출 시 안내.
import { useState } from 'react';
import type { BountyInput } from './bounty.types';
import { useBountyActions } from './useBountyActions';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import '../agent/agent.css';
import './bounty.css';

interface BountyFormProps {
  /** 저장 성공 후 콜백. */
  onSaved?: () => void;
  /** 취소/뒤로. */
  onCancel?: () => void;
}

export default function BountyForm({ onSaved, onCancel }: BountyFormProps) {
  const { busy, error, create } = useBountyActions();
  const [mission, setMission] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!mission.trim()) {
      setSubmitError('어떤 현장 확인이 필요한지 적어 주세요.');
      return;
    }

    // 금액·좌표·결제 키 없음(②/⑤). 미션 텍스트뿐.
    const payload: BountyInput = { mission: mission.trim() };

    try {
      await create(payload);
      onSaved?.();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : '등록에 실패했습니다.',
      );
    }
  };

  return (
    <form
      className="agent-form"
      onSubmit={handleSubmit}
      aria-label="바운티 작성"
    >
      <h2 className="agent-form__heading">현장 확인 미션 올리기</h2>

      {/* ② 무금전 보상 안내 — 금전 아님 명시(아이콘+텍스트 병행). */}
      <p className="bounty-form__reward-note" role="note">
        <span className="chip chip--reward" aria-label="보상 안내">
          <span aria-hidden="true">🏅</span> 뱃지 + 평판
        </span>{' '}
        보상은 <b>뱃지와 평판</b>입니다. <b>금전이 아닙니다.</b> 돈을 주고받는
        미션이 아니에요.
      </p>

      <label className="agent-form__field">
        <span className="agent-form__label">확인 미션</span>
        <textarea
          className="agent-form__input bounty-form__textarea"
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          placeholder="예: 여주 나이키 270 에어맥스97 올블랙 재고 사진 부탁!"
          rows={4}
          required
        />
        <span className="agent-form__hint">
          어느 매장에서 무엇을 확인해 주면 되는지 구체적으로 적어 주세요.
        </span>
      </label>

      {/* ① 사진은 직접 촬영분만 — 불펌 금지. MVP 에서는 제출 시 안내만. */}
      <p className="bounty-form__photo-note" role="note">
        <span aria-hidden="true">📷</span>{' '}
        확인 사진은 <b>직접 촬영한 것만</b> 올려 주세요. 다른 곳의 사진을 가져오는
        불펌은 금지되며 신고 대상입니다. (사진 첨부는 추후 제공)
      </p>

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
          {busy ? '올리는 중…' : '미션 올리기'}
        </button>
      </div>
    </form>
  );
}
