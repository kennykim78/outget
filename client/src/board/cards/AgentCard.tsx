// 대행자 카드(S3 요약). 지위 뱃지(개인/전문)·활동지역·출동일정·평판.
// 전문이면 상호/사업자번호 표시. "아직 현장 확인가 없음" placeholder(가격은 Epic6).
// 개인 지위는 사업자등록 의무 고지(③ 상시)를 함께 노출한다.
// [채팅으로 매칭] 버튼 → onMatch(agentId)(채팅 본체는 Epic5).
import type { AgentProfile } from '../board.types';
import PersonalNotice from '../../agent/PersonalNotice';
import '../board.css';

interface AgentCardProps {
  agent: AgentProfile;
  /** 현위치 기준 거리 라벨(권한거부 시 null → 미표시). */
  distanceLabel?: string | null;
  /** 채팅 매칭 진입(POST /api/matches). 미지정 시 버튼 숨김. */
  onMatch?: (agentId: string) => void;
}

export default function AgentCard({ agent, distanceLabel, onMatch }: AgentCardProps) {
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

      {/* ③ 개인 지위 상시 고지(사업자등록 의무). */}
      {!pro && <PersonalNotice compact />}

      {/* 가격 위계: 현장 확인가 placeholder — 입력은 Epic6. */}
      <p className="price-placeholder" role="note">
        아직 현장 확인가 없음
      </p>

      {/* 채팅 매칭 진입(채팅 본체는 Epic5). */}
      {onMatch && (
        <button
          type="button"
          className="agent-form__btn agent-form__btn--primary card__match-btn"
          onClick={() => onMatch(agent.id)}
        >
          채팅으로 매칭
        </button>
      )}
    </article>
  );
}
