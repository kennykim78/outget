// F3-1 /vet React — 지도 키 없음 폴백, 필터, vet_clicked, 제보됨 배지 0, visitNote 상시, 제보 폼(202·429·429 하루 한도·400).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { COPY } from '@ws/copy';
import { naverMapSearchUrl, type PublicAnimalType, type PublicVet } from '@ws/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTrackerForTest, type Tracker } from '../events/track';
import { golden, pageOf } from '../test/fixtures';
import { vetReportApi } from './reportApi';
import VetCard from './VetCard';
import VetPage from './VetPage';
import vetCss from '../styles/vet.css?raw';

const budgie: PublicAnimalType = { ...golden, id: 'budgie', slug: 'parrot/budgie', group: 'PARROT', displayName: '사랑앵무', mascot: null };

const vet = (id: string, over: Partial<PublicVet> = {}): PublicVet => ({
  id,
  name: `병원${id}`,
  address: `서울 마포구 길 ${id}`,
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

const VETS = [
  vet('a', { treats: ['hamster-golden'], night: true, lat: 37.55, lng: 126.91 }),
  vet('b', { treats: ['hamster-golden', 'budgie'], emergency: true, lat: 37.56, lng: 126.92 }),
  vet('c', { treats: ['budgie'], night: true, emergency: true, verifiedAt: null, region: '서울 은평구' }),
];

function vetPage(vets: PublicVet[] = VETS, kind: 'VET' | 'VET_REGION' = 'VET', region?: string) {
  const p = pageOf(kind, { types: [golden, budgie], vets }, { path: region ? '/vet/x' : '/vet' });
  if (region) p.route.region = region;
  return p;
}

let calls: Array<[string, Record<string, unknown>]> = [];
let errors: ReturnType<typeof vi.spyOn>;

function setWide(wide: boolean) {
  window.matchMedia = vi.fn((q: string) => ({
    matches: wide && q.includes('min-width'),
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  calls = [];
  const fake: Tracker = { track: (n, p) => void calls.push([n, p]), flush: () => undefined, dispose: () => undefined };
  setTrackerForTest(fake);
  window.history.replaceState(null, '', '/vet');
  errors = vi.spyOn(console, 'error');
  setWide(false);
});

afterEach(() => {
  setTrackerForTest(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (window as { naver?: unknown }).naver;
  document.getElementById('naver-maps-sdk')?.remove();
  Reflect.deleteProperty(window, 'matchMedia');
});

const cards = () => Array.from(document.querySelectorAll('li.ws-vet')).map((li) => li.getAttribute('data-ws-id'));

describe('지도 키 없음 → 목록 전용', () => {
  it.each([false, true])('wide=%s: 지도 DOM 0·전환 0·SDK 스크립트 0·콘솔 오류 0, layout=list', (wide) => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', '');
    setWide(wide);
    render(<VetPage page={vetPage()} capturedMain={null} />);
    expect(document.querySelectorAll('.ws-vet-map')).toHaveLength(0);
    expect(document.querySelector('[role="region"][aria-label="지도"]')).toBeNull();
    expect(screen.queryByRole('button', { name: COPY.vet.mapTab })).toBeNull();
    expect(screen.queryByRole('button', { name: COPY.vet.listTab })).toBeNull();
    expect(document.getElementById('naver-maps-sdk')).toBeNull();
    expect(document.querySelector('main')).toHaveAttribute('data-ws-vet-layout', 'list');
    expect(document.querySelector('.ws-vet-grid')).toBeNull();
    expect(cards()).toEqual(['vetClinics#a', 'vetClinics#b', 'vetClinics#c']);
    expect(document.body.textContent).not.toMatch(/VITE_|지도 키|불러오지/);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('지도 키 있음', () => {
  function fakeSdk() {
    const listeners: Array<{ target: unknown; fn: () => void }> = [];
    const markers: Array<{ title?: string; setMap: (m: unknown) => void }> = [];
    const pans: number[][] = [];
    class LatLng {
      constructor(
        public a: number,
        public b: number,
      ) {}
      lat() {
        return this.a;
      }
      lng() {
        return this.b;
      }
    }
    class LatLngBounds {
      extend() {
        return this;
      }
    }
    class Map {
      setCenter() {}
      panTo(c: LatLng) {
        pans.push([c.a, c.b]);
      }
      fitBounds() {}
      destroy() {}
    }
    class Marker {
      title?: string;
      constructor(o: { title?: string }) {
        this.title = o.title;
        markers.push(this);
      }
      setMap() {}
    }
    const Event = {
      addListener: (target: unknown, _n: string, fn: () => void) => {
        listeners.push({ target, fn });
        return fn;
      },
      removeListener: () => undefined,
    };
    (window as unknown as { naver: unknown }).naver = { maps: { LatLng, LatLngBounds, Map, Marker, Event } };
    return { listeners, markers, pans };
  }

  it('≤767: [목록][지도] 전환(기본 목록), 지도 모드에서 마커 → 카드 1장, 미선택 안내', () => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'k');
    const sdk = fakeSdk();
    render(<VetPage page={vetPage()} capturedMain={null} />);
    expect(document.querySelector('main')).toHaveAttribute('data-ws-vet-layout', 'map');
    const listBtn = screen.getByRole('button', { name: COPY.vet.listTab });
    expect(listBtn).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.ws-vet-map')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: COPY.vet.mapTab }));
    expect(screen.getByRole('region', { name: COPY.vet.mapAria })).toBeInTheDocument();
    expect(cards()).toEqual([]);
    expect(screen.getByText(COPY.vet.mapHint)).toBeInTheDocument();
    // 좌표 있는 병원만 마커(c 는 좌표 없음), title = 병원명
    expect(sdk.markers.map((m) => m.title)).toEqual(['병원a', '병원b']);
    act(() => sdk.listeners[1].fn());
    expect(cards()).toEqual(['vetClinics#b']);
    expect(document.querySelector('li.ws-vet')).toHaveAttribute('aria-current', 'true');
    expect(sdk.pans).toEqual([[37.56, 126.92]]);
    expect(screen.getByText(COPY.vet.visitNote)).toBeInTheDocument();
  });

  it('768–1023 은 ≤767 처럼 전환(DR m-7): 나란히 아님', () => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'k');
    window.matchMedia = vi.fn((q: string) => ({
      matches: q === '(min-width: 768px)',
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    fakeSdk();
    render(<VetPage page={vetPage()} capturedMain={null} />);
    expect(document.querySelector('.ws-vet-grid')).toBeNull();
    expect(screen.getByRole('button', { name: COPY.vet.mapTab })).toBeInTheDocument();
  });

  it('≥1024: 목록 + 지도 나란히, 전환 없음, 카드 이름 → 선택·panTo·vet_clicked detail', () => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'k');
    setWide(true);
    const sdk = fakeSdk();
    render(<VetPage page={vetPage()} capturedMain={null} />);
    const grid = document.querySelector('.ws-vet-grid');
    expect(grid?.querySelector('.ws-vet-list ul.ws-vets')).not.toBeNull();
    expect(grid?.querySelector('.ws-vet-map')).not.toBeNull();
    expect(screen.queryByRole('button', { name: COPY.vet.mapTab })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '병원a' }));
    expect(document.querySelector('[data-ws-id="vetClinics#a"]')).toHaveAttribute('aria-current', 'true');
    expect(sdk.pans).toEqual([[37.55, 126.91]]);
    expect(calls).toContainEqual(['vet_clicked', { clinicId: 'a', action: 'detail' }]);
  });

  it('SDK 로드 실패 → 목록 전용(지도·전환·오류 문구 0)', () => {
    vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'k');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    const script = document.getElementById('naver-maps-sdk');
    expect(script).not.toBeNull();
    act(() => {
      script?.dispatchEvent(new Event('error'));
    });
    expect(document.querySelectorAll('.ws-vet-map')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: COPY.vet.mapTab })).toBeNull();
    expect(document.querySelector('main')).toHaveAttribute('data-ws-vet-layout', 'list');
    expect(cards()).toHaveLength(3);
  });
});

