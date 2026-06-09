// Prisma row ↔ 도메인 Stored* 매핑.
//   Prisma 의 nullable(null) ↔ 도메인의 optional(undefined) 변환을 한곳에 모은다.
//   매핑 함수는 순수(네트워크 호출 0) — repo 가 행위를, 매퍼가 형태를 담당한다.
//
// 좌표(lat/lng) 주의: AgentProfile · DiscountPost 의 매장 앵커 좌표만 옮긴다.
//   사용자 위치가 아니며(불변식 ⑤), 전송/영속 동사를 좌표와 같은 줄에 두지 않는다.
import type { StoredAgentProfile } from '../agent/agent.types.js';
import type { Match } from '../agent/match.repo.js';
import type { StoredRequest, VerifiedPrice } from '../request/request.types.js';
import type { StoredNotification } from '../request/request.types.js';
import type { StoredMessage } from '../chat/message.types.js';
import type { StoredDiscountPost } from '../board/listings.types.js';
import type { Report } from '../governance/report.types.js';
import type { ReportStatus, ReportTargetType } from '../governance/report.types.js';
import type { DisputeAuditEntry } from '../governance/dispute.repo.js';
import type { Badge } from '../badge/badge.types.js';
import type { Bounty, BountyStatus, BountySubmission } from '../bounty/bounty.types.js';
import type { GroupSlot, GroupSlotStatus } from '../groupslot/groupslot.types.js';

// ── AgentProfile ─────────────────────────────────────────────
interface AgentRow {
  id: string;
  ownerUserId: string;
  status: string;
  bizName: string | null;
  bizNo: string | null;
  contact: string | null;
  bizDocRef: string | null;
  activeRegion: string;
  scheduleText: string;
  reputation: number;
  lat: number | null;
  lng: number | null;
}

export function rowToAgent(r: AgentRow): StoredAgentProfile {
  const out: StoredAgentProfile = {
    id: r.id,
    ownerUserId: r.ownerUserId,
    status: r.status as StoredAgentProfile['status'],
    activeRegion: r.activeRegion,
    scheduleText: r.scheduleText,
    reputation: r.reputation,
  };
  if (r.bizName !== null) out.bizName = r.bizName;
  if (r.bizNo !== null) out.bizNo = r.bizNo;
  if (r.contact !== null) out.contact = r.contact;
  if (r.bizDocRef !== null) out.bizDocRef = r.bizDocRef;
  // 매장 앵커 좌표(있을 때만) — 사용자 위치 아님(불변식 ⑤ 예외).
  if (r.lat !== null) out.lat = r.lat;
  if (r.lng !== null) out.lng = r.lng;
  return out;
}

// ── Match ────────────────────────────────────────────────────
interface MatchRow {
  id: string;
  agentId: string;
  buyerId: string;
  requestId: string | null;
  status: string;
  chatThreadId: string;
  createdAt: string;
  dealMethod: string | null;
}

export function rowToMatch(r: MatchRow): Match {
  const out: Match = {
    id: r.id,
    agentId: r.agentId,
    buyerId: r.buyerId,
    status: r.status as Match['status'],
    chatThreadId: r.chatThreadId,
    createdAt: r.createdAt,
  };
  if (r.requestId !== null) out.requestId = r.requestId;
  if (r.dealMethod !== null) out.dealMethod = r.dealMethod as Match['dealMethod'];
  return out;
}

// ── Request ──────────────────────────────────────────────────
interface RequestRow {
  id: string;
  ownerUserId: string;
  item: string;
  options: string | null;
  hopePrice: number;
  deadline: string;
  region: string;
  status: string;
  adoptedBy: string | null;
  matchId: string | null;
  vpPrice: number | null;
  vpAgentId: string | null;
  vpVerifiedAt: string | null;
  vpNote: string | null;
}

export function rowToRequest(r: RequestRow): StoredRequest {
  const out: StoredRequest = {
    id: r.id,
    ownerUserId: r.ownerUserId,
    item: r.item,
    hopePrice: r.hopePrice,
    deadline: r.deadline,
    region: r.region,
    status: r.status as StoredRequest['status'],
  };
  if (r.options !== null) out.options = r.options;
  if (r.adoptedBy !== null) out.adoptedBy = r.adoptedBy;
  if (r.matchId !== null) out.matchId = r.matchId;
  if (r.vpPrice !== null && r.vpAgentId !== null && r.vpVerifiedAt !== null) {
    const vp: VerifiedPrice = {
      price: r.vpPrice,
      agentId: r.vpAgentId,
      verifiedAt: r.vpVerifiedAt,
    };
    if (r.vpNote !== null) vp.note = r.vpNote;
    out.verifiedPrice = vp;
  }
  return out;
}

