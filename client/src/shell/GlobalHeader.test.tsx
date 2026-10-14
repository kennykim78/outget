// shell/GlobalHeader — 건너뛰기 링크(WCAG 2.4.1): 헤더 첫 포커스 요소 a.ws-skip-link[href=#main] (프리렌더와 같은 마크업).
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '@ws/copy';
import GlobalHeader from './GlobalHeader';

describe('GlobalHeader 건너뛰기 링크', () => {
  it('header 첫 a = .ws-skip-link[href=#main], 라벨은 COPY.nav.skipToMain', () => {
    render(<GlobalHeader type={null} current={null} chipExpanded={false} onChipOpen={() => {}} />);
    const header = screen.getByRole('banner');
    const first = header.querySelector('a');
    expect(first).toHaveClass('ws-skip-link');
    expect(first).toHaveAttribute('href', '#main');
    expect(within(header).getByRole('link', { name: COPY.nav.skipToMain })).toBe(first);
  });
});
