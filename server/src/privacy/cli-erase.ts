// 운영자 삭제 CLI(P7) — 메일 등으로 받은 삭제 요청을 운영자가 처리한다. 라우트와 같은 eraseAccount(channel=OPERATOR).
//   153: 이메일은 명령줄(argv)로 받지 않는다 — sudo COMMAND=·journald·운영자 접속 기록·셸 history 에 남지 않게 표준 입력 한 줄로만.
//   사용: npm run privacy:erase -w server   → 안내가 뜨면 이메일을 붙여넣고 Enter, 확인용으로 한 번 더 입력하고 Enter
//         (화면에만 보이고 프로그램은 값을 되울리지 않음). 159: 두 입력이 다르거나 확인 없이 끝나면 거부(종료 2).
//         컨테이너: sudo -u deploy docker compose -f /opt/withsmall/compose.yaml exec app node dist/privacy/cli-erase.js
//   인수는 무엇이든 거부(종료 2, 표준 입력 읽지 않음). 한 번에 한 계정 — 비TTY(파이프)는 비어 있지 않은 줄이 정확히 1개,
//   TTY 는 첫 줄과 확인 줄이 같아야 한다(두 줄 붙여넣기·불일치·확인 전 EOF 는 거부).
//   162·166: TTY 는 확인 줄(또는 빈 첫 줄·상한 초과) 뒤 raw 모드로 바꿔 정착 구간까지 읽어 버리고(비공백이면 거부),
//   결과를 낸 뒤에도 프로세스 종료 직전까지 계속 읽어 버린다 — 붙여넣은 나머지가 부모 셸로 넘어가지 않게. 종료 전 raw 복원.
//   출력: 건수만(이메일·userId·해시 0). 사용자가 없어도 그 이메일의 토큰 정리 + 묘비 기록(DB + WS_ERASURE_FILE)은 한다(백업 복원 재적용).
//   종료 코드: 0 성공(삭제 + VACUUM) · 2 입력 오류(인수 있음·빈 입력·여러 줄·확인 불일치·형식·잘못된 UTF-8·너무 김·읽기 오류) · 1 실행 실패(VACUUM 만 실패해도 1 — 삭제는 커밋됨, 재실행 멱등).
import { constants as osConstants } from 'node:os';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { normalizeEmail } from '../save/email.js';
import { eraseAccount, type EraseCounts, type ErasureStore } from './erase.js';

export interface EraseCliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now: () => Date;
  /** 표준 입력 전체(TTY 면 확인 일치 시 첫 줄, 불일치·정착 구간 입력이면 'multi' 로 거부되는 두 줄). null = 너무 김·읽기 오류. 인수 검사 통과 후에만 호출. */
  readInput: () => Promise<string | null>;
  /** 입력 검증 통과 후에만 호출(연결 종료는 호출자 책임). */
  store: () => Promise<ErasureStore>;
}

const USAGE = 'usage: privacy:erase (인수 없음 — 이메일은 표준 입력 한 줄)';
export const STDIN_PROMPT = '삭제할 계정 이메일을 입력하고 Enter(값은 출력하지 않음):';
export const STDIN_CONFIRM_PROMPT = '삭제할 계정 이메일을 한 번 더 입력하고 Enter(확인용, 값은 출력하지 않음):';
/** 두 줄(TTY 첫 줄 + 확인 줄) 합계 상한. 166: 보관량 상한일 뿐 — 넘어도 읽기는 계속한다(결과는 거부). */
export const STDIN_MAX_BYTES = 1024;

type InputProblem = 'empty' | 'multi' | 'format';

/** 입력 분류 — 값은 돌려주지 않는다(오류 메시지에 값이 섞일 길 차단). */
function classifyInput(text: string): { ok: true; email: string } | { ok: false; reason: InputProblem } {
  // String.trim 은 U+FEFF(BOM)·\r·\t 도 지운다 — 줄 끝 \r 도 trim 몫(159 LOW-1: split 에 \r? 를 따로 두면 동치 변이라 테스트로 지킬 수 없다).
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, reason: 'empty' };
  if (lines.length > 1) return { ok: false, reason: 'multi' };
  const email = normalizeEmail(lines[0]);
  return email === null ? { ok: false, reason: 'format' } : { ok: true, email };
}

