// 홈 A(동물 미선택, R3 시안 v1b · 286 U3a): 히어로 → (U3b~e 섹션 자리) → 하단 CTA.
//   후기(Reviews)는 홈에서 비노출(D6, 컴포넌트는 보존) · 소개 슬라이드 삭제. 저장(/save) 유도 0. 데이터는 ws-data 만.
import type { PublicAnimalType, WsPageData } from '@ws/engine';
import Hero from './Hero';
import StartBand from './StartBand';

export interface HomeAProps {
  page: WsPageData;
  /** 저장된 동물(data.types 안) — "이어서" 링크. */
  continueType: PublicAnimalType | null;
  onPick(): void;
}

export default function HomeA({ page, continueType, onPick }: HomeAProps) {
  return (
    <main id="main" className="ws-page ws-home-a" data-ws-route={page.route.kind}>
      <Hero continueType={continueType} onPick={onPick} />
      <StartBand onPick={onPick} />
    </main>
  );
}
