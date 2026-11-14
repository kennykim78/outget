// 전역 헤더(U2b · R3 v1b / R4 시안, Kenny D1·D2·D3 2026-11-14). 서버 renderHeader(server/src/prerender/pages/common.ts)와 같은 구조·클래스:
//   header.ws-header > a.ws-skip-link · a.ws-logo · button.ws-menu-btn · nav#ws-nav.ws-nav(준비물 · 크기 확인 · 병원 · 동물 칩).
//   ≥768: 로고 · 메뉴 3 · 오른쪽 칩(미선택 「친구 선택하기」 채운 버튼 / 선택 = 동물 이름). 메뉴 단추 숨김.
//   ≤767: 로고 + 「메뉴」 단추(하단 탭바 대체, D2) — 펼치면 헤더 아래 패널(nav). 공개 패턴(disclosure navigation):
//     aria-expanded·aria-controls, 열면 첫 링크로 포커스, Esc = 닫고 단추로 포커스 복귀, 헤더 밖으로 포커스가 나가면 닫힘.
//     포커스 트랩 없음 — 모달이 아니다(스크림·inert 없음, 뒤 페이지 조작 가능). WAI-ARIA APG Disclosure Navigation 과 같은 근거.
//   「크기 확인」(D3 ①): 동물 있으면 intentHref('SPEC_CHECK')(같은 문서면 layerLinks 가 L5 push), 없으면 /pick + L1 경유 의도 보존.
import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import type { PublicAnimalType, WsPageData } from '@ws/engine';
import { COPY } from '@ws/copy';
import { intentHref } from '../home/intent';
import AnimalChip from './AnimalChip';
import { PICK_PATH, pickLinkClick } from './pickLink';
import type { NavCurrent } from './shellType';

/** nav id(메뉴 단추 aria-controls) — 서버 common.ts NAV_ID 와 같은 값. */
export const NAV_ID = 'ws-nav';

export interface GlobalHeaderProps {
  type: Pick<PublicAnimalType, 'id' | 'slug' | 'displayName'> | null;
  current: NavCurrent;
  /** 이 문서 ws-data — 「크기 확인」 대상 계산(서버 specCheckHref 와 같은 입력). */
  page: WsPageData;
  chipExpanded: boolean;
  onChipOpen(): void;
  /** 미선택 「크기 확인」 — L1 을 열고 의도(SPEC_CHECK)를 보존한다(shell/usePickIntent). */
  onSpecCheckIntent(): void;
}

export default function GlobalHeader({ type, current, page, chipExpanded, onChipOpen, onSpecCheckIntent }: GlobalHeaderProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // 열면 첫 링크로 포커스(메뉴 단추로 연 경우만 — open 이 false→true 로 바뀔 때).
  useEffect(() => {
    if (open) navRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
  }, [open]);

  // Esc = 닫고 단추로 포커스 복귀. 레이어가 열려 있으면(Esc 는 레이어 몫) 메뉴는 이미 닫혀 있다(아래 closeForLayer).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // 헤더 밖으로 포커스가 나가면 닫는다(포커스는 빼앗지 않는다).
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!open) return;
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setOpen(false);
  };

  // 메뉴 안에서 레이어를 여는 링크(칩·크기 확인) — 열기 전에 메뉴를 닫고 포커스를 메뉴 단추로(레이어가 닫히면 보이는 단추로 복귀).
  //   ≥768 에선 단추가 숨겨져 focus() 가 무시되므로 누른 링크에 포커스가 남는다.
  const closeForLayer = () => {
    if (!open) return;
    setOpen(false);
    btnRef.current?.focus();
  };

  // 메뉴 링크로 문서 이동 시에도 닫는다(뒤로 가기 bfcache 복원 때 펼친 채 남지 않게).
  const onNavClick = (e: MouseEvent<HTMLElement>) => {
    const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (a && !a.hasAttribute('data-ws-chip') && a.getAttribute('data-ws-nav') !== 'spec-check') setOpen(false);
  };

  const specHref = type ? intentHref('SPEC_CHECK', type, page) : PICK_PATH;
  const specIntent = pickLinkClick(onSpecCheckIntent);

  return (
    <header className="ws-header" onBlur={onBlur}>
      <a className="ws-skip-link" href="#main">
        {COPY.nav.skipToMain}
      </a>
      <a className="ws-logo" href="/">
        {COPY.nav.logo}
      </a>
      <button ref={btnRef} type="button" className="ws-menu-btn" aria-expanded={open} aria-controls={NAV_ID} onClick={() => setOpen((x) => !x)}>
        {COPY.nav.menu}
      </button>
      <nav ref={navRef} className="ws-nav" id={NAV_ID} aria-label={COPY.nav.menuLabel} onClick={onNavClick}>
        <a href="/supplies" aria-current={current === 'supplies' ? 'page' : undefined}>
          {COPY.nav.menuSupplies}
        </a>
        <a
          data-ws-nav="spec-check"
          href={specHref}
          onClick={(e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            closeForLayer();
            if (!type) specIntent(e);
          }}
        >
          {COPY.nav.menuSpecCheck}
        </a>
        <a href="/vet" aria-current={current === 'vet' ? 'page' : undefined}>
          {COPY.nav.vet}
        </a>
        <AnimalChip type={type} expanded={chipExpanded} onOpen={onChipOpen} onBeforeOpen={closeForLayer} />
      </nav>
    </header>
  );
}
