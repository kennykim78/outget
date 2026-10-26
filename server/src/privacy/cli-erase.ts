// 운영자 삭제 CLI(P7) — 메일 등으로 받은 삭제 요청을 운영자가 처리한다. 라우트와 같은 eraseAccount(channel=OPERATOR).
//   사용: npm run privacy:erase -w server -- --email <주소>      (컨테이너: node dist/privacy/cli-erase.js --email <주소>)
//   출력: 건수만(이메일·userId·해시 0). 사용자가 없어도 그 이메일의 토큰 정리 + 묘비 기록(DB + WS_ERASURE_FILE)은 한다(백업 복원 재적용).
//   종료 코드: 0 성공(삭제 + VACUUM) · 2 인자 오류 · 1 실행 실패(VACUUM 만 실패해도 1 — 삭제는 커밋됨, 재실행 멱등).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { normalizeEmail } from '../save/email.js';
import { eraseAccount, type EraseCounts, type ErasureStore } from './erase.js';

export interface EraseCliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => Date;
  /** 인자 검증 통과 후에만 호출(연결 종료는 호출자 책임). */
  store: () => Promise<ErasureStore>;
}

const USAGE = 'usage: privacy:erase --email <address>';

function parseEmail(argv: readonly string[]): string | null {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') {
      if (raw !== undefined || i + 1 >= argv.length) return null;
      raw = argv[++i];
    } else if (a.startsWith('--email=')) {
      if (raw !== undefined) return null;
      raw = a.slice('--email='.length);
    } else {
      return null;
    }
  }
  return normalizeEmail(raw);
}

export function formatCounts(c: EraseCounts): string {
  return (
    `privacy:erase — magicTokens ${c.magicTokens}, users ${c.users}, sessions ${c.sessions}, snapshots ${c.snapshots},` +
    ` badges ${c.badges}, notifications ${c.notifications}, refreshTokens ${c.refreshTokens}`
  );
}

export async function runEraseCli(argv: readonly string[], io: EraseCliIo): Promise<number> {
  const email = parseEmail(argv);
  if (email === null) {
    io.stderr('privacy:erase: --email 값이 없거나 형식이 아니다(값은 출력하지 않음)');
    io.stderr(USAGE);
    return 2;
  }
  const store = await io.store();
  const counts = await eraseAccount(store, { email }, 'OPERATOR', io.now(), io.stdout);
  io.stdout(formatCounts(counts));
  // 101 L-5: 라우트(DELETE /api/save → compact 스케줄러)와 같이 삭제 페이지를 파일에서 제거(SQLite VACUUM). 트랜잭션 밖.
  //   실패해도 삭제는 이미 커밋 — 종료 1 로 알리고, 같은 명령 재실행(멱등) 또는 다음 정리 작업(24h, 끝에 VACUUM)이 마무리한다.
  try {
    await store.compact?.();
  } catch (e) {
    io.stderr(`privacy:erase: 삭제는 완료, VACUUM 실패(${(e as Error).name}) — 같은 명령을 다시 실행하거나 다음 정리 작업을 기다린다`);
    return 1;
  }
  return 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const norm = (u: string): string => (process.platform === 'win32' ? u.toLowerCase() : u);
  return norm(pathToFileURL(resolve(entry)).href) === norm(import.meta.url);
}

if (isMain()) {
  let client: PrismaClient | null = null;
  try {
    process.exitCode = await runEraseCli(process.argv.slice(2), {
      stdout: (l) => process.stdout.write(`${l}\n`),
      stderr: (l) => process.stderr.write(`${l}\n`),
      now: () => new Date(),
      store: async () => {
        const [{ PrismaClient: Ctor }, { PrismaErasureStore }, { resolveBackupConfig }, { resolveErasureFile, withTombstoneFile }] =
          await Promise.all([import('@prisma/client'), import('./erase.prisma.js'), import('./retention.js'), import('./tombstone-file.js')]);
        // 서버와 같은 묘비 파일(WS_ERASURE_FILE)에도 기록 — 백업 복원 후 재적용. 경로 검사 실패면 아무것도 지우지 않고 종료 1.
        const file = resolveErasureFile(process.env, resolveBackupConfig(process.env).dir);
        const c = new Ctor();
        client = c;
        return withTombstoneFile(new PrismaErasureStore(c), file, async (id) => (await c.user.findUnique({ where: { id }, select: { email: true } }))?.email ?? null);
      },
    });
  } catch (e) {
    // 오류 메시지에 쿼리 인자(이메일)가 섞일 수 있어 이름만 출력.
    process.stderr.write(`privacy:erase: 실패(트랜잭션 롤백) — ${(e as Error).name}\n`);
    process.exitCode = 1;
  } finally {
    if (client) await (client as PrismaClient).$disconnect();
  }
}
