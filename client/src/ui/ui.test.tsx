// ui 기본 요소: AnimalAvatar(리포 자산만), Glyph(텍스트 글리프), RailSection(구조·화살표 라벨).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AnimalAvatar from './AnimalAvatar';
import Glyph from './Glyph';
import RailSection from './RailSection';

describe('AnimalAvatar', () => {
  it('/mascots/{asset}.svg 만 쓰고 형식이 틀린 자산은 빈 디스크', () => {
    const { container, rerender } = render(<AnimalAvatar asset="hamster-golden" size="sm" tone="peach-soft" alt="" />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/mascots/hamster-golden.svg');
    expect(container.querySelector('.ws-avatar--sm.ws-avatar--peach-soft')).not.toBeNull();
    for (const bad of ['https://x.example/a', '../etc', 'A B', null]) {
      rerender(<AnimalAvatar asset={bad} size="lg" tone="brand-soft" alt="x" />);
      expect(container.querySelector('img')).toBeNull();
    }
  });

  it('컨텍스트 헤더(lg·peach-soft)만 LCP 우선: fetchpriority=high, decoding 없음 — 다른 조합은 decoding=async 그대로(R6 F2b ②)', () => {
    const { container, rerender } = render(<AnimalAvatar asset="hamster-golden" size="lg" tone="peach-soft" alt="" />);
    const lcp = container.querySelector('img');
    expect(lcp).toHaveAttribute('fetchpriority', 'high');
    expect(lcp).not.toHaveAttribute('decoding');
    for (const [size, tone] of [['lg', 'brand-soft'], ['sm', 'peach-soft'], ['md', 'peach-soft'], ['md', 'surface'], ['type', 'brand-soft']] as const) {
      rerender(<AnimalAvatar asset="hamster-golden" size={size} tone={tone} alt="" />);
      const img = container.querySelector('img');
      expect(img).not.toHaveAttribute('fetchpriority');
      expect(img).toHaveAttribute('decoding', 'async');
    }
  });
});

describe('Glyph', () => {
  it('텍스트 글리프 + aria-hidden', () => {
    const { container } = render(<Glyph kind="ready" />);
    const g = container.querySelector('.ws-glyph');
    expect(g).toHaveTextContent('✓');
    expect(g).toHaveAttribute('aria-hidden', 'true');
    expect(g).toHaveAttribute('data-ws-glyph', 'ready');
  });
});

describe('RailSection', () => {
  it('section[data-ws-section] + h2 연결 + ul[role=list] 프리렌더 클래스 + 전체 링크', () => {
    render(
      <RailSection id="products" kind="product" title="기준에 맞는 준비물" subtitle="부제" more={{ label: '전체', href: '/x' }} prevLabel="이전 보기" nextLabel="다음 보기">
        <li>a</li>
        <li>b</li>
      </RailSection>,
    );
    const section = document.querySelector('section[data-ws-section="products"]') as HTMLElement;
    expect(section).not.toBeNull();
    const h2 = screen.getByRole('heading', { level: 2, name: '기준에 맞는 준비물' });
    expect(section.getAttribute('aria-labelledby')).toBe(h2.id);
    const list = screen.getByRole('list');
    expect(list).toHaveClass('ws-rail', 'ws-products');
    expect(list).toHaveAttribute('tabindex', '0');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /전체/ })).toHaveAttribute('href', '/x');
    // jsdom 은 레이아웃이 없어 넘침 0 → 화살표 없음.
    expect(screen.queryByRole('button', { name: '다음 보기' })).toBeNull();
  });
});

describe('copyText', () => {
  it('있는 경로는 문자열, 없는 경로·객체 경로는 null, 템플릿은 formatCopy 로 채우고 실패하면 null', async () => {
    const { copyAt, copyFmt } = await import('./copyText');
    expect(copyAt('nav.logo')).toBe('WithSmall');
    expect(copyAt('nav')).toBeNull();
    expect(copyAt('nope.missing')).toBeNull();
    expect(copyFmt('homeB.saveTitle', { animal: '골든햄스터' })).toBe('골든햄스터 준비, 이어서 할까요?');
    expect(copyFmt('homeB.saveTitle', {})).toBeNull();
  });
});
