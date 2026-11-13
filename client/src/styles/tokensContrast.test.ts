// 토큰 v2.0(R3 순백+청록) 대비 검사 — 글자 색 × 바탕 색 WCAG 1.4.3 ≥4.5:1, 초점 링 1.4.11 ≥3:1.
//   값은 생성 산출물 tokens.css(:root) 에서 읽는다(tokens.json → gen-tokens.mjs). 상태 5색은 기존 대응 유지,
//   later 문구는 ink-muted 와 같은 값(v1.2 의 3.9:1 예외 폐지).
import { describe, expect, it } from 'vitest';
import tokensCss from './tokens.css?raw';

const root = tokensCss.slice(tokensCss.indexOf(':root {'), tokensCss.indexOf('\n}'));
const v = (name: string): string => {
  const m = root.match(new RegExp(`--ws-${name}:\\s*(#[0-9a-fA-F]{6});`));
  if (!m) throw new Error(`--ws-${name} 없음(6자리 hex 아님)`);
  return m[1].toLowerCase();
};

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('tokens v2.0 — R3 확정 값', () => {
  it('ground #FFF · ink #102326 · brand #007F8B · ink-body #48575A · line #D7DFDF', () => {
    expect(tokensCss).toMatch(/from docs\/design\/tokens\.json v2\.0\.0/);
    expect([v('bg-000'), v('surface'), v('ink'), v('brand'), v('ink-body'), v('line')]).toEqual([
      '#ffffff',
      '#ffffff',
      '#102326',
      '#007f8b',
      '#48575a',
      '#d7dfdf',
    ]);
  });

  it('later 문구 = ink-muted', () => {
    expect(v('status-later')).toBe(v('ink-muted'));
  });

  it('레이아웃: container 1200 · gutter 24 · section-gap 120/72 · 모달 720 · 레이어 여백 40/16 · 버튼 52 · 입력 72 · 행 76/72 · 사진 20/14 · 숫자→단위 8', () => {
    const px = (n: string) => root.match(new RegExp(`--ws-${n}:\\s*([^;]+);`))?.[1];
    expect({
      'content-max': px('content-max'),
      'grid-gutter': px('grid-gutter'),
      'section-gap': px('section-gap'),
      'section-gap-mobile': px('section-gap-mobile'),
      'modal-w': px('modal-w'),
      'layer-pad': px('layer-pad'),
      'layer-pad-mobile': px('layer-pad-mobile'),
      'btn-h': px('btn-h'),
      'input-h': px('input-h'),
      'row-h': px('row-h'),
      'row-h-mobile': px('row-h-mobile'),
      'radius-photo': px('radius-photo'),
      'radius-photo-mobile': px('radius-photo-mobile'),
      'num-unit-gap': px('num-unit-gap'),
    }).toEqual({
      'content-max': '1200px',
      'grid-gutter': '24px',
      'section-gap': '120px',
      'section-gap-mobile': '72px',
      'modal-w': '720px',
      'layer-pad': '40px',
      'layer-pad-mobile': '16px',
      'btn-h': '52px',
      'input-h': '72px',
      'row-h': '76px',
      'row-h-mobile': '72px',
      'radius-photo': '20px',
      'radius-photo-mobile': '14px',
      'num-unit-gap': '8px',
    });
  });
});

describe('tokens v2.0 — 대비 ≥4.5:1 (글자)', () => {
  const TEXT = ['ink', 'ink-body', 'ink-muted', 'brand-text', 'status-ready', 'status-first', 'status-check', 'status-later', 'status-fail'];
  const GROUND = ['bg-000', 'surface', 'bg-100', 'brand-soft'];

  for (const fg of TEXT) {
    for (const bg of GROUND) {
      it(`${fg} on ${bg}`, () => {
        expect(ratio(v(fg), v(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const s of ['ready', 'first', 'check', 'fail']) {
    it(`status-${s} on status-${s}-soft (판정 줄·칩)`, () => {
      expect(ratio(v(`status-${s}`), v(`status-${s}-soft`))).toBeGreaterThanOrEqual(4.5);
    });
    it(`ink on status-${s}-soft`, () => {
      expect(ratio(v('ink'), v(`status-${s}-soft`))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('on-brand on brand (주 버튼 글자)', () => {
    expect(ratio(v('on-brand'), v('brand'))).toBeGreaterThanOrEqual(4.5);
  });

  it('brand 를 글자로 쓰면 bg-000 위에서만 — 흰 바탕 ≥4.5', () => {
    expect(ratio(v('brand'), v('bg-000'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('tokens v2.0 — 비글자 대비 ≥3:1', () => {
  it('focus 링 on bg-000 · bg-100 · brand-soft', () => {
    for (const bg of ['bg-000', 'bg-100', 'brand-soft']) expect(ratio(v('focus'), v(bg))).toBeGreaterThanOrEqual(3);
  });

  it('status-first 와 status-fail 은 같은 값이 아니다(밝기 차)', () => {
    expect(v('status-first')).not.toBe(v('status-fail'));
    expect(Math.abs(lum(v('status-first')) - lum(v('status-fail')))).toBeGreaterThan(0.01);
  });
});
