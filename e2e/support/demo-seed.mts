// E2E 데모 시드 — server/src/__tests__/demo/demo-site.ts demoSeed() 와 같은 메모리 확장(그 파일은 import 시 서버를 띄우므로 복제).
//   promoted() 승격(메모리) + 후기 8건 "[데모] 후기 자리 N" + 호환 규칙 VERIFIED + 병원 3건 "데모 동물병원 N".
//   실제 문장·병원 사실 창작 없음. 디스크의 시드 파일은 읽기만 한다(불변식 ⑦: 승격은 메모리·임시 폴더에만).
//   동기화 규칙: demo-site.ts demoSeed 를 바꾸면 여기도 같이 바꾼다(R7 후보: demoSeed 를 fixtures 로 옮겨 단일화).
import { readFileSync } from 'node:fs';
import type { SeedBundle } from '../../server/src/engine/index.js';
import { V, promoted } from '../../server/src/__tests__/fixtures/prerender-seed.js';

export const DEMO_REGIONS = ['서울 마포구', '서울 강남구', '서울 서초구'] as const;

/**
 * X2 불변식 ③ 런타임 단언용 최소 규격 미달 상품(메모리 변형, R6 E2) — 실제 상품 사실이 아닌 자리표시.
 *   VERIFIED·ACTIVE·사용권 있음(검수·상태는 통과)인데 규격만 미달(쳇바퀴 지름 20cm < 최소 28cm) → 추천 영역·상품 페이지 0 이어야 한다.
 *   meetsMinSpec 은 specCheck 와 일치하게 false(빌드 validate 통과). 값은 below-min.json 하나(스펙 쪽 invariants.ts 도 같은 파일을 읽는다).
 */
export const BELOW_MIN_PRODUCT = JSON.parse(readFileSync(new URL('./below-min.json', import.meta.url), 'utf8')) as {
  id: string;
  title: string;
  diameterCm: number;
};

export function withBelowMinProduct(s: SeedBundle): SeedBundle {
  const base = s.curatedProducts.find((x) => x.id === 'cp-001');
  if (!base) throw new Error('e2e demo: cp-001 없음(미달 변형의 원본)');
  s.curatedProducts.push({
    ...structuredClone(base),
    id: BELOW_MIN_PRODUCT.id,
    title: BELOW_MIN_PRODUCT.title,
    specValues: { ...(base.specValues ?? {}), diameterCm: BELOW_MIN_PRODUCT.diameterCm },
    meetsMinSpec: false,
  });
  return s;
}

export function demoSeed(): SeedBundle {
  const s = promoted();
  const base = s.testimonials.slice(0, 8);
  if (base.length < 8) throw new Error('e2e demo: 시드 후기 슬롯이 8건 미만');
  s.testimonials = base.map((t, i) => ({
    ...t,
    quote: `[데모] 후기 자리 ${i + 1}`,
    status: 'APPROVED',
    verifiedUsage: true,
    consentAt: '2026-09-26',
  }));
  s.compatibilityRules = s.compatibilityRules.map((r) => ({ ...r, ...V }));
  if (s.compatibilityRules.length < 3) throw new Error('e2e demo: 호환 규칙이 3건 미만');
  const coords: Array<[number, number]> = [
    [37.5663, 126.9019],
    [37.4979, 127.0276],
    [37.4837, 127.0324],
  ];
  s.vetClinics = DEMO_REGIONS.map((region, i) => ({
    id: `vc-demo-0${i + 1}`,
    name: `데모 동물병원 ${i + 1}`,
    region,
    treats: ['hamster-golden'],
    night: i === 1,
    emergency: i === 2,
    phone: '02-000-0000',
    address: `[데모] ${region} 주소 자리`,
    lat: coords[i][0],
    lng: coords[i][1],
    verification: { status: 'VERIFIED', method: 'PHONE_CALL', verifiedAt: '2026-09-28', note: null },
  }));
  return s;
}
