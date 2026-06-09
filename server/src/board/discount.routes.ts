// Epic 6 할인소식(UGC) 쓰기 라우터.
//   POST /api/discounts      (소식알림자/개인대행자/전문대행자/운영자) — 작성. status='정상' 서버 강제.
//   GET  /api/discounts/me   (auth) — 내가 쓴 할인소식 목록(authorId·status 미노출).
//
// 주의: 목록 GET /api/discounts 는 기존 listings.routes 에 있으므로 여기서 만들지 않는다(/me 만 신설).
// 불변식 ①: 외부 fetch 0(자사 리포지토리만). 네이버쇼핑 조회는 **shoppingPort 뒤로만** 한다 —
//   이 파일엔 fetch/외부 URL 리터럴 0(유일한 외부 fetch 는 naver.shopping.adapter.ts).
// 불변식 ④: unverifiedBase 는 리포지토리가 서버 강제(클라가 보내지 못한다). platformPrice/ourPrice 0.
//   참고가 6필드(base/lowest/productId/Source/Query/FetchedAt)도 서버 권위 스탬프 — 가격은 confirm
//   재조회로만 확정(검증이 클라 가격 주입 차단). 검색·확정 외부 호출은 shoppingPort 뒤로만.
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
import { searchLimiter } from '../middleware/rate-limit.js';
import { validateDiscountInput, DISCOUNT_FIELD_MAX } from './discount.validation.js';

// 참고가 출처 라벨(고정) — 외부 출처 표기(불변식 ④). 플랫폼 단정가 아님.
const REFERENCE_SOURCE = '네이버쇼핑';
// 작성 가능 역할 — 검색·작성 동일(구매자 제외).
const WRITER_ROLES = ['소식알림자', '개인대행자', '전문대행자', '운영자'] as const;

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

  // 네이버쇼핑 검색(폼 표시용 후보 목록) — 외부 호출은 shoppingPort.search 뒤로만(이 파일은
  //   fetch/외부 URL 0). 검색도 서버가 호출(키 비노출, 불변식 ①). 결과 title/mallName 은
  //   표시용이며 DB 저장 아님(클라가 되돌려 보내도 서버는 productId+query 로만 재조회).
  //   auth + 작성 역할 + searchLimiter(분당 30/IP, test env passthrough).
  //   limiter 는 auth·role 뒤에 둔다 — 미인증 트래픽이 인증 사용자의 검색 쿼터를
  //   소진하지 못하게(보안감사 MED). 외부 호출은 어차피 인증 통과 후에만 발생.
  router.get(
    '/shopping/search',
    requireAuth,
    requireRole(...WRITER_ROLES),
    searchLimiter,
    async (req, res) => {
      const q = req.query.query;
      if (typeof q !== 'string' || q.trim().length === 0) {
        res.status(400).json({ error: 'query(검색어)는 비어있지 않은 텍스트여야 합니다.' });
        return;
      }
      if (q.length > DISCOUNT_FIELD_MAX.referenceQuery) {
        res.status(400).json({
          error: `query 는 ${DISCOUNT_FIELD_MAX.referenceQuery}자를 넘을 수 없습니다.`,
        });
        return;
      }
      const candidates = await shoppingPort.search(q.trim());
      res.status(200).json(candidates);
    },
  );

  // 작성 — 소식알림자/대행자/운영자(구매자 제외). status='정상' 은 리포지토리가 강제.
  router.post(
    '/discounts',
    requireAuth,
    requireRole(...WRITER_ROLES),
    async (req, res) => {
      const result = validateDiscountInput(req.body);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      // referenceQuery+referenceProductId 가 둘 다 있으면 서버가 confirm 재조회로 두 가격을
      //   확정해 참고가 6필드를 스탬프한다(클라가 가격을 보낼 수 없음 — 서버 권위, 불변식 ④).
      //   외부 호출은 shoppingPort.confirm 뒤로만(이 파일은 fetch/외부 URL 0).
      //   productId 미입력/confirm null(매칭 실패·실패)이면 폴백(미스탬프 → 기존 기준가 미확인 유지,
      //   all-or-nothing). confirm 결과엔 외부 본문(title/mall) 0 — 숫자·productId·시각만.
      let reference: DiscountReferenceStamp | undefined;
      const query = result.value.referenceQuery;
      const productId = result.value.referenceProductId;
      if (query && productId) {
        const stamp = await shoppingPort.confirm(query, productId);
        if (stamp) {
          reference = {
            referenceBasePrice: stamp.basePrice,
            referenceLowestPrice: stamp.lowestPrice,
            referenceProductId: stamp.productId,
            referenceSource: REFERENCE_SOURCE,
            referenceQuery: query,
            referenceFetchedAt: stamp.fetchedAt,
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
