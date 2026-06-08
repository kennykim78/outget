// 바운티 목록(S7) — GET /api/bounties. 무금전 미션 카드 리스트.
// 불변식:
//   - 빈 상태는 가짜로 채우지 않고 첫 미션 작성을 유도(EmptyState).
//   - ③: 통신판매중개 고지(IntermediaryNotice) 상시.
//   - ②: 금액·정산 표기 없음(카드/보상은 뱃지·평판뿐).
import { useBounties } from './useBounties';
import BountyCard from './BountyCard';
import EmptyState from '../board/EmptyState';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import './bounty.css';

interface BountyListProps {
  /** 새 미션 작성 진입(작성 권한자에게만 노출하도록 호출부가 결정). */
  onWriteNew?: () => void;
}

export default function BountyList({ onWriteNew }: BountyListProps) {
  const { status, data, error, reload } = useBounties();

  return (
    <section className="bounty-list" aria-label="바운티 목록">
      <header className="bounty-list__head">
        <h2 className="bounty-list__heading">현장 확인 미션</h2>
        {onWriteNew && (
          <button
            type="button"
            className="agent-form__btn agent-form__btn--primary"
            onClick={onWriteNew}
          >
            미션 올리기
          </button>
        )}
      </header>

      {/* ② 무금전 안내 상단 고정. */}
      <p className="bounty-list__note" role="note">
        모든 미션의 보상은 <b>뱃지와 평판</b>입니다. <b>금전이 아닙니다.</b>
      </p>

      {status === 'loading' && <p role="status">불러오는 중…</p>}

      {status === 'error' && (
        <div className="bounty-list__error" role="alert">
          <p>{error ?? '바운티를 불러오지 못했습니다.'}</p>
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
        <EmptyState message="아직 현장 확인 미션이 없어요. 첫 미션을 올려보세요!" />
      )}

      {status === 'ready' &&
        data.map((b) => (
          <BountyCard key={b.id} bounty={b} onSubmitted={reload} />
        ))}

      {/* ③ 통신판매중개 고지 상시. */}
      <IntermediaryNotice />
    </section>
  );
}
