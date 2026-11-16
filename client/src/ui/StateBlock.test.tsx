// R4-8 StateBlock — 빈 상태·로딩·실패 머리(시안 states_board). 버튼 0(호출부 소유), 로딩 = status·aria-busy·숫자 없는 막대, 실패 = alert·△.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StateBlock from './StateBlock';
import appCss from '../styles/app.css?raw';

describe('StateBlock', () => {
  it('빈 상태: 표식(장식) → 제목 h3 → 본문, role 없음, 버튼 0', () => {
    const { container } = render(<StateBlock kind="empty" title="제목" body="본문이에요." />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-ws-state-kind', 'empty');
    expect(root).not.toHaveAttribute('role');
    expect(root.querySelector('.ws-state-mark')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('heading', { level: 3, name: '제목' })).toBeInTheDocument();
    expect(screen.getByText('본문이에요.')).toHaveClass('ws-state-body');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(root.querySelector('.ws-state-bar')).toBeNull();
  });

  it('로딩: role=status + aria-busy, 막대는 장식(aria-hidden)·숫자 0, 안내 문구', () => {
    render(<StateBlock kind="loading" title="불러와요" body="잠깐이에요." wait="기다려 주세요." />);
    const s = screen.getByRole('status');
    expect(s).toHaveAttribute('aria-busy', 'true');
    expect(s.querySelector('.ws-state-bar')).toHaveAttribute('aria-hidden', 'true');
    expect(s).toHaveTextContent('기다려 주세요.');
    expect(s.textContent).not.toMatch(/\d|%/);
  });

  it('실패: role=alert, △ 글리프(check), data-ws-error, 레벨 4 제목', () => {
    render(<StateBlock kind="error" level={4} errorId="x" title="못 했어요" />);
    const a = screen.getByRole('alert');
    expect(a).toHaveAttribute('data-ws-error', 'x');
    expect(a.querySelector('[data-ws-glyph="check"]')?.textContent).toBe('△');
    expect(screen.getByRole('heading', { level: 4, name: '못 했어요' })).toBeInTheDocument();
  });

  it('mark=false(병원 목록 빈 상태): 표식 0, 페이지 제목 아래 h2, 자식(링크) 포함', () => {
    render(
      <StateBlock kind="empty" mark={false} level={2} title="없어요">
        <a href="/x">링크</a>
      </StateBlock>,
    );
    expect(document.querySelector('.ws-state-mark')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '없어요' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '링크' })).toBeInTheDocument();
  });

  it('CSS: 막대 움직임은 prefers-reduced-motion 에서 정지, 그라디언트·그림자 0', () => {
    const block = appCss.slice(appCss.indexOf('/* ── 상태 블록(R4-8'));
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.ws-state-bar > span\s*\{\s*animation: none;/);
    expect(block).not.toMatch(/gradient|box-shadow/);
  });
});
