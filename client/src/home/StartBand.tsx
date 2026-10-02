// 홈 A ④ 시작 배너(스펙22 §2.15). 제목 + 채운 CTA(→ L1) + "가입 없이 바로 시작해요". 저장 유도 없음.
import { COPY } from '@ws/copy';

export default function StartBand({ onPick }: { onPick(): void }) {
  return (
    <section className="ws-band ws-band--start" data-ws-section="start" aria-labelledby="ws-start-title">
      <h2 id="ws-start-title" className="ws-t-title">
        {COPY.homeA.startTitle}
      </h2>
      <button type="button" className="ws-btn ws-btn--fill" data-ws-action="pick-animal" onClick={onPick}>
        {COPY.homeA.startCta}
      </button>
      <p className="ws-t-meta ws-muted">{COPY.homeA.startNote}</p>
    </section>
  );
}
