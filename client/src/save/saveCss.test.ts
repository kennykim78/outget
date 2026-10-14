// save.css 회귀(DR M-2 · m-4 · n-4) — 꼬리 버튼 전체 폭·세로 쌓기, 저장 점 래퍼 없음, 비활성 링크 ink-muted. 토큰 변수만.
import { describe, expect, it } from 'vitest';
import saveCss from '../styles/save.css?raw';

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(saveCss);
  return m ? m[1] : '';
}

describe('save.css', () => {
  it('M-2: .ws-save-foot 는 세로 flex·전체 폭, 버튼 width 100%', () => {
    const foot = rule('.ws-save-foot');
    expect(foot).toMatch(/flex-direction:\s*column/);
    expect(foot).toMatch(/width:\s*100%/);
    expect(foot).toMatch(/align-self:\s*stretch/);
    expect(rule('.ws-save-foot > .ws-btn')).toMatch(/width:\s*100%/);
  });

  it('m-4: 저장 점 래퍼 규칙 없음, 점은 6×6 brand-text', () => {
    expect(saveCss).not.toContain('.ws-save-dot-wrap');
    const dot = rule('.ws-save-dot');
    expect(dot).toMatch(/width:\s*6px/);
    expect(dot).toMatch(/height:\s*6px/);
    expect(dot).toMatch(/var\(--ws-brand-text\)/);
  });

  it('n-4: 비활성 저장 링크 = ink-muted', () => {
    const d = rule('.ws-save-link:disabled');
    expect(d).toMatch(/color:\s*var\(--ws-ink-muted\)/);
    expect(d).not.toContain('status-later');
  });

  it('색·간격은 토큰 변수만(hex 0, 그림자·그라데이션 0)', () => {
    expect(saveCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(saveCss).not.toMatch(/box-shadow|gradient/);
  });
});
