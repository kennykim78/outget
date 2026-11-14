// 홈 A(동물 미선택, R3 시안 v1b · 286 U3a~U3e): 히어로 → 「처음 준비, 여기서 시작해요」 시작 카드 3 → 설명 섹션(Explain: 필요/불필요 · 숫자 · 함께 살 집 · 병원) → 하단 CTA.
//   후기(Reviews)는 홈에서 비노출(D6, 컴포넌트는 보존) · 소개 슬라이드 삭제. 저장(/save) 유도 0. 데이터는 ws-data 만.
//   시작 카드 의도 보존: 미선택에서 카드를 누르면 L1 을 열고, 동물을 고르면 그 카드의 대상(intent.ts)으로 이동한다(shell/usePickIntent).
import type { PublicAnimalType, WsPageData } from '@ws/engine';
import { usePickIntent } from '../shell/usePickIntent';
import Explain from './Explain';
import Hero from './Hero';
import StartBand from './StartBand';
import StartCards from './StartCards';

export interface HomeAProps {
  page: WsPageData;
  /** 저장된 동물(data.types 안) — "이어서" 링크 · 시작 카드 직행 대상. */
  continueType: PublicAnimalType | null;
  onPick(): void;
}

export default function HomeA({ page, continueType, onPick }: HomeAProps) {
  // 미선택 상태에서 눌린 시작 카드 의도 — L1 에서 동물을 고르면 그 대상으로 이동한다.
  const onIntent = usePickIntent(page, onPick);

  return (
    <main id="main" className="ws-page ws-home-a" data-ws-route={page.route.kind}>
      <Hero continueType={continueType} onPick={onPick} />
      <StartCards page={page} selected={continueType} onIntent={onIntent} />
      <Explain page={page} />
      <StartBand onPick={onPick} />
    </main>
  );
}