// VerifiedPrice → flat 컬럼(4)으로 풀어쓰는 헬퍼(repo setVerifiedPrice 용).
export function verifiedPriceToColumns(vp: VerifiedPrice): {
  vpPrice: number;
  vpAgentId: string;
  vpVerifiedAt: string;
  vpNote: string | null;
} {
  return {
    vpPrice: vp.price,
    vpAgentId: vp.agentId,
    vpVerifiedAt: vp.verifiedAt,
    vpNote: vp.note ?? null,
  };
}

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

// ── DiscountPost ─────────────────────────────────────────────
interface DiscountRow {
  id: string;
  authorId: string;
  storeBrand: string;
  discountRate: number | null;
  discountPrice: number | null;
  listPrice: number | null;
  unverifiedBase: boolean;
  source: string;
  photo: string | null;
  createdAt: string;
  status: string;
  referenceBasePrice: number | null;
  referenceLowestPrice: number | null;
  referenceProductId: string | null;
  referenceSource: string | null;
  referenceQuery: string | null;
  referenceFetchedAt: string | null;
  referencePrice: number | null; // legacy(미사용) — 읽되 매핑하지 않는다.
  lat: number | null;
  lng: number | null;
}

export function rowToDiscount(r: DiscountRow): StoredDiscountPost {
  const out: StoredDiscountPost = {
    id: r.id,
    authorId: r.authorId,
    storeBrand: r.storeBrand,
    unverifiedBase: r.unverifiedBase,
    source: r.source,
    createdAt: r.createdAt,
    status: r.status as StoredDiscountPost['status'],
  };
  if (r.discountRate !== null) out.discountRate = r.discountRate;
  if (r.discountPrice !== null) out.discountPrice = r.discountPrice;
  if (r.listPrice !== null) out.listPrice = r.listPrice;
  if (r.photo !== null) out.photo = r.photo;
  // 네이버쇼핑 참고가(외부 출처 스탬프, 불변식 ④) — all-or-nothing 복원(기준: referenceBasePrice).
  //   여섯 필드 전부 non-null 일 때만 함께 복원한다(부분 NULL 은 무시). legacy referencePrice 는
  //   읽되 매핑하지 않는다(O4 드롭 예정).
  if (
    r.referenceBasePrice !== null &&
    r.referenceLowestPrice !== null &&
    r.referenceProductId !== null &&
    r.referenceSource !== null &&
    r.referenceQuery !== null &&
    r.referenceFetchedAt !== null
  ) {
    out.referenceBasePrice = r.referenceBasePrice;
    out.referenceLowestPrice = r.referenceLowestPrice;
    out.referenceProductId = r.referenceProductId;
    out.referenceSource = r.referenceSource;
    out.referenceQuery = r.referenceQuery;
    out.referenceFetchedAt = r.referenceFetchedAt;
  }
  // 매장 앵커 좌표(있을 때만) — 운영자 시드 전용, 사용자 위치 아님(불변식 ⑤ 예외).
  if (r.lat !== null) out.lat = r.lat;
  if (r.lng !== null) out.lng = r.lng;
  return out;
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

// ── Dispute ──────────────────────────────────────────────────
interface DisputeRow {
  id: string;
  matchId: string;
  actorId: string;
  action: string;
  detail: string;
  createdAt: string;
}

export function rowToDispute(r: DisputeRow): DisputeAuditEntry {
  return {
    id: r.id,
    matchId: r.matchId,
    actorId: r.actorId,
    action: r.action,
    detail: r.detail,
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

// ── Bounty ───────────────────────────────────────────────────
interface BountyRow {
  id: string;
  requesterId: string;
  mission: string;
  status: string;
}

export function rowToBounty(r: BountyRow): Bounty {
  return {
    id: r.id,
    requesterId: r.requesterId,
    mission: r.mission,
    status: r.status as BountyStatus,
  };
}

interface BountySubmissionRow {
  id: string;
  bountyId: string;
  solverId: string;
  photo: string | null;
  createdAt: string;
  badgeAwarded: boolean;
}

export function rowToSubmission(r: BountySubmissionRow): BountySubmission {
  const out: BountySubmission = {
    id: r.id,
    bountyId: r.bountyId,
    solverId: r.solverId,
    createdAt: r.createdAt,
    badgeAwarded: r.badgeAwarded,
  };
  if (r.photo !== null) out.photo = r.photo;
  return out;
}

// ── GroupSlot ────────────────────────────────────────────────
interface GroupSlotRow {
  id: string;
  agentId: string;
  scheduleText: string;
  region: string;
  capacity: number;
  joinedCount: number;
  status: string;
}

export function rowToGroupSlot(r: GroupSlotRow): GroupSlot {
  return {
    id: r.id,
    agentId: r.agentId,
    scheduleText: r.scheduleText,
    region: r.region,
    capacity: r.capacity,
    joinedCount: r.joinedCount,
    status: r.status as GroupSlotStatus,
  };
}
