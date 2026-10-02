// 동물 칩(스펙22 §2.2). 프리렌더 `<a data-ws-chip href>` 와 같은 요소 — 하이드레이션 후 클릭을 가로채 L1 을 연다.
//   선택 = sm 아바타 + 이름 + ▾ / 비었으면 "친구 선택 ▾". 로그인 점은 R5.
import type { MouseEvent } from 'react';
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import AnimalAvatar from '../ui/AnimalAvatar';
import { typeHomeHref } from './shellType';

export interface AnimalChipProps {
  type: Pick<PublicAnimalType, 'slug' | 'displayName' | 'mascot'> | null;
  /** L1 이 열려 있는지(aria-expanded). */
  expanded: boolean;
  onOpen(): void;
}

export default function AnimalChip({ type, expanded, onOpen }: AnimalChipProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // 수정 키(새 탭 등)는 브라우저 기본 동작 유지.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen();
  };
  return (
    <a
      data-ws-chip=""
      className={`ws-chip${type ? ' ws-chip--selected' : ''}`}
      href={type ? typeHomeHref(type) : '/'}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
    >
      {type ? <AnimalAvatar asset={type.mascot} size="sm" tone="peach-soft" alt="" /> : null}
      <span className="ws-chip-name">{type ? type.displayName : COPY.nav.chooseFriend}</span>{' '}
      <span className="ws-chip-caret" aria-hidden="true">
        ▾
      </span>
    </a>
  );
}
