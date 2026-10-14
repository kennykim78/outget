import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PublicVet } from '@ws/engine';
import VetCard from './VetCard';

const vet: PublicVet = {
  id: 'a',
  name: '병원a',
  address: '서울 마포구 길 a',
  phone: '02-123-4567',
  region: '서울 마포구',
  treats: [],
  night: null,
  emergency: null,
  lat: null,
  lng: null,
  verifiedAt: null,
};

describe('VetCard heading level · 선택 버튼', () => {
  it('기본 h3, level={2} 면 h2', () => {
    const { unmount } = render(<ul><VetCard vet={vet} /></ul>);
    expect(screen.getByRole('heading', { level: 3, name: '병원a' })).toBeInTheDocument();
    unmount();
    render(<ul><VetCard vet={vet} level={2} /></ul>);
    expect(screen.getByRole('heading', { level: 2, name: '병원a' })).toBeInTheDocument();
  });

  it('병원명 버튼 aria-pressed 가 selected 를 반영', () => {
    const { unmount } = render(<ul><VetCard vet={vet} onSelect={vi.fn()} /></ul>);
    expect(screen.getByRole('button', { name: '병원a' })).toHaveAttribute('aria-pressed', 'false');
    unmount();
    render(<ul><VetCard vet={vet} onSelect={vi.fn()} selected /></ul>);
    expect(screen.getByRole('button', { name: '병원a' })).toHaveAttribute('aria-pressed', 'true');
  });
});
