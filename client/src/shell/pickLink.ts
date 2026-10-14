// 친구 선택 링크(K1 · 계획 51 레인 B). JS 없음·하이드레이션 전 = 정적 URL /pick(서버 프리렌더: 홈 A 부모 + 정적 L1 aside, noindex),
//   하이드레이션 후 = 클릭을 가로채 L1 레이어. 수정 키(새 탭·새 창)·보조 버튼은 브라우저 기본 동작 유지.
//   PICK_PATH 는 서버 엔진 상수(레인 A, server/src/engine/index.ts) 단일 소스 — 프리렌더 칩·CTA href 와 같은 값.
import type { MouseEvent } from 'react';

export { PICK_PATH } from '@ws/engine';

/** 친구 선택 링크 onClick — 일반 클릭만 preventDefault 후 open(). */
export function pickLinkClick(open: () => void): (e: MouseEvent<HTMLAnchorElement>) => void {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open();
  };
}
