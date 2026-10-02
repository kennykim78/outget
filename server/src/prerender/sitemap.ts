// sitemap.xml(순수·결정론). 빌드 시각 미기록, lastmod 는 입력값(기여 레코드 verifiedAt 최댓값, D19).
// 항목 선택(indexable 페이지만, /supplies/{item}/{type} 제외 D11)은 호출부(F2/F3) 책임.

export interface SitemapEntry {
  /** 디코드된 절대 경로. 예: "/", "/hamster/golden", "/vet/서울-마포구" */
  path: string;
  /** YYYY-MM-DD. 없으면 lastmod 생략. */
  lastmod?: string;
}

/** http(s)://host[:port] 만 허용, 후행 '/' 제거. 경로·쿼리·인증정보 있으면 throw. */
export function normalizeOrigin(origin: string): string {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new Error(`origin 이 URL 이 아니다: "${origin}"`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`origin 은 http(s) 여야 한다: "${origin}"`);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error(`origin 에 경로·쿼리·인증정보가 있으면 안 된다: "${origin}"`);
  }
  return `${u.protocol}//${u.host}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function checkDate(d: string): string {
  const m = DATE_RE.exec(d);
  if (!m) throw new Error(`sitemap: lastmod 는 YYYY-MM-DD: "${d}"`);
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, da));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== da) {
    throw new Error(`sitemap: 존재하지 않는 날짜: "${d}"`);
  }
  return d;
}

/** 디코드된 경로 → 세그먼트별 percent-encode. %·?·#·공백·제어문자·'//' 는 throw. */
export function encodeSitemapPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`sitemap: 경로는 '/' 하나로 시작: "${path}"`);
  // eslint-disable-next-line no-control-regex
  if (/[%?#\s\u0000-\u001f\u007f\\]/.test(path)) throw new Error(`sitemap: 경로에 허용되지 않는 문자: "${path}"`);
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;',
  );
}

export function buildSitemap(origin: string, entries: readonly SitemapEntry[]): string {
  const base = normalizeOrigin(origin);
  const rows = entries.map((e) => ({ path: e.path, loc: encodeSitemapPath(e.path), lastmod: e.lastmod }));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.loc)) throw new Error(`sitemap: 중복 경로 "${r.path}"`);
    seen.add(r.loc);
    if (r.lastmod !== undefined) checkDate(r.lastmod);
  }
  rows.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
  const body = rows
    .map((r) => `<url><loc>${escapeXml(base + r.loc)}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    (body ? body + '\n' : '') +
    '</urlset>\n'
  );
}
