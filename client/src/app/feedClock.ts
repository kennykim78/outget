// 377 S1 — 피드 신선도는 문서를 받은 때가 아니라 「지금」 기기 시계로 다시 잰다(engine feedDataAt: 72h 뒤 가격 0, 168h 뒤 블록 0).
//   열어 둔 탭 = 다음 기한 타이머, 잠들었던 탭·뒤로가기 복원 = visibilitychange·pageshow.
//   HomeB 는 이 파일을 import 하지 않는다 — App 이 거른 page 를 내려 준다.
import { useEffect, useMemo, useState } from 'react';
import { feedDataAt, feedNextChangeMs, type WsPageData } from '@ws/engine';

/** 시험 주입 지점. */
export const feedClock = {
  now: (): number => Date.now(),
};

/** setTimeout 지연 상한(2^31-1). */
const MAX_DELAY_MS = 2_147_483_647;

/** page 의 data.feed 를 지금 단계로 낮춘 page(바뀔 것 없으면 같은 객체). 만료면 feed 키 자체가 없다. */
export function useLivePage(page: WsPageData): WsPageData {
  const feed = page.data.feed;
  const [, setTick] = useState(0);
  const stage = feedDataAt(feed, feedClock.now())?.stage ?? null;

  useEffect(() => {
    if (!feed) return;
    const bump = () => setTick((n) => n + 1);
    const now = feedClock.now();
    // 렌더와 effect 사이에 기한을 넘겼으면 다음 타이머를 기다리지 않고 다시 그린다(378 D1).
    if ((feedDataAt(feed, now)?.stage ?? null) !== stage) bump();
    const at = feedNextChangeMs(feed, now);
    const timer = at === null ? undefined : setTimeout(bump, Math.min(Math.max(at - now, 0), MAX_DELAY_MS));
    document.addEventListener('visibilitychange', bump);
    window.addEventListener('pageshow', bump);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', bump);
      window.removeEventListener('pageshow', bump);
    };
  });

  return useMemo(() => {
    if (!feed || stage === feed.stage) return page;
    const live = stage === null ? undefined : feedDataAt(feed, feedClock.now());
    const { feed: _stale, ...data } = page.data;
    void _stale;
    return { ...page, data: live ? { ...data, feed: live } : data };
  }, [page, feed, stage]);
}
