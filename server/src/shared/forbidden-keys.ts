// 저장 금지 키 단일 소스(불변식 ⑧, 계약 C-R5-1·C-R5-2) — 서버 저장 검증기(save/validate.ts)와
//   클라이언트 localStorage 어댑터(client/src/lib/storage.ts, 별칭 @ws/forbidden-keys)가 같은 목록·같은 매칭을 쓴다.
//   R-1(QA-M 재시험): 서버 30 · 클라 26 으로 갈라져 id 가 sessionid·ws_sid·ip·useragent 인 값이 클라는 통과·서버는 400 이던 드리프트 제거.
// 매칭 규칙(양쪽 동일): 객체 키 이름 **정확 일치, 대소문자 무시**('q' 는 'quote' 를 막지 않는다). 순회(깊이 상한 등)는 각자.
// 순수 모듈 — Node·DOM API import 금지(클라 번들에 들어간다).

export const FORBIDDEN_KEY_LIST: readonly string[] = Object.freeze([
  // 위치(불변식 ⑧)
  'lat', 'lng', 'latitude', 'longitude', 'coords', 'coordinates', 'location', 'gps', 'geo', 'position',
  // 지역·주소
  'region', 'sigungu', 'address', 'postcode', 'zip',
  // 연락처·식별
  'email', 'phone',
  // 자격증명·세션
  'token', 'accesstoken', 'refreshtoken', 'refresh', 'password', 'sid', 'sessionid', 'ws_sid',
  // 요청 메타
  'ip', 'useragent',
  // 자유 질의
  'query', 'search', 'q',
]);

export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(FORBIDDEN_KEY_LIST);

/** 키 이름 하나가 금지 키인가(정확 일치·대소문자 무시). */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase());
}
