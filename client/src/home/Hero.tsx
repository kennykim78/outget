// 홈 A ① 친구 선택(스펙22 §3.1). 마스코트 + h1 + 채운 CTA(a href=/pick → 하이드레이션 후 L1, K1) + 저장 타입 있으면 "이어서" 링크(자동 이동 없음, D-6)
//   + 기능 칩 4(→ #ws-intro-i, D-25). 부제 없음(D-26). 마스코트는 img(D-2 인라인 SVG 대신 — 보고서 참고).
import type { PublicAnimalType } from '@ws/engine';
import { COPY } from '@ws/copy';
import AnimalAvatar from '../ui/AnimalAvatar';
import { copyFmt } from '../ui/copyText';
import { PICK_PATH, pickLinkClick } from '../shell/pickLink';
import { typeHomeHref } from '../shell/shellType';

export interface HeroProps {
  continueType: Pick<PublicAnimalType, 'slug' | 'displayName' | 'mascot'> | null;
  onPick(): void;
  onFeature(index: number): void;
}

export default function Hero({ continueType, onPick, onFeature }: HeroProps) {
  const cont = continueType ? copyFmt('homeA.continueLink', { animal: continueType.displayName }) : null;
  return (
    <section className="ws-hero" data-ws-section="hero" aria-labelledby="ws-hero-title">
      <AnimalAvatar asset="group-small-mammal" size="lg" tone="brand-soft" alt="" />
      <h1 id="ws-hero-title" className="ws-t-display">
        {COPY.homeA.heroTitle}
      </h1>
      <a className="ws-btn ws-btn--fill" data-ws-action="pick-animal" href={PICK_PATH} onClick={pickLinkClick(onPick)}>
        {COPY.homeA.heroCta}
      </a>
      {continueType && cont ? (
        <a className="ws-continue ws-t-meta" href={typeHomeHref(continueType)}>
          <AnimalAvatar asset={continueType.mascot} size="md" tone="peach-soft" alt="" />
          <span>{cont}</span>
          <span aria-hidden="true"> ›</span>
        </a>
      ) : null}
      <ul className="ws-feature-chips">
        {COPY.homeA.featureChips.map((label, i) => (
          <li key={label}>
            <a
              href={`#ws-intro-${i + 1}`}
              onClick={(e) => {
                e.preventDefault();
                onFeature(i);
              }}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
