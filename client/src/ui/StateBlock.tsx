// 상태 블록(R4-8, R4 시안 states_board) — 빈 상태 · 로딩 · 불러오기/보내기 실패의 머리 하나.
//   표식(빈 = 짧은 청록 선, 로딩 = 점 3개, 실패 = △ 글리프) → 제목 → 본문 → (로딩만) 진행 막대(숫자 없음) + 기다림 안내.
//   버튼은 그리지 않는다 — 호출부가 레이어 하단 슬롯·페이지에 행동 하나만 둔다(채운 버튼 ≤1, 로딩엔 행동 없음).
//   문구는 호출부가 @ws/copy 에서 넘긴다(한국어 하드코딩 0). 실패 문구는 사용자 말로(개발 용어 금지).
import type { ReactNode } from 'react';
import Glyph from './Glyph';

export type StateKind = 'empty' | 'loading' | 'error';

export interface StateBlockProps {
  kind: StateKind;
  title: string;
  body?: string | null;
  /** 로딩 막대 아래 안내(로딩만). */
  wait?: string | null;
  /** 제목 레벨 — 레이어 안 3(제목행 h2 아래), 레이어 소제목 아래 4, 페이지 2. */
  level?: 2 | 3 | 4;
  /** false = 표식 없음(병원 목록 빈 상태 — 시안에 표식 없음). */
  mark?: boolean;
  /** 실패 상태 식별(시험·QA). */
  errorId?: string;
  children?: ReactNode;
}

export default function StateBlock({ kind, title, body, wait, level = 3, mark = true, errorId, children }: StateBlockProps) {
  const Heading = level === 2 ? 'h2' : level === 4 ? 'h4' : 'h3';
  // 로딩 = status(polite) + aria-busy, 실패 = alert(바로 낭독), 빈 상태 = 일반 영역.
  const role = kind === 'loading' ? 'status' : kind === 'error' ? 'alert' : undefined;
  return (
    <div
      className={`ws-state ws-state--${kind}`}
      data-ws-state-kind={kind}
      data-ws-error={kind === 'error' ? errorId : undefined}
      role={role}
      aria-busy={kind === 'loading' ? true : undefined}
    >
      {mark ? (
        kind === 'error' ? (
          <Glyph kind="check" className="ws-state-mark" />
        ) : (
          <span className="ws-state-mark" aria-hidden="true" />
        )
      ) : null}
      <Heading className="ws-state-title">{title}</Heading>
      {body ? <p className="ws-state-body">{body}</p> : null}
      {kind === 'loading' ? (
        <>
          <span className="ws-state-bar" aria-hidden="true">
            <span />
          </span>
          {wait ? <p className="ws-state-wait">{wait}</p> : null}
        </>
      ) : null}
      {children}
    </div>
  );
}
