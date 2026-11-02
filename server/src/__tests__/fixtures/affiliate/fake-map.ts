// 259 시험용 가짜 제휴 맵 — 코드는 명백한 가짜(FAKE + 4자리)만(106 §6.9: 실 링크·미등록 도메인 노출 금지).
import { buildSearchLinks, type SeedBundle } from '../../../engine/index.js';
import type { AffiliateLinkMap, AffiliateMapFile } from '../../../prerender/affiliate.js';
import { buildSite, type BuildSiteOptions } from '../../../prerender/site.js';

export const fakeCode = (i: number): string => `FAKE${String(i + 1).padStart(4, '0')}`;

/** 꺼짐 빌드의 모든 검색어(타입·요구사항 순, 중복 제거). */
export function buildKeywords(seed: SeedBundle, opts: BuildSiteOptions): string[] {
  const b = buildSite(seed, opts);
  return [...new Set(b.model.types.flatMap((t) => t.requirements.map((r) => r.pub.searchKeyword)))].filter((k) => k !== '');
}

/** 검색어마다 가짜 코드(FAKE0001…). */
export function fakeLinkMap(keywords: readonly string[]): AffiliateLinkMap {
  return new Map(keywords.map((k, i) => [k, { COUPANG: fakeCode(i) }]));
}

/** 맵 파일 형태(parseAffiliateMap 입력). */
export function fakeMapFile(keywords: readonly string[], generatedAt = '2026-11-02'): AffiliateMapFile {
  return {
    v: 1,
    provider: 'COUPANG',
    subId: 'fixture',
    source: 'MANUAL',
    generatedAt,
    entries: keywords.map((keyword, i) => ({
      keyword,
      landingUrl: (buildSearchLinks(keyword).find((l) => l.provider === 'COUPANG') as { href: string }).href,
      code: fakeCode(i),
    })),
  };
}
