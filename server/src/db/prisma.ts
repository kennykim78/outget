// PrismaClient 싱글턴. 영속 레이어 진입점(index.ts 가 makePrismaRepos 에 주입).
// 테스트/인메모리 경로는 이 모듈을 import 하지 않는다 — DB 연결 0(190 테스트 보호).
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// 우아한 종료(index.ts SIGTERM/SIGINT 에서 호출).
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
