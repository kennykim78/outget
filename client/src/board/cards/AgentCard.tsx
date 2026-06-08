// 대행자 카드(S3 요약). 지위 뱃지(개인/전문)·활동지역·출동일정·평판.
// 전문이면 상호/사업자번호 표시. "아직 현장 확인가 없음" placeholder(가격은 Epic6).
import type { AgentProfile } from '../board.types';
import '../board.css';

interface AgentCardProps {
  agent: AgentProfile;
  /** 현위치 기준 거리 라벨(권한거부 시 null → 미표시). */
  distanceLabel?: string | null;
}

export default function AgentCard({ agent, distanceLabel }: AgentCardProps) {
  const pro = agent.status === '전문';
  return (
    <article className="card card--agent" aria-label="대행자 카드">
      <header className="card__head">
        <span
          className={
            'badge badge--status' +
            (pro ? ' badge--pro' : ' badge--personal')
          }
        >
          {pro ? '전문' : '개인'}
        </span>
        <span className="badge badge--reputation" aria-label="평판 점수">
          평판 {agent.reputation}
        </span>
        {distanceLabel && (
          <span className="card__distance">{distanceLabel}</span>
        )}
      </header>

      {pro && (agent.bizName || agent.bizNo) && (
        <dl className="card__biz">
          {agent.bizName && (
            <div className="card__biz-row">
              <dt>상호</dt>
              <dd>{agent.bizName}</dd>
            </div>
          )}
          {agent.bizNo && (
            <div className="card__biz-row">
              <dt>사업자번호</dt>
              <dd>{agent.bizNo}</dd>
            </div>
          )}
        </dl>
      )}

      <dl className="card__meta">
        <div className="card__meta-row">
          <dt>활동지역</dt>
          <dd>{agent.activeRegion}</dd>
        </div>
        <div className="card__meta-row">
          <dt>출동일정</dt>
          <dd>{agent.scheduleText}</dd>
        </div>
      </dl>

      {/* 가격 위계: 현장 확인가 placeholder — 입력은 Epic6. */}
      <p className="price-placeholder" role="note">
        아직 현장 확인가 없음
      </p>
    </article>
  );
}
