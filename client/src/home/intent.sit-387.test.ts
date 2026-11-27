import { describe, expect, it } from 'vitest';
import { golden, pageOf, req } from '../test/fixtures';
import { intentHref } from './intent';

const cage = req('cage', 'REQUIRED');
cage.item.specSchema.fields = [{ key: 'width', label: '폭', type: 'number', min: 1, max: 500 }];
const wheel = { ...req('wheel', 'REQUIRED'), item: { ...req('wheel', 'REQUIRED').item, specSchema: cage.item.specSchema } };

describe('387 SIT intent fallback', () => {
  it.each([wheel, req('bowl', 'REQUIRED')])('SIT는 route 품목 $supplyItemId만 fallback 후보', (item) => {
    const page = pageOf('SUPPLY_ITEM_TYPE', { requirements: [cage, item] }, { typeId: golden.id });
    page.route.itemId = item.supplyItemId;
    const old = { ...page, data: { ...page.data, requirements: [item] } };
    expect(intentHref('SPEC_CHECK', golden, page)).toBe(intentHref('SPEC_CHECK', golden, old));
  });

  it('다른 route·명시 specCheckItemId·다른 intent의 기존 규칙 유지', () => {
    const page = pageOf('TYPE', { requirements: [cage, wheel] }, { typeId: golden.id });
    expect(intentHref('SPEC_CHECK', golden, page)).toBe('/hamster/golden/check/cage');
    page.route.kind = 'SUPPLY_ITEM_TYPE';
    page.route.itemId = 'wheel';
    page.data.types = [{ ...golden, specCheckItemId: 'explicit' }];
    expect(intentHref('SPEC_CHECK', golden, page)).toBe('/hamster/golden/check/explicit');
    expect(intentHref('CHECKLIST', golden, page)).toBe('/hamster/golden');
    expect(intentHref('SETUP', golden, page)).toBe('/hamster/golden');
    expect(intentHref('VET', golden, page)).toBe('/vet');
  });
});
