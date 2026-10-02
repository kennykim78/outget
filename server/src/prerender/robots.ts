// robots.txt(순수·결정론). 기본 = 전면 Disallow(계획 D7). indexable === true 일 때만 Allow + Sitemap.
// indexable 은 운영 도메인 확정(Kenny 항목 §8-1) 후 WS_INDEXABLE=1 로만 켠다 — 판단은 호출부(F3).
import { normalizeOrigin } from './sitemap.js';

export interface RobotsInput {
  indexable?: boolean;
  /** indexable 일 때 필수. 예: https://withsmall.kr */
  origin?: string;
}

const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

export function buildRobots(input: RobotsInput = {}): string {
  if (input.indexable !== true) return DISALLOW_ALL;
  if (input.origin === undefined) throw new Error('robots: indexable 이면 origin 이 필요하다');
  const origin = normalizeOrigin(input.origin);
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}
