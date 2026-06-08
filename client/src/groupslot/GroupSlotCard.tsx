// 공동대행 슬롯 카드(S8) — 일정/지역/자리 + [참여]. 경고 모달 동의 후에만 join(I3).
// 불변식:
//   - I3: 참여 버튼 → 경고 모달 → "이해했어요, 계속" 동의 후에만 join 호출.
//   - ②/R2: 금액·대금 표기·입력 없음(정원/참여 수는 자리 수).
//   - XSS: 사용자 텍스트는 React 보간(JSX)으로만 렌더.
import { useState } from 'react';
import type { GroupSlot } from './groupslot.types';
import { useGroupSlotActions } from './useGroupSlotActions';
import GroupSlotWarningModal from './GroupSlotWarningModal';
import './groupslot.css';

interface GroupSlotCardProps {
  slot: GroupSlot;
  /** 참여 가능 여부(구매자에게만 true 로 호출부가 결정). */
  canJoin?: boolean;
  /** 참여 성공 후 갱신 콜백(목록 reload 등). */
  onJoined?: () => void;
}

export default function GroupSlotCard({
  slot,
  canJoin = false,
  onJoined,
}: GroupSlotCardProps) {
  const { busy, error, join } = useGroupSlotActions();
  const [warnOpen, setWarnOpen] = useState(false);
  const [done, setDone] = useState(false);

  const full = slot.joinedCount >= slot.capacity;
  const closed = slot.status === '마감' || full;
  const remaining = Math.max(0, slot.capacity - slot.joinedCount);

  // 참여 버튼 → 모달만 띄운다(동의 전 join 미호출 I3).
  const handleJoinClick = () => setWarnOpen(true);

  // 모달 동의 후에만 실제 참여(I3).
  const handleConfirm = async () => {
    setWarnOpen(false);
    try {
      await join(slot.id);
      setDone(true);
      onJoined?.();
    } catch {
      // error 상태로 표시 — throw 흡수.
    }
  };

  return (
    <article className="card card--groupslot" aria-label="공동대행 슬롯 카드">
      <header className="card__head">
        <span className="badge badge--groupslot">공동대행 슬롯</span>
        <span
          className={
            'badge badge--gs-status' + (closed ? ' badge--gs-closed' : '')
          }
        >
          {closed ? '마감' : '모집중'}
        </span>
      </header>

      <dl className="card__meta">
        <div className="card__meta-row">
          <dt>출동일정</dt>
          <dd>{slot.scheduleText}</dd>
        </div>
        <div className="card__meta-row">
          <dt>활동지역</dt>
          <dd>{slot.region}</dd>
        </div>
        <div className="card__meta-row">
          <dt>자리</dt>
          <dd>
            {slot.joinedCount} / {slot.capacity}
            {!closed && <> · 남은 자리 {remaining}</>}
          </dd>
        </div>
      </dl>

      {done ? (
        <p className="gs-card__joined" role="status">
          참여 신청이 접수됐어요. 매칭 채팅에서 진행됩니다.
        </p>
      ) : (
        canJoin &&
        !closed && (
          <button
            type="button"
            className="agent-form__btn agent-form__btn--primary card__match-btn"
            onClick={handleJoinClick}
            disabled={busy}
          >
            {busy ? '참여 중…' : '참여하기'}
          </button>
        )
      )}

      {error && (
        <p className="agent-form__error" role="alert">
          {error}
        </p>
      )}

      {/* I3: 동의 전 join 미호출 — 모달이 게이트. */}
      <GroupSlotWarningModal
        open={warnOpen}
        actionLabel="공동대행 참여"
        onConfirm={handleConfirm}
        onCancel={() => setWarnOpen(false)}
      />
    </article>
  );
}
