import { createApp } from './app.js';
import { makePrismaRepos } from './db/repos.js';
import { prisma, disconnectPrisma } from './db/prisma.js';
import { loadKnownIds } from './boot/known-ids.js';
import { resolveBackupConfig, runRetention, startRetentionSchedule } from './privacy/retention.js';
import { PrismaRetentionStore } from './privacy/retention.prisma.js';
import { resolveErasureFile, withTombstoneFile } from './privacy/tombstone-file.js';
import { privacyPlaceholderCheck, resolveClientDist } from './config/env.js';

// 직접 실행(node dist/index.js·start:prod)에서도 docker-entrypoint 와 같은 검사 — 운영에서 /privacy 에 {{KENNY: 자리표시가 있으면
//   기동 거부(exit 1), WS_ALLOW_PRIVACY_PLACEHOLDER=1 만 경고로 허용. 묘비 재적용·retention 등 기존 기동 순서보다 앞.
{
  const privacy = privacyPlaceholderCheck(process.env, resolveClientDist(process.env));
  // eslint-disable-next-line no-console
  for (const w of privacy.warnings) console.warn(`[withsmall] env 경고: ${w}`);
  if (privacy.problems.length > 0) {
    // eslint-disable-next-line no-console
    for (const p of privacy.problems) console.error(`[withsmall] 기동 거부: ${p}`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT) || 3001;

// 영속(SQLite/Prisma) 경로로 부팅 — 전환 지점은 이 한 곳뿐.
//   콘텐츠 시드 적재는 seed 로더(R2)가 담당한다.
// 허용 id 집합(기동 시 1회, boot/known-ids.ts): 제보 treats = 검수 통과 동물,
//   반응 대상 = 노출 상품·SupplyItem·Bundle 의 상위집합(엔진 isVerified + 상품 ACTIVE·meetsMinSpec).
//   시드 재적재 후에는 재기동으로 갱신된다. 비어 있으면 거부(fail-closed).

// P5: 백업 나이 정리 설정(WS_BACKUP_DIR·WS_BACKUP_MAX_AGE_DAYS, prune-backups.sh 와 같은 이름·규칙) — 잘못되면 기동 실패.
const backup = resolveBackupConfig(process.env);
// 묘비 파일(WS_ERASURE_FILE, 기본 /data/erasures.jsonl) — 백업 폴더·DB 파일과 겹치면 기동 실패.
const erasureFile = resolveErasureFile(process.env, backup.dir);
const baseRepos = makePrismaRepos(prisma);
// 삭제(라우트 SELF·정리 RETENTION)는 묘비를 파일에도 남긴다(삭제 전). 재적용 = DB 묘비 ∪ 파일 묘비, 정리 = 둘 다 7일.
const repos = {
  ...baseRepos,
  erasure: withTombstoneFile(baseRepos.erasure, erasureFile, async (id) => (await baseRepos.user.findById(id))?.email ?? null),
};

// P4: 묘비 재적용 — 컨테이너 순서상 migrate deploy·seed load(콘텐츠 테이블만) 뒤, 요청을 받기 전.
//   백업 복원으로 되살아난(묘비 시각 이전 생성) User 를 다시 지운다 — 전체 백업 복원으로 DB 묘비가 사라져도 파일 묘비로.
//   파일 손상 줄은 건너뛰고 오류 이름만 로그(기동 계속), 파일을 못 읽으면 기동 실패. 로그는 건수만.
const reapplied = await repos.erasure.reapplyTombstones();
// eslint-disable-next-line no-console
console.log(`[privacy] tombstone reapply users=${reapplied}`);

const { knownTypeIds, knownTargetIds } = await loadKnownIds(prisma);

// 운영(development·test 외): PUBLIC_ORIGIN 없음·console 메일·REACTION_KEY_SECRET·JWT 시크릿 부족·TRUST_PROXY 오류면
//   createApp 이 throw(fail-closed).
const app = createApp(repos, { knownTypeIds, knownTargetIds });

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[withsmall] server listening on :${PORT} (SQLite/Prisma)`);
});

// P5: 보존 기간 정리 — 기동 1회 + 24h(unref). 끝에 VACUUM. 실패는 로그만(다음 주기 재시도).
const retentionStore = new PrismaRetentionStore(prisma, 'sqlite');
const retention = startRetentionSchedule(() =>
  runRetention({ store: retentionStore, erasure: repos.erasure, backup }, new Date()),
);

// 우아한 종료 — 정리 타이머 정지, HTTP 서버 닫고 Prisma 연결 해제.
async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[withsmall] ${signal} 수신 — 종료 중...`);
  retention.stop();
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