describe('필터', () => {
  beforeEach(() => vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', ''));

  it('진료 동물·야간·응급 조합, 쿼리 반영, 결과 0 → 안내 + 필터 지우기', () => {
    render(<VetPage page={vetPage()} capturedMain={null} />);
    const chip = (name: string) => screen.getByRole('button', { name });
    // 진료 동물 칩 = 표시명(원시 id 0)
    expect(screen.queryByRole('button', { name: /hamster-golden|budgie/ })).toBeNull();

    fireEvent.click(chip('사랑앵무'));
    expect(cards()).toEqual(['vetClinics#b', 'vetClinics#c']);
    expect(chip('사랑앵무')).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?treats=budgie');

    fireEvent.click(chip(COPY.vet.night));
    expect(cards()).toEqual(['vetClinics#c']);
    fireEvent.click(chip(COPY.vet.emergency));
    expect(cards()).toEqual(['vetClinics#c']);
    expect(window.location.search).toBe('?treats=budgie&night=1&emergency=1');

    fireEvent.click(chip('골든햄스터')); // 진료 동물은 하나 — 교체
    expect(chip('사랑앵무')).toHaveAttribute('aria-pressed', 'false');
    expect(cards()).toEqual([]);
    expect(document.querySelector('.ws-vet-empty p')).toHaveTextContent(COPY.vet.filterNoResult);
    expect(screen.getByText(COPY.vet.visitNote)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: COPY.vet.filterClear }));
    expect(cards()).toHaveLength(3);
    expect(window.location.search).toBe('');
  });

  it('접근성: 목록 카드 제목은 h2, 필터 토글 → sr-only status 안내(초기 빈 텍스트, 0건이면 filterNoResult)', () => {
    render(<VetPage page={vetPage()} capturedMain={null} />);
    const live = document.querySelector('main > [role="status"]') as HTMLElement;
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveClass('ws-visually-hidden');
    expect(live.textContent).toBe('');
    expect(document.querySelectorAll('li.ws-vet h2')).toHaveLength(3);
    expect(document.querySelectorAll('li.ws-vet h3')).toHaveLength(0);
    expect(document.querySelector('.ws-vet-empty')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: COPY.vet.night }));
    expect(live.textContent).toBe(COPY.vet.filterUpdated);
    fireEvent.click(screen.getByRole('button', { name: '사랑앵무' }));
    fireEvent.click(screen.getByRole('button', { name: COPY.vet.emergency }));
    fireEvent.click(screen.getByRole('button', { name: '골든햄스터' }));
    expect(cards()).toEqual([]);
    expect(live.textContent).toBe(COPY.vet.filterNoResult);
    expect(document.querySelector('.ws-vet-empty [aria-live], .ws-vet-empty [role="status"]')).toBeNull();
  });

  it('쿼리로 시작 상태 복원, history.state(레이어) 보존', () => {
    window.history.replaceState({ keep: 1 }, '', '/vet?emergency=1');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    expect(cards()).toEqual(['vetClinics#b', 'vetClinics#c']);
    fireEvent.click(screen.getByRole('button', { name: COPY.vet.night }));
    expect(window.history.state).toEqual({ keep: 1 });
    expect(localStorage.length).toBe(0); // 필터 저장 0
  });
});

