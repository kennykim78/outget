// 컴포지션 루트 — Repos 인터페이스 + 두 팩토리(InMemory / Prisma).
//   createApp(repos) 가 단일 진입점으로 주입받는다. 기본 인자는 makeInMemoryRepos()
//   → 테스트가 createApp() 무인자로 인메모리에서 그대로 통과한다.
//   index.ts 만 makePrismaRepos(prisma) 로 영속 경로를 켠다(전환 지점 1곳).
//   (R1: Outget 리포지토리 agent/match/request/discount/dispute/bounty/groupslot,
//    v0.1 분양·신청서·용품거래 모듈 제거.)
import type { PrismaClient } from '@prisma/client';

import { InMemoryUserRepository, type UserRepository } from '../auth/user.repo.js';
import { PrismaUserRepository } from '../auth/user.prisma.repo.js';
import {
  InMemoryRefreshTokenStore,
  PrismaRefreshTokenStore,
  type RefreshTokenStore,
} from '../auth/refresh.store.js';

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
  InMemoryReportRepository,
  type ReportRepository,
} from '../governance/report.repo.js';
import { PrismaReportRepository } from '../governance/report.prisma.repo.js';

import { InMemoryBadgeRepository, type BadgeRepository } from '../badge/badge.repo.js';
import { PrismaBadgeRepository } from '../badge/badge.prisma.repo.js';

import {
  InMemoryVetClinicRepository,
  type VetClinicRepository,
} from '../vet/vet.repo.js';
import { PrismaVetClinicRepository } from '../vet/vet.prisma.repo.js';

// 앱이 의존하는 전체 리포지토리 집합.
export interface Repos {
  user: UserRepository;
  refreshStore: RefreshTokenStore;
  notification: NotificationRepository;
  message: MessageRepository;
  report: ReportRepository;
  badge: BadgeRepository;
  vet: VetClinicRepository;
}

// 인메모리 구성(테스트 기본 + dev 폴백). 프로세스 메모리에만 존재.
export function makeInMemoryRepos(): Repos {
  return {
    user: new InMemoryUserRepository(),
    refreshStore: new InMemoryRefreshTokenStore(),
    notification: new InMemoryNotificationRepository(),
    message: new InMemoryMessageRepository(),
    report: new InMemoryReportRepository(),
    badge: new InMemoryBadgeRepository(),
    vet: new InMemoryVetClinicRepository(),
  };
}

// 영속(SQLite/Prisma) 구성. index.ts 에서 prisma 싱글턴을 주입한다.
export function makePrismaRepos(prisma: PrismaClient): Repos {
  return {
    user: new PrismaUserRepository(prisma),
    refreshStore: new PrismaRefreshTokenStore(prisma),
    notification: new PrismaNotificationRepository(prisma),
    message: new PrismaMessageRepository(prisma),
    report: new PrismaReportRepository(prisma),
    badge: new PrismaBadgeRepository(prisma),
    vet: new PrismaVetClinicRepository(prisma),
  };
}
