// QA95 D-1: User.lastSeenAt 갱신 규칙(순수, 의존 0 — auth 저장소가 가볍게 가져다 쓴다).
//   서울(UTC+9 고정, 서머타임 없음) 날짜가 바뀌었을 때만 1회 쓴다 → 같은 날 재방문은 쓰기 0.
//   retention.ts 의 seoulDayStartIso(seoulToday(now)) 와 같은 값(패리티 테스트: privacy.last-seen.test.ts).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** now 가 속한 서울 날짜의 00:00(KST) ISO. */
export function seoulDayStartIsoAt(now: Date): string {
  const t = now.getTime();
  return new Date(Math.floor((t + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS).toISOString();
}

/**
 * 갱신 필요 = 저장값 없음 ∨ 저장값이 오늘(서울) 00:00 이전.
 *   101 L-3: 저장값은 사용한 서울 날짜의 00:00(seoulDayStartIsoAt) — 접속 시각은 남기지 않는다(날짜 단위 최소 수집).
 *   실제 마지막 사용보다 최대 하루 이를 수 있다 — 365일 판정을 늦추지 않고 앞당길 뿐이며 그 오차는 하루 미만(이전 '그날 첫 사용 시각'
 *   저장과 같은 한계). 미래 값(시계 역행)은 갱신하지 않는다.
 */
export function needsLastSeenTouch(stored: string | null | undefined, now: Date): boolean {
  if (stored === null || stored === undefined || stored === '') return true;
  return stored < seoulDayStartIsoAt(now);
}
