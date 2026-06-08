// 요청 상태 뱃지 — 대기/채택/매칭/진행/종료.
// 색 단독 의존 금지: 상태 텍스트가 1차 신호, 색은 보조(색각 고려).
import type { RequestStatus } from './request.types';
import './request.css';

interface RequestStatusBadgeProps {
  status: RequestStatus;
}

// 상태→보조 색 클래스(텍스트 라벨과 항상 병행).
const STATUS_CLASS: Record<RequestStatus, string> = {
  대기: 'req-status--waiting',
  채택: 'req-status--adopted',
  매칭: 'req-status--matched',
  진행: 'req-status--progress',
  종료: 'req-status--closed',
};

export default function RequestStatusBadge({ status }: RequestStatusBadgeProps) {
  return (
    <span
      className={'badge req-status ' + STATUS_CLASS[status]}
      aria-label={`진행 상태: ${status}`}
    >
      {status}
    </span>
  );
}
