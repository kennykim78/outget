// 홈 A(동물 미선택, 스펙22 §3.1 · UX §3.1 A): ① 친구 선택 → ② 실제 이용 후기(0이면 없음) → ③ 소개 → ④ 시작 배너. 4섹션 고정.
//   "요즘 많이 찾는 준비"는 R4 데이터 0 → 숨김. 저장(/save) 유도 0. 데이터는 ws-data 만.
import { useRef } from 'react';
import type { LinkedAction, PublicAnimalType, WsPageData } from '@ws/engine';
import Hero from './Hero';
import IntroSlides, { type IntroSlidesHandle } from './IntroSlides';
import Reviews from './Reviews';
import StartBand from './StartBand';

export interface HomeAProps {
  page: WsPageData;
  /** 저장된 동물(data.types 안) — "이어서" 링크. */
  continueType: PublicAnimalType | null;
  onPick(): void;
}

export default function HomeA({ page, continueType, onPick }: HomeAProps) {
  const intro = useRef<IntroSlidesHandle>(null);
  // 후기 행동: VET 은 /vet 링크(카드 안), 나머지(CHECKLIST·SPEC_CHECK·SETUP)는 미선택 홈이므로 L1.
  const onAction = (a: LinkedAction) => {
    if (a !== 'VET') onPick();
  };
  return (
    <main className="ws-page ws-home-a" data-ws-route={page.route.kind}>
      <Hero continueType={continueType} onPick={onPick} onFeature={(i) => intro.current?.goTo(i)} />
      <Reviews testimonials={page.data.testimonials} types={page.data.types} onAction={onAction} vetAvailable={page.data.vets.length > 0} />
      <IntroSlides ref={intro} onTry={onPick} />
      <StartBand onPick={onPick} />
    </main>
  );
}
