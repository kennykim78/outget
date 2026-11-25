// 377 S1 — SW ws-html 런타임 캐시 플러그인: `Cache-Control: no-store` 응답(서버가 피드 변형 HTML 에 붙인다)은
//   담지도(cacheWillUpdate), 이미 담긴 것을 내놓지도(cachedResponseWillBeUsed) 않는다 — 가격이 든 문서가 오프라인·3초 초과
//   폴백으로 7일 캐시에서 다시 나오지 않게(fail-closed).
//   workbox generateSW 가 함수 소스를 그대로 sw.js 에 옮겨 적는다: 화살표 함수만, 바깥 변수 참조 0.
//   cacheWillUpdate 를 정의하면 NetworkFirst 기본 플러그인(200·0 만 저장)이 빠지므로 같은 조건을 여기서 지킨다.
export const wsHtmlNoStore = {
  cacheWillUpdate: async ({ response }: { response: Response }): Promise<Response | null> =>
    (response.status === 200 || response.status === 0) && !/\bno-store\b/i.test(response.headers.get('cache-control') || '')
      ? response
      : null,
  cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }): Promise<Response | null> =>
    cachedResponse && !/\bno-store\b/i.test(cachedResponse.headers.get('cache-control') || '') ? cachedResponse : null,
};
