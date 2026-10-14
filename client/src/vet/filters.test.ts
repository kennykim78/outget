import type { PublicVet } from '@ws/engine';
import { describe, expect, it } from 'vitest';
import { applyVetFilter, isFiltered, NO_FILTER, parseVetFilter, treatChoices, vetFilterSearch } from './filters';
import { chipsFromCaptured, chipsFromVets } from './regionChips';
import { validateVetReport } from './reportApi';

const vet = (id: string, over: Partial<PublicVet> = {}): PublicVet => ({
  id,
  name: `병원 ${id}`,
  address: `서울 마포구 ${id}`,
  phone: '02-123-4567',
  region: '서울 마포구',
  treats: ['hamster-golden'],
  night: null,
  emergency: null,
  lat: null,
  lng: null,
  verifiedAt: '2026-09-01',
  ...over,
});

const V = [
  vet('a', { treats: ['hamster-golden'], night: true, emergency: false }),
  vet('b', { treats: ['hamster-golden', 'budgie'], night: false, emergency: true }),
  vet('c', { treats: ['budgie'], night: true, emergency: true }),
  vet('d', { treats: ['hamster-golden'], night: null, emergency: null }),
];
const ids = (xs: PublicVet[]) => xs.map((x) => x.id);

describe('applyVetFilter — 조합(거르기만, ws-data 순서 유지)', () => {
  it.each([
    [{ treats: null, night: false, emergency: false }, ['a', 'b', 'c', 'd']],
    [{ treats: 'hamster-golden', night: false, emergency: false }, ['a', 'b', 'd']],
    [{ treats: 'budgie', night: false, emergency: false }, ['b', 'c']],
    [{ treats: null, night: true, emergency: false }, ['a', 'c']],
    [{ treats: null, night: false, emergency: true }, ['b', 'c']],
    [{ treats: null, night: true, emergency: true }, ['c']],
    [{ treats: 'hamster-golden', night: true, emergency: false }, ['a']],
    [{ treats: 'hamster-golden', night: false, emergency: true }, ['b']],
    [{ treats: 'hamster-golden', night: true, emergency: true }, []],
    [{ treats: 'budgie', night: true, emergency: true }, ['c']],
  ])('%j → %j', (f, want) => {
    expect(ids(applyVetFilter(V, f))).toEqual(want);
  });

  it('null(확인 전)은 야간·응급 필터에서 "가능"으로 치지 않는다', () => {
    expect(ids(applyVetFilter([V[3]], { treats: null, night: true, emergency: false }))).toEqual([]);
  });

  it('isFiltered', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, night: true })).toBe(true);
  });
});

describe('쿼리 왕복', () => {
  it('parse ↔ search', () => {
    const f = { treats: 'budgie', night: true, emergency: true };
    expect(vetFilterSearch(f)).toBe('?treats=budgie&night=1&emergency=1');
    expect(parseVetFilter(vetFilterSearch(f), ['budgie'])).toEqual(f);
    expect(vetFilterSearch(NO_FILTER)).toBe('');
  });

  it('고를 수 없는 treats·형식 위반·다른 키는 버린다', () => {
    expect(parseVetFilter('?treats=cat', ['budgie'])).toEqual(NO_FILTER);
    expect(parseVetFilter('?treats=Bad%20Id', ['Bad Id'])).toEqual(NO_FILTER);
    expect(parseVetFilter('?night=yes&emergency=0&lat=37', [])).toEqual(NO_FILTER);
  });

  it('진료 동물 칩 = 병원이 진료하는 노출 타입만(data.types 순서)', () => {
    const types = [
      { id: 'budgie', displayName: '사랑앵무' },
      { id: 'hamster-golden', displayName: '골든햄스터' },
      { id: 'rabbit', displayName: '토끼' },
    ];
    expect(treatChoices(types, V).map((t) => t.id)).toEqual(['budgie', 'hamster-golden']);
  });
});

describe('지역 칩', () => {
  it('/vet: ws-data 에서 "전체" + 지역(정렬)', () => {
    const chips = chipsFromVets([vet('x', { region: '서울 은평구' }), vet('y', { region: '서울 마포구' })], '전체');
    expect(chips.map((c) => [c.label, c.href])).toEqual([
      ['전체', '/vet'],
      ['서울 마포구', `/vet/${encodeURI('서울-마포구')}`],
      ['서울 은평구', `/vet/${encodeURI('서울-은평구')}`],
    ]);
    expect(chipsFromVets([], '전체')).toEqual([]);
  });

  it('/vet/{region}: 같은 문서 프리렌더 칩만, /vet 밖 href 는 버린다', () => {
    const html =
      '<main class="ws-page"><ul class="ws-region-chips"><li><a href="/vet">전체</a></li>' +
      '<li><a href="/vet/%EC%84%9C%EC%9A%B8-%EB%A7%88%ED%8F%AC%EA%B5%AC" aria-current="page">서울 마포구</a></li>' +
      '<li><a href="https://example.com/x">밖</a></li><li><a href="/vet/a/b">깊음</a></li></ul></main>';
    expect(chipsFromCaptured(html).map((c) => [c.label, c.region])).toEqual([
      ['전체', null],
      ['서울 마포구', '서울 마포구'],
    ]);
    expect(chipsFromCaptured(null)).toEqual([]);
  });
});

describe('제보 사전 검사(서버 parseVetReport 와 같은 규칙)', () => {
  const ok = { name: '  동물  병원 ', address: '서울 마포구 1', phone: '02-123-4567', treats: ['budgie', 'budgie'] };
  it('통과: 공백 정리·treats 중복 제거', () => {
    expect(validateVetReport(ok)).toEqual({
      body: { name: '동물 병원', address: '서울 마포구 1', phone: '02-123-4567', treats: ['budgie'] },
      invalid: [],
    });
  });
  it.each([
    [{ name: '' }, ['name']],
    [{ name: 'x'.repeat(61) }, ['name']],
    [{ address: '<b>' }, ['address']],
    [{ address: 'https://spam' }, ['address']],
    [{ phone: '1234' }, ['phone']],
    [{ phone: '02--1234-5678' }, ['phone']],
    [{ phone: '-0212345678' }, ['phone']],
    [{ treats: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, ['treats']],
  ])('%j → %j', (over, want) => {
    expect(validateVetReport({ ...ok, ...over }).invalid).toEqual(want);
  });
});
