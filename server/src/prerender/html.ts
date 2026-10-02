// 프리렌더 HTML 이스케이프 부품(순수). 모든 시드 텍스트는 escapeHtml/escapeAttr 를 거친다(계획 §6-2).

const HTML_ESC: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 텍스트 노드용. & < > " ' 를 엔티티로. */
export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);
}

/** 속성 값용(항상 큰따옴표로 감싸 쓴다). escapeHtml + 백틱(구형 IE 비인용 속성 탈출 방지). */
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

// U+2028/U+2029 는 소스에 리터럴·\u 표기로 두지 않는다(편집 도구가 실제 줄 구분자로 바꾼 적 있음).
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const BS = String.fromCharCode(0x5c); // 역슬래시

const JSON_ESC: Readonly<Record<string, string>> = {
  '<': BS + 'u003c',
  '>': BS + 'u003e',
  '&': BS + 'u0026',
  [LS]: BS + 'u2028',
  [PS]: BS + 'u2029',
};
const JSON_ESC_RE = new RegExp(`[<>&${LS}${PS}]`, 'g');

/**
 * `<script type="application/json">` · `ld+json` 본문용 직렬화.
 * < > & U+2028 U+2029 를 \u 이스케이프 → 결과에 `</`·`<!--` 가 생길 수 없다. JSON.parse 왕복 보존.
 * 직렬화 결과가 없으면(undefined·함수·심볼) throw.
 */
export function jsonForScript(value: unknown): string {
  const raw: string | undefined = JSON.stringify(value);
  if (typeof raw !== 'string') throw new TypeError('jsonForScript: JSON 으로 직렬화할 수 없는 값');
  return raw.replace(JSON_ESC_RE, (c) => JSON_ESC[c]);
}
