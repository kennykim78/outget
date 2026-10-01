import { Router } from 'express';
import type { AdoptionRepository } from './adoption.repo.js';
import { validateAdoptionPostInput } from './adoption.validation.js';

export function makeAdoptionRoutes(
  adoptionRepo: AdoptionRepository,
  requireAuth: (req: any, res: any, next: any) => void
): Router {
  const router = Router();

  // 목록 조회
  router.get('/', async (req, res) => {
    try {
      const { category, dealType, region } = req.query;
      const posts = await adoptionRepo.list({
        category: typeof category === 'string' ? category : undefined,
        dealType: typeof dealType === 'string' ? dealType : undefined,
        region: typeof region === 'string' ? region : undefined,
      });
      res.json({ posts });
    } catch (err: any) {
      res.status(500).json({ error: '분양글 목록을 불러오는 중 오류가 발생했습니다.' });
    }
  });

  // 상세 조회
  router.get('/:id', async (req, res) => {
    try {
      const post = await adoptionRepo.findById(req.params.id);
      if (!post || post.status === 'BLINDED') {
        return res.status(404).json({ error: '게시글을 찾을 수 없거나 블라인드 처리되었습니다.' });
      }
      res.json({ post });
    } catch (err: any) {
      res.status(500).json({ error: '게시글 조회 중 오류가 발생했습니다.' });
    }
  });

  // 분양글 등록 (로그인 필수)
  router.post('/', requireAuth, async (req: any, res: any) => {
    try {
      const userId = req.user!.sub;
      const validation = validateAdoptionPostInput(req.body);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(' ') });
      }

      const post = await adoptionRepo.create(userId, {
        category: req.body.category,
        speciesDetail: req.body.speciesDetail,
        petName: req.body.petName,
        gender: req.body.gender,
        ageText: req.body.ageText,
        healthStatus: req.body.healthStatus,
        dealType: req.body.dealType,
        price: req.body.price,
        depositRefundTerms: req.body.depositRefundTerms,
        citesSpecies: Boolean(req.body.citesSpecies),
        citesDocReady: Boolean(req.body.citesDocReady),
        requiredCageSpec: req.body.requiredCageSpec,
        story: req.body.story,
        photos: Array.isArray(req.body.photos) ? req.body.photos : [],
        region: req.body.region,
        lat: req.body.lat,
        lng: req.body.lng,
      });

      res.status(201).json({ post });
    } catch (err: any) {
      res.status(500).json({ error: '분양글 등록 중 오류가 발생했습니다.' });
    }
  });

  // 상태 변경 (AVAILABLE, RESERVED, COMPLETED)
  router.patch('/:id/status', requireAuth, async (req: any, res: any) => {
    try {
      const user = req.user!;
      const { status } = req.body;
      const post = await adoptionRepo.findById(req.params.id);
      if (!post) {
        return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
      }

      if (post.authorId !== user.sub && user.role !== '운영자') {
        return res.status(403).json({ error: '게시글 작성자만 상태를 변경할 수 있습니다.' });
      }

      const updated = await adoptionRepo.updateStatus(req.params.id, status);
      res.json({ post: updated });
    } catch (err: any) {
      res.status(500).json({ error: '상태 변경 중 오류가 발생했습니다.' });
    }
  });

  return router;
}
