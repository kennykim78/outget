// 홈 A ④ 시작 배너(스펙22 §2.15). 제목 + 채운 CTA(a href=/pick → 하이드레이션 후 L1, K1) + "가입 없이 바로 시작해요". 저장 유도 없음.
import { COPY } from '@ws/copy';
import { PICK_PATH, pickLinkClick } from '../shell/pickLink';

export default function StartBand({ onPick }: { onPick(): void }) {
  return (
    <section className="ws-band ws-band--start" data-ws-section="start" aria-labelledby="ws-start-title">
      <h2 id="ws-start-title" className="ws-t-title">
        {COPY.homeA.startTitle}
      </h2>
      <a className="ws-btn ws-btn--fill" data-ws-action="pick-animal" href={PICK_PATH} onClick={pickLinkClick(onPick)}>
        {COPY.homeA.startCta}
      </a>
      <p className="ws-t-meta ws-muted">{COPY.homeA.startNote}</p>
    </section>
  );
}