describe('VetCard', () => {
  beforeEach(() => vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', ''));

  it('프리렌더 순서: 이름 → 확인 배지 → 주소 → 진료 동물(표시명) → 야간·응급 → 전화·길찾기', () => {
    const v = vet('b', { treats: ['hamster-golden', 'budgie', 'unknown-x'], night: true, emergency: true });
    render(
      <ul>
        <VetCard vet={v} typeNames={new Map([[golden.id, '골든햄스터'], [budgie.id, '사랑앵무']])} />
      </ul>,
    );
    const li = document.querySelector('li.ws-vet') as HTMLElement;
    expect(li).toHaveAttribute('data-ws-id', 'vetClinics#b');
    const parts = Array.from(li.children).map((c) => c.className || c.tagName);
    expect(parts).toEqual(['H3', 'ws-vet-badge', 'ws-vet-address', 'ws-vet-phone', 'ws-vet-treats', 'ws-vet-flags', 'ws-vet-actions']);
    expect(li.querySelector('.ws-vet-phone')).toHaveTextContent('02-123-4567');
    expect(li.querySelector('.ws-vet-badge')).toHaveTextContent(`✓${COPY.vet.verifiedBadge} 2026.09`);
    expect(li.querySelector('.ws-vet-treats')).toHaveTextContent(`${COPY.vet.treats}: 골든햄스터 · 사랑앵무`);
    expect(li.textContent).not.toMatch(/unknown-x|hamster-golden|km|거리/);
    // DR m-5: 보이는 라벨은 "전화"만(줄바꿈 방지), 접근 이름은 "전화 {번호}"
    const tel = within(li).getByRole('link', { name: `${COPY.vet.call} 02-123-4567` });
    expect(tel).toHaveAttribute('href', 'tel:021234567');
    expect(tel.textContent).toBe(COPY.vet.call);
    const route = within(li).getByRole('link', { name: new RegExp(`^${COPY.vet.directions} ?[(]새 창[)]$`) });
    expect(route).toHaveAttribute('href', naverMapSearchUrl(`${v.name} ${v.address}`));
    expect(route).toHaveAttribute('target', '_blank');
    expect(route).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('vet_clicked{clinicId, action}: call·route, 전화·길찾기는 선택하지 않음', () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <VetCard vet={vet('a')} onSelect={onSelect} />
      </ul>,
    );
    const call = screen.getByRole('link', { name: new RegExp(COPY.vet.call) });
    call.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(call);
    const route = screen.getByRole('link', { name: new RegExp(`^${COPY.vet.directions} ?[(]새 창[)]$`) });
    route.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(route);
    expect(calls).toEqual([
      ['vet_clicked', { clinicId: 'a', action: 'call' }],
      ['vet_clicked', { clinicId: 'a', action: 'route' }],
    ]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('"제보됨" 배지 0 — verifiedAt 없는 병원도 배지 문구 없음(배지 자체 생략)', () => {
    render(<VetPage page={vetPage()} capturedMain={null} />);
    const c = document.querySelector('[data-ws-id="vetClinics#c"]') as HTMLElement;
    expect(c.querySelector('.ws-vet-badge')).toBeNull();
    expect(document.body.textContent).not.toContain(COPY.vet.reportedBadge);
    expect(document.body.textContent).not.toContain('제보됨');
  });
});

describe('빈 상태·visitNote', () => {
  beforeEach(() => vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', 'k'));

  it('/vet 병원 0: emptyAll + 제보하기(섹션 펼침), 필터·지도 0, visitNote 있음', () => {
    render(<VetPage page={vetPage([])} capturedMain={null} />);
    expect(screen.getByText(COPY.vet.emptyAll)).toBeInTheDocument();
    expect(document.querySelector('.ws-vet-filters')).toBeNull();
    expect(document.querySelectorAll('.ws-vet-map')).toHaveLength(0);
    expect(document.getElementById('naver-maps-sdk')).toBeNull(); // 병원 0 → SDK 요청 0
    expect(screen.getByText(COPY.vet.visitNote)).toBeInTheDocument();
    const details = document.querySelector('details.ws-vet-report') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: COPY.vet.reportLink }));
    expect(details.open).toBe(true);
  });

  it('/vet/{region}: 제목·지역 칩(프리렌더 보관분, aria-current), emptyRegion 은 지역 0일 때', () => {
    const html =
      '<main class="ws-page"><ul class="ws-region-chips"><li><a href="/vet">전체</a></li>' +
      '<li><a href="/vet/x" aria-current="page">서울 마포구</a></li><li><a href="/vet/y">서울 은평구</a></li></ul></main>';
    render(<VetPage page={vetPage([VETS[0]], 'VET_REGION', '서울 마포구')} capturedMain={html} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.vet.regionTitle.replace('{name}', '서울 마포구'));
    const nav = screen.getByRole('list', { name: COPY.vet.regionsTitle });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['전체', '서울 마포구', '서울 은평구']);
    expect(within(nav).getByRole('link', { name: '서울 마포구' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '전체' })).not.toHaveAttribute('aria-current');
    // 레인 E: 지역 링크는 필터 칩이 아니다(프리렌더 마크업과 일치)
    for (const l of within(nav).getAllByRole('link')) expect(l).not.toHaveClass('ws-filter-chip');
    expect(screen.getByText(COPY.vet.visitNote)).toBeInTheDocument();
  });

  it('N2: 현재 칩 가운데 정렬은 scrollIntoView 없이 ul.scrollLeft 직접 설정(포커스 시작점 보존)', () => {
    const html =
      '<main class="ws-page"><ul class="ws-region-chips"><li><a href="/vet">전체</a></li>' +
      '<li><a href="/vet/x" aria-current="page">서울 마포구</a></li><li><a href="/vet/y">서울 은평구</a></li></ul></main>';
    const spy = vi.fn();
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const orig = Object.getOwnPropertyDescriptor(proto, 'scrollIntoView');
    proto.scrollIntoView = spy;
    const defs: Array<[string, PropertyDescriptor | undefined]> = [];
    const mock = (name: string, get: (this: HTMLElement) => number) => {
      defs.push([name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]);
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get });
    };
    const isChips = (e: HTMLElement) => e.classList.contains('ws-region-chips');
    mock('scrollWidth', function () { return isChips(this) ? 600 : 0; });
    mock('clientWidth', function () { return isChips(this) ? 300 : 0; });
    mock('offsetLeft', function () { return this.getAttribute('aria-current') === 'page' ? 400 : 0; });
    mock('offsetWidth', function () { return this.getAttribute('aria-current') === 'page' ? 100 : 0; });
    try {
      render(<VetPage page={vetPage([VETS[0]], 'VET_REGION', '서울 마포구')} capturedMain={html} />);
      const ul = screen.getByRole('list', { name: COPY.vet.regionsTitle }) as HTMLUListElement;
      expect(ul.scrollLeft).toBe(300); // 400 - (300-100)/2 = 300, max = 300
      expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const [n, d] of defs) {
        if (d) Object.defineProperty(HTMLElement.prototype, n, d);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[n];
      }
      if (orig) Object.defineProperty(proto, 'scrollIntoView', orig);
      else delete proto.scrollIntoView;
    }
  });

  it('레인 E: 조건 그룹 이름 · 지역 줄 힌트 기본 hidden', () => {
    render(<VetPage page={vetPage([VETS[0]], 'VET', undefined)} capturedMain={null} />);
    expect(screen.getByRole('group', { name: COPY.vet.filtersTitle })).toBeInTheDocument();
    expect(screen.getByText(COPY.vet.regionsMore)).not.toBeVisible();
    expect(screen.getByText(COPY.vet.regionsMore)).toHaveAttribute('hidden');
  });
});

