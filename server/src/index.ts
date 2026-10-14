import { createApp } from './app.js';
import { makePrismaRepos } from './db/repos.js';
import { prisma, disconnectPrisma } from './db/prisma.js';
import { loadKnownIds } from './boot/known-ids.js';

const PORT = Number(process.env.PORT) || 3001;

// 영속(SQLite/Prisma) 경로로 부팅 — 전환 지점은 이 한 곳뿐.
//   콘텐츠 시드 적재는 seed 로더(R2)가 담당한다.
// 허용 id 집합(기동 시 1회, boot/known-ids.ts): 제보 treats = 검수 통과 동물,
//   반응 대상 = 노출 상품·SupplyItem·Bundle 의 상위집합(엔진 isVerified + 상품 ACTIVE·meetsMinSpec).
//   시드 재적재 후에는 재기동으로 갱신된다. 비어 있으면 거부(fail-closed).
const { knownTypeIds, knownTargetIds } = await loadKnownIds(prisma);

// 운영(development·test 외): PUBLIC_ORIGIN 없음·console 메일·REACTION_KEY_SECRET·JWT 시크릿 부족·TRUST_PROXY 오류면
//   createApp 이 throw(fail-closed).
const app = createApp(makePrismaRepos(prisma), { knownTypeIds, knownTargetIds });

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
