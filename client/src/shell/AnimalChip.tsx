// 동물 칩(스펙22 §2.2). 프리렌더 `<a data-ws-chip href="/pick">` 와 같은 요소 — JS 없음·하이드레이션 전엔 정적 /pick(K1),
//   하이드레이션 후 일반 클릭을 가로채 L1 을 연다(수정 키·보조 버튼은 기본 동작).
//   선택 = sm 아바타 + 이름 + (이메일 연결 시 저장 점 — save/SaveDot) + ▾ / 비었으면 "친구 선택 ▾".
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import SaveDot from '../save/SaveDot';
import AnimalAvatar from '../ui/AnimalAvatar';
import { PICK_PATH, pickLinkClick } from './pickLink';

export interface AnimalChipProps {
  type: Pick<PublicAnimalType, 'slug' | 'displayName' | 'mascot'> | null;
  /** L1 이 열려 있는지(aria-expanded). */
  expanded: boolean;
  onOpen(): void;
}

export default function AnimalChip({ type, expanded, onOpen }: AnimalChipProps) {
  return (
    <a
      data-ws-chip=""
      className={`ws-chip${type ? ' ws-chip--selected' : ''}`}
      href={PICK_PATH}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={pickLinkClick(onOpen)}
    >
      {type ? <AnimalAvatar asset={type.mascot} size="sm" tone="peach-soft" alt="" /> : null}
      <span className="ws-chip-name">{type ? type.displayName : COPY.nav.chooseFriend}</span>
      <SaveDot />{' '}
      <span className="ws-chip-caret" aria-hidden="true">
        ▾
      </span>
    </a>
  );
}
