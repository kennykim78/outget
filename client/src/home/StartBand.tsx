// 홈 A 하단 CTA(R3 시안 v1b, 286 U3a — 기존 시작 배너 개조). 왼쪽 문장(제목 + 한 줄) · 오른쪽 채운 버튼 1(a href=/pick → 하이드레이션 후 L1, K1).
//   ≤767 세로 쌓임. 배경 없음(시안). 저장 유도 없음. 서버 misc.ts homeParts 와 같은 마크업.
import { COPY } from '@ws/copy';
import { PICK_PATH, pickLinkClick } from '../shell/pickLink';

export default function StartBand({ onPick }: { onPick(): void }) {
  return (
    <section className="ws-start" data-ws-section="start" aria-labelledby="ws-start-title">
      <div className="ws-start-text">
        <h2 id="ws-start-title" className="ws-t-display ws-start-title">
          {COPY.homeA.startTitle}
        </h2>
        <p className="ws-t-body ws-muted">{COPY.homeA.startBody}</p>
      </div>
      <a className="ws-btn ws-btn--fill" data-ws-action="pick-animal" href={PICK_PATH} onClick={pickLinkClick(onPick)}>
        {COPY.homeA.startCta}
      </a>
    </section>
  );
}
