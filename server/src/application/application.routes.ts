import { Router } from 'express';
import type { ApplicationRepository } from './application.repo.js';
import type { AdoptionRepository } from '../adoption/adoption.repo.js';

export function makeApplicationRoutes(
  appRepo: ApplicationRepository,
  adoptionRepo: AdoptionRepository,
  requireAuth: (req: any, res: any, next: any) => void
): Router {
  const router = Router();

  // 신청서 제출 (로그인 필수)
  router.post('/', requireAuth, async (req: any, res: any) => {
    try {
      const userId = req.user!.sub;
      const { postId, cagePhotoUrl, experience, familyAgreed, commitment } = req.body;

      if (!postId) {
        return res.status(400).json({ error: '분양글 ID는 필수입니다.' });
      }

      const post = await adoptionRepo.findById(postId);
      if (!post || post.status === 'BLINDED') {
        return res.status(404).json({ error: '존재하지 않거나 블라인드 처리된 분양글입니다.' });
      }

      if (post.authorId === userId) {
        return res.status(400).json({ error: '자신이 작성한 분양글에는 신청할 수 없습니다.' });
      }

      // 사육환경 인증 사진 필수 검증 (뱀 먹이용 수거 및 충동입양 방어)
      if (!cagePhotoUrl || typeof cagePhotoUrl !== 'string' || cagePhotoUrl.trim().length === 0) {
        return res.status(400).json({ error: '아이가 머물 사육 환경(케이지, 은신처 등) 사진 첨부는 필수입니다.' });
      }

      if (familyAgreed !== true) {
        return res.status(400).json({ error: '동거인 전원의 입양 동의가 필요합니다.' });
      }

      if (!commitment || commitment.trim().length < 5) {
        return res.status(400).json({ error: '책임 서약 및 각오를 5자 이상 작성해 주세요.' });
      }

      const app = await appRepo.create(userId, {
        postId,
        cagePhotoUrl,
        experience: experience || '없음',
        familyAgreed: true,
        commitment,
      });

      res.status(201).json({ application: app });
    } catch (err: any) {
      res.status(500).json({ error: '입양 신청서 제출 중 오류가 발생했습니다.' });
    }
  });

  // 내가 신청한 내역 조회
  router.get('/my', requireAuth, async (req: any, res: any) => {
    try {
      const userId = req.user!.sub;
      const applications = await appRepo.listByApplicantId(userId);
      res.json({ applications });
    } catch (err: any) {
      res.status(500).json({ error: '신청 내역 조회 중 오류가 발생했습니다.' });
    }
  });

  // 특정 분양글에 들어온 신청서 목록 (분양자 본인 조회)
  router.get('/post/:postId', requireAuth, async (req: any, res: any) => {
    try {
      const user = req.user!;
      const post = await adoptionRepo.findById(req.params.postId);
      if (!post) {
        return res.status(404).json({ error: '분양글을 찾을 수 없습니다.' });
      }
      if (post.authorId !== user.sub && user.role !== '운영자') {
        return res.status(403).json({ error: '분양글 작성자만 신청 목록을 볼 수 있습니다.' });
      }

      const applications = await appRepo.listByPostId(req.params.postId);
      res.json({ applications });
    } catch (err: any) {
      res.status(500).json({ error: '신청 목록 조회 중 오류가 발생했습니다.' });
    }
  });

  // 입양 신청 수락 -> 1:1 대화방 개설
  router.patch('/:id/accept', requireAuth, async (req: any, res: any) => {
    try {
      const user = req.user!;
      const app = await appRepo.findById(req.params.id);
      if (!app) {
        return res.status(404).json({ error: '신청서를 찾을 수 없습니다.' });
      }

      const post = await adoptionRepo.findById(app.postId);
      if (!post) {
        return res.status(404).json({ error: '해당 분양글을 찾을 수 없습니다.' });
      }
      if (post.authorId !== user.sub && user.role !== '운영자') {
        return res.status(403).json({ error: '분양글 작성자만 수락할 수 있습니다.' });
      }

      // 채팅 스레드 ID 생성
      const chatThreadId = `chat_${post.id}_${app.applicantId}`;
      const updated = await appRepo.updateStatus(app.id, 'ACCEPTED', chatThreadId);
      // 분양글 상태를 'RESERVED(예약중)'으로 변경
      await adoptionRepo.updateStatus(post.id, 'RESERVED');

      res.json({ application: updated });
    } catch (err: any) {
      res.status(500).json({ error: '입양 신청 수락 중 오류가 발생했습니다.' });
    }
  });

  // 입양 신청 거절
  router.patch('/:id/reject', requireAuth, async (req: any, res: any) => {
    try {
      const user = req.user!;
      const app = await appRepo.findById(req.params.id);
      if (!app) {
        return res.status(404).json({ error: '신청서를 찾을 수 없습니다.' });
      }

      const post = await adoptionRepo.findById(app.postId);
      if (!post) {
        return res.status(404).json({ error: '해당 분양글을 찾을 수 없습니다.' });
      }
      if (post.authorId !== user.sub && user.role !== '운영자') {
        return res.status(403).json({ error: '분양글 작성자만 거절할 수 있습니다.' });
      }

      const updated = await appRepo.updateStatus(app.id, 'REJECTED');
      res.json({ application: updated });
    } catch (err: any) {
      res.status(500).json({ error: '입양 신청 거절 중 오류가 발생했습니다.' });
    }
  });

  return router;
}
