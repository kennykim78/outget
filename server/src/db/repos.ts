// 컴포지션 루트 — Repos 인터페이스 + 두 팩토리(InMemory / Prisma).
//   createApp(repos) 가 단일 진입점으로 주입받는다. 기본 인자는 makeInMemoryRepos()
//   → 테스트(190개)가 createApp() 무인자로 인메모리에서 그대로 통과한다.
//   index.ts 만 makePrismaRepos(prisma) 로 영속 경로를 켠다(전환 지점 1곳).
//
// listings 는 Repos 멤버가 아니다 — InMemoryListingsRepository 어댑터가 agent/request/
//   discount/badge repo 를 주입받아 시드+등록분을 병합한다(Prisma 전용 클래스 없음).
//   paymentRail 도 repo 가 아니다(app.ts 가 직접 생성).
import type { PrismaClient } from '@prisma/client';

import { InMemoryUserRepository, type UserRepository } from '../auth/user.repo.js';
import { PrismaUserRepository } from '../auth/user.prisma.repo.js';
import {
  InMemoryRefreshTokenStore,
  PrismaRefreshTokenStore,
  type RefreshTokenStore,
} from '../auth/refresh.store.js';

import {
  InMemoryAgentProfileRepository,
  type AgentProfileRepository,
} from '../agent/agent.repo.js';
import { PrismaAgentProfileRepository } from '../agent/agent.prisma.repo.js';
import { InMemoryMatchRepository, type MatchRepository } from '../agent/match.repo.js';
import { PrismaMatchRepository } from '../agent/match.prisma.repo.js';

import {
  InMemoryRequestRepository,
  type RequestRepository,
} from '../request/request.repo.js';
import { PrismaRequestRepository } from '../request/request.prisma.repo.js';

import {
  InMemoryNotificationRepository,
  type NotificationRepository,
} from '../notification/notification.repo.js';
import { PrismaNotificationRepository } from '../notification/notification.prisma.repo.js';

import {
  InMemoryMessageRepository,
  type MessageRepository,
} from '../chat/message.repo.js';
import { PrismaMessageRepository } from '../chat/message.prisma.repo.js';

import {
  InMemoryDiscountRepository,
  type DiscountRepository,
} from '../board/discount.repo.js';
import { PrismaDiscountRepository } from '../board/discount.prisma.repo.js';

import {
  InMemoryReportRepository,
  type ReportRepository,
} from '../governance/report.repo.js';
import { PrismaReportRepository } from '../governance/report.prisma.repo.js';

import {
  InMemoryDisputeRepository,
  type DisputeRepository,
} from '../governance/dispute.repo.js';
import { PrismaDisputeRepository } from '../governance/dispute.prisma.repo.js';

import { InMemoryBadgeRepository, type BadgeRepository } from '../badge/badge.repo.js';
import { PrismaBadgeRepository } from '../badge/badge.prisma.repo.js';

import {
  InMemoryBountyRepository,
  type BountyRepository,
} from '../bounty/bounty.repo.js';
import { PrismaBountyRepository } from '../bounty/bounty.prisma.repo.js';

import {
  InMemoryGroupSlotRepository,
  type GroupSlotRepository,
} from '../groupslot/groupslot.repo.js';
import { PrismaGroupSlotRepository } from '../groupslot/groupslot.prisma.repo.js';

// 앱이 의존하는 전체 리포지토리 집합.
export interface Repos {
  user: UserRepository;
  refreshStore: RefreshTokenStore;
  agent: AgentProfileRepository;
  match: MatchRepository;
  request: RequestRepository;
  notification: NotificationRepository;
  message: MessageRepository;
  discount: DiscountRepository;
  report: ReportRepository;
  dispute: DisputeRepository;
  badge: BadgeRepository;
  bounty: BountyRepository;
  groupSlot: GroupSlotRepository;
}

// 인메모리 구성(테스트 기본 + dev 폴백). 프로세스 메모리에만 존재.
export function makeInMemoryRepos(): Repos {
  return {
    user: new InMemoryUserRepository(),
    refreshStore: new InMemoryRefreshTokenStore(),
    agent: new InMemoryAgentProfileRepository(),
    match: new InMemoryMatchRepository(),
    request: new InMemoryRequestRepository(),
    notification: new InMemoryNotificationRepository(),
    message: new InMemoryMessageRepository(),
    discount: new InMemoryDiscountRepository(),
    report: new InMemoryReportRepository(),
    dispute: new InMemoryDisputeRepository(),
    badge: new InMemoryBadgeRepository(),
    bounty: new InMemoryBountyRepository(),
    groupSlot: new InMemoryGroupSlotRepository(),
  };
}

// 영속(SQLite/Prisma) 구성. index.ts 에서 prisma 싱글턴을 주입한다.
export function makePrismaRepos(prisma: PrismaClient): Repos {
  return {
    user: new PrismaUserRepository(prisma),
    refreshStore: new PrismaRefreshTokenStore(prisma),
    agent: new PrismaAgentProfileRepository(prisma),
    match: new PrismaMatchRepository(prisma),
    request: new PrismaRequestRepository(prisma),
    notification: new PrismaNotificationRepository(prisma),
    message: new PrismaMessageRepository(prisma),
    discount: new PrismaDiscountRepository(prisma),
    report: new PrismaReportRepository(prisma),
    dispute: new PrismaDisputeRepository(prisma),
    badge: new PrismaBadgeRepository(prisma),
    bounty: new PrismaBountyRepository(prisma),
    groupSlot: new PrismaGroupSlotRepository(prisma),
  };
}
