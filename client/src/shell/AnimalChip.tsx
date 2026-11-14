// 동물 칩(U2b · Kenny D1 2026-11-14: 헤더 CTA 자리를 칩으로). 프리렌더 `<a data-ws-chip href="/pick">` 와 같은 요소 — JS 없음·하이드레이션
//   전엔 정적 /pick(K1), 하이드레이션 후 일반 클릭을 가로채 L1 을 연다(수정 키·보조 버튼은 기본 동작).
//   미선택 = 채운 버튼 「친구 선택하기」(R3 시안 v1b 헤더 CTA) · 선택 = 동물 이름(R4 시안 헤더 오른쪽 글자, 아바타·▾ 없음)
//   + (이메일 연결 시 저장 점 — save/SaveDot, 마운트 시 저장 동기화 1회라 두 상태 모두 렌더).
//   서버 프리렌더 server/src/prerender/pages/common.ts renderHeader 의 칩과 같은 태그·클래스.
import type { MouseEvent } from 'react';
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import SaveDot from '../save/SaveDot';
import { PICK_PATH, pickLinkClick } from './pickLink';

export interface AnimalChipProps {
  type: Pick<PublicAnimalType, 'slug' | 'displayName'> | null;
  /** L1 이 열려 있는지(aria-expanded). */
  expanded: boolean;
  onOpen(): void;
  /** 일반 클릭으로 L1 을 열기 직전(헤더 메뉴 닫기 등) — 선택. */
  onBeforeOpen?(e: MouseEvent<HTMLAnchorElement>): void;
}

export default function AnimalChip({ type, expanded, onOpen, onBeforeOpen }: AnimalChipProps) {
  const open = pickLinkClick(onOpen);
  return (
    <a
      data-ws-chip=""
      className={type ? 'ws-chip ws-chip--selected' : 'ws-chip ws-btn ws-btn--fill'}
      href={PICK_PATH}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={(e) => {
        if (!e.defaultPrevented && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) onBeforeOpen?.(e);
        open(e);
      }}
    >
      <span className="ws-chip-name">{type ? type.displayName : COPY.nav.chooseFriend}</span>
      <SaveDot />
    </a>
  );
}
