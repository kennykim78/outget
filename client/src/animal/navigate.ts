// 문서 이동(23 plan D4 — 동물 전환은 location.assign). 테스트는 nav.assign 을 바꿔 끼운다(jsdom location 은 교체 불가).
export const nav = {
  assign(href: string): void {
    window.location.assign(href);
  },
};
