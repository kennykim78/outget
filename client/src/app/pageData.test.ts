// readPageData — 프리렌더 ws-data 검증(계약 C-2, 단계 F0 (d)). 실패는 전부 null(fail-closed).
//   합성 fixture만 쓴다(D12). 외부 호출 0.
import { afterEach, describe, expect, it } from 'vitest';
import { WS_DATA_KEYS } from '@ws/engine';
import { emptyPageData, readPageData, resolvePageData, routeFromLocation } from './pageData';

function validPayload(): Record<string, unknown> {
  return {
    v: 1,
    route: { kind: 'HOME', path: '/' },
    layer: null,
    catalogUrl: '/data/catalog.v1.0123abcd.json',
    data: {
      types: [],
      requirements: [],
      products: [],
      bundles: [],
      vets: [],
      testimonials: [],
    },
  };
}

function mountScript(text: string): void {
  const s = document.createElement('script');
  s.id = 'ws-data';
  s.type = 'application/json';
  s.textContent = text;
  document.body.appendChild(s);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('readPageData', () => {
  it('정상: 유효한 ws-data 를 그대로 돌려준다', () => {
    const payload = validPayload();
    mountScript(JSON.stringify(payload));
    const page = readPageData(document);
    expect(page).not.toBeNull();
    expect(page?.v).toBe(1);
    expect(page?.route.kind).toBe('HOME');
    expect(Object.keys(page?.data ?? {}).sort()).toEqual([...WS_DATA_KEYS].sort());
  });

  it('data 키가 WS_DATA_KEYS 와 정확히 같지 않으면(7개) null', () => {
    const payload = validPayload();
    (payload.data as Record<string, unknown>).extra = [];
    mountScript(JSON.stringify(payload));
    expect(readPageData(document)).toBeNull();
  });

  it('v !== 1 이면(v=2) null', () => {
    const payload = { ...validPayload(), v: 2 };
    mountScript(JSON.stringify(payload));
    expect(readPageData(document)).toBeNull();
  });

  it('깨진 JSON 이면 null(throw 하지 않음)', () => {
    mountScript('{"v":1,"route":');
    expect(() => readPageData(document)).not.toThrow();
    expect(readPageData(document)).toBeNull();
  });

  it('#ws-data 스크립트가 없으면 null', () => {
    expect(readPageData(document)).toBeNull();
  });

  it('추가 거부: 미지 route.kind · 키 누락 · 배열 아닌 값 · 잘못된 layer', () => {
    const cases: Array<(p: Record<string, unknown>) => void> = [
      (p) => {
        p.route = { kind: 'BOARD', path: '/' };
      },
      (p) => {
        delete (p.data as Record<string, unknown>).vets;
      },
      (p) => {
        (p.data as Record<string, unknown>).products = {};
      },
      (p) => {
        p.layer = { kind: 'L9', typeId: 'x', itemId: 'y' };
      },
      (p) => {
        p.route = { kind: 'HOME' };
      },
    ];
    for (const mutate of cases) {
      document.body.innerHTML = '';
      const p = validPayload();
      mutate(p);
      mountScript(JSON.stringify(p));
      expect(readPageData(document)).toBeNull();
    }
  });
});

describe('readPageData — 추천 영역 규격 방어(불변식 ③)', () => {
  function product(verdict: string): Record<string, unknown> {
    return { id: 'p1', supplyItemId: 'cage', title: 't', verdict };
  }

  it('products 의 verdict 가 OK·BELOW_RECOMMENDED 면 통과', () => {
    const p = validPayload();
    (p.data as Record<string, unknown>).products = [product('OK'), product('BELOW_RECOMMENDED')];
    mountScript(JSON.stringify(p));
    expect(readPageData(document)?.data.products).toHaveLength(2);
  });

  it('BELOW_MIN·CHECK·누락 verdict 가 하나라도 있으면 페이지 전체 null', () => {
    for (const bad of [product('BELOW_MIN'), product('CHECK'), { id: 'p2' }, 'p3']) {
      document.body.innerHTML = '';
      const p = validPayload();
      (p.data as Record<string, unknown>).products = [product('OK'), bad];
      mountScript(JSON.stringify(p));
      expect(readPageData(document)).toBeNull();
    }
  });
});

describe('fail-closed 폴백', () => {
  it('ws-data 없으면 빈 데이터 + routeFromLocation', () => {
    const page = resolvePageData(document, { pathname: '/vet/' });
    expect(page.route).toEqual({ kind: 'VET', path: '/vet' });
    expect(page.layer).toBeNull();
    for (const k of WS_DATA_KEYS) expect(page.data[k]).toEqual([]);
  });

  it('routeFromLocation: 데이터 없이 판별 가능한 경로만, 나머지는 NOT_FOUND', () => {
    expect(routeFromLocation({ pathname: '/' }).kind).toBe('HOME');
    expect(routeFromLocation({ pathname: '/supplies' }).kind).toBe('SUPPLIES');
    expect(routeFromLocation({ pathname: '/credits' }).kind).toBe('CREDITS');
    expect(routeFromLocation({ pathname: '/save' }).kind).toBe('SAVE');
    // K1 /pick(끝 슬래시 무시) → PICK(레인 A 라우트 종류).
    expect(routeFromLocation({ pathname: '/pick/' })).toEqual({ kind: 'PICK', path: '/pick' });
    expect(routeFromLocation({ pathname: '/hamster/golden' }).kind).toBe('NOT_FOUND');
  });

  it('C-R5-6: route.kind SAVE 인 ws-data 를 받는다(layer null)', () => {
    const payload = validPayload();
    payload.route = { kind: 'SAVE', path: '/save' };
    mountScript(JSON.stringify(payload));
    expect(readPageData(document)?.route.kind).toBe('SAVE');
  });

  it('emptyPageData 는 catalogUrl 을 비워 지연 fetch 대상이 없다', () => {
    expect(emptyPageData({ pathname: '/' }).catalogUrl).toBe('');
  });
});
