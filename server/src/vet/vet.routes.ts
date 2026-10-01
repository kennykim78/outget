import { Router } from 'express';
import type { VetClinicRepository } from './vet.repo.js';

export function makeVetRoutes(vetRepo: VetClinicRepository): Router {
  const router = Router();

  // 전국 특수동물 전문병원 목록 조회 및 검색
  router.get('/', async (req, res) => {
    try {
      const { q } = req.query;
      const clinics = await vetRepo.list(typeof q === 'string' ? q : undefined);
      res.json({ clinics });
    } catch (err: any) {
      res.status(500).json({ error: '특수동물 전문병원 목록을 불러오는 중 오류가 발생했습니다.' });
    }
  });

  // 상세 조회
  router.get('/:id', async (req, res) => {
    try {
      const clinic = await vetRepo.findById(req.params.id);
      if (!clinic) {
        return res.status(404).json({ error: '병원 정보를 찾을 수 없습니다.' });
      }
      res.json({ clinic });
    } catch (err: any) {
      res.status(500).json({ error: '병원 조회 중 오류가 발생했습니다.' });
    }
  });

  return router;
}