describe('제보 폼(POST /api/vets/reports)', () => {
  beforeEach(() => vi.stubEnv('VITE_NAVER_MAP_CLIENT_ID', ''));

  function fill() {
    fireEvent.change(screen.getByLabelText(COPY.vet.reportName), { target: { value: '새 동물병원' } });
    fireEvent.change(screen.getByLabelText(COPY.vet.reportAddress), { target: { value: '서울 마포구 새길 1' } });
    fireEvent.change(screen.getByLabelText(COPY.vet.reportPhone), { target: { value: '02-555-1234' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '사랑앵무' }));
  }
  const reportStatus = () => within(document.querySelector('details.ws-vet-report') as HTMLElement).getByRole('status');
  const submit = () => fireEvent.click(screen.getByRole('button', { name: COPY.vet.reportSubmit }));

  it('202 → 접수 안내만, 목록·배지에 제보 병원 0, 입력 비움, 본문 4키(좌표·이메일 0)', async () => {
    const send = vi.spyOn(vetReportApi, 'send').mockResolvedValue('ok');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    fill();
    submit();
    await waitFor(() => expect(reportStatus()).toHaveTextContent(COPY.vet.reportThanks));
    expect(send).toHaveBeenCalledWith({ name: '새 동물병원', address: '서울 마포구 새길 1', phone: '02-555-1234', treats: ['budgie'] });
    expect(cards()).toEqual(['vetClinics#a', 'vetClinics#b', 'vetClinics#c']);
    expect(document.body.textContent).not.toContain(COPY.vet.reportedBadge);
    expect(document.querySelector('.ws-vets')?.textContent).not.toContain('새 동물병원');
    expect(screen.getByLabelText(COPY.vet.reportName)).toHaveValue('');
    expect(localStorage.length).toBe(0);
  });

  it('429 → "지금은 보낼 수 없어요" 안내, 입력 유지', async () => {
    vi.spyOn(vetReportApi, 'send').mockResolvedValue('rate');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    fill();
    submit();
    await waitFor(() => expect(reportStatus()).toHaveTextContent(COPY.vet.reportError));
    expect(screen.getByLabelText(COPY.vet.reportName)).toHaveValue('새 동물병원');
  });

  it('278: 429 REPORT_DAILY_LIMIT(daily) → "오늘 제보가 많아요, 내일 다시 보내 주세요", 입력 유지(rate 안내와 다름)', async () => {
    vi.spyOn(vetReportApi, 'send').mockResolvedValue('daily');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    fill();
    submit();
    await waitFor(() => expect(reportStatus()).not.toBeEmptyDOMElement());
    expect(COPY.vet.reportDaily).toBe('오늘 제보가 많아요, 내일 다시 보내 주세요');
    expect(reportStatus().textContent).toBe(COPY.vet.reportDaily);
    expect(reportStatus().textContent).not.toContain(COPY.vet.reportError);
    expect(screen.getByLabelText(COPY.vet.reportName)).toHaveValue('새 동물병원');
  });

  it('서버 400 → 안내 문구, 입력 유지', async () => {
    vi.spyOn(vetReportApi, 'send').mockResolvedValue('invalid');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    fill();
    submit();
    await waitFor(() => expect(reportStatus()).not.toBeEmptyDOMElement());
    expect(reportStatus().textContent).toBe(COPY.vet.reportInvalid);
    expect(screen.getByLabelText(COPY.vet.reportPhone)).toHaveValue('02-555-1234');
  });

  it('사전 검사 위반 → 전송 0, 해당 필드 aria-invalid', () => {
    const send = vi.spyOn(vetReportApi, 'send');
    render(<VetPage page={vetPage()} capturedMain={null} />);
    fill();
    fireEvent.change(screen.getByLabelText(COPY.vet.reportPhone), { target: { value: '12' } });
    submit();
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByLabelText(COPY.vet.reportPhone)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(COPY.vet.reportName)).not.toHaveAttribute('aria-invalid');
  });
});

