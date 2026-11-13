// 홈 A 히어로(R3 시안 v1b, 286 U3a). 큰 한 문장 h1 + 부제 + 선택 바 1(a href=/pick — 입력 아님, 하이드레이션 후 L1, K1)
//   + 저장 타입 있으면 "이어서" 링크(자동 이동 없음, D-6 — 클라이언트 전용). 기능 칩·마스코트 없음(시안).
//   서버 프리렌더 server/src/prerender/pages/misc.ts homeParts 와 같은 태그·클래스·id(parity 시험 2종).
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import AnimalAvatar from '../ui/AnimalAvatar';
import { copyFmt } from '../ui/copyText';
import { PICK_PATH, pickLinkClick } from '../shell/pickLink';
import { typeHomeHref } from '../shell/shellType';

export interface HeroProps {
  continueType: Pick<PublicAnimalType, 'slug' | 'displayName' | 'mascot'> | null;
  onPick(): void;
}

/** 선택 바 화살표(장식) — 서버 misc.ts PICK_BAR_ARROW 와 같은 SVG. */
export function PickBarArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export default function Hero({ continueType, onPick }: HeroProps) {
  const cont = continueType ? copyFmt('homeA.continueLink', { animal: continueType.displayName }) : null;
  return (
    <section className="ws-hero" data-ws-section="hero" aria-labelledby="ws-hero-title">
      <h1 id="ws-hero-title" className="ws-t-display ws-hero-title">
        {COPY.homeA.heroTitle}
      </h1>
      <p className="ws-t-body ws-muted ws-hero-sub">{COPY.homeA.heroSub}</p>
      <a className="ws-pick-bar" data-ws-action="pick-animal" href={PICK_PATH} onClick={pickLinkClick(onPick)}>
        <span className="ws-pick-bar-label">{COPY.homeA.heroBar}</span>
        <span className="ws-pick-bar-go">
          <PickBarArrow />
        </span>
      </a>
      {continueType && cont ? (
        <a className="ws-continue ws-t-meta" href={typeHomeHref(continueType)}>
          <AnimalAvatar asset={continueType.mascot} size="md" tone="peach-soft" alt="" />
          <span>{cont}</span>
          <span aria-hidden="true"> ›</span>
        </a>
      ) : null}
    </section>
  );
}
