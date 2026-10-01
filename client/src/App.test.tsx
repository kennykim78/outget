// 셸 렌더 회귀 — 헤더 브랜드 "WithSmall" 과 본문 자리 표시.
// 외부 호출 0(불변식 ①): fetch 는 목으로 막고, refresh 토큰이 없어 부팅은 곧바로 anon 이 된다.
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import AuthProvider from './auth/AuthProvider';

const BANNED = [
  '괜찮다',
  '안전하다',
  '최저가',
  '판매순',
  '베스트',
  '정확도',
  '회원가입',
  '구매',
];

describe('App shell', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network disabled in test'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the WithSmall header and placeholder body', async () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    expect(screen.getByRole('banner')).toHaveTextContent('WithSmall');
    expect(
      await screen.findByText('작은 친구를 맞이할 준비, 곧 이곳에서 시작해요.'),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renders no banned words', async () => {
    const { container } = render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    await screen.findByText(/곧 이곳에서/);
    const text = container.textContent ?? '';
    for (const word of BANNED) {
      expect(text).not.toContain(word);
    }
    expect(text).not.toMatch(/outget/i);
  });
});
