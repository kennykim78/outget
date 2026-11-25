// 385(381 D2): 피드 블록 제목 기억 — JSON 을 읽기 전(하이드레이션·로딩·실패)에도 프리렌더와 같은 제목을 쓰려고 품목별 popular 만 들고 있는다(탭 메모리).
//   원천 = ① 이 문서 정적 L4 의 블록 제목(boot) ② 읽어 온 블록의 popular(FeedSection). 의존성 0(boot 가 feedBlock 지연 청크를 끌어오지 않게).
//   둘 다 없으면(문서 안 이동으로 처음 여는 품목) 기본 제목 「몰 검색 결과」.
const popular = new Set<string>();

export function resetFeedTitleForTest(): void {
  popular.clear();
}

export function rememberFeedPopular(typeId: string, itemId: string, on: boolean): void {
  if (on) popular.add(`${typeId}/${itemId}`);
  else popular.delete(`${typeId}/${itemId}`);
}

export function rememberedFeedPopular(typeId: string, itemId: string): boolean {
  return popular.has(`${typeId}/${itemId}`);
}
