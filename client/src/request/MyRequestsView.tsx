// 내 요청 목록(S4 상태추적): 상태 뱃지 · 확인가 인라인 · 통신판매중개 고지 상시.
// 불변식:
//   - ①/R1: useMyRequests(자사 /api/requests/me 상대경로)만 사용.
//   - ⑤/R3: 항목에 좌표 없음(region 텍스트만).
//   - ③: IntermediaryNotice 상시.
//   - ②/④: 확인가는 VerifiedPriceInline(대행자 책임·플랫폼 단정가 아님)으로만 표시.
// 빈 상태는 가짜로 채우지 않고 작성 유도(EmptyState 카피).
import { useMyRequests } from './useMyRequests';
import RequestStatusBadge from './RequestStatusBadge';
import VerifiedPriceInline from './VerifiedPriceInline';
import IntermediaryNotice from '../board/cards/IntermediaryNotice';
import '../board/board.css';
import './request.css';

interface MyRequestsViewProps {
  /** 새 요청 작성 진입(빈 상태 유도용). */
  onWriteNew?: () => void;
}

export default function MyRequestsView({ onWriteNew }: MyRequestsViewProps) {
  const { status, data, error, reload } = useMyRequests();

  return (
    <section className="my-requests" aria-label="내 요청 목록">
      <header className="my-requests__head">
        <h2 className="agent-form__heading">내 요청</h2>
        <IntermediaryNotice />
      </header>

      {status === 'loading' && (
        <p className="board-view__status" role="status">
          불러오는 중…
        </p>
      )}

      {status === 'error' && (
        <div className="board-view__status" role="alert">
          <p>{error ?? '내 요청을 불러오지 못했습니다.'}</p>
          <button type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}

      {status === 'ready' && data.length === 0 && (
        <div className="empty-state">
          <p className="empty-state__title">아직 올린 요청이 없어요</p>
          <p className="empty-state__hint">
            원하는 물건과 희망가(대행료 포함)를 적어 역경매 요청을 올려 보세요.
          </p>
          {onWriteNew && (
            <button
              type="button"
              className="agent-form__btn agent-form__btn--primary"
              onClick={onWriteNew}
            >
              요청 올리기
            </button>
          )}
        </div>
      )}

      {status === 'ready' && data.length > 0 && (
        <div className="board-view__list">
          {data.map((r) => (
            <article
              key={r.id}
              className="card card--request"
              aria-label="내 요청 카드"
            >
              <header className="card__head">
                <span className="badge badge--neutral">요청</span>
                <RequestStatusBadge status={r.status} />
              </header>

              <h3 className="card__title">{r.item}</h3>
              {r.options && <p className="card__sub">{r.options}</p>}

              <dl className="card__meta">
                <div className="card__meta-row">
                  <dt>언제까지</dt>
                  <dd>{r.deadline}</dd>
                </div>
                <div className="card__meta-row">
                  <dt>지역</dt>
                  <dd>{r.region}</dd>
                </div>
                <div className="card__meta-row">
                  <dt>희망가(대행료 포함)</dt>
                  <dd className="card__price-hope">
                    {r.hopePrice.toLocaleString('ko-KR')}원
                  </dd>
                </div>
              </dl>

              {r.verifiedPrice && (
                <VerifiedPriceInline verifiedPrice={r.verifiedPrice} />
              )}
            </article>
          ))}
          <IntermediaryNotice compact />
        </div>
      )}
    </section>
  );
}