/** 표준 입력 텍스트 → 정규화 이메일. 비어 있지 않은 줄이 정확히 1개가 아니거나 형식이 아니면 null. */
export function parseEmailInput(text: string): string | null {
  const r = classifyInput(text);
  return r.ok ? r.email : null;
}

export interface ReadStdinOptions {
  isTTY: boolean;
  maxBytes?: number;
  /** TTY 일 때만 안내 1줄을 쓴다(입력값은 절대 쓰지 않음). write 가 던지면 읽기를 정리하고 null(166). */
  prompt: { write: (s: string) => unknown };
  /** 162: TTY 정착 구간 — 멈춤 지점 뒤 마지막 조각으로부터 이 시간 동안 조각이 더 없으면 끝(기본 250ms). */
  settleMs?: number;
  /** 162: 정착 구간 전체 상한(조각이 계속 와도 이 시간이 지나면 거부로 끝, 기본 2000ms). */
  settleMaxMs?: number;
}

/** 166: 결과 프로미스 + release(). TTY 는 결과를 낸 뒤에도 release() 전까지 입력을 계속 읽어 버린다(결과 불변). */
export type StdinRead = Promise<string | null> & { release: () => void };

export const TTY_SETTLE_MS = 250;
export const TTY_SETTLE_MAX_MS = 2000;
/** classifyInput 이 반드시 'multi' 로 거부하는 고정 텍스트(입력값 무관 — 빈 첫 줄 뒤 붙여넣기도 거부되게). */
const TTY_MULTI_REJECT = '-\n-';
/** 166: classifyInput 이 반드시 'format' 으로 거부하는 고정 텍스트(잘못된 UTF-8 — 대체 문자로 받아들이지 않는다). */
const FORMAT_REJECT = '-';

/** TTY 확인 실패(불일치·확인 줄 비어 있음·확인 전 EOF) → classifyInput 이 반드시 'multi' 로 거부하는 텍스트(비어 있지 않은 줄 2개). */
function ttyReject(line1: string, line2: string): string {
  return line2.trim() === '' ? `${line1}\n${line1}` : `${line1}\n${line2}`;
}

/** TTY 첫 줄(비어 있지 않음) + 확인 줄 → trim 값이 같으면 첫 줄, 아니면 거부 텍스트. 뒤에 오는 내용은 정착 구간이 본다. */
function ttyConfirm(line1: string, line2: string): string {
  return line1.trim() === line2.trim() ? line1 : ttyReject(line1, line2);
}

/** 166: 엄격 UTF-8(fatal) — 잘못된 바이트는 undefined(→ 형식 오류). BOM 은 남겨 classifyInput 의 trim 이 지운다(기존 의미 유지). */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function decodeStrict(b: Uint8Array): string | undefined {
  try {
    return STRICT_UTF8.decode(b);
  } catch {
    return undefined;
  }
}

/** 166: 정착 구간에서 허용하는 바이트는 공백·CR·LF 뿐. raw 모드라 0x03(Ctrl-C)·0x04(Ctrl-D)·ESC(브래킷 표식 \e[200~ / \e[201~)·탭 등 그 밖은 전부 비공백. */
function hasNonBlank(b: Uint8Array): boolean {
  return b.some((x) => x !== 0x20 && x !== 0x0d && x !== 0x0a);
}

type RawCapable = Readable & { setRawMode?: (mode: boolean) => unknown };

