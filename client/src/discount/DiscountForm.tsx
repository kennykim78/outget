// 할인소식 작성 폼(S6): 품목/브랜드 필수 · 할인율%|할인가 · 정가(선택) · 출처 필수 · 사진 안내.
// 불변식:
//   - ⑤/R3: 좌표 입력란 없음. 사용자 등록분은 핀 없이 리스트로 노출된다.
//   - ④/R5: 정가 미입력 시 서버가 [기준가 미확인] 라벨을 강제 — 폼은 안내만 한다.
//     플랫폼 단정가(platform/our/official) 변수 없음.
//   - ①/R1: 저장은 useDiscountActions 의 자사 상대경로 호출만. 사진은 직접 촬영분 안내(MVP 미전송).
//   - ③: 통신판매중개 고지(IntermediaryNotice) 상시.
import { useState } from 'react';
import type { DiscountInput } from './discount.types';
import { useDiscountActions } from './useDiscountActions';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import '../agent/agent.css';
import './discount.css';

interface DiscountFormProps {
  /** 저장 성공 후 콜백. */
  onSaved?: () => void;
  /** 취소/뒤로. */
  onCancel?: () => void;
}

interface FormState {
  storeBrand: string;
  discountRate: string;
  discountPrice: string;
  listPrice: string;
  source: string;
}

const EMPTY_FORM: FormState = {
  storeBrand: '',
  discountRate: '',
  discountPrice: '',
  listPrice: '',
  source: '',
};

export default function DiscountForm({ onSaved, onCancel }: DiscountFormProps) {
  const { busy, error, create } = useDiscountActions();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  // 정가 미입력 → 미확인 라벨 안내(서버가 최종 강제).
  const baseWillBeUnverified = !form.listPrice.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!form.storeBrand.trim()) {
      setSubmitError('어느 매장·브랜드 소식인지 적어 주세요.');
      return;
    }

    const rate = form.discountRate.trim() ? Number(form.discountRate) : null;
    const price = form.discountPrice.trim() ? Number(form.discountPrice) : null;
    const list = form.listPrice.trim() ? Number(form.listPrice) : null;

    if (rate == null && price == null) {
      setSubmitError('할인율(%) 또는 할인가 중 하나는 적어 주세요.');
      return;
    }
    if (rate != null && (Number.isNaN(rate) || rate <= 0 || rate >= 100)) {
      setSubmitError('할인율은 1~99 사이 숫자로 입력해 주세요.');
      return;
    }
    if (price != null && (Number.isNaN(price) || price <= 0)) {
      setSubmitError('할인가는 0보다 큰 숫자로 입력해 주세요.');
      return;
    }
    if (list != null && (Number.isNaN(list) || list <= 0)) {
      setSubmitError('정가는 0보다 큰 숫자로 입력해 주세요.');
      return;
    }
    if (!form.source.trim()) {
      setSubmitError('출처를 적어 주세요(미검증 제보로 표기됩니다).');
      return;
    }

    // 좌표·photo·unverifiedBase 없음 — DTO 에 키 자체가 없다(⑤/①/④).
    const payload: DiscountInput = {
      storeBrand: form.storeBrand.trim(),
      source: form.source.trim(),
      ...(rate != null ? { discountRate: rate } : {}),
      ...(price != null ? { discountPrice: price } : {}),
      ...(list != null ? { listPrice: list } : {}),
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
      aria-label="할인소식 작성"
    >
      <h2 className="agent-form__heading">할인소식 올리기</h2>

      {/* 미검증 제보 안내 — 회색 중립 칩(아이콘+텍스트 병행, 색 단독 의존 금지). */}
      <p className="discount-form__unverified-note" role="note">
        <span className="chip chip--unverified" aria-label="미검증 제보">
          <span aria-hidden="true">◌</span> 미검증 제보
        </span>{' '}
        올려주신 소식은 미검증 사용자 제보로 표기됩니다.
      </p>

      <label className="agent-form__field">
        <span className="agent-form__label">매장·브랜드</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.storeBrand}
          onChange={(e) => patch({ storeBrand: e.target.value })}
          placeholder="예: 나이키 팩토리 여주점 / 데이브레이크"
          required
        />
        <span className="agent-form__hint">
          어느 매장·브랜드·품목 소식인지 적어 주세요.
        </span>
      </label>

      <div className="discount-form__row">
        <label className="agent-form__field">
          <span className="agent-form__label">할인율 (%)</span>
          <input
            className="agent-form__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={form.discountRate}
            onChange={(e) => patch({ discountRate: e.target.value })}
            placeholder="예: 40"
          />
        </label>

        <label className="agent-form__field">
          <span className="agent-form__label">할인가 (원)</span>
          <input
            className="agent-form__input"
            type="number"
            inputMode="numeric"
            min={1}
            value={form.discountPrice}
            onChange={(e) => patch({ discountPrice: e.target.value })}
            placeholder="예: 72000"
          />
        </label>
      </div>
      <span className="agent-form__hint">
        할인율 또는 할인가 중 하나 이상을 적어 주세요(둘 다 가능).
      </span>

      <label className="agent-form__field">
        <span className="agent-form__label">정가 (선택)</span>
        <input
          className="agent-form__input"
          type="number"
          inputMode="numeric"
          min={1}
          value={form.listPrice}
          onChange={(e) => patch({ listPrice: e.target.value })}
          placeholder="예: 120000"
        />
        {baseWillBeUnverified ? (
          <span className="discount-form__base-hint" role="note">
            정가를 비우면 <b>[기준가 미확인·사용자 제보가]</b> 라벨이 자동으로
            붙습니다.
          </span>
        ) : (
          <span className="agent-form__hint">
            정가는 참고용으로만 표시되며 할인 부분이 중심입니다.
          </span>
        )}
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">출처</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.source}
          onChange={(e) => patch({ source: e.target.value })}
          placeholder="예: 현장 방문 / 매장 안내문"
          required
        />
        <span className="agent-form__hint">
          미검증 제보로 표기됩니다. 어디서 본 소식인지 적어 주세요.
        </span>
      </label>

      {/* 사진 안내 — 직접 촬영분만, 불펌 금지(①). MVP 에서는 전송하지 않는다. */}
      <p className="discount-form__photo-note" role="note">
        <span className="discount-form__photo-icon" aria-hidden="true">
          📷
        </span>
        <span>
          사진은 <b>직접 촬영한 것만</b> 올려 주세요. 다른 곳의 사진을 가져오는
          불펌은 금지되며 신고 대상입니다. (사진 첨부는 추후 제공 — 지금은 안내만)
        </span>
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
          {busy ? '올리는 중…' : '할인소식 올리기'}
        </button>
      </div>
    </form>
  );
}
