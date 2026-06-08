// Epic 2 읽기 전용 보드 라우터.
// GET /api/agents · /api/requests · /api/discounts (옵션 ?region=).
// POST/PUT/DELETE 없음(읽기 전용 — 등록/매칭/결제는 후속 에픽).
// 자금 미보유: 결제 토큰 0. 사용자 위경도 수신/저장 0(불변식 ②⑤).
import { Router } from 'express';
import type { ListingsRepository } from './listings.repo.js';

// ?region= 쿼리를 안전하게 단일 문자열로 정규화(배열/빈문자 → undefined).
function readRegion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createListingsRouter(repo: ListingsRepository): Router {
  const router = Router();

  router.get('/agents', async (req, res) => {
    const region = readRegion(req.query.region);
    res.status(200).json(await repo.listAgents(region));
  });

  router.get('/requests', async (req, res) => {
    const region = readRegion(req.query.region);
    res.status(200).json(await repo.listRequests(region));
  });

  router.get('/discounts', async (req, res) => {
    const region = readRegion(req.query.region);
    res.status(200).json(await repo.listDiscounts(region));
  });

  return router;
}
