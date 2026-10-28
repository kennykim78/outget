// PrismaClient 싱글턴. 영속 레이어 진입점(index.ts 가 makePrismaRepos 에 주입).
// 테스트/인메모리 경로는 이 모듈을 import 하지 않는다 — DB 연결 0(190 테스트 보호).
import { PrismaClient } from '@prisma/client';
import { sqliteDatasourceUrl } from './sqlite-url.js';

// SQLite 는 연결 1개(sqlite-url.ts — 잠금 대기가 엔진 스레드를 막아 대화형 트랜잭션이 만료되는 경합 방지).
const datasourceUrl = sqliteDatasourceUrl(process.env.DATABASE_URL);
export const prisma = datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();

// 우아한 종료(index.ts SIGTERM/SIGINT 에서 호출).
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
