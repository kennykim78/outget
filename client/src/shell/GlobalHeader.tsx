// 전역 헤더(스펙22 §2.1). header.ws-header > a.ws-logo + a[data-ws-chip] + nav.ws-nav — 프리렌더와 같은 구조·클래스.
//   ≤767 로고 + 칩(nav 숨김, 탭바가 대신) · ≥768 오른쪽 "용품 찾기"·"병원", 현재 메뉴 aria-current. 좌측 레일 없음.
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import AnimalChip from './AnimalChip';
import type { NavCurrent } from './shellType';

export interface GlobalHeaderProps {
  type: Pick<PublicAnimalType, 'slug' | 'displayName' | 'mascot'> | null;
  current: NavCurrent;
  chipExpanded: boolean;
  onChipOpen(): void;
}

export default function GlobalHeader({ type, current, chipExpanded, onChipOpen }: GlobalHeaderProps) {
  return (
    <header className="ws-header">
      <a className="ws-logo" href="/">
        {COPY.nav.logo}
      </a>
      <AnimalChip type={type} expanded={chipExpanded} onOpen={onChipOpen} />
      <nav className="ws-nav">
        <a className="ws-t-cta" href="/supplies" aria-current={current === 'supplies' ? 'page' : undefined}>
          {COPY.nav.supplies}
        </a>
        <a className="ws-t-cta" href="/vet" aria-current={current === 'vet' ? 'page' : undefined}>
          {COPY.nav.vet}
        </a>
      </nav>
    </header>
  );
}
