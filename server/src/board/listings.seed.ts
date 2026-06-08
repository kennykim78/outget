// Epic 2 시드 — 운영자 수동 입력 상수. 외부 fetch/스크래핑 0건(하드코딩 배열).
// 좌표는 앵커 매장 placeholder(여주/김포). 사용자 위치 아님(불변식 ⑤).
// DiscountPost 의 unverifiedBase 는 stampDiscount() 가 정가(listPrice) 유무로 강제한다.
import type {
  AgentProfile,
  RequestItem,
  StoredDiscountPost,
} from './listings.types.js';

// 앵커 지역 좌표 placeholder(매장/지역 중심) — 사용자 추적과 무관.
const YEOJU = { lat: 37.298, lng: 127.637 };
const GIMPO = { lat: 37.615, lng: 126.715 };

export const AGENT_SEED: readonly AgentProfile[] = [
  {
    id: 'a1',
    status: '개인',
    activeRegion: '여주',
    scheduleText: '주말 오전 여주 프리미엄아울렛 출동',
    reputation: 12,
    lat: YEOJU.lat,
    lng: YEOJU.lng,
  },
  {
    id: 'a2',
    status: '전문',
    bizName: '여주대행상회',
    bizNo: '123-45-67890',
    contact: 'chat',
    activeRegion: '여주',
    scheduleText: '평일 매일 상주',
    reputation: 48,
    lat: YEOJU.lat,
    lng: YEOJU.lng,
  },
  {
    id: 'a3',
    status: '전문',
    bizName: '김포라이브쇼퍼',
    bizNo: '987-65-43210',
    contact: 'chat',
    activeRegion: '김포',
    scheduleText: '주 3회 김포 아울렛 방문',
    reputation: 31,
    lat: GIMPO.lat,
    lng: GIMPO.lng,
  },
];

export const REQUEST_SEED: readonly RequestItem[] = [
  {
    id: 'r1',
    item: '나이키 운동화 270mm',
    options: '검정/흰색 무관',
    hopePrice: 80000,
    deadline: '2026-06-20',
    region: '여주',
    status: '대기',
  },
  {
    id: 'r2',
    item: '폴로 셔츠 L',
    hopePrice: 45000,
    deadline: '2026-06-15',
    region: '김포',
    status: '대기',
  },
];

// 정가 누락 시 unverifiedBase=true 를 서버가 스탬프(기준가 미확인 규칙 시연).
//   시드는 운영자 수동 입력분이므로 authorId='operator-seed', status='정상' 으로 고정한다.
function stampDiscount(
  raw: Omit<StoredDiscountPost, 'unverifiedBase' | 'authorId' | 'status'>,
): StoredDiscountPost {
  return {
    ...raw,
    unverifiedBase: raw.listPrice === undefined,
    authorId: 'operator-seed',
    status: '정상',
  };
}

export const DISCOUNT_SEED: readonly StoredDiscountPost[] = [
  // 정가 입력 있음 → unverifiedBase=false.
  stampDiscount({
    id: 'd1',
    storeBrand: '나이키 팩토리',
    discountRate: 40,
    discountPrice: 78000,
    listPrice: 130000,
    source: '현장 가격표',
    createdAt: '2026-06-08T09:00:00.000Z',
    lat: YEOJU.lat,
    lng: YEOJU.lng,
  }),
  // 정가 미입력 → 서버가 unverifiedBase=true 강제(아래 stamp 가 처리).
  stampDiscount({
    id: 'd2',
    storeBrand: '아디다스 아울렛',
    discountRate: 30,
    source: '제보',
    createdAt: '2026-06-08T10:30:00.000Z',
    lat: GIMPO.lat,
    lng: GIMPO.lng,
  }),
];
