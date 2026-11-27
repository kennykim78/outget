import { describe, expect, it } from 'vitest';
import { COPY } from '../prerender/copy.js';
import { layerL4 } from '../prerender/pages/type.js';
import { projectSite, type RequirementModel } from '../prerender/project.js';
import { buildSite } from '../prerender/site.js';
import { BASELINE_CASES, REAL_AS_OF, baseOptions } from './fixtures/affiliate/baseline.js';
import { realSeed } from './fixtures/prerender-seed.js';

const model = projectSite(realSeed(), REAL_AS_OF);
const golden = model.types.find((t) => t.id === 'hamster-golden')!;
const saucer = golden.requirements.find((r) => r.item.id === 'saucer')!;
const conditions = (html: string): string | null =>
  html.match(/<section data-ws-part="conditions">[\s\S]*?<\/section>/)?.[0] ?? null;

describe('388 D3: L4 조건 구획', () => {
  it('최소·권장 규칙이 모두 없으면 제목까지 구획 전체를 생략한다', () => {
    expect(saucer.pub.minSpec.rules).toEqual([]);
    expect(saucer.pub.recommendedSpec.rules).toEqual([]);
    expect(conditions(layerL4(golden, saucer))).toBeNull();
  });

  it('규칙이 있어도 라벨 없는 enum 행이 모두 숨겨지면 구획을 생략한다', () => {
    const item = { ...saucer.item, specSchema: { fields: [{ key: 'kind', label: '종류', type: 'enum' as const, options: ['RAW'] }] } };
    const spec = { rules: [{ key: 'kind', op: 'eq' as const, value: 'RAW' }] };
    const r: RequirementModel = { ...saucer, item, pub: { ...saucer.pub, item: { ...saucer.pub.item, specSchema: item.specSchema }, minSpec: spec, recommendedSpec: spec } };
    expect(conditions(layerL4(golden, r))).toBeNull();
  });

  it.each([[true, false], [false, true], [true, true]])('최소=%s·권장=%s: 표시 행이 있으면 기존 구획 바이트를 유지한다', (min, recommended) => {
    const item = { ...saucer.item, specSchema: { fields: [{ key: 'size', label: '크기', type: 'number' as const }] } };
    const rule = { key: 'size', op: 'gte' as const, value: 28, reason: '시험 <이유>' };
    const r: RequirementModel = {
      ...saucer, item,
      pub: { ...saucer.pub, item: { ...saucer.pub.item, specSchema: item.specSchema }, minSpec: { rules: min ? [rule] : [] }, recommendedSpec: { rules: recommended ? [rule] : [] } },
    };
    const rows = '<ul>\n<li>크기 28 이상 — 시험 &lt;이유&gt;</li>\n</ul>';
    expect(conditions(layerL4(golden, r))).toBe([
      `<section data-ws-part="conditions"><h3>${COPY.supplyLayer.conditions}</h3>`,
      ...(min ? [`<h4>${COPY.supplyLayer.min}</h4>\n${rows}`] : []),
      ...(recommended ? [`<h4>${COPY.supplyLayer.recommended}</h4>\n${rows}`] : []),
      '</section>',
    ].join('\n'));
  });

  it.each(BASELINE_CASES)('$name: TYPE·SUPPLY_ITEM_TYPE 정적 L4에 내용 없는 조건 구획이 없다', (c) => {
    const site = buildSite(c.seed(), baseOptions(c.asOf));
    expect(site.pages.some((p) => p.data.layer?.kind === 'L4')).toBe(true);
    if (c.name === 'real') expect(site.pages.find((p) => p.route.path === '/supplies/saucer/hamster-golden')).toBeDefined();
    const empty = site.pages.filter((p) => {
      const section = conditions(p.html);
      return section !== null && !section.includes('<li>');
    }).map((p) => p.route.path);
    expect(empty).toEqual([]);
  });
});
