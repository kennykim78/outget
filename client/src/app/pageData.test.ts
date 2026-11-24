// readPageData — 프리렌더 ws-data 검증(계약 C-2, 단계 F0 (d)). 실패는 전부 null(fail-closed).
//   합성 fixture만 쓴다(D12). 외부 호출 0.
import { afterEach, describe, expect, it } from 'vitest';
import { buildSearchLinks, encodeWsPage, WS_DATA_KEYS, WS_WIRE_VERSION, type WsPageData } from '@ws/engine';
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

describe('readPageData — 362 N9 data.feed(피드 변형 페이지만 7번째 키)', () => {
  const card = { supplyItemId: 'wheel', provider: 'COUPANG', title: '햄스터 쳇바퀴 30cm', url: 'https://link.coupang.com/a/Abcd12', imageUrl: null, verdict: 'OK', specValues: { diameterCm: 30 } };
  const withFeed = (feed: unknown): Record<string, unknown> => {
    const p = validPayload();
    (p.data as Record<string, unknown>).feed = feed;
    return p;
  };

  it('정상 full·noprice data.feed 통과(키 7개)', () => {
    for (const feed of [
      { v: 1, stage: 'full', priceCheckedOn: '2026-11-23', items: ['wheel'], rail: [{ ...card, price: { amount: 12900, currency: 'KRW' } }] },
      { v: 1, stage: 'noprice', items: ['wheel', 'hideout'], rail: [card] },
    ]) {
      document.body.innerHTML = '';
      mountScript(JSON.stringify(withFeed(feed)));
      expect(readPageData(document)?.data.feed).toEqual(feed);
    }
  });

  it('형식 위반 data.feed 하나라도 → 페이지 전체 null(링크·이미지 호스트·noprice 가격·verdict·품목 밖)', () => {
    const bads = [
      { v: 1, stage: 'noprice', items: ['wheel'], rail: [{ ...card, url: 'https://evil.example/x' }] },
      { v: 1, stage: 'noprice', items: ['wheel'], rail: [{ ...card, imageUrl: 'https://evil.example/a.jpg' }] },
      { v: 1, stage: 'noprice', items: ['wheel'], rail: [{ ...card, price: { amount: 1, currency: 'KRW' } }] },
      { v: 1, stage: 'noprice', items: ['wheel'], rail: [{ ...card, verdict: 'BELOW_MIN' }] },
      { v: 1, stage: 'noprice', items: ['hideout'], rail: [card] },
      { v: 1, stage: 'full', items: ['wheel'], rail: [] },
      [],
    ];
    for (const feed of bads) {
      document.body.innerHTML = '';
      mountScript(JSON.stringify(withFeed(feed)));
      expect(readPageData(document)).toBeNull();
    }
  });

  it('feed 외 7번째 키·feed 와 함께 8번째 키는 여전히 null', () => {
    const p = withFeed({ v: 1, stage: 'noprice', items: [], rail: [] });
    (p.data as Record<string, unknown>).extra = [];
    mountScript(JSON.stringify(p));
    expect(readPageData(document)).toBeNull();
  });
});

describe('readPageData — 와이어 v2(출처 표 + sourceRefs, 계획 73 S3)', () => {
  const SRC_A = { url: 'https://example.org/a', title: 'A' };
  const SRC_B = { url: 'https://example.org/b', title: 'B' };
  function requirement(id: string, keyword: string, source: Array<{ url: string; title: string }>): Record<string, unknown> {
    return {
      requirementId: id,
      animalTypeId: 'hamster-golden',
      supplyItemId: id,
      priority: 'REQUIRED',
      orderHint: 'FIRST',
      notNowReason: null,
      minSpec: { all: [] },
      recommendedSpec: { all: [] },
      why: 'w',
      caution: null,
      avoid: null,
      searchKeyword: keyword,
      searchLinks: buildSearchLinks(keyword),
      item: { id, name: id, category: 'HOUSING', glyph: 'g', specSchema: { fields: [] }, alternativeIds: [] },
      source,
      lastVerifiedAt: '2026-10-01',
    };
  }
  function v1WithRequirements(): Record<string, unknown> {
    const p = validPayload();
    p.route = { kind: 'TYPE', path: '/hamster/golden' };
    (p.data as Record<string, unknown>).requirements = [
      requirement('cage', '햄스터 케이지', [SRC_A, SRC_B]),
      requirement('bedding', '햄스터 베딩', [SRC_B]),
    ];
    (p.data as Record<string, unknown>).products = [{ id: 'p1', supplyItemId: 'cage', title: 't', verdict: 'OK' }];
    return p;
  }
  function wire(): Record<string, unknown> {
    return encodeWsPage(v1WithRequirements() as unknown as WsPageData) as unknown as Record<string, unknown>;
  }

  it('v2 정상: 디코드 결과가 같은 v1 페이지와 동일 객체(키 순서 포함)', () => {
    const w = wire();
    expect(w.v).toBe(WS_WIRE_VERSION);
    expect(w.sources).toEqual([SRC_A, SRC_B]);
    mountScript(JSON.stringify(v1WithRequirements()));
    const fromV1 = readPageData(document);
    document.body.innerHTML = '';
    mountScript(JSON.stringify(w));
    const fromV2 = readPageData(document);
    expect(fromV1).not.toBeNull();
    expect(fromV2).toEqual(fromV1);
    expect(JSON.stringify(fromV2)).toBe(JSON.stringify(fromV1));
    expect(fromV2?.v).toBe(1);
  });

  it('v2 sourceRefs 가 표 범위 밖이면 null', () => {
    const w = wire();
    const reqs = (w.data as Record<string, unknown>).requirements as Array<Record<string, unknown>>;
    reqs[1].sourceRefs = [0, 1, 2];
    mountScript(JSON.stringify(w));
    expect(readPageData(document)).toBeNull();
  });

  it('v2 에 BELOW_MIN 상품이 하나라도 있으면 페이지 전체 null(불변식 ③, 디코드 뒤 허용목록)', () => {
    const w = wire();
    (w.data as Record<string, unknown>).products = [
      { id: 'p1', supplyItemId: 'cage', title: 't', verdict: 'OK' },
      { id: 'p2', supplyItemId: 'cage', title: 't', verdict: 'BELOW_MIN' },
    ];
    mountScript(JSON.stringify(w));
    expect(readPageData(document)).toBeNull();
  });

  it('v2 디코드 뒤에도 route·data 6키 검사가 그대로 적용된다', () => {
    const w = wire();
    w.route = { kind: 'BOARD', path: '/' };
    mountScript(JSON.stringify(w));
    expect(readPageData(document)).toBeNull();
    document.body.innerHTML = '';
    const w2 = wire();
    (w2.data as Record<string, unknown>).extra = [];
    mountScript(JSON.stringify(w2));
    expect(readPageData(document)).toBeNull();
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
    expect(routeFromLocation({ pathname: '/privacy' })).toEqual({ kind: 'PRIVACY', path: '/privacy' });
    expect(routeFromLocation({ pathname: '/privacy/' }).kind).toBe('PRIVACY');
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
