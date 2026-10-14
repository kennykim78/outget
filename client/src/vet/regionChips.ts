// /vet 지역 칩("전체" + 지역). /vet 의 ws-data 는 전체 병원이라 지역을 바로 뽑지만, /vet/{region} 의 ws-data 는 그 지역 병원뿐이라
//   같은 문서의 프리렌더 칩(ul.ws-region-chips, captureStatic 보관분)에서 링크만 읽는다 — 같은 문서·빌드 산출물만(불변식 ①).
//   href 는 /vet 또는 /vet/{세그먼트} 만 받는다(다른 링크 0).
import type { PublicVet } from '@ws/engine';

export interface RegionChip {
  label: string;
  href: string;
  /** null = "전체". */
  region: string | null;
}

const HREF_RE = /^\/vet(?:\/[^/?#\s]+)?$/;

/** 프리렌더 지역 표기("서울 마포구") → 경로 세그먼트(공백 → '-', 서버 regionSegment 와 같은 규칙). */
export function regionSegment(region: string): string {
  return region.replace(/ /g, '-');
}

export function chipsFromVets(vets: readonly PublicVet[], allLabel: string): RegionChip[] {
  const regions = [...new Set(vets.map((v) => v.region).filter((r) => r !== ''))].sort();
  if (regions.length === 0) return [];
  return [{ label: allLabel, href: '/vet', region: null }, ...regions.map((r) => ({ label: r, href: `/vet/${encodeURI(regionSegment(r))}`, region: r }))];
}

/** 보관한 프리렌더 main HTML 에서 지역 칩 링크를 읽는다. 없거나 형식이 다르면 []. */
export function chipsFromCaptured(html: string | null): RegionChip[] {
  if (!html || typeof DOMParser === 'undefined') return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: RegionChip[] = [];
  for (const a of Array.from(doc.querySelectorAll('ul.ws-region-chips a'))) {
    const href = a.getAttribute('href') ?? '';
    const label = (a.textContent ?? '').trim();
    if (!HREF_RE.test(href) || label === '') continue;
    out.push({ label, href, region: href === '/vet' ? null : label });
  }
  return out;
}
