// 특수동물 진료 병원 — 읽기 전용 API. VERIFIED 만 노출(불변식 7).
//   GET /api/vets?region=&q=   — 목록(시군구 텍스트 필터, 이름·주소 검색)
//   GET /api/vets/:id          — 상세
//   진료 가능 여부 판단은 하지 않는다(불변식 5) — 전화 확인된 사실만 전달.
import { Router } from 'express';
import type { VetClinicRepository } from './vet.repo.js';
import type { VetQuery } from './vet.types.js';

export function makeVetRoutes(vetRepo: VetClinicRepository): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const query: VetQuery = {};
      if (typeof req.query.region === 'string' && req.query.region.trim()) {
        query.region = req.query.region.trim();
      }
      if (typeof req.query.q === 'string' && req.query.q.trim()) {
        query.q = req.query.q.trim();
      }
      const clinics = await vetRepo.list(query);
      res.status(200).json({ clinics });
    } catch {
      res.status(500).json({ error: '병원 목록을 불러오지 못했습니다.' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const clinic = await vetRepo.findById(req.params.id);
      if (!clinic) {
        res.status(404).json({ error: '병원 정보를 찾을 수 없습니다.' });
        return;
      }
      res.status(200).json({ clinic });
    } catch {
      res.status(500).json({ error: '병원 정보를 불러오지 못했습니다.' });
    }
  });

  return router;
}
