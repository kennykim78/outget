// 바운티 카드(S7): 미션 + [내가 확인해줄게요]→submit. 보상은 뱃지/평판(금전 아님 ②).
// 불변식:
//   - ②/R2: 금액·대금 표기·입력 없음. 보상 라벨은 "금전 아님" 명시.
//   - XSS: 모든 사용자 텍스트는 React 보간(JSX)으로만 렌더(dangerouslySetInnerHTML 0).
//   - ①: 사진 제출은 직접 촬영분만(MVP 미전송) — 버튼은 제출 트리거만.
import { useState } from 'react';
import type { Bounty } from './bounty.types';
import { useBountyActions } from './useBountyActions';
import './bounty.css';

interface BountyCardProps {
  bounty: Bounty;
  /** 제출 성공 후 갱신 콜백(목록 reload 등). */
  onSubmitted?: () => void;
}

export default function BountyCard({ bounty, onSubmitted }: BountyCardProps) {
  const { busy, error, submit } = useBountyActions();
  const [done, setDone] = useState(false);
  const closed = bounty.status === '완료';

  const handleSubmit = async () => {
    try {
      await submit(bounty.id);
      setDone(true);
      onSubmitted?.();
    } catch {
      // error 상태로 표시 — throw 흡수.
    }
  };

  return (
    <article className="card card--bounty" aria-label="바운티 카드">
      <header className="card__head">
        <span className="badge badge--bounty">현장 확인 미션</span>
        <span
          className={
            'badge badge--bounty-status' +
            (closed ? ' badge--bounty-done' : '')
          }
        >
          {bounty.status}
        </span>
      </header>

      {/* 미션 텍스트 — React 보간(XSS 안전). */}
      <p className="bounty-card__mission">{bounty.mission}</p>

      {/* ② 보상 안내 — 뱃지/평판, 금전 아님(아이콘+텍스트 병행). */}
      <p className="bounty-card__reward" role="note">
        <span aria-hidden="true">🏅</span> 보상: 확인러 뱃지 + 평판{' '}
        <b>(금전 아님)</b>
      </p>

      {done ? (
        <p className="bounty-card__submitted" role="status">
          확인 제출이 접수됐어요. 검토 후 뱃지가 지급됩니다.
        </p>
      ) : (
        !closed && (
          <button
            type="button"
            className="agent-form__btn agent-form__btn--primary card__match-btn"
            onClick={handleSubmit}
            disabled={busy}
          >
            {busy ? '제출 중…' : '내가 확인해줄게요'}
          </button>
        )
      )}

      {error && (
        <p className="agent-form__error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
