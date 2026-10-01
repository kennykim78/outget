// Prisma row ↔ 도메인 Stored* 매핑.
//   Prisma 의 nullable(null) ↔ 도메인의 optional(undefined) 변환을 한곳에 모은다.
//   매핑 함수는 순수(네트워크 호출 0) — repo 가 행위를, 매퍼가 형태를 담당한다.
//   (R1: Outget 매퍼 agent/match/request/discount/dispute/bounty/groupslot 제거.)
import type { StoredNotification } from '../notification/notification.types.js';
import type { StoredMessage } from '../chat/message.types.js';
import type { Report } from '../governance/report.types.js';
import type { ReportStatus, ReportTargetType } from '../governance/report.types.js';
import type { Badge } from '../badge/badge.types.js';

// ── Notification ─────────────────────────────────────────────
interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  refId: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export function rowToNotification(r: NotificationRow): StoredNotification {
  return {
    id: r.id,
    userId: r.userId,
    type: r.type,
    refId: r.refId,
    message: r.message,
    createdAt: r.createdAt,
    read: r.read,
  };
}

// ── Message ──────────────────────────────────────────────────
interface MessageRow {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export function rowToMessage(r: MessageRow): StoredMessage {
  return {
    id: r.id,
    threadId: r.threadId,
    senderId: r.senderId,
    body: r.body,
    createdAt: r.createdAt,
  };
}

// ── Report ───────────────────────────────────────────────────
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  reporterId: string;
  createdAt: string;
}

export function rowToReport(r: ReportRow): Report {
  return {
    id: r.id,
    targetType: r.targetType as ReportTargetType,
    targetId: r.targetId,
    reason: r.reason,
    status: r.status as ReportStatus,
    reporterId: r.reporterId,
    createdAt: r.createdAt,
  };
}

// ── Badge ────────────────────────────────────────────────────
interface BadgeRow {
  userId: string;
  type: string;
  grantedAt: string;
}

export function rowToBadge(r: BadgeRow): Badge {
  return { userId: r.userId, type: r.type, grantedAt: r.grantedAt };
}

