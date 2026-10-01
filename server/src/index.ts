import { createApp } from './app.js';
import { makePrismaRepos } from './db/repos.js';
import { prisma, disconnectPrisma } from './db/prisma.js';

const PORT = Number(process.env.PORT) || 3001;

// 영속(SQLite/Prisma) 경로로 부팅 — 전환 지점은 이 한 곳뿐.
//   콘텐츠 시드 적재는 seed 로더(R2)가 담당한다.
const app = createApp(makePrismaRepos(prisma));

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[withsmall] server listening on :${PORT} (SQLite/Prisma)`);
});

// 우아한 종료 — HTTP 서버 닫고 Prisma 연결 해제.
async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[withsmall] ${signal} 수신 — 종료 중...`);
  server.close(async () => {
    await disconnectPrisma();
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
