// 공동대행 슬롯 목록(S8) — GET /api/group-slots. 개설 진입 + 참여 카드.
// 불변식:
//   - 빈 상태는 가짜로 채우지 않고 첫 개설을 유도(EmptyState).
//   - ③: 통신판매중개 고지(IntermediaryNotice) 상시.
//   - 개설/참여 권한은 호출부가 결정(canCreate/canJoin) — 표시 게이트(권위는 서버).
import { useGroupSlots } from './useGroupSlots';
import GroupSlotCard from './GroupSlotCard';
import EmptyState from '../board/EmptyState';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import './groupslot.css';

interface GroupSlotListProps {
  /** 개설 진입(대행자에게만 노출하도록 호출부가 결정). */
  onCreateNew?: () => void;
  /** 참여 가능 여부(구매자에게만 true). */
  canJoin?: boolean;
}

export default function GroupSlotList({
  onCreateNew,
  canJoin = false,
}: GroupSlotListProps) {
  const { status, data, error, reload } = useGroupSlots();

  return (
    <section className="gs-list" aria-label="공동대행 슬롯 목록">
      <header className="gs-list__head">
        <h2 className="gs-list__heading">공동대행 슬롯</h2>
        {onCreateNew && (
          <button
            type="button"
            className="agent-form__btn agent-form__btn--primary"
            onClick={onCreateNew}
          >
            슬롯 개설
          </button>
        )}
      </header>

      {/* 사입·세무 주의 안내 상단 고정(상세 경고는 참여/개설 시 모달). */}
      <p className="gs-list__note" role="note">
        <span aria-hidden="true">⚠</span> 대량 구매는 사입(도소매)으로 간주될 수
        있어요. 각 요청은 접수 후 구매하세요(선사입 금지).
      </p>

      {status === 'loading' && <p role="status">불러오는 중…</p>}

      {status === 'error' && (
        <div className="gs-list__error" role="alert">
          <p>{error ?? '공동대행 슬롯을 불러오지 못했습니다.'}</p>
          <button
            type="button"
            className="agent-form__btn agent-form__btn--ghost"
            onClick={reload}
          >
            다시 시도
          </button>
        </div>
      )}

      {status === 'ready' && data.length === 0 && (
        <EmptyState message="아직 공동대행 슬롯이 없어요. 첫 슬롯을 열어보세요!" />
      )}

      {status === 'ready' &&
        data.map((s) => (
          <GroupSlotCard
            key={s.id}
            slot={s}
            canJoin={canJoin}
            onJoined={reload}
          />
        ))}

      {/* ③ 통신판매중개 고지 상시. */}
      <IntermediaryNotice />
    </section>
  );
}
