// 신고→블라인드(notice-and-takedown) 라우터.
//   POST /api/reports               (auth)   — 신고 생성(생성 즉시 status='블라인드' 임시조치).
//   POST /api/reports/:id/appeal    (작성자)  — 이의제기(대상 글 작성자 본인만). status='이의' + 운영자 알림.
//   GET  /api/reports?status=       (운영자)  — 상태별 신고 목록.
//   POST /api/reports/:id/restore   (운영자)  — 복구(재노출).
//   POST /api/reports/:id/remove    (운영자)  — 영구 삭제(목록 제외).
//
// 신고 즉시 임시조치(블라인드) → 이의/복구/삭제 상태머신. 운영자 동선 분리.
// 자금 흐름 필드 0. 좌표 0(검증에서 차단). 외부 fetch 0(자사만).
// R1: Outget 할인소식 대상 연동 제거. 대상 작성자 추적은 해당 기능(병원 제보 등)이
//   들어올 때 추가한다 — 그 전까지 이의제기는 fail-closed(403).
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import type { ReportRepository } from './report.repo.js';
import type { NotificationRepository } from '../notification/notification.repo.js';
import type { ReportStatus } from './report.types.js';
import { validateReportInput } from './report.validation.js';

// 운영자 알림 수신 채널(고정 inbox). 운영자 계정 레지스트리는 후속.
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

// 대상 글 작성자 조회 — 현재 작성자를 추적할 수 있는 대상 타입이 없다(항상 undefined).
async function targetAuthor(): Promise<string | undefined> {
  return undefined;
}

export function createReportRouter(
  reportRepo: ReportRepository,
  notificationRepo: NotificationRepository,
): Router {
  const router = Router();

  // 신고 생성 — 인증 사용자면 누구나. 즉시 블라인드(임시조치).
  router.post('/reports', requireAuth, async (req, res) => {
    const result = validateReportInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const report = await reportRepo.create(req.user!.sub, result.value);
    res.status(201).json(report);
  });

  // 이의제기 — 대상 글 작성자 본인만(아니면 403). status='이의' + 운영자 알림.
  router.post('/reports/:id/appeal', requireAuth, async (req, res) => {
    const report = await reportRepo.findById(req.params.id);
    if (!report) {
      res.status(404).json({ error: '신고를 찾을 수 없습니다.' });
      return;
    }
    const author = await targetAuthor();
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

  // 복구(재노출) — 운영자만.
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
      res.status(200).json(updated);
    },
  );

  // 영구 삭제 — 운영자만.
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
      res.status(200).json(updated);
    },
  );

  return router;
}
