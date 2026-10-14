// 홈 A(동물 미선택, 스펙22 §3.1 · UX §3.1 A): ① 친구 선택 → ② 실제 이용 후기(0이면 없음) → ③ 소개 → ④ 시작 배너. 4섹션 고정.
//   "요즘 많이 찾는 준비"는 R4 데이터 0 → 숨김. 저장(/save) 유도 0. 데이터는 ws-data 만.
import { useEffect, useRef, useState } from 'react';
import type { LinkedAction, PublicAnimalType, WsPageData } from '@ws/engine';
import { nav } from '../animal/navigate';
import { setPickHandler } from '../animal/pickHandler';
import { useOpenLayer } from '../ui/layer/useLayer';
import Hero from './Hero';
import { intentHref } from './intent';
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
  const openLayer = useOpenLayer();
  // 미선택 상태에서 눌린 후기 행동 — L1 에서 동물을 고르면 그 행동의 대상으로 이동한다.
  const [pending, setPending] = useState<LinkedAction | null>(null);
  const l1Seen = useRef(false);

  // 후기 행동: VET 은 /vet 링크(카드 안). 나머지는 선택된 동물이 있으면 바로 대상으로, 없으면 L1(의도 보존).
  const onAction = (a: LinkedAction) => {
    if (a === 'VET') return;
    if (continueType) {
      nav.assign(intentHref(a, continueType, page));
      return;
    }
    l1Seen.current = false;
    setPending(a);
    onPick();
  };

  // 의도가 있을 때만 L1 선택 핸들러 등록 — AnimalPicker 기본 이동 대신 의도 대상으로 한 번만 이동(이중 이동 방지). 없으면 기본 이동 유지.
  useEffect(() => {
    if (pending === null) return;
    const off = setPickHandler((type) => {
      setPending(null);
      nav.assign(intentHref(pending, type, page));
      return true;
    });
    return off;
  }, [pending, page]);

  // L1 이 열렸다가 선택 없이 닫히면 의도를 버린다.
  useEffect(() => {
    if (pending === null) return;
    if (openLayer?.kind === 'L1') l1Seen.current = true;
    else if (l1Seen.current) setPending(null);
  }, [pending, openLayer]);

  return (
    <main id="main" className="ws-page ws-home-a" data-ws-route={page.route.kind}>
      <Hero continueType={continueType} onPick={onPick} onFeature={(i) => intro.current?.goTo(i)} />
      <Reviews testimonials={page.data.testimonials} types={page.data.types} onAction={onAction} vetAvailable={page.data.vets.length > 0} />
      <IntroSlides ref={intro} onTry={onPick} />
      <StartBand onPick={onPick} />
    </main>
  );
}
