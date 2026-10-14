// WCAG 1.4.11·1.4.1 — 라디오 선택 상태는 배경색 외 표지(테두리·✓)와 forced-colors 대응을 갖는다.
import { describe, expect, it } from 'vitest';
import specCss from './speccheck.css?raw';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vite.config css.include 가 src/styles 만 → checklist.css 는 ?raw 가 빈 문자열이라 fs 로 읽는다.
const checklistCss = readFileSync(resolve(__dirname, '../checklist/checklist.css'), 'utf8');

function block(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : '';
}

describe.each([
  ['speccheck.css', specCss, '.ws-spec-radio--on'],
  ['checklist.css', checklistCss, '.ws-setupq-radio--on'],
])('%s %s', (_name, css, cls) => {
  it('선택 규칙에 2px brand-text 테두리와 ✓ 글리프', () => {
    expect(block(css, cls)).toMatch(/border:\s*2px solid var\(--ws-brand-text\)/);
    expect(block(css, `${cls}::before`)).toMatch(/content:\s*'✓'/);
  });
  it('forced-colors 블록에서 Highlight 테두리', () => {
    const m = new RegExp(`@media \\(forced-colors: active\\)\\s*\\{[^@]*${cls.replace('.', '\\.')}[^}]*Highlight`).exec(css);
    expect(m).not.toBeNull();
  });
});
