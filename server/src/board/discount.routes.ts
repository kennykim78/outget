// Epic 6 할인소식(UGC) 쓰기 라우터.
//   POST /api/discounts      (소식알림자/개인대행자/전문대행자/운영자) — 작성. status='정상' 서버 강제.
//   GET  /api/discounts/me   (auth) — 내가 쓴 할인소식 목록(authorId·status 미노출).
//
// 주의: 목록 GET /api/discounts 는 기존 listings.routes 에 있으므로 여기서 만들지 않는다(/me 만 신설).
// 불변식 ①: 외부 fetch 0(자사 리포지토리만). 네이버쇼핑 조회는 **shoppingPort 뒤로만** 한다 —
//   이 파일엔 fetch/외부 URL 리터럴 0(유일한 외부 fetch 는 naver.shopping.adapter.ts).
// 불변식 ④: unverifiedBase 는 리포지토리가 서버 강제(클라가 보내지 못한다). platformPrice/ourPrice 0.
//   참고가 4필드(referencePrice/Source/Query/FetchedAt)도 서버 권위 스탬프 — 검증이 클라 주입 차단.
// 불변식 ⑤: 위치는 매장 브랜드 텍스트만(좌표 수신 0).
// 응답에서 authorId·status 는 절대 노출하지 않는다(toPublicDiscount).
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type {
  DiscountReferenceStamp,
  DiscountRepository,
} from './discount.repo.js';
import type { DiscountPost, StoredDiscountPost } from './listings.types.js';
import type { ShoppingPriceRail } from '../shopping/shopping.port.js';
import { validateDiscountInput } from './discount.validation.js';

// 참고가 출처 라벨(고정) — 외부 출처 표기(불변식 ④). 플랫폼 단정가 아님.
const REFERENCE_SOURCE = '네이버쇼핑';

// 응답용으로 authorId·status 를 제거(노출 금지). 나머지 공개 필드만 반환.
function toPublicDiscount(d: StoredDiscountPost): DiscountPost {
  const { authorId: _a, status: _s, ...pub } = d;
  void _a;
  void _s;
  return pub;
}

export function createDiscountRouter(
  discountRepo: DiscountRepository,
  shoppingPort: ShoppingPriceRail,
): Router {
  const router = Router();

  // 작성 — 소식알림자/대행자/운영자(구매자 제외). status='정상' 은 리포지토리가 강제.
  router.post(
    '/discounts',
    requireAuth,
    requireRole('소식알림자', '개인대행자', '전문대행자', '운영자'),
    async (req, res) => {
      const result = validateDiscountInput(req.body);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      // referenceQuery 가 있으면 네이버쇼핑 최저가를 조회해 참고가 4필드를 서버가 스탬프한다.
      //   외부 호출은 shoppingPort.lookupLowest 뒤로만(이 파일은 fetch/외부 URL 0).
      //   null/실패면 폴백(스탬프 없음 → 기존 unverifiedBase/기준가 미확인 유지, all-or-nothing).
      let reference: DiscountReferenceStamp | undefined;
      const query = result.value.referenceQuery;
      if (query) {
        const lowest = await shoppingPort.lookupLowest(query);
        if (lowest) {
          reference = {
            referencePrice: lowest.price,
            referenceSource: REFERENCE_SOURCE,
            referenceQuery: query,
            referenceFetchedAt: lowest.fetchedAt,
          };
        }
      }
      const saved = await discountRepo.create(req.user!.sub, result.value, reference);
      res.status(201).json(toPublicDiscount(saved));
    },
  );

  // 내 할인소식 목록 — 작성자 본인 것만. authorId·status 미노출.
  router.get('/discounts/me', requireAuth, async (req, res) => {
    const mine = await discountRepo.listByOwner(req.user!.sub);
    res.status(200).json(mine.map(toPublicDiscount));
  });

  return router;
}
