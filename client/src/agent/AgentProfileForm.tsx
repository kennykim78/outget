// 대행자 프로필 작성/편집 폼(S3 입력측).
// 구성: StatusSelect → 지위 분기(PersonalNotice / BizInfoFields)
//        → 활동지역(텍스트)·출동일정(텍스트) → 소개 → 제출.
// 불변식:
//   - ⑤/R3: 좌표 입력란 없음(위치는 텍스트만). 폼 DTO 에 좌표 필드 자체가 없다.
//   - ③: 개인 선택 시 PersonalNotice 상시 노출. 전문은 상호/사업자번호/연락처.
//   - ①/R1: 저장은 useAgentProfile 의 자사 상대경로 호출만 사용.
//   - ②: 결제/대금 처리 입력 0(플랫폼 자금 미보유).
import { useEffect, useState } from 'react';
import type { AgentProfileInput, AgentStatus } from './agent.types';
import { useAgentProfile } from './useAgentProfile';
import StatusSelect from './StatusSelect';
import PersonalNotice from './PersonalNotice';
import BizInfoFields from './BizInfoFields';
import './agent.css';

interface AgentProfileFormProps {
  /** 저장 성공 후 콜백(예: 보드로 복귀). */
  onSaved?: () => void;
  /** 취소/뒤로. */
  onCancel?: () => void;
}

// 사업자번호 형식(서버 미러) — XXX-XX-XXXXX. 형식 검증만(외부 진위 API 0).
const BIZ_NO_RE = /^\d{3}-\d{2}-\d{5}$/;

const EMPTY_FORM: AgentProfileInput = {
  status: '개인',
  bizName: '',
  bizNo: '',
  contact: '',
  bizDocRef: '',
  activeRegion: '',
  scheduleText: '',
};

export default function AgentProfileForm({
  onSaved,
  onCancel,
}: AgentProfileFormProps) {
  const { me, loading, saving, error, save } = useAgentProfile();
  const [form, setForm] = useState<AgentProfileInput>(EMPTY_FORM);
  const [bizNoError, setBizNoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 편집 진입 시 /me 프리필(좌표는 다루지 않음).
  useEffect(() => {
    if (!me) return;
    setForm({
      status: me.status,
      bizName: me.bizName ?? '',
      bizNo: me.bizNo ?? '',
      contact: me.contact ?? '',
      bizDocRef: me.bizDocRef ?? '',
      activeRegion: me.activeRegion,
      scheduleText: me.scheduleText,
    });
  }, [me]);

  const patch = (p: Partial<AgentProfileInput>) =>
    setForm((f) => ({ ...f, ...p }));

  const setStatus = (status: AgentStatus) => {
    patch({ status });
    if (status === '개인') setBizNoError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // 전문 지위 검증: 상호·사업자번호(형식)·연락처 필수.
    if (form.status === '전문') {
      if (!form.bizName?.trim()) {
        setSubmitError('전문 지위는 상호가 필요합니다.');
        return;
      }
      if (!BIZ_NO_RE.test((form.bizNo ?? '').trim())) {
        setBizNoError('사업자번호 형식이 올바르지 않습니다 (XXX-XX-XXXXX).');
        return;
      }
      setBizNoError(null);
    }

    if (!form.activeRegion.trim()) {
      setSubmitError('활동지역을 입력해 주세요.');
      return;
    }
    if (!form.scheduleText.trim()) {
      setSubmitError('출동일정을 입력해 주세요.');
      return;
    }

    // 개인 지위면 사업자 필드는 보내지 않는다(노이즈 제거).
    const payload: AgentProfileInput =
      form.status === '전문'
        ? {
            status: '전문',
            bizName: form.bizName?.trim(),
            bizNo: form.bizNo?.trim(),
            contact: form.contact?.trim() || undefined,
            bizDocRef: form.bizDocRef?.trim() || undefined,
            activeRegion: form.activeRegion.trim(),
            scheduleText: form.scheduleText.trim(),
          }
        : {
            status: '개인',
            activeRegion: form.activeRegion.trim(),
            scheduleText: form.scheduleText.trim(),
          };

    try {
      await save(payload);
      onSaved?.();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error ? err.message : '저장에 실패했습니다.',
      );
    }
  };

  if (loading) {
    return (
      <p className="agent-form__status" role="status">
        불러오는 중…
      </p>
    );
  }

  return (
    <form className="agent-form" onSubmit={handleSubmit} aria-label="대행자 프로필">
      <h2 className="agent-form__heading">
        {me ? '대행 프로필 편집' : '대행 광고 올리기'}
      </h2>

      <StatusSelect value={form.status} onChange={setStatus} />

      {/* ③ 개인 지위 상시 고지. */}
      {form.status === '개인' && <PersonalNotice />}

      {/* 전문 지위 추가 입력(의뢰자정보). */}
      {form.status === '전문' && (
        <BizInfoFields
          value={{
            bizName: form.bizName,
            bizNo: form.bizNo,
            contact: form.contact,
            bizDocRef: form.bizDocRef,
          }}
          onChange={patch}
          bizNoError={bizNoError}
        />
      )}

      {/* 위치는 텍스트만 — 좌표 입력란 없음(⑤/R3). */}
      <label className="agent-form__field">
        <span className="agent-form__label">활동지역</span>
        <input
          className="agent-form__input"
          type="text"
          value={form.activeRegion}
          onChange={(e) => patch({ activeRegion: e.target.value })}
          placeholder="예: 송도동·연수구 일대 (동/지역명)"
          required
        />
        <span className="agent-form__hint">
          정확한 좌표가 아닌 활동 동·지역명을 적어 주세요.
        </span>
      </label>

      <label className="agent-form__field">
        <span className="agent-form__label">출동일정</span>
        <textarea
          className="agent-form__input agent-form__textarea"
          value={form.scheduleText}
          onChange={(e) => patch({ scheduleText: e.target.value })}
          placeholder="예: 매주 화·목 오전 현장 방문"
          rows={2}
          required
        />
      </label>

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
          disabled={saving}
        >
          {saving ? '저장 중…' : me ? '수정 저장' : '등록'}
        </button>
      </div>
    </form>
  );
}
