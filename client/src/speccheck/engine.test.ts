// speccheck/engine — loadEngine(catalogUrl): 정확 패턴 + 동일 출처만, v===1, createCatalog/createEngine 메모이즈.
//   합성 카탈로그(테스트 전용, 노출 시드 아님)로 specCheck 직렬화 왕복 결과가 서버 엔진 직접 호출과 같은지 본다.
import { createCatalog, createEngine, type CatalogInput } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogLoadError, clearEngineCacheForTest, isCatalogUrl, loadEngine } from './engine';

const ORIGIN = 'https://withsmall.example';
const URL_OK = '/data/catalog.v1.0123abcd.json';

const META = {
  reviewStatus: 'VERIFIED',
  reviewerType: 'EXPERIENCED_KEEPER',
  verifiedBy: null,
  verifiedAt: '2026-09-30',
  contentKind: 'SPEC',
  source: [],
};

/** 합성 카탈로그(JSON 그대로 — 서버 PublicCatalog 형태). */
const CATALOG = {
  v: 1,
  seedDigest: 'test-digest',
  animalTypes: [
    {
      ...META,
      id: 'syn-hamster',
      group: 'SMALL_MAMMAL',
      displayName: '합성 햄스터',
      status: 'ACTIVE',
      aliases: [],
      taxonId: null,
      careProfileId: 'syn-profile',
    },
  ],
  careProfiles: [{ ...META, id: 'syn-profile', name: '합성 프로필', taxonIds: [], facts: {}, careNotes: [] }],
  supplyItems: [
    {
      ...META,
      id: 'syn-cage',
      name: '합성 케이지',
      category: 'CAGE',
      glyph: 'x',
      lifecycle: 'DURABLE',
      specSchema: { fields: [{ key: 'floorWcm', label: '바닥 가로', type: 'number', min: 0, max: 300 }] },
      compatibleAlternativeIds: ['syn-tank'],
      description: 'd',
    },
    {
      ...META,
      id: 'syn-tank',
      name: '합성 수조',
      category: 'CAGE',
      glyph: 'y',
      lifecycle: 'DURABLE',
      specSchema: { fields: [] },
      compatibleAlternativeIds: [],
      description: 'd',
    },
  ],
  supplyRequirements: [
    {
      ...META,
      id: 'syn-req',
      careProfileId: 'syn-profile',
      supplyItemId: 'syn-cage',
      priority: 'REQUIRED',
      orderHint: 'BEFORE_ARRIVAL',
      why: 'w',
      caution: null,
      avoid: null,
      minSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 80, reason: '최소 80' }] },
      recommendedSpec: { rules: [{ key: 'floorWcm', op: 'gte', value: 100, reason: '권장 100' }] },
      notNowReason: null,
      searchKeyword: null,
    },
  ],
  compatibilityRules: [],
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearEngineCacheForTest();
  fetchMock = vi.fn(async () => okResponse(CATALOG));
});
afterEach(() => clearEngineCacheForTest());

describe('isCatalogUrl', () => {
  it.each([URL_OK, `${ORIGIN}${URL_OK}`])('허용: %s', (u) => {
    expect(isCatalogUrl(u, ORIGIN)).toBe(true);
  });

  it.each([
    'https://evil.example/data/catalog.v1.0123abcd.json',
    '//evil.example/data/catalog.v1.0123abcd.json',
    'http://withsmall.example/data/catalog.v1.0123abcd.json', // 스킴 다름 = 다른 출처
    '/data/catalog.v2.0123abcd.json',
    '/data/catalog.v1.0123ABCD.json',
    '/data/catalog.v1.0123abc.json',
    '/data/catalog.v1.0123abcde.json',
    '/data/catalog.v1.0123abcd.json?x=1',
    '/data/catalog.v1.0123abcd.json#a',
    '/data/../data/catalog.v1.0123abcd.json',
    '/x/data/catalog.v1.0123abcd.json',
    'data/catalog.v1.0123abcd.json',
    'javascript:alert(1)',
    '',
  ])('거부: %s', (u) => {
    expect(isCatalogUrl(u, ORIGIN)).toBe(false);
  });
});

describe('loadEngine', () => {
  it('외부·다른 패턴 URL → 거부, fetch 0', async () => {
    for (const u of ['https://evil.example/data/catalog.v1.0123abcd.json', '/data/catalog.v2.0123abcd.json']) {
      await expect(loadEngine(u, { fetch: fetchMock, origin: ORIGIN })).rejects.toBeInstanceOf(CatalogLoadError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('동일 출처 GET(자격 same-origin, 리다이렉트 금지)', async () => {
    await loadEngine(URL_OK, { fetch: fetchMock, origin: ORIGIN });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'error' });
  });

  it('v=2 · v 없음 · 배열 아님 → 거부', async () => {
    for (const bad of [
      { ...CATALOG, v: 2 },
      { ...CATALOG, v: undefined },
      { ...CATALOG, supplyItems: {} },
      { ...CATALOG, compatibilityRules: undefined },
      [],
    ]) {
      clearEngineCacheForTest();
      const f = vi.fn(async () => okResponse(bad));
      await expect(loadEngine(URL_OK, { fetch: f, origin: ORIGIN })).rejects.toBeInstanceOf(CatalogLoadError);
    }
  });

  it('HTTP 오류·깨진 JSON → 거부, 실패는 메모하지 않아 재시도 가능', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(new Response('{', { status: 200 }))
      .mockResolvedValueOnce(okResponse(CATALOG));
    await expect(loadEngine(URL_OK, { fetch: f, origin: ORIGIN })).rejects.toBeInstanceOf(CatalogLoadError);
    await expect(loadEngine(URL_OK, { fetch: f, origin: ORIGIN })).rejects.toBeInstanceOf(CatalogLoadError);
    await expect(loadEngine(URL_OK, { fetch: f, origin: ORIGIN })).resolves.toBeTruthy();
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('메모이즈: 같은 URL 은 fetch 1회·같은 엔진', async () => {
    const [a, b] = await Promise.all([
      loadEngine(URL_OK, { fetch: fetchMock, origin: ORIGIN }),
      loadEngine(URL_OK, { fetch: fetchMock, origin: ORIGIN }),
    ]);
    const c = await loadEngine(URL_OK, { fetch: fetchMock, origin: ORIGIN });
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('specCheck 직렬화 왕복 = 서버 엔진 직접 호출(OK · 권장 미달 · 최소 미달 · 입력 누락)', async () => {
    const engine = await loadEngine(URL_OK, { fetch: fetchMock, origin: ORIGIN });
    const ref = createEngine(createCatalog(structuredClone(CATALOG) as unknown as CatalogInput));
    const inputs = [{ floorWcm: 120 }, { floorWcm: 90 }, { floorWcm: 60 }, {}];
    const verdicts: string[] = [];
    for (const input of inputs) {
      const got = engine.specCheck('syn-hamster', 'syn-cage', input);
      const want = ref.specCheck('syn-hamster', 'syn-cage', input);
      expect(JSON.parse(JSON.stringify(got))).toEqual(JSON.parse(JSON.stringify(want)));
      verdicts.push(got.verdict);
    }
    expect(verdicts).toEqual(['OK', 'BELOW_RECOMMENDED', 'BELOW_MIN', 'CHECK']);
  });
});
