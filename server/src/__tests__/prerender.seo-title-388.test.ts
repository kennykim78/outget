import { describe, expect, it } from 'vitest';
import { decodeWsPage, encodeWsPage } from '../engine/ws-wire.js';
import { COPY, formatCopy } from '../prerender/copy.js';
import { escapeHtml } from '../prerender/html.js';
import { renderTypePage } from '../prerender/pages/type.js';
import { projectSite } from '../prerender/project.js';
import { planRoutes } from '../prerender/routes.js';
import { buildSite } from '../prerender/site.js';
import { REAL_AS_OF, baseOptions } from './fixtures/affiliate/baseline.js';
import { realSeed } from './fixtures/prerender-seed.js';

describe('388 D2: 공개 타입 seoTitle 투영', () => {
  it.each([
    ['있음', '  맞춤 <타입> 제목  '],
    ['없음', undefined],
    ['null', null],
    ['빈 문자열', ''],
    ['공백', ' \t\n '],
  ] as const)('%s: 키 유무·원문·프리렌더 제목이 일치한다', (_label, seoTitle) => {
    const seed = realSeed();
    const raw = seed.animalTypes.find((t) => t.id === 'hamster-golden')!;
    if (seoTitle === undefined) delete raw.seoTitle;
    else raw.seoTitle = seoTitle;
    const model = projectSite(seed, REAL_AS_OF);
    const type = model.types.find((t) => t.id === raw.id)!;
    const hasSeo = seoTitle !== undefined && seoTitle !== null && seoTitle.trim() !== '';
    expect(Object.hasOwn(type.pub, 'seoTitle')).toBe(hasSeo);
    if (hasSeo) {
      expect(type.pub.seoTitle).toBe(seoTitle);
      expect(Object.keys(type.pub).at(-1)).toBe('seoTitle');
    }
    const route = planRoutes(model).find((r) => r.kind === 'TYPE' && r.typeId === raw.id && r.layer === null)!;
    const page = renderTypePage(model, { origin: 'https://example.test', route, catalogUrl: '/data/catalog.json', mascots: new Map() }, type);
    const expected = hasSeo ? seoTitle : formatCopy(COPY.site.typeTitle, { animal: type.pub.displayName }) + COPY.site.titleSuffix;
    expect(page.head).toContain(`<title>${escapeHtml(expected)}</title>`);
    const decoded = decodeWsPage(JSON.parse(JSON.stringify(encodeWsPage(page.data))))!;
    const publicType = decoded.data.types.find((t) => t.id === raw.id)!;
    expect(Object.hasOwn(publicType, 'seoTitle')).toBe(hasSeo);
    expect(publicType.seoTitle ?? formatCopy(COPY.site.typeTitle, { animal: publicType.displayName }) + COPY.site.titleSuffix).toBe(expected);
    expect(raw.seoTitle).toBe(seoTitle);
  });

  it('현재 시드: 공개 페이지 모델에 seoTitle 키 없음(v1 바이트는 T-③b-v1)', () => {
    const seed = realSeed();
    expect(seed.animalTypes.length).toBeGreaterThan(0);
    expect(seed.animalTypes.every((t) => t.seoTitle == null || t.seoTitle.trim() === '')).toBe(true);
    const site = buildSite(seed, baseOptions(REAL_AS_OF));
    expect(site.pages.length).toBeGreaterThan(0);
    for (const page of site.pages) {
      for (const type of page.data.data.types) expect(Object.hasOwn(type, 'seoTitle')).toBe(false);
    }
  });
});
