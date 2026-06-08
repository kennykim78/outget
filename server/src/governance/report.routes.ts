// Epic 7 신고→블라인드(notice-and-takedown) 라우터.
//   POST /api/reports               (auth)   — 신고 생성 → 즉시 블라인드(임시조치) + 대상 차단 + 작성자 알림.
//   POST /api/reports/:id/appeal    (작성자)  — 이의제기(대상 글 작성자 본인만). status='이의' + 운영자 알림.
//   GET  /api/reports?status=       (운영자)  — 상태별 신고 목록.
//   POST /api/reports/:id/restore   (운영자)  — 복구(재노출) + 작성자 알림.
//   POST /api/reports/:id/remove    (운영자)  — 영구 삭제(목록 제외) + 작성자 알림.
//
// 불변식 ③: 신고 즉시 임시조치(블라인드) → 이의/복구/삭제 상태머신. 운영자 동선 분리.
// 불변식 ②: 자금 흐름 필드 0. 불변식 ⑤: 좌표 0(검증에서 차단). 외부 fetch 0(자사만).
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type { ReportRepository } from './report.repo.js';
import type { DiscountRepository } from '../board/discount.repo.js';
import type { NotificationRepository } from '../notification/notification.repo.js';
import type { ReportStatus } from './report.types.js';
import { validateReportInput } from './report.validation.js';

// 운영자 알림 수신 채널(고정 inbox). 운영자 계정 레지스트리는 후속 에픽.
const OPERATOR_INBOX = 'operator';

const VALID_STATUSES: readonly ReportStatus[] = [
  '정상',
  '블라인드',
  '이의',
  '복구',
  '삭제',
];

function isStatus(v: unknown): v is ReportStatus {
  return typeof v === 'string' && (VALID_STATUSES as readonly string[]).includes(v);
}

export function createReportRouter(
  reportRepo: ReportRepository,
  discountRepo: DiscountRepository,
  notificationRepo: NotificationRepository,
): Router {
  const router = Router();

  // 대상 글 작성자(있으면) 조회 — 현재는 discount 대상만 작성자 추적 가능.
  async function targetAuthor(
    targetType: string,
    targetId: string,
  ): Promise<string | undefined> {
    if (targetType !== 'discount') return undefined;
    const found = await discountRepo.findById(targetId);
    return found?.authorId;
  }

  // 신고 생성 — 인증 사용자면 누구나. 즉시 블라인드(임시조치).
  router.post('/reports', requireAuth, async (req, res) => {
    const result = validateReportInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const report = await reportRepo.create(req.user!.sub, result.value);

    // 대상이 할인소식이면 글 상태도 즉시 블라인드(목록 제외)로 전이 + 작성자 알림.
    if (result.value.targetType === 'discount') {
      const blinded = await discountRepo.setStatus(result.value.targetId, '블라인드');
      if (blinded) {
        await notificationRepo.append(
          blinded.authorId,
          '블라인드',
          report.id,
          '신고가 접수되어 게시물이 임시 비공개(블라인드) 되었습니다. 이의제기할 수 있습니다.',
        );
      }
    }
    res.status(201).json(report);
  });

  // 이의제기 — 대상 글 작성자 본인만(아니면 403). status='이의' + 운영자 알림.
  router.post('/reports/:id/appeal', requireAuth, async (req, res) => {
    const report = await reportRepo.findById(req.params.id);
    if (!report) {
      res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
      return;
    }
    const author = await targetAuthor(report.targetType, report.targetId);
    // 작성자만 이의 가능. 작성자 추적 불가 대상은 이의 동선을 막는다(fail-closed).
    if (author === undefined || author !== req.user!.sub) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const updated = await reportRepo.setStatus(report.id, '이의');
    await notificationRepo.append(
      OPERATOR_INBOX,
      '이의',
      report.id,
      '블라인드 게시물에 이의가 제기되었습니다. 검토가 필요합니다.',
    );
    res.status(200).json(updated);
  });

  // 신고 목록(상태별) — 운영자만.
  router.get('/reports', requireAuth, requireRole('운영자'), async (req, res) => {
    const status = req.query.status;
    if (isStatus(status)) {
      res.status(200).json(await reportRepo.listByStatus(status));
      return;
    }
    res.status(200).json(await reportRepo.listAll());
  });

  // 복구(재노출) — 운영자만. report '복구' + 할인소식 '복구' + 작성자 알림.
  router.post(
    '/reports/:id/restore',
    requireAuth,
    requireRole('운영자'),
    async (req, res) => {
      const report = await reportRepo.findById(req.params.id);
      if (!report) {
        res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
        return;
      }
      const updated = await reportRepo.setStatus(report.id, '복구');
      if (report.targetType === 'discount') {
        const restored = await discountRepo.setStatus(report.targetId, '복구');
        if (restored) {
          await notificationRepo.append(
            restored.authorId,
            '복구',
            report.id,
            '검토 결과 게시물이 복구(재노출)되었습니다.',
          );
        }
      }
      res.status(200).json(updated);
    },
  );

  // 영구 삭제 — 운영자만. report '삭제' + 할인소식 '삭제'(목록 영구 제외) + 작성자 알림.
  router.post(
    '/reports/:id/remove',
    requireAuth,
    requireRole('운영자'),
    async (req, res) => {
      const report = await reportRepo.findById(req.params.id);
      if (!report) {
        res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
        return;
      }
      const updated = await reportRepo.setStatus(report.id, '삭제');
      if (report.targetType === 'discount') {
        const removed = await discountRepo.setStatus(report.targetId, '삭제');
        if (removed) {
          await notificationRepo.append(
            removed.authorId,
            '삭제',
            report.id,
            '검토 결과 게시물이 영구 삭제되었습니다.',
          );
        }
      }
      res.status(200).json(updated);
    },
  );

  return router;
}