describe('vetReportApi.send 상태 매핑', () => {
  it.each([
    [202, 'ok'],
    [429, 'rate'],
    [400, 'invalid'],
    [415, 'invalid'],
    [500, 'error'],
  ])('%i → %s, 동일 출처 상대 경로 POST JSON', async (status, want) => {
    const f = vi.fn().mockResolvedValue({ status });
    vi.stubGlobal('fetch', f);
    await expect(vetReportApi.send({ name: 'n', address: 'a', phone: '0212345678', treats: [] })).resolves.toBe(want);
    expect(f.mock.calls[0][0]).toBe('/api/vets/reports');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    vi.unstubAllGlobals();
  });

  it.each([
    [{ error: 'REPORT_DAILY_LIMIT' }, 'daily'],
    [{ error: 'rate_limited' }, 'rate'],
    [null, 'rate'],
  ])('278: 429 본문 %j → %s(하루 한도와 시간당 리미터를 본문 코드로 구분)', async (body, want) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, json: () => Promise.resolve(body) }));
    await expect(vetReportApi.send({ name: 'n', address: 'a', phone: '0212345678', treats: [] })).resolves.toBe(want);
    vi.unstubAllGlobals();
  });

  it('278: 429 본문이 JSON 이 아니면 rate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, json: () => Promise.reject(new SyntaxError('x')) }));
    await expect(vetReportApi.send({ name: 'n', address: 'a', phone: '0212345678', treats: [] })).resolves.toBe('rate');
    vi.unstubAllGlobals();
  });

  it('네트워크 실패 → error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')));
    await expect(vetReportApi.send({ name: 'n', address: 'a', phone: '0212345678', treats: [] })).resolves.toBe('error');
    vi.unstubAllGlobals();
  });
});

