// 산출물 HTML 경량 파서 — compliance-scan 전용(정밀 파서 아님, 프리렌더가 만드는 정형 HTML 대상). 의존성 0.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function parseAttrs(str) {
  const out = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

/**
 * 같은 이름(대소문자 무시)이 두 번 이상 나온 속성 이름 목록(소문자·첫 등장 순). parseAttrs 와 같은 토큰화.
 *   parseAttrs 는 마지막 값을 쓰지만 브라우저는 첫 값을 쓴다 — 판정이 갈릴 수 있으므로 호출 쪽이 fail-closed 로 쓴다(C10-AFF-OUT).
 */
export function dupAttrNames(str) {
  const seen = new Set();
  const dups = [];
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const k = m[1].toLowerCase();
    if (seen.has(k)) {
      if (!dups.includes(k)) dups.push(k);
    } else seen.add(k);
  }
  return dups;
}

/** <script> 블록: { attrs, body, index } — 본문은 첫 </script 까지(브라우저와 같음). */
export function scripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ attrs: parseAttrs(m[1]), rawAttrs: m[1], body: m[2], index: m.index });
  // 닫히지 않은 <script 도 보고 대상으로(본문 = 끝까지).
  return out;
}

/** 시작 태그 목록: { name, attrs, index } (script/style 본문·주석 안은 제외). */
export function tags(html) {
  const masked = maskNonMarkup(html);
  const out = [];
  const re = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(masked)) !== null) out.push({ name: m[1].toLowerCase(), attrs: parseAttrs(html.slice(m.index + 1 + m[1].length, m.index + m[0].length - 1)), index: m.index });
  return out;
}

/** script·style 본문과 주석을 같은 길이 공백으로(인덱스 보존). */
export function maskNonMarkup(html) {
  const sp = (s) => s.replace(/[^\n]/g, ' ');
  return html
    .replace(/<!--[\s\S]*?-->/g, sp)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_, a, b, c) => a + sp(b) + c)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, a, b, c) => a + sp(b) + c);
}

/** 가시 텍스트 노드: { text, index }. */
export function textNodes(html) {
  const masked = maskNonMarkup(html);
  const out = [];
  const re = />([^<]+)</g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const raw = html.slice(m.index + 1, m.index + 1 + m[1].length);
    const text = decodeEntities(raw);
    if (text.trim() !== '') out.push({ text, index: m.index + 1 });
  }
  return out;
}
