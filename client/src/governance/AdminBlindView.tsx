// 운영자 신고 관리 화면 — 블라인드/이의 큐 + 복구/삭제 버튼.
// 상태 뱃지는 색 + 텍스트 병행(색 단독 의존 금지, 색각 고려).
// 불변식:
//   - ①/R1: useAdminReports(자사 /api/reports 상대경로)만 사용.
//   - ③: 신고→즉시 블라인드 후 운영자가 복구/삭제로 사후 판단(완전 방치 금지).
//   - ⑤/R3: 항목에 좌표 없음. ②: 자금 흐름 표시 없음.
import { useAdminReports } from './useAdminReports';
import type { AdminReport } from './useAdminReports';
import './governance.css';

interface AdminBlindViewProps {
  onBack?: () => void;
}

// 상태별 뱃지 클래스(색은 보조, 텍스트가 1차 신호).
function statusClass(status: string): string {
  switch (status) {
    case '블라인드':
      return 'admin-status admin-status--blinded';
    case '이의':
      return 'admin-status admin-status--appeal';
    case '복구':
      return 'admin-status admin-status--restored';
    case '삭제':
      return 'admin-status admin-status--removed';
    default:
      return 'admin-status admin-status--neutral';
  }
}

// 대상 종류 표시 카피.
function targetLabel(t: AdminReport['targetType']): string {
  switch (t) {
    case 'discount':
      return '할인소식';
    case 'message':
      return '채팅 메시지';
    case 'profile':
      return '대행자 프로필';
    case 'request':
      return '역경매 요청';
    default:
      return t;
  }
}

// 상태 필터 탭.
const FILTERS: { value: string; label: string }[] = [
  { value: '블라인드', label: '블라인드' },
  { value: '이의', label: '이의 신청' },
  { value: '복구', label: '복구됨' },
  { value: '삭제', label: '삭제됨' },
  { value: '', label: '전체' },
];

export default function AdminBlindView({ onBack }: AdminBlindViewProps) {
  const {
    status,
    data,
    error,
    filter,
    setFilter,
    reload,
    restore,
    remove,
    actionError,
  } = useAdminReports();

  // 복구/삭제 후 오류는 훅이 actionError 로 노출하므로 여기서는 삼킨다.
  const handleRestore = (id: string) => {
    void restore(id).catch(() => {});
  };
  const handleRemove = (id: string) => {
    void remove(id).catch(() => {});
  };

  return (
    <section className="admin-blind" aria-label="신고 관리">
      <header className="admin-blind__head">
        <h2 className="agent-form__heading">신고 관리</h2>
        {onBack && (
          <button
            type="button"
            className="agent-form__btn agent-form__btn--ghost"
            onClick={onBack}
          >
            보드로
          </button>
        )}
      </header>

      <div className="admin-blind__filters" role="tablist" aria-label="상태 필터">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={
              'admin-blind__filter' +
              (filter === f.value ? ' admin-blind__filter--active' : '')
            }
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {actionError && (
        <p className="report-flow__error" role="alert">
          {actionError}
        </p>
      )}

      {status === 'loading' && (
        <p className="board-view__status" role="status">
          불러오는 중…
        </p>
      )}

      {status === 'error' && (
        <div className="board-view__status" role="alert">
          <p>{error ?? '신고 큐를 불러오지 못했습니다.'}</p>
          <button type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}

      {status === 'ready' && data.length === 0 && (
        <div className="empty-state" role="status">
          <p className="empty-state__title">처리할 신고가 없어요</p>
          <p className="empty-state__hint">
            선택한 상태에 해당하는 신고가 없습니다.
          </p>
        </div>
      )}

      {status === 'ready' && data.length > 0 && (
        <ul className="admin-blind__list">
          {data.map((r) => (
            <li key={r.id} className="admin-report" aria-label="신고 항목">
              <div className="admin-report__top">
                <span className={statusClass(r.status)}>{r.status}</span>
                <span className="admin-report__target">
                  {targetLabel(r.targetType)}
                </span>
              </div>
              <dl className="admin-report__meta">
                <div className="admin-report__meta-row">
                  <dt>사유</dt>
                  <dd>{r.reason}</dd>
                </div>
                <div className="admin-report__meta-row">
                  <dt>대상 ID</dt>
                  <dd className="admin-report__id">{r.targetId}</dd>
                </div>
                <div className="admin-report__meta-row">
                  <dt>접수</dt>
                  <dd>{r.createdAt}</dd>
                </div>
              </dl>
              <div className="admin-report__actions">
                <button
                  type="button"
                  className="report-flow__btn report-flow__btn--ghost"
                  onClick={() => handleRestore(r.id)}
                >
                  복구
                </button>
                <button
                  type="button"
                  className="report-flow__btn report-flow__btn--danger"
                  onClick={() => handleRemove(r.id)}
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