/**
 * 비TTY: EOF(또는 'close')까지 읽는다. 상한 초과면 보관만 멈추고 EOF 까지 버려 읽은 뒤 null(destroy 하지 않는다 — 166).
 * TTY(159): 안내 1 → 첫 줄 → 안내 2(확인) → 확인 줄. 두 입력 줄은 canonical 그대로(터미널 에코·줄 편집 유지, 프로그램 되울림 0).
 *   같으면 첫 줄, 다르면 'multi' 거부. 첫 줄이 비면 확인 없이 그 줄(→ 'empty'). 확인 줄 전 EOF 는 거부(확인 없이 쓰지 않는다).
 * 멈춤 지점(확인 줄 수신·빈 첫 줄·상한 초과 — 162 QA161, 166 QA163 D1·D2·Codex164):
 *   ① TTY 면 즉시 setRawMode(true) — canonical 은 줄바꿈 전 미완성 줄(붙여넣기 마지막 줄·브래킷 끝 표식)을 넘기지 않으므로,
 *      raw 로 바꿔 그것까지 바로 받아 버린다(셸 입력 줄로 넘어가지 않게).
 *   ② 정착 구간(조각마다 settleMs 재시작, 전체 settleMaxMs): 공백·CR·LF 외 바이트가 하나라도 오면 거부. 전체 상한 도달도 거부.
 *      raw 중 0x03 은 SIGINT 가 오지 않는다 — 비공백이라 거부(store 미호출)로 끝난다.
 *   ③ 상한은 보관량만 제한 — 초과(결과 null)·추가 줄·불일치는 되돌릴 수 없는 거부 상태로 두고 읽기(소비)는 계속한다.
 *   ④ 결과를 낸 뒤에도 release() 전까지 리스너를 남겨 store()·삭제·VACUUM 동안 들어온 바이트를 읽어 버린다(결과 불변).
 *      판정 뒤 raw 중 0x03 은 무시한다 — 삭제가 이미 판정돼 진행 중이라 중간 중단(트랜잭션 뒤 묘비 파일·VACUUM 누락)이 더 위험하다.
 *   release(): 멱등. raw 복원(setRawMode(false)) → 리스너 제거 → pause. 판정 전이면 결과 null.
 * 한계(deploy.md 4절): release() 뒤(결과 출력 뒤)에 친 입력은 셸로 간다 — 같은 TTY 를 부모 셸에 돌려주는 구조라 완전 차단은 불가.
 */
