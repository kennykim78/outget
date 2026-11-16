// 미선택 상태의 의도 보존(L1 경유 → 의도 대상): 동물이 없을 때 행동(시작 카드·헤더 「크기 확인」)을 누르면 L1 을 열고,
//   동물을 고르면 그 행동의 대상(home/intent.ts intentHref)으로 한 번만 이동한다. L1 이 선택 없이 닫히면 의도를 버린다.
//   HomeA 시작 카드(286 U3b)에서 옮겨 온 같은 동작 — 헤더 메뉴(U2b, D3 ①)와 공용.
import { useEffect, useRef, useState } from 'react';
import type { LinkedAction, WsPageData } from '@ws/engine';
import { nav } from '../animal/navigate';
import { setPickHandler } from '../animal/pickHandler';
import { intentHref } from '../home/intent';
import { useOpenLayer } from '../ui/layer/useLayer';

/** 반환 = 의도를 걸고 L1 을 여는 함수. */
export function usePickIntent(page: WsPageData, openL1: () => void): (action: LinkedAction) => void {
  const openLayer = useOpenLayer();
  const [pending, setPending] = useState<LinkedAction | null>(null);
  const l1Seen = useRef(false);

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

  return (action) => {
    l1Seen.current = false;
    setPending(action);
    openL1();
  };
}
