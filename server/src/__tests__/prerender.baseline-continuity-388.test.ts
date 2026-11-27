// 388 D3의 42파일에 옛 빈 conditions 구획만 복원해 갱신 전 기준선과의 바이트 연속성을 증명한다.
// 이후 의도한 산출물 변경이 이 파일들을 바꾸면 같은 방식의 증거를 남긴 뒤 이 시험·픽스처를 지운다.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildSite, type SiteBuild } from '../prerender/site.js';
import { BASELINE_CASES, baseOptions, sha256 } from './fixtures/affiliate/baseline.js';

type CaseName = 'real' | 'dwarfPreview';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/affiliate/pre388d3-baseline.sha256.json', import.meta.url), 'utf8')) as Record<CaseName, Record<string, string>>;

// _workspace/388b_baseline_diff_w2.txt의 집합을 픽스처 키와 독립적으로 고정한다(용품마다 두 경로).
const paths = (typeId: string, slug: string, items: readonly string[]): string[] =>
  items.flatMap((item) => [`${slug}/supplies/${item}/index.html`, `supplies/${item}/${typeId}/index.html`]);
const dwarfPaths = paths('hamster-dwarf', 'hamster/dwarf', ['food', 'saucer', 'thermo', 'water']);
const expectedFiles: Record<CaseName, string[]> = {
  real: [
    ...paths('hamster-golden', 'hamster/golden', ['carrier', 'chew', 'food', 'saucer', 'thermo', 'water']),
    ...dwarfPaths,
    ...paths('gerbil-mongolian', 'gerbil', ['carrier', 'sand-bath-box', 'thermo']),
    ...paths('guinea-pig', 'guinea-pig', ['brush', 'carrier', 'thermo', 'water']),
  ].sort(),
  dwarfPreview: [...dwarfPaths].sort(),
};
// D3 이전 layerL4는 why 직후에 이 두 줄을 냈다(빈 rules 문자열은 filter로 제거).
const oldConditions = '<section data-ws-part="conditions"><h3>조건</h3>\n</section>\n';
const cases = [{ name: 'real', count: 34 }, { name: 'dwarfPreview', count: 8 }] as const;

it('388 D3의 보존 집합은 real 34·dwarfPreview 8, 총 42파일이다', () => {
  expect(Object.keys(baseline).sort()).toEqual(['dwarfPreview', 'real']);
  for (const { name, count } of cases) {
    expect(expectedFiles[name], name).toHaveLength(count);
    expect(new Set(expectedFiles[name]).size, name).toBe(count);
    expect(Object.keys(baseline[name]).sort(), name).toEqual(expectedFiles[name]);
  }
  expect(Object.values(baseline).flatMap((files) => Object.keys(files))).toHaveLength(42);
});

describe.each(cases)('388 D3 기준선 연속성 — $name', ({ name }) => {
  let site: SiteBuild;
  beforeAll(() => {
    const c = BASELINE_CASES.find((entry) => entry.name === name)!;
    site = buildSite(c.seed(), baseOptions(c.asOf));
  });

  it.each(expectedFiles[name])('%s: 빈 conditions를 정확히 한 번 복원하면 옛 sha256과 같다', (file) => {
    const label = `${name}/${file}`;
    const html = site.files.get(file);
    expect(html, label).toBeDefined();
    const current = html!;
    expect(current, label).not.toMatch(/data-ws-part=["']conditions["']/);
    const layers = [...current.matchAll(/<aside\b[^>]*\bdata-ws-layer="L4"[^>]*>[\s\S]*?<\/aside>/g)];
    expect(layers, label).toHaveLength(1);
    const layer = layers[0];
    const anchors = [...layer[0].matchAll(/<section data-ws-part="why"><h3>[^<]*<\/h3><p>[\s\S]*?<\/p><\/section>\n/g)];
    expect(anchors, label).toHaveLength(1);
    const anchor = anchors[0];
    const at = layer.index! + anchor.index! + anchor[0].length;
    const restored = current.slice(0, at) + oldConditions + current.slice(at);
    expect(restored.match(/data-ws-part="conditions"/g), label).toHaveLength(1);
    expect(baseline[name][file], label).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(restored), label).toBe(baseline[name][file]);
  });
});