export function readStdinText(stream: Readable, opts: ReadStdinOptions): StdinRead {
  const maxBytes = opts.maxBytes ?? STDIN_MAX_BYTES;
  const settleMs = opts.settleMs ?? TTY_SETTLE_MS;
  const settleMaxMs = opts.settleMaxMs ?? TTY_SETTLE_MAX_MS;
  const tty = opts.isTTY;
  const rawStream = tty && typeof (stream as RawCapable).setRawMode === 'function' ? (stream as RawCapable) : null;
  let resolveResult!: (v: string | null) => void;
  const result = new Promise<string | null>((r) => {
    resolveResult = r;
  });
  // 'line' = 입력 줄(canonical) · 'settle' = 멈춤 뒤 정착(raw) · 'post' = 결과 냄, release 까지 소비만.
  let phase: 'line' | 'settle' | 'post' = 'line';
  const chunks: Buffer[] = [];
  let size = 0;
  let overflow = false;
  let confirmPrompted = false;
  /** 정착 구간 잠정 결과. null = 상한 초과(되돌릴 수 없음). */
  let decision: string | null = '';
  let dirty = false;
  let rawOn = false;
  let released = false;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = (): void => {
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    if (maxTimer !== undefined) clearTimeout(maxTimer);
    quietTimer = maxTimer = undefined;
  };
  const setRaw = (on: boolean): void => {
    if (!rawStream || rawOn === on) return;
    rawOn = on;
    try {
      rawStream.setRawMode!(on);
    } catch {
      if (on) rawOn = false; // 전환 실패 — canonical 그대로(정착 구간은 그대로 돈다)
    }
  };
  const detach = (): void => {
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
    stream.removeListener('close', onEnd);
    stream.removeListener('error', onError);
    stream.pause();
  };
  /** 결과를 낸다(한 번). TTY 는 리스너를 남겨 계속 소비, 비TTY 는 EOF·오류 뒤라 바로 정리. */
  const decide = (v: string | null): void => {
    if (phase === 'post') return;
    phase = 'post';
    clearTimers();
    chunks.length = 0;
    if (!tty) detach();
    resolveResult(v);
  };
  const release = (): void => {
    if (released) return;
    released = true;
    clearTimers();
    setRaw(false);
    detach();
    if (phase !== 'post') {
      phase = 'post';
      chunks.length = 0;
      resolveResult(null);
    }
  };
  const verdict = (): string | null => (decision === null ? null : dirty ? TTY_MULTI_REJECT : decision);
  const armQuiet = (): void => {
    if (quietTimer !== undefined) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => decide(verdict()), settleMs);
  };
  /** 멈춤 지점 — rest = 멈춤 줄 뒤 같은 조각에 이미 온 내용. 보관 버퍼는 비운다(값을 더 들고 있지 않음). */
  const startSettle = (v: string | null, rest: Uint8Array): void => {
    phase = 'settle';
    decision = v;
    chunks.length = 0;
    if (hasNonBlank(rest)) dirty = true;
    maxTimer = setTimeout(() => {
      dirty = true;
      decide(verdict());
    }, settleMaxMs);
    armQuiet();
    setRaw(true); // 미완성 줄·표식까지 즉시 받는다(입력 줄은 이미 끝 — 에코·줄 편집이 필요 없는 구간)
  };
  /** 안내 쓰기 — 던지면 정리 경로(release → null). */
  const writePrompt = (s: string): boolean => {
    try {
      opts.prompt.write(s);
      return true;
    } catch {
      release();
      return false;
    }
  };

  function onData(c: Buffer | string): void {
    if (phase === 'post') return; // 판정 뒤 — 읽어 버린다(결과 불변, 0x03 포함)
    const b = typeof c === 'string' ? Buffer.from(c, 'utf8') : c;
    size += b.length;
    if (phase === 'settle') {
      // 읽어서 버린다(보관·출력하지 않음). 상한 초과·비공백 → 거부 고정, 읽기는 계속.
      if (size > maxBytes || hasNonBlank(b)) dirty = true;
      return armQuiet();
    }
    if (overflow) return; // 비TTY 상한 초과 — 보관만 멈추고 EOF 까지 버려 읽는다
    if (size > maxBytes) {
      overflow = true;
      chunks.length = 0;
      if (tty) startSettle(null, new Uint8Array(0)); // TTY: 멈춤 지점 — 나머지를 raw 로 받아 버린다
      return;
    }
    chunks.push(b);
    if (!tty) return;
    // 입력값은 prompt 에 되울리지 않는다(153 D3·M6) — prompt 에는 고정 안내 2줄만. 줄 끝 \r 은 classifyInput 의 trim 이 지운다.
    const all = Buffer.concat(chunks);
    const nl1 = all.indexOf(0x0a);
    if (nl1 < 0) return;
    const line1 = decodeStrict(all.subarray(0, nl1));
    if (line1 !== undefined && line1.trim() === '') return startSettle(line1, all.subarray(nl1 + 1));
    if (!confirmPrompted) {
      confirmPrompted = true;
      if (!writePrompt(`${STDIN_CONFIRM_PROMPT}\n`)) return;
    }
    const nl2 = all.indexOf(0x0a, nl1 + 1);
    if (nl2 < 0) return;
    const line2 = decodeStrict(all.subarray(nl1 + 1, nl2));
    startSettle(line1 === undefined || line2 === undefined ? FORMAT_REJECT : ttyConfirm(line1, line2), all.subarray(nl2 + 1));
  }
  /** 'end' 와 'close'(end·error 없이 close 만 오는 스트림 — 166) 공통. */
  function onEnd(): void {
    if (phase === 'post') return;
    if (phase === 'settle') return decide(verdict());
    if (overflow) return decide(null);
    const text = decodeStrict(Buffer.concat(chunks));
    if (text === undefined) return decide(FORMAT_REJECT);
    if (!tty || text.trim() === '') return decide(text);
    // TTY 확인 줄 전 EOF(Ctrl-D): 첫 줄은 비어 있지 않다(비었으면 onData 에서 멈춤) — 확인 없이 진행하지 않는다.
    const nl1 = text.indexOf('\n');
    decide(ttyReject(nl1 < 0 ? text : text.slice(0, nl1), ''));
  }
  function onError(): void {
    decide(null);
    detach();
  }

  stream.on('error', onError);
  stream.on('end', onEnd);
  stream.on('close', onEnd);
  if (!tty || writePrompt(`${STDIN_PROMPT}\n`)) {
    stream.on('data', onData);
    stream.resume();
  }
  return Object.assign(result, { release });
}

export function formatCounts(c: EraseCounts): string {
  return (
    `privacy:erase — magicTokens ${c.magicTokens}, users ${c.users}, sessions ${c.sessions}, snapshots ${c.snapshots},` +
    ` badges ${c.badges}, notifications ${c.notifications}, refreshTokens ${c.refreshTokens}`
  );
}

