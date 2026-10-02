// 출처 호스트 → registrable domain(M6, R3 C3). 순수 — 네트워크·DNS 조회 없음(WHATWG URL 파서만 사용).
//   FOOD/HEALTH "서로 다른 출처 2개"(V04)를 서브도메인·후행 점·대소문자·IDN 표기 차이로 우회하지 못하게 한다.
//   판정 불가(IP·localhost·점 없음·공개 접미사 자체·이상 문자)는 null — 호출자는 null 을 "출처로 세지 않음"으로 다룬다(fail-closed).
//   전체 Public Suffix List 가 아니라 시드 출처에 실제로 쓰일 2단계 접미사만 둔다(의존성 0). 목록 밖 2단계 접미사는
//   마지막 2 라벨로 묶이므로 "같은 기관을 다른 기관으로" 세는 방향의 오판은 생기지 않는다(더 엄격해질 뿐).

/** 2단계 공개 접미사(마지막 2 라벨). 여기 있으면 registrable domain 은 마지막 3 라벨. */
export const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  // .kr
  'co.kr', 'or.kr', 'go.kr', 'ac.kr', 'ne.kr', 're.kr', 'pe.kr', 'ms.kr', 'hs.kr', 'es.kr', 'sc.kr', 'kg.kr', 'mil.kr',
  // .uk
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'nhs.uk',
  // .au
  'com.au', 'org.au', 'gov.au', 'edu.au',
  // .jp
  'co.jp', 'or.jp', 'ac.jp', 'go.jp',
  // .cn
  'com.cn',
  // .nz
  'co.nz', 'org.nz',
]);

/** 호스트 입력에 허용하지 않는 문자(경로·사용자 정보·포트·쿼리·공백·IPv6 대괄호). */
const BAD_HOST_CHARS = /[\s/\\@:?#[\]%]/;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * 호스트명 → registrable domain(소문자 ASCII/punycode). 판정 불가면 null.
 * 예: a.vet.example.com → example.com, vet.snu.ac.kr → snu.ac.kr, example.com. → example.com, 127.0.0.1 → null.
 */
export function registrableDomain(host: string): string | null {
  if (typeof host !== 'string' || host.length === 0 || BAD_HOST_CHARS.test(host)) return null;
  let h = host.toLowerCase();
  while (h.endsWith('.')) h = h.slice(0, -1);
  if (h.length === 0) return null;

  // IDN → ASCII, IPv4 변형(0x7f.1 등) 정규화는 WHATWG URL 파서에 맡긴다.
  let ascii: string;
  try {
    ascii = new URL(`http://${h}/`).hostname;
  } catch {
    return null;
  }
  while (ascii.endsWith('.')) ascii = ascii.slice(0, -1);

  if (IPV4_RE.test(ascii)) return null;
  const labels = ascii.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return null;
  if (labels[labels.length - 1] === 'localhost') return null;
  // 숫자만인 TLD 는 실제 TLD 가 아니다(파서가 IPv4 로 보지 않은 잔여 숫자 형태 방어).
  if (/^\d+$/.test(labels[labels.length - 1])) return null;

  const n = MULTI_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  if (labels.length < n) return null; // 공개 접미사 자체(co.kr 등)
  return labels.slice(-n).join('.');
}

/** http(s) URL → registrable domain. 다른 스킴·파싱 실패·판정 불가는 null. */
export function registrableDomainOfUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return registrableDomain(u.hostname);
}
