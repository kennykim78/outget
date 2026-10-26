// 컴포지션 루트 — Repos 인터페이스 + 두 팩토리(InMemory / Prisma).
//   createApp(repos) 가 단일 진입점으로 주입받는다. 기본 인자는 makeInMemoryRepos()
//   → 테스트가 createApp() 무인자로 인메모리에서 그대로 통과한다.
//   index.ts 만 makePrismaRepos(prisma) 로 영속 경로를 켠다(전환 지점 1곳).
//   (R5 D4: message·badge 는 Repos 에서 제거 — 소스·Prisma 모델은 유지, 앱 경로에서 미사용.)
//   (R1: 이전 서비스 리포지토리 agent/match/request/discount/dispute/bounty/groupslot,
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
  InMemoryReportRepository,
  type ReportRepository,
} from '../governance/report.repo.js';
import { PrismaReportRepository } from '../governance/report.prisma.repo.js';

import {
  InMemoryVetClinicRepository,
  type VetClinicRepository,
  type VetReportRepository,
} from '../vet/vet.repo.js';
import { PrismaVetClinicRepository } from '../vet/vet.prisma.repo.js';

import { InMemoryEventRepository, type EventRepository } from '../analytics/event.repo.js';
import { PrismaEventRepository } from '../analytics/event.prisma.repo.js';

import { InMemoryReactionRepository, type ReactionRepository } from '../reaction/reaction.repo.js';
import { PrismaReactionRepository } from '../reaction/reaction.prisma.repo.js';

import {
  InMemoryMagicTokenRepository,
  InMemorySaveSnapshotRepository,
  InMemorySessionRepository,
  type MagicTokenRepository,
  type SaveSnapshotRepository,
  type SessionRepository,
} from '../save/save.repo.js';
import {
  PrismaMagicTokenRepository,
  PrismaSaveSnapshotRepository,
  PrismaSessionRepository,
} from '../save/save.prisma.repo.js';

import { InMemoryErasureStore, type ErasureStore } from '../privacy/erase.js';
import { PrismaErasureStore } from '../privacy/erase.prisma.js';

// 앱이 의존하는 전체 리포지토리 집합.
export interface Repos {
  user: UserRepository;
  refreshStore: RefreshTokenStore;
  notification: NotificationRepository;
  report: ReportRepository;
  /** 읽기(VERIFIED 만) + 제보 쓰기(REPORTED, 비노출 — D15). */
  vet: VetClinicRepository & VetReportRepository;
  /** 익명 반응(C-R5-3). */
  reaction: ReactionRepository;
  event: EventRepository;
  // R5 저장(C-R5-2): 매직링크 토큰·세션·스냅샷(원문 토큰·세션 id 없음, 해시만).
  magicToken: MagicTokenRepository;
  session: SessionRepository;
  saveSnapshot: SaveSnapshotRepository;
  /** P2 개인정보 삭제(DELETE /api/save·CLI·정리 작업 공용). 토큰→User(Cascade)→Badge·Notification·RefreshToken + 묘비. */
  erasure: ErasureStore;
}

// 인메모리 구성(테스트 기본 + dev 폴백). 프로세스 메모리에만 존재.
export function makeInMemoryRepos(): Repos {
  const user = new InMemoryUserRepository();
  const refreshStore = new InMemoryRefreshTokenStore();
  const notification = new InMemoryNotificationRepository();
  const magicToken = new InMemoryMagicTokenRepository();
  const session = new InMemorySessionRepository();
  const saveSnapshot = new InMemorySaveSnapshotRepository();
  return {
    user,
    refreshStore,
    notification,
    report: new InMemoryReportRepository(),
    vet: new InMemoryVetClinicRepository(),
    reaction: new InMemoryReactionRepository(),
    event: new InMemoryEventRepository(),
    magicToken,
    session,
    saveSnapshot,
    erasure: new InMemoryErasureStore({ user, refreshStore, notification, magicToken, session, saveSnapshot }),
  };
}

// 영속(SQLite/Prisma) 구성. index.ts 에서 prisma 싱글턴을 주입한다.
export function makePrismaRepos(prisma: PrismaClient): Repos {
  return {
    user: new PrismaUserRepository(prisma),
    refreshStore: new PrismaRefreshTokenStore(prisma),
    notification: new PrismaNotificationRepository(prisma),
    report: new PrismaReportRepository(prisma),
    vet: new PrismaVetClinicRepository(prisma),
    reaction: new PrismaReactionRepository(prisma),
    event: new PrismaEventRepository(prisma),
    magicToken: new PrismaMagicTokenRepository(prisma),
    session: new PrismaSessionRepository(prisma),
    saveSnapshot: new PrismaSaveSnapshotRepository(prisma),
    erasure: new PrismaErasureStore(prisma),
  };
}