describe('불변식 ⑧ — 위치 API 사용 0', () => {
  it('client/src 소스 어디에도 위치 조회 API 문자열이 없다', () => {
    const word = ['geo', 'location'].join('');
    const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(files).length).toBeGreaterThan(20);
    const hits = Object.entries(files).filter(([, src]) => src.includes(word)).map(([p]) => p);
    expect(hits).toEqual([]);
  });
});

describe('vet.css — DR M-4·m-6·m-7·n-6·n-9', () => {
  const flat = vetCss.replace(/\s+/g, ' ');
  it('선택 칩 "✓" 접두: 프리렌더 지역 링크 + 클라 칩(aria-current·aria-pressed)', () => {
    const m = flat.match(/([^{}]+)\{ content: '✓'; content: '✓' \/ ''; margin-right: var\(--ws-space-1\); \}/);
    expect(m).not.toBeNull();
    const sel = m?.[1] ?? '';
    expect(sel).toContain(".ws-region-chips a[aria-current='page']::before");
    expect(sel).not.toContain(".ws-filter-chip[aria-current='page']");
    expect(sel).toContain(".ws-filter-chip[aria-pressed='true']::before");
  });
  it('레인 E: 지역 선택 = 채움 brand, 필터 선택 = brand-soft', () => {
    expect(flat).toMatch(/\.ws-region-chips a\[aria-current='page'\] \{[^}]*background: var\(--ws-brand\);[^}]*color: var\(--ws-on-brand\);/);
    expect(flat).toMatch(/\.ws-filter-chip\[aria-pressed='true'\] \{[^}]*background: var\(--ws-brand-soft\);/);
  });
  it('나란히는 ≥1024 에서만, 목록 전용은 본문 전체 reading 폭 가운데', () => {
    expect(flat).toMatch(/@media \(min-width: 1024px\) \{ \.ws-vet-grid \{ display: grid; grid-template-columns: 5fr 7fr;/);
    expect(flat).not.toMatch(/@media \(min-width: 768px\) \{ \.ws-vet-grid/);
    expect(flat).toMatch(/main\.ws-page\[data-ws-vet-layout='list'\] \{ max-width: calc\(var\(--ws-modal-w\) \+ 2 \* var\(--ws-gutter-wide\)\); margin-inline: auto; \}/);
  });
  it('DR-4: 카드 제목 셀렉터가 h2·h3 모두, 페이지 h1 은 프리렌더 main 도 포함', () => {
    expect(flat).toMatch(/li\.ws-vet :is\(h2, h3\) \{[^}]*font-size: var\(--ws-type-cta-size\);/);
    expect(flat).toContain("main.ws-page:is([data-ws-route='VET'], [data-ws-route='VET_REGION']) h1 {");
  });
  it('제보 섹션 펼침 표시 · 카드 버튼 줄 아래 정렬', () => {
    expect(flat).toContain(".ws-vet-report > summary::after { content: '›';");
    expect(flat).toContain('.ws-vet-report[open] > summary::after { transform: rotate(90deg); }');
    expect(flat).toMatch(/li\.ws-vet \.ws-vet-actions \{[^}]*margin-top: auto;/);
  });
});
