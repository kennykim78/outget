// 후기 마퀴(≥6, copy 가 들어온 뒤의 경로): 2줄(위 앞 절반 / 아래 나머지), 복제 묶음 aria-hidden+inert, 원본 카드 8,
//   "멈추기/다시 흐르게 하기" 토글(D-18), 행동 링크(VET → /vet, 나머지 → L1). copy 경로는 C1 대기라 여기서만 주입한다.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { testimonial, golden } from '../test/fixtures';
import Glyph from '../ui/Glyph';
import Reviews from './Reviews';

const INJECTED: Record<string, string> = {
  'homeA.reviewPause': 'PAUSE',
  'homeA.reviewResume': 'RESUME',
  'homeA.reviewAction.CHECKLIST': 'ACT_CHECKLIST',
  'homeA.reviewAction.SPEC_CHECK': 'ACT_SPEC',
  'homeA.reviewAction.SETUP': 'ACT_SETUP',
  'homeA.reviewAction.VET': 'ACT_VET',
  'glyphLabel.first': 'LABEL_FIRST',
};

vi.mock('../ui/copyText', () => ({
  copyAt: (p: string) => INJECTED[p] ?? null,
  copyFmt: () => null,
}));

describe('Reviews marquee', () => {
  it('2줄 + 복제 inert + 토글 + 행동 링크', () => {
    const onAction = vi.fn();
    const list = Array.from({ length: 8 }, (_, i) => testimonial(i + 1));
    render(<Reviews testimonials={list} types={[golden]} onAction={onAction} vetAvailable />);
    const s = document.querySelector('[data-ws-section="reviews"]') as HTMLElement;
    expect(s).toHaveAttribute('data-ws-ladder', 'marquee');
    const rows = s.querySelectorAll('.ws-marquee-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('li[data-ws-id]')).toHaveLength(4);
    expect(rows[1].querySelectorAll('li[data-ws-id]')).toHaveLength(4);
    const clones = s.querySelectorAll('ul[aria-hidden="true"]');
    expect(clones).toHaveLength(2);
    for (const c of Array.from(clones)) expect(c).toHaveAttribute('inert');
    const toggle = screen.getByRole('button', { name: 'PAUSE' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'RESUME' })).toHaveAttribute('aria-pressed', 'true');
    expect(s.querySelector('.ws-marquee--paused')).not.toBeNull();
    // 행동: 원본 세트만 접근 가능. VET 은 /vet 링크, CHECKLIST 는 버튼 → onAction.
    const vet = Array.from(s.querySelectorAll('ul:not([aria-hidden]) a.ws-review-action'));
    expect(vet.every((a) => a.getAttribute('href') === '/vet')).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: /ACT_CHECKLIST/ })[0]);
    expect(onAction).toHaveBeenCalledWith('CHECKLIST');
  });
});

describe('Reviews marquee focus (WCAG 2.4.7·2.4.11)', () => {
  it('두 행 모두 카드 링크 포커스 → inert 아닌 묶음 소속 + 행이 정적 배치(--focus)로 전환, 이탈 시 복귀', () => {
    const list = Array.from({ length: 8 }, (_, i) => testimonial(i + 1));
    render(<Reviews testimonials={list} types={[golden]} onAction={() => undefined} vetAvailable />);
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.ws-marquee-row'));
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      const targets = Array.from(row.querySelectorAll<HTMLElement>('.ws-review-action'));
      expect(targets.length).toBeGreaterThan(0);
      for (const el of targets) {
        if (el.tabIndex === -1) continue;
        fireEvent.focus(el);
        expect(el.closest('ul')?.hasAttribute('inert')).toBe(false);
        expect(row.classList.contains('ws-marquee-row--focus')).toBe(true);
      }
      fireEvent.blur(targets[0], { relatedTarget: document.body });
      expect(row.classList.contains('ws-marquee-row--focus')).toBe(false);
    });
  });
});

describe('K1', () => {
  it('병원 데이터 0 이면 VET 후기의 행동 링크 생략, 다른 행동은 유지', () => {
    const list = Array.from({ length: 4 }, (_, i) => testimonial(i + 1)); // linkedAction 순환에 VET 포함
    render(<Reviews testimonials={list} types={[golden]} onAction={() => undefined} vetAvailable={false} />);
    expect(screen.queryByText('ACT_VET')).toBeNull();
    expect(document.querySelector('a.ws-review-action[href="/vet"]')).toBeNull();
    expect(screen.getByRole('button', { name: /ACT_CHECKLIST/ })).toBeInTheDocument();
  });

  it('Glyph labelled: copy glyphLabel.{kind} 가 있으면 시각 숨김 라벨, 없으면 생략', () => {
    const { container, rerender } = render(<Glyph kind="first" labelled />);
    expect(container.querySelector('.ws-visually-hidden')).toHaveTextContent('LABEL_FIRST');
    rerender(<Glyph kind="ready" labelled />);
    expect(container.querySelector('.ws-visually-hidden')).toBeNull();
    expect(container.querySelector('.ws-glyph')).toHaveAttribute('aria-hidden', 'true');
  });
});
