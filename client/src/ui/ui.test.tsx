// ui 기본 요소: AnimalAvatar(리포 자산만), Glyph(텍스트 글리프), RailSection(구조·화살표 라벨).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY, GLYPH } from '@ws/copy';
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

  it('R4-1 전역 표: 판정 4상태 ○ △ ✕ — + ? · 준비 ✓ ! · 글자 중복 없음(○ 는 기준 충족 하나뿐, 「나중에」 글리프 없음)', () => {
    expect([GLYPH.ok, GLYPH.check, GLYPH.fail, GLYPH.none, GLYPH.unknown]).toEqual(['○', '△', '✕', '—', '?']);
    expect([GLYPH.ready, GLYPH.first]).toEqual(['✓', '!']);
    const chars = Object.values(GLYPH);
    expect(new Set(chars).size).toBe(chars.length);
    expect(Object.keys(GLYPH)).not.toContain('later');
    const { container } = render(<Glyph kind="ok" className="ws-verdict-glyph" />);
    const g = container.querySelector('.ws-glyph');
    expect(g).toHaveClass('ws-verdict-glyph');
    expect(g).toHaveAttribute('data-ws-glyph', 'ok');
    expect(g).toHaveTextContent('○');
  });

  it('R4-1 qa: glyphLabel 은 GLYPH 키를 모두 덮고(+ later), 판정 단어는 L5 와 같다', () => {
    for (const k of Object.keys(GLYPH)) expect(COPY.glyphLabel, k).toHaveProperty(k);
    expect(COPY.glyphLabel.later).toBe('나중에');
    expect(COPY.glyphLabel.ok).toBe(COPY.verdict.markOk);
    expect(COPY.glyphLabel.fail).toBe(COPY.verdict.productBelowMin);
    expect(COPY.glyphLabel.none).toBe(COPY.verdict.markNone);
    expect(COPY.glyphLabel.unknown).toBe(COPY.verdict.markInput);
    render(<Glyph kind="unknown" labelled />);
    expect(screen.getByText(COPY.verdict.markInput)).toHaveClass('ws-visually-hidden');
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
    // layout 생략 = 기존 레일(홈 B 무변경) — 변형 클래스 없음.
    expect(section.className).toBe('ws-rail-section ws-rail-section--product');
  });

  it('286 U3b: layout=grid3 + kind=starter → section 에 변형 클래스만 추가, ul.ws-starters(나머지 구조 동일)', () => {
    render(
      <RailSection id="starters" kind="starter" layout="grid3" title="처음 준비" prevLabel={null} nextLabel={null}>
        <li>a</li>
      </RailSection>,
    );
    const section = document.querySelector('section[data-ws-section="starters"]') as HTMLElement;
    expect(section.className).toBe('ws-rail-section ws-rail-section--starter ws-rail-section--grid3');
    expect(screen.getByRole('list')).toHaveClass('ws-rail', 'ws-starters');
    // ≥768 에서 스크롤이 없는 grid3 는 레일 tabindex 를 달지 않는다(카드 링크가 포커스를 받아 모바일 레일 이동은 유지). 기본 레일은 tabindex=0.
    expect(screen.getByRole('list')).not.toHaveAttribute('tabindex');
    expect(section.querySelector('.ws-rail-tools')?.childElementCount).toBe(0);
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
