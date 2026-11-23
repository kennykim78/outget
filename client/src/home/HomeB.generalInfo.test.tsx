// 356 단계 9 — 일반 참고 정보(GENERAL_INFO, 코드 고정 6종) 종 페이지 고지.
//   고지(COPY.generalInfo.notice)는 종 페이지당 1회: 홈 B 컨텍스트 헤더 아래 한 곳. L4 를 위에 열어도 화면 전체에서 1회(L4 는 출처 라벨만).
//   generalInfo 키가 없는 타입(VERIFIED 체인)은 고지 0 · 기존 「검수 내용」 그대로. 합성 fixture(시드 아님).
import { act, render, screen } from '@testing-library/react';
import { COPY } from '@ws/copy';
import type { PublicAnimalType, PublicRequirement } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { NO_CAPTURE } from '../app/staticCapture';
import { golden, pageOf, req } from '../test/fixtures';
import { layerStore } from '../ui/layer/useLayer';

// review 키 없는 GENERAL_INFO 타입(서버 projectType — 자기 메타 GENERAL_INFO 면 review 키 자체가 없다).
const giType: PublicAnimalType = (() => {
  const t: PublicAnimalType = { ...golden, generalInfo: true };
  delete t.review;
  return t;
})();

function giReq(id: string, name: string): PublicRequirement {
  return { ...req(id, 'REQUIRED', name), lastVerifiedAt: '', source: [], generalInfo: true };
}

function page(t: PublicAnimalType, reqs: PublicRequirement[]) {
  return pageOf('TYPE', { types: [t], requirements: reqs }, { typeId: t.id, path: `/${t.slug}` });
}

const count = (needle: string) => (document.body.textContent ?? '').split(needle).length - 1;

beforeEach(() => {
  localStorage.clear();
  act(() => layerStore.resetForTest());
});
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => layerStore.resetForTest());
});

describe('356 일반 참고 정보 고지', () => {
  it('generalInfo 타입: 컨텍스트 헤더 안(h1 다음)에 고지 1회, 섹션 구조 그대로', () => {
    render(<App page={page(giType, [giReq('cage', '케이지')])} captured={NO_CAPTURE} />);
    const ctx = document.querySelector('.ws-context') as HTMLElement;
    const note = ctx.querySelector('[data-ws-notice="general-info"]') as HTMLElement;
    expect(note).not.toBeNull();
    expect(note.textContent).toBe(COPY.generalInfo.notice);
    expect(note).toHaveClass('ws-t-meta', 'ws-muted');
    expect(note.previousElementSibling?.tagName).toBe('H1');
    expect(count(COPY.generalInfo.notice)).toBe(1);
    // 섹션 순서는 기존 홈 B 와 같다(컨텍스트가 첫 섹션)
    expect(screen.getByRole('main').children[0]).toBe(ctx);
  });

  it('VERIFIED 타입(generalInfo 키 없음): 고지 0', () => {
    render(<App page={page(golden, [req('cage', 'REQUIRED', '케이지')])} captured={NO_CAPTURE} />);
    expect(document.querySelector('[data-ws-notice="general-info"]')).toBeNull();
    expect(count(COPY.generalInfo.notice)).toBe(0);
  });

  it('L4 를 열어도 화면 전체 고지 1회 — L4 「검수 내용」 자리는 출처 라벨(마지막 검수·검수 제목 0)', () => {
    render(<App page={page(giType, [giReq('cage', '케이지')])} captured={NO_CAPTURE} />);
    act(() => layerStore.open('L4', { typeId: giType.id, itemId: 'cage' }));
    const d = screen.getByRole('dialog', { name: '케이지' });
    const ver = d.querySelector('[data-ws-part="verified"]') as HTMLElement;
    expect(ver).not.toBeNull();
    expect(ver.querySelector('h3')).toHaveTextContent(COPY.supplyLayer.source);
    expect(ver.textContent).toContain(COPY.generalInfo.sourceLabel);
    expect(ver.textContent).not.toContain(COPY.supplyLayer.lastVerified);
    expect(d.textContent).not.toContain(COPY.supplyLayer.reviewTitle);
    expect(d.textContent).not.toContain(COPY.generalInfo.notice);
    expect(count(COPY.generalInfo.notice)).toBe(1);
  });
});
