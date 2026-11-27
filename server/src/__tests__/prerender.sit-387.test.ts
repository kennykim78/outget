import { describe, expect, it } from 'vitest';
import { buildSite } from '../prerender/site.js';
import { WS_DATA_MAX_BYTES } from '../prerender/cli.js';
import { BASELINE_CASES, baseOptions } from './fixtures/affiliate/baseline.js';

describe('387 SIT 확장 데이터의 화면·L4 계약', () => {
  for (const c of BASELINE_CASES) {
    const site = buildSite(c.seed(), baseOptions(c.asOf));
    const pages = site.pages.filter((p) => p.route.kind === 'SUPPLY_ITEM_TYPE');

    it(`${c.name}: 헤더 fallback은 원래 품목만, 규격 없으면 타입 홈`, () => {
      expect(pages.length).toBeGreaterThan(0);
      for (const p of pages) {
        const t = site.model.types.find((t) => t.id === p.route.typeId)!;
        const r = t.requirements.find((r) => r.item.id === p.route.itemId)!;
        const fromType = p.data.data.types.find((x) => x.id === t.id)?.specCheckItemId;
        const id = fromType || (r.pub.item.specSchema.fields.length ? r.item.id : null);
        const href = `/${t.pub.slug}${id ? `/check/${encodeURIComponent(id)}` : ''}`;
        expect(p.html.match(/data-ws-nav="spec-check" href="([^"]+)"/)?.[1], p.route.path).toBe(href);
      }
    });

    it(`${c.name}: 모든 도달 L4의 상품·재귀 대안은 타입 문서와 같고 순서·노출·크기 유지`, () => {
      for (const p of pages) {
        const t = site.model.types.find((t) => t.id === p.route.typeId)!;
        const data = p.data.data;
        const ids = new Set(data.requirements.map((r) => r.supplyItemId));
        expect(data.requirements, p.route.path).toEqual(t.requirements.filter((r) => ids.has(r.item.id)).map((r) => r.pub));
        expect(data.products, p.route.path).toEqual(t.products.filter((product) => ids.has(product.supplyItemId)));
        for (const r of data.requirements) {
          const direct = site.pages.find((x) => x.route.path === `/${t.pub.slug}/supplies/${r.supplyItemId}`)!;
          expect(direct, p.route.path).toBeDefined();
          expect(data.products.filter((x) => x.supplyItemId === r.supplyItemId), `${p.route.path} → ${r.supplyItemId}`)
            .toEqual(direct.data.data.products.filter((x) => x.supplyItemId === r.supplyItemId));
          const alternatives = t.requirements.filter((x) => r.item.alternativeIds.includes(x.item.id)).map((x) => x.pub);
          expect(data.requirements.filter((x) => r.item.alternativeIds.includes(x.supplyItemId))).toEqual(alternatives);
        }
        expect(p.wsDataBytes).toBeLessThanOrEqual(WS_DATA_MAX_BYTES);
      }
    });
  }
});
