import { Router } from 'express';
import type { SupplyRepository } from './supply.repo.js';
import type { AuthContext } from '../auth/auth.middleware.js';

export function makeSupplyRoutes(
  supplyRepo: SupplyRepository,
  requireAuth: (req: any, res: any, next: any) => void
): Router {
  const router = Router();

  // 용품 목록 조회
  router.get('/', async (req, res) => {
    try {
      const { itemType, dealType, region } = req.query;
      const supplies = await supplyRepo.list({
        itemType: typeof itemType === 'string' ? itemType : undefined,
        dealType: typeof dealType === 'string' ? dealType : undefined,
        region: typeof region === 'string' ? region : undefined,
      });
      res.json({ supplies });
    } catch (err: any) {
      res.status(500).json({ error: '용품 목록을 불러오는 중 오류가 발생했습니다.' });
    }
  });

  // 상세 조회
  router.get('/:id', async (req, res) => {
    try {
      const supply = await supplyRepo.findById(req.params.id);
      if (!supply || supply.status === 'BLINDED') {
        return res.status(404).json({ error: '용품 게시글을 찾을 수 없거나 블라인드 처리되었습니다.' });
      }
      res.json({ supply });
    } catch (err: any) {
      res.status(500).json({ error: '용품 조회 중 오류가 발생했습니다.' });
    }
  });

  // 등록 (로그인 필수)
  router.post('/', requireAuth, async (req: any, res: any) => {
    try {
      const auth = req.auth as AuthContext;
      const { title, itemType, dealType, price, description, photos, region, lat, lng } = req.body;

      if (!title || title.trim().length === 0) {
        return res.status(400).json({ error: '용품 제목은 필수입니다.' });
      }

      const allowedItemTypes = ['CAGE', 'FEED', 'TOY', 'BEDDING', 'ETC'];
      if (!itemType || !allowedItemTypes.includes(itemType)) {
        return res.status(400).json({ error: '올바른 용품 카테고리를 선택해 주세요.' });
      }

      const allowedDealTypes = ['FREE', 'USED_DEAL'];
      if (!dealType || !allowedDealTypes.includes(dealType)) {
        return res.status(400).json({ error: '거래 유형(무료나눔, 중고 직거래)을 선택해 주세요.' });
      }

      if (dealType === 'FREE' && price && price > 0) {
        return res.status(400).json({ error: '무료나눔은 금액이 0원이어야 합니다.' });
      }

      if (dealType === 'USED_DEAL' && (!price || price <= 0)) {
        return res.status(400).json({ error: '중고 직거래 판매 금액을 올바르게 입력해 주세요.' });
      }

      if (!description || description.trim().length < 5) {
        return res.status(400).json({ error: '용품 설명을 5자 이상 작성해 주세요.' });
      }

      if (!region || region.trim().length === 0) {
        return res.status(400).json({ error: '직거래 가능 지역(동네)은 필수입니다.' });
      }

      const post = await supplyRepo.create(auth.userId, {
        title,
        itemType,
        dealType,
        price,
        description,
        photos: Array.isArray(photos) ? photos : [],
        region,
        lat,
        lng,
      });

      res.status(201).json({ supply: post });
    } catch (err: any) {
      res.status(500).json({ error: '용품 등록 중 오류가 발생했습니다.' });
    }
  });

  // 상태 변경
  router.patch('/:id/status', requireAuth, async (req: any, res: any) => {
    try {
      const auth = req.auth as AuthContext;
      const { status } = req.body;
      const supply = await supplyRepo.findById(req.params.id);
      if (!supply) {
        return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
      }
      if (supply.authorId !== auth.userId && auth.role !== 'ADMIN') {
        return res.status(403).json({ error: '작성자만 상태를 변경할 수 있습니다.' });
      }

      const updated = await supplyRepo.updateStatus(req.params.id, status);
      res.json({ supply: updated });
    } catch (err: any) {
      res.status(500).json({ error: '상태 변경 중 오류가 발생했습니다.' });
    }
  });

  return router;
}
