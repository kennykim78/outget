// 기준일 — 오늘(Asia/Seoul) YYYY-MM-DD. CI `TZ=Asia/Seoul date +%F` · server/src/config/dates.ts seoulToday 와 같은 뜻(S-R4 L-A).
//   러너 로컬 시간대(UTC 등)와 무관. 패리티: server/src/__tests__/engine.exposure.parity.test.ts.

/** @param {Date} [at] */
export function seoulToday(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
