// 서울 기준일(Asia/Seoul) 날짜 함수 — 서버 전용 작은 모듈(Intl·Date 만, 프리렌더·제휴 import 금지).
//   서버 런타임(privacy/retention.ts·reaction/anon-key.ts 등)이 이 함수 하나 때문에 prerender/cli.ts(제휴 맵 로더·프리렌더)를
//   끌어오지 않게 분리(277 B — 260·274 C10-AFF-RUNTIME WARN 원인). prerender/cli.ts 는 여기서 재 export 한다.
//   shared/ 가 아닌 이유: shared/*.ts 는 클라 번들 공용 순수 모듈이라 Date 전역 금지(engine.purity.test 'shared purity') — 시계 함수는 둘 수 없다.

/**
 * 오늘(Asia/Seoul) YYYY-MM-DD — CI `TZ=Asia/Seoul date +%F` 와 같은 뜻(S-R4 L-A). 러너 로컬 시간대(UTC 등)와 무관.
 *   scripts/lib/dates.mjs seoulToday 와 같은 구현(패리티 테스트: prerender.security-r4.test.ts).
 */
export function seoulToday(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
