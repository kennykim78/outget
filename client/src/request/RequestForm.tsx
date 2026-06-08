// 역경매 요청 작성 폼(S4): 무엇/옵션·수량/얼마(대행료 포함 희망가)/언제까지/지역/메모.
// 불변식:
//   - ⑤/R3: 좌표 입력란 없음. 위치는 region(동/지역 텍스트)뿐.
//   - ②: 결제·정산·예치 입력 0. hopePrice 는 표시 희망가일 뿐(플랫폼 자금 미보유).
//   - ③: 통신판매중개 고지(IntermediaryNotice) 상시 노출.
//   - ①/R1: 저장은 useRequestActions 의 자사 상대경로 호출만 사용.
import { useState } from 'react';
import type { RequestInput } from './request.types';
import { useRequestActions } from './useRequestActions';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import '../agent/agent.css';
import './request.css';

interface RequestFormProps {
  /** 저장 성공 후 콜백(예: 내 요청 화면으로). */
  onSaved?: () => void;
  /** 취소/뒤로. */
  onCancel?: () => void;
}

interface FormState {
  item: string;
  options: string;
  hopePrice: string;
  deadline: string;
  region: string;
  memo: string;
}

const EMPTY_FORM: FormState = {
  item: '',
  options: '',
  hopePrice: '',
  deadline: '',
  region: '',
  memo: '',
};

export default function RequestForm({ onSaved, onCancel }: RequestFormProps) {
  const { busy, error, create } = useRequestActions();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!form.item.trim()) {
      setSubmitError('무엇을 요청하는지 적어 주세요.');
      return;
    }
    const price = Number(form.hopePrice);
    if (!form.hopePrice.trim() || Number.isNaN(price) || price <= 0) {
      setSubmitError('희망가(대행료 포함)를 숫자로 입력해 주세요.');
      return;
    }
    if (!form.deadline.trim()) {
      setSubmitError('언제까지 필요한지 적어 주세요.');
      return;
    }
    if (!form.region.trim()) {
      setSubmitError('지역(동/지역명)을 입력해 주세요.');
      return;
    }

    // 옵션·수량·메모는 하나의 옵션 텍스트로 합친다(서버 RequestInput.options).
    const optionParts = [form.options.trim(), form.memo.trim()].filter(Boolean);
    const payload: RequestInput = {
      item: form.item.trim(),
      hopePrice: price,
      deadline: form.deadline.trim(),
      region: form.region.trim(),
      ...(optionParts.length > 0
        ? { options: optionParts.join(' · ') }
        : {}),
    };

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
      aria-label="역경매 요청 작성"
    >
      <h2 className="agent-form__heading">역경매 요청 올리기</h2>

      <label className="agent-form__field">
        <span className="agent-form__label">무엇을 구해 드릴까요</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.item}
          onChange={(e) => patch({ item: e.target.value })}
          placeholder="예: 나이키 데이브레이크 270mm"
          required
        />
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">옵션·수량 (선택)</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.options}
          onChange={(e) => patch({ options: e.target.value })}
          placeholder="예: 화이트 2켤레"
        />
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">희망가 (대행료 포함)</span>
        <input
          className="agent-form__input"
          type="number"
          inputMode="numeric"
          min={1}
          value={form.hopePrice}
          onChange={(e) => patch({ hopePrice: e.target.value })}
          placeholder="예: 120000"
          required
        />
        <span className="agent-form__hint">
          대행료까지 포함해 지불 가능한 금액을 적어 주세요(원).
        </span>
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">언제까지</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.deadline}
          onChange={(e) => patch({ deadline: e.target.value })}
          placeholder="예: 이번 주 일요일까지"
          required
        />
      </label>

      {/* 위치는 텍스트만 — 좌표 입력란 없음(⑤/R3). */}
      <label className="agent-form__field">
        <span className="agent-form__label">지역</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.region}
          onChange={(e) => patch({ region: e.target.value })}
          placeholder="예: 송도동·연수구 일대 (동/지역명)"
          required
        />
        <span className="agent-form__hint">
          정확한 좌표가 아닌 동·지역명을 적어 주세요.
        </span>
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">메모 (선택)</span>
        <textarea
          className="agent-form__input agent-form__textarea"
          value={form.memo}
          onChange={(e) => patch({ memo: e.target.value })}
          placeholder="예: 영수증 사진 함께 부탁드려요"
          rows={2}
        />
      </label>

      {/* ② 결제 고지 — 플랫폼은 자금을 보유하지 않는다. */}
      <p className="request-form__pay-notice" role="note">
        결제는 대행자 채택·확인가 후 직접 또는 외부 안전결제로 진행됩니다
        (Outget은 자금을 보유하지 않습니다).
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
          {busy ? '등록 중…' : '요청 올리기'}
        </button>
      </div>
    </form>
  );
}