const INPUT_ERRORS: Record<InputProblem | 'read', string> = {
  read: 'privacy:erase: 입력이 너무 길거나 읽지 못했다(값은 출력하지 않음)',
  empty: 'privacy:erase: 입력이 비어 있다 — 이메일 한 줄을 표준 입력으로 넣는다(컨테이너면 docker exec -i / compose exec 확인)',
  multi: 'privacy:erase: 한 번에 한 계정 — 입력이 여러 줄이거나 확인 입력이 다르다(값은 출력하지 않음)',
  format: 'privacy:erase: 이메일 형식이 아니다(값은 출력하지 않음)',
};

export async function runEraseCli(argv: readonly string[], io: EraseCliIo): Promise<number> {
  // 순서 고정: 인수 검사 → readInput → 입력 검증 → store(). 인수가 있으면 표준 입력을 읽지 않는다(TTY 프롬프트로 재입력 유도 방지).
  if (argv.length > 0) {
    const emailFlag = argv.some((a) => a === '--email' || a.startsWith('--email='));
    io.stderr(
      emailFlag
        ? 'privacy:erase: 이메일은 명령줄로 받지 않는다(명령줄은 sudo 기록에 남는다) — 인수 없이 실행하고 표준 입력으로 넣는다(값은 출력하지 않음)'
        : 'privacy:erase: 인수는 받지 않는다 — 인수 없이 실행하고 이메일은 표준 입력으로 넣는다(값은 출력하지 않음)',
    );
    io.stderr(USAGE);
    return 2;
  }
  const text = await io.readInput();
  if (text === null) {
    io.stderr(INPUT_ERRORS.read);
    io.stderr(USAGE);
    return 2;
  }
  const parsed = classifyInput(text);
  if (!parsed.ok) {
    io.stderr(INPUT_ERRORS[parsed.reason]);
    io.stderr(USAGE);
    return 2;
  }
  const store = await io.store();
  const counts = await eraseAccount(store, { email: parsed.email }, 'OPERATOR', io.now(), io.stdout);
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

/**
 * 166: 터미널 복원 공통 경로 — 'exit'·SIGINT·SIGTERM·SIGHUP·uncaught 예외에서 release()(raw 복원, 멱등)를 부른다.
 *   신호는 복원 뒤 128+번호로 종료(기본 동작과 같은 종료 코드). raw 중 키보드 Ctrl-C 는 신호가 아니라 0x03 바이트로 온다(readStdinText 가 처리).
 *   반환값 = 등록 해제 함수.
 */
export function installTtyRestore(release: () => void, proc: NodeJS.Process = process): () => void {
  const onExit = (): void => release();
  const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const sigHandlers = sigs.map((sig) => {
    const h = (): void => {
      release();
      proc.exit(128 + (osConstants.signals[sig] ?? 0));
    };
    proc.on(sig, h);
    return [sig, h] as const;
  });
  proc.on('exit', onExit);
  proc.on('uncaughtExceptionMonitor', onExit);
  return () => {
    proc.removeListener('exit', onExit);
    proc.removeListener('uncaughtExceptionMonitor', onExit);
    for (const [sig, h] of sigHandlers) proc.removeListener(sig, h);
  };
}

function isMain(): boolean {
  const [, entry] = process.argv; // 실행 파일 경로(진입점 판정용) — 인수 값은 읽지 않는다
  if (!entry) return false;
  const norm = (u: string): string => (process.platform === 'win32' ? u.toLowerCase() : u);
  return norm(pathToFileURL(resolve(entry)).href) === norm(import.meta.url);
}

if (isMain()) {
  let client: PrismaClient | null = null;
  let input: StdinRead | null = null;
  const releaseInput = (): void => input?.release();
  installTtyRestore(releaseInput);
  try {
    process.exitCode = await runEraseCli(process.argv.slice(2), {
      stdout: (l) => process.stdout.write(`${l}\n`),
      stderr: (l) => process.stderr.write(`${l}\n`),
      now: () => new Date(),
      readInput: () => (input = readStdinText(process.stdin, { isTTY: !!process.stdin.isTTY, maxBytes: STDIN_MAX_BYTES, prompt: process.stderr })),
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
    try {
      if (client) await (client as PrismaClient).$disconnect();
    } finally {
      // 종료 직전까지 읽어 버린 뒤 raw 복원·stdin 정리(166) — 이 뒤에 친 입력은 셸로 간다(deploy.md 4절).
      releaseInput();
    }
  }
}
