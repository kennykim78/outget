// 153: 삭제 CLI 의 이메일은 표준 입력 — 명령줄(argv)에 나타나지 않게(sudo COMMAND=·journald·운영자 기록·셸 history).
//   (a) parseEmailInput 순수 함수 (b) readStdinText 스트림 읽기(비TTY EOF·상한·TTY 첫 줄 + 확인 줄(159)·정착 구간(162)·오류)
//   (c) 실제 프로세스 — DB 연결 전 종료. 회귀로 store() 까지 가도 임시 디렉터리 밖에 쓰지 않게 env 격리(159 LOW-2).
//   테스트 데이터는 예약 도메인(example.com·example.org·예시.한국)만(159 LOW-3).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  STDIN_CONFIRM_PROMPT,
  STDIN_PROMPT,
  TTY_SETTLE_MAX_MS,
  TTY_SETTLE_MS,
  installTtyRestore,
  parseEmailInput,
  readStdinText,
  runEraseCli,
} from '../privacy/cli-erase.js';

describe('parseEmailInput', () => {
  it.each([
    ['a@example.com', 'a@example.com'],
    ['a@example.com\n', 'a@example.com'],
    ['a@example.com\r\n', 'a@example.com'],
    ['\n\n  a@example.com  \n\n', 'a@example.com'],
    ['\r\n  a@example.com\t\r\n\r\n', 'a@example.com'],
    ['\uFEFFa@example.com', 'a@example.com'],
    ['\uFEFFa@example.com\r\n', 'a@example.com'],
    // 159 LOW-1: 줄 단위 trim 이 \t·BOM·\r 만 있는 줄을 빈 줄로 만든다(단독 변이 "공백만 제거" 를 잡는다).
    ['a@example.com\n\t\n', 'a@example.com'],
    ['\uFEFF\na@example.com', 'a@example.com'],
    ['a@example.com\n\r\n', 'a@example.com'],
    ['\t\na@example.com\n\uFEFF\r\n', 'a@example.com'],
    ['A@EXAMPLE.COM', 'a@example.com'],
    ['홍＠예시.한국', '홍@예시.한국'],
  ])('%j → %j', (input, want) => {
    expect(parseEmailInput(input)).toBe(want);
  });

  it.each([
    [''],
    ['  \n'],
    ['\r\n\r\n'],
    ['\uFEFF\n\t\n'],
    ['a@example.com\nb@example.org'],
    ['a@example.com\r\nb@example.org\r\n'],
    ['a@example.com\rb@example.org'],
    ['a b@example.com'],
    ['a@example'],
    [`${'a'.repeat(250)}@example.com`],
  ])('%j → null', (input) => {
    expect(parseEmailInput(input)).toBeNull();
  });
});

function sink(): { stream: { write: (s: string) => boolean }; text: () => string; calls: () => number } {
  const parts: string[] = [];
  return { stream: { write: (s: string) => (parts.push(s), true) }, text: () => parts.join(''), calls: () => parts.length };
}

const P1 = `${STDIN_PROMPT}\n`;
const P2 = `${STDIN_CONFIRM_PROMPT}\n`;
const VALUE = /@|example|secret|홍|예시/;

describe('readStdinText', () => {
  it('비TTY: EOF 까지 조각을 이어 읽는다, 프롬프트 없음', async () => {
    const s = new PassThrough();
    const p = sink();
    const r = readStdinText(s, { isTTY: false, maxBytes: 1024, prompt: p.stream });
    s.write('a@exa');
    s.write('mple.com\n');
    s.end();
    expect(await r).toBe('a@example.com\n');
    expect(p.text()).toBe('');
  });

  it('비TTY: 멀티바이트 문자가 조각 경계에서 갈라져도 그대로 복원', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: false, maxBytes: 1024, prompt: sink().stream });
    const b = Buffer.from('홍@예시.한국');
    s.write(b.subarray(0, 1));
    s.write(b.subarray(1));
    s.end();
    expect(await r).toBe('홍@예시.한국');
  });

  it('상한: 정확히 maxBytes 는 통과, maxBytes+1 바이트 → EOF 까지 버려 읽은 뒤 null(166: destroy 하지 않음)', async () => {
    const ok = new PassThrough();
    const r1 = readStdinText(ok, { isTTY: false, maxBytes: 1024, prompt: sink().stream });
    ok.end('x'.repeat(1024));
    expect(await r1).toBe('x'.repeat(1024));

    const big = new PassThrough();
    const state = { done: false };
    const r2 = readStdinText(big, { isTTY: false, maxBytes: 1024, prompt: sink().stream });
    void r2.then(() => (state.done = true));
    const destroy = vi.spyOn(big, 'destroy');
    big.write('x'.repeat(1000));
    big.write('x'.repeat(25)); // 1025 — 보관만 멈추고 계속 읽는다
    big.write('y'.repeat(5000));
    await new Promise((res) => setImmediate(res));
    expect(state.done).toBe(false); // EOF 전에는 끝나지 않는다
    expect(destroy).not.toHaveBeenCalled(); // 상한에서 destroy 하지 않는다(EOF 뒤 autoDestroy 는 스트림 기본 동작)
    expect(big.readableLength).toBe(0); // 읽어 버리는 중(쌓이지 않음)
    big.end('z'.repeat(100));
    expect(await r2).toBeNull();
    expect(big.readableLength).toBe(0);
  });

  it('기본 maxBytes 는 1024', async () => {
    const big = new PassThrough();
    const r = readStdinText(big, { isTTY: false, prompt: sink().stream });
    big.end('x'.repeat(1025));
    expect(await r).toBeNull();
  });

  it("비TTY: 'close' 만 오고 end·error 없음 → 그때까지 받은 것으로 끝(166)", async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: false, maxBytes: 1024, prompt: sink().stream });
    s.write('a@example.com\n');
    await new Promise((res) => setImmediate(res));
    s.destroy(); // 오류 없이 close
    expect(await r).toBe('a@example.com\n');
  });

  it('비TTY: 잘못된 UTF-8 → 대체 문자로 받지 않고 형식 거부(166)', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: false, maxBytes: 1024, prompt: sink().stream });
    s.end(Buffer.concat([Buffer.from([0x61, 0xff]), Buffer.from('@example.com\n')]));
    const t = await r;
    expect(t).not.toBeNull();
    expect(t).not.toContain('�');
    expect(parseEmailInput(t!)).toBeNull();
  });

  it('프롬프트 write 가 던지면 정리 → null, 리스너 제거(166)', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, {
      isTTY: true,
      maxBytes: 1024,
      prompt: {
        write: () => {
          throw new Error('EPIPE');
        },
      },
    });
    expect(await r).toBeNull();
    expect(s.listenerCount('data')).toBe(0);
    expect(s.listenerCount('end')).toBe(0);
  });

  it('TTY: 안내 1 → 첫 줄 → 안내 2(확인) → 같은 확인 줄이면 첫 줄 반환, prompt 에는 안내 2줄만(값 0)', async () => {
    const s = new PassThrough();
    const p = sink();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream });
    expect(p.text()).toBe(P1);
    s.write('secret@exam');
    expect(p.calls()).toBe(1); // 줄바꿈 전에는 확인 안내도 없다
    s.write('ple.com\r\n');
    await new Promise((res) => setImmediate(res));
    expect(p.text()).toBe(P1 + P2);
    s.write('secret@example.com\n');
    expect(await r).toBe('secret@example.com\r');
    s.write('more@example.com\n'); // 166: 반환 뒤 입력도 release 전까지 읽어 버린다(결과 불변)
    await new Promise((res) => setImmediate(res));
    expect(s.readableLength).toBe(0);
    r.release();
    // M6: 입력값(전체·일부·줄바꿈 앞 조각)을 prompt 에 되울리지 않는다 — 고정 안내 2줄, 쓰기 호출 2회.
    expect(p.text()).toBe(P1 + P2);
    expect(p.calls()).toBe(2);
    expect(p.text()).not.toMatch(VALUE);
    expect(parseEmailInput('secret@example.com\r')).toBe('secret@example.com');
  });

  it('TTY: 확인 비교는 줄 단위 trim(\\r·공백·BOM 차이는 같음)', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: sink().stream });
    s.write('  a@example.com\r\n\uFEFFa@example.com \r\n');
    expect(parseEmailInput((await r)!)).toBe('a@example.com');
  });

  it('TTY: 한 조각에 같은 두 줄 → 첫 줄, prompt 에 값 없음(M6)', async () => {
    const s = new PassThrough();
    const p = sink();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream });
    s.write('a@example.com\na@example.com\n');
    expect(await r).toBe('a@example.com');
    expect(p.text()).toBe(P1 + P2);
    expect(p.text()).not.toMatch(VALUE);
  });

  it('TTY: 1바이트씩 조각 분할(멀티바이트 포함)이어도 두 줄 확인 후 첫 줄', async () => {
    const s = new PassThrough();
    const p = sink();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream });
    const b = Buffer.from('홍@예시.한국\n홍@예시.한국\n');
    for (let i = 0; i < b.length; i++) s.write(b.subarray(i, i + 1));
    expect(await r).toBe('홍@예시.한국');
    expect(p.text()).toBe(P1 + P2);
    expect(p.text()).not.toMatch(VALUE);
  });

  it('TTY: 한 조각에 서로 다른 두 줄(두 계정 붙여넣기) → 거부 텍스트(parse null)', async () => {
    const s = new PassThrough();
    const p = sink();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream });
    s.write('a@example.com\nb@example.org\n');
    const t = await r;
    expect(t).not.toBeNull();
    expect(parseEmailInput(t!)).toBeNull();
    expect(p.text()).toBe(P1 + P2);
  });

  it('TTY: 확인 줄이 다름(조각 분할) / 확인 줄 빈 Enter / 확인 뒤 같은 조각에 셋째 줄 → 전부 거부 텍스트', async () => {
    for (const parts of [
      ['a@example.com\n', 'a@example.org\n'],
      ['a@exam', 'ple.com\nb@exa', 'mple.com\n'],
      ['a@example.com\n', '\n'],
      ['a@example.com\n', ' \t\r\n'],
      ['a@example.com\na@example.com\nb@example.org\n'],
    ]) {
      const s = new PassThrough();
      const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: sink().stream });
      for (const c of parts) s.write(c);
      const t = await r;
      expect(t, JSON.stringify(parts)).not.toBeNull();
      expect(parseEmailInput(t!), JSON.stringify(parts)).toBeNull();
    }
  });

  it('TTY: 첫 줄 뒤 EOF(Ctrl-D, 확인 전) · 줄바꿈 없이 EOF · 확인 줄 일부만 오고 EOF → 거부 텍스트', async () => {
    for (const input of ['a@example.com\n', 'a@example.com', 'a@example.com\na@example.com']) {
      const s = new PassThrough();
      const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: sink().stream });
      s.end(input);
      const t = await r;
      expect(t, JSON.stringify(input)).not.toBeNull();
      expect(parseEmailInput(t!), JSON.stringify(input)).toBeNull();
    }
  });

  it('TTY: 첫 줄이 비면 확인 안내 없이 그 줄 반환(→ 빈 입력)', async () => {
    const s = new PassThrough();
    const p = sink();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream });
    s.write(' \r\na@example.com\n');
    expect(parseEmailInput((await r)!)).toBeNull();
    expect(p.text()).toBe(P1);
  });

  it('TTY: Ctrl-D(빈 EOF) → 빈 문자열', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: sink().stream });
    s.end();
    expect(await r).toBe('');
  });

  it('TTY: 줄바꿈 없이 상한 초과 → null', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: true, maxBytes: 16, prompt: sink().stream });
    s.write('x'.repeat(17));
    expect(await r).toBeNull();
  });

  it('TTY: 상한은 두 줄 합계 — 각 줄은 상한 안이어도 합이 넘으면 null', async () => {
    const line = 'abcdefgh@example.com\n'; // 21바이트
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: true, maxBytes: 40, prompt: sink().stream });
    s.write(line);
    s.write(line); // 42 > 40
    expect(await r).toBeNull();

    const ok = new PassThrough();
    const r2 = readStdinText(ok, { isTTY: true, maxBytes: 42, prompt: sink().stream });
    ok.write(line);
    ok.write(line); // 42 = 상한
    expect(await r2).toBe('abcdefgh@example.com');
  });

  it('stream error → null', async () => {
    const s = new PassThrough();
    const r = readStdinText(s, { isTTY: false, maxBytes: 1024, prompt: sink().stream });
    s.write('a@example.com');
    s.destroy(new Error('EIO a@example.com'));
    expect(await r).toBeNull();
  });
});

// 159 MEDIUM-1: TTY 경로 전체(readStdinText → runEraseCli). 확인이 다르면 store() 를 부르지 않는다.
describe('runEraseCli + TTY 확인', () => {
  const NOW = new Date('2026-10-29T00:00:00Z');
  const runTty = async (
    parts: string[],
    end = false,
  ): Promise<{ code: number; err: string; out: string; prompt: string; store: ReturnType<typeof vi.fn> }> => {
    const s = new PassThrough();
    const p = sink();
    const out: string[] = [];
    const err: string[] = [];
    const store = vi.fn(async () => {
      throw new Error('stop-after-store');
    });
    const done = runEraseCli([], {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      readInput: () => readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream }),
      store,
    }).catch((e: Error) => (e.message === 'stop-after-store' ? -1 : Promise.reject(e)));
    for (const c of parts) s.write(c);
    if (end) s.end();
    const code = await done;
    return { code, err: err.join('\n'), out: out.join('\n'), prompt: p.text(), store };
  };

  it('일치 → 입력 검증 통과(store 호출까지 진행), 프롬프트는 안내 2줄만', async () => {
    const r = await runTty(['a@example.com\r\n', 'a@example.com\n']);
    expect(r.store).toHaveBeenCalledTimes(1);
    expect(r.code).toBe(-1);
    expect(r.prompt).toBe(P1 + P2);
    expect(`${r.prompt}${r.err}${r.out}`).not.toMatch(VALUE);
  });

  it.each([
    ['불일치', ['a@example.com\n', 'b@example.org\n'], false],
    ['한 조각에 두 계정', ['a@example.com\nb@example.org\n'], false],
    ['조각 분할 불일치', ['a@exa', 'mple.com\nb@', 'example.org\n'], false],
    ['확인 빈 Enter', ['a@example.com\n', '\n'], false],
    ['첫 줄 뒤 EOF', ['a@example.com\n'], true],
  ])('%s → 2, store 미호출, 값 출력 0', async (_name, parts, end) => {
    const r = await runTty(parts as string[], end as boolean);
    expect(r.code).toBe(2);
    expect(r.store).not.toHaveBeenCalled();
    expect(r.out).toBe('');
    expect(r.err).toContain('한 번에 한 계정 — 입력이 여러 줄이거나 확인 입력이 다르다');
    expect(r.prompt).toBe(P1 + P2);
    expect(`${r.prompt}${r.err}${r.out}`).not.toMatch(VALUE);
  });
});

// 162(QA161 MEDIUM-A): canonical TTY 는 read 한 번에 한 줄 — 붙여넣은 줄이 따로, 조금씩 늦게 온다.
//   멈춤 지점(확인 줄·빈 첫 줄) 뒤 정착 구간(마지막 조각 뒤 settleMs, 전체 settleMaxMs) 동안 읽어 버리고, 비공백이 오면 거부.
//   가짜 타이머(setTimeout 만) — 조각 사이 간격을 정확히 준다. setImmediate 는 진짜(스트림 이벤트 흘리기).
describe('readStdinText TTY 정착 구간(162)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const tick = (): Promise<void> => new Promise((res) => setImmediate(res));
  /** steps: [이전 조각 뒤 지연 ms, 조각]. 반환: 결과 프로미스 + 해결 여부. */
  const start = (
    opts: { settleMs?: number; settleMaxMs?: number; maxBytes?: number } = {},
  ): { s: PassThrough; r: Promise<string | null>; state: { done: boolean; v: string | null | undefined }; p: ReturnType<typeof sink> } => {
    const s = new PassThrough();
    const p = sink();
    const state: { done: boolean; v: string | null | undefined } = { done: false, v: undefined };
    const r = readStdinText(s, { isTTY: true, maxBytes: opts.maxBytes ?? 1024, prompt: p.stream, settleMs: opts.settleMs, settleMaxMs: opts.settleMaxMs });
    void r.then((v) => {
      state.done = true;
      state.v = v;
    });
    return { s, r, state, p };
  };
  const feed = async (s: PassThrough, steps: Array<[number, string]>): Promise<void> => {
    for (const [delay, chunk] of steps) {
      if (delay > 0) await vi.advanceTimersByTimeAsync(delay);
      s.write(chunk);
      await tick();
    }
  };
  const settleAll = async (ms = 5000): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    await tick();
  };

  it('기본값: 정착 250ms, 전체 상한 2000ms', () => {
    expect(TTY_SETTLE_MS).toBe(250);
    expect(TTY_SETTLE_MAX_MS).toBe(2000);
  });

  it("조각 따로 ['A\\n','A\\n','B\\n'](10ms 간격) → 거부 텍스트", async () => {
    const t = start();
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [10, 'a@example.com\n'],
      [10, 'b@example.org\n'],
    ]);
    expect(t.state.done).toBe(false); // 확인 줄 뒤에도 바로 끝나지 않는다(정착 구간)
    await settleAll();
    expect(t.state.done).toBe(true);
    expect(t.state.v).not.toBeNull();
    expect(parseEmailInput(t.state.v!)).toBeNull();
    expect(t.p.text()).toBe(P1 + P2);
    expect(t.p.text()).not.toMatch(VALUE);
  });

  it('확인 뒤 B 가 구간 안(200ms 뒤) 지연 도착 → 거부', async () => {
    const t = start();
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
      [200, 'b@example.org\n'],
    ]);
    await settleAll();
    expect(parseEmailInput(t.state.v!)).toBeNull();
  });

  it("빈 첫 줄 뒤 따로 ['\\n','A\\n'] → 거부(빈 입력이 아니라 여러 줄), 확인 안내 없음", async () => {
    const t = start();
    await feed(t.s, [
      [0, '\n'],
      [100, 'a@example.com\n'],
    ]);
    await settleAll();
    expect(t.state.v).not.toBeNull();
    expect(parseEmailInput(t.state.v!)).toBeNull();
    expect(t.state.v!.split('\n').filter((l) => l.trim() !== '').length).toBeGreaterThan(1);
    expect(t.state.v).not.toMatch(VALUE);
    expect(t.p.text()).toBe(P1);
  });

  it('빈 첫 줄만 → 구간 뒤 빈 줄 반환(빈 입력 유지)', async () => {
    const t = start();
    await feed(t.s, [[0, '\r\n']]);
    await settleAll();
    expect(t.state.v).toBe('\r');
  });

  it('정상 [A, A] → 마지막 조각 뒤 정확히 settleMs 에 첫 줄로 끝, 그 뒤 입력은 무시', async () => {
    const t = start();
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
    ]);
    await vi.advanceTimersByTimeAsync(249);
    await tick();
    expect(t.state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect(t.state.done).toBe(true);
    expect(t.state.v).toBe('a@example.com');
    t.s.write('b@example.org\n'); // 판정 뒤 — 166: 읽어 버리되 결과는 그대로
    await settleAll();
    expect(t.state.v).toBe('a@example.com');
    expect(t.s.readableLength).toBe(0);
  });

  it('구간 안 공백·CR·LF 만 → 거부하지 않는다', async () => {
    const t = start();
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
      [100, '\n'],
      [100, ' \r\n'],
    ]);
    await settleAll();
    expect(t.state.v).toBe('a@example.com');
  });

  it('구간 안 탭·0x03·0x04·ESC 표식 → 거부(166: 공백·CR·LF 외 전부 비공백)', async () => {
    for (const junk of ['\t', '\x03', '\x04', '\x1b[201~', '\x1b[200~']) {
      const t = start();
      await feed(t.s, [
        [0, 'a@example.com\n'],
        [0, 'a@example.com\n'],
        [50, junk],
      ]);
      await settleAll();
      expect(t.state.done, JSON.stringify(junk)).toBe(true);
      expect(parseEmailInput(t.state.v!), JSON.stringify(junk)).toBeNull();
    }
  });

  it('타이머는 조각마다 다시 시작 — 200ms 간격 공백 뒤 B(확인 줄부터 400ms) → 거부', async () => {
    const t = start();
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
      [200, '\n'],
      [200, 'b@example.org\n'],
    ]);
    expect(t.state.done).toBe(false);
    await settleAll();
    expect(parseEmailInput(t.state.v!)).toBeNull();
  });

  it('settleMs 주입: 50ms 면 60ms 뒤 B 는 구간 밖(첫 줄로 끝), 40ms 뒤면 거부', async () => {
    const late = start({ settleMs: 50 });
    await feed(late.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
      [60, 'b@example.org\n'],
    ]);
    await settleAll();
    expect(late.state.v).toBe('a@example.com');

    const early = start({ settleMs: 50 });
    await feed(early.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
      [40, 'b@example.org\n'],
    ]);
    await settleAll();
    expect(parseEmailInput(early.state.v!)).toBeNull();
  });

  it('전체 상한: 공백 조각이 계속 와도 settleMaxMs 에 거부로 끝(무한 대기 없음)', async () => {
    const t = start({ settleMs: 250, settleMaxMs: 2000 });
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'],
    ]);
    for (let i = 0; i < 9; i++) await feed(t.s, [[200, '\n']]); // 1800ms
    expect(t.state.done).toBe(false);
    await feed(t.s, [[200, '\n']]); // 2000ms
    expect(t.state.done).toBe(true);
    expect(parseEmailInput(t.state.v!)).toBeNull();
  });

  it('구간 안 바이트 상한(합계) 초과 → 거부 고정, 읽기는 계속(166: 상한에서 멈추지 않음)', async () => {
    const t = start({ maxBytes: 64 });
    await feed(t.s, [
      [0, 'a@example.com\n'],
      [0, 'a@example.com\n'], // 28
      [0, ' '.repeat(37)], // 65 > 64
    ]);
    expect(t.state.done).toBe(false); // 상한 때문에 끝내지 않는다
    await feed(t.s, [[100, ' '.repeat(500)]]);
    expect(t.state.done).toBe(false);
    expect(t.s.readableLength).toBe(0);
    await settleAll();
    expect(t.state.done).toBe(true);
    expect(t.state.v).not.toBeNull();
    expect(parseEmailInput(t.state.v!)).toBeNull();
  });

  it('구간 안 EOF → 바로 끝(깨끗하면 첫 줄, 비공백 뒤면 거부)', async () => {
    const ok = start();
    await feed(ok.s, [[0, 'a@example.com\na@example.com\n']]);
    ok.s.end();
    await tick();
    await tick();
    expect(ok.state.v).toBe('a@example.com');

    const bad = start();
    await feed(bad.s, [
      [0, 'a@example.com\na@example.com\n'],
      [10, 'b@'],
    ]);
    bad.s.end();
    await tick();
    await tick();
    expect(bad.state.done).toBe(true);
    expect(parseEmailInput(bad.state.v!)).toBeNull();
  });

  describe('runEraseCli 경유(조각 따로)', () => {
    const NOW = new Date('2026-10-29T00:00:00Z');
    const runSteps = async (steps: Array<[number, string]>): Promise<{ code: number; err: string; out: string; prompt: string; store: ReturnType<typeof vi.fn> }> => {
      const s = new PassThrough();
      const p = sink();
      const out: string[] = [];
      const err: string[] = [];
      const store = vi.fn(async () => {
        throw new Error('stop-after-store');
      });
      const done = runEraseCli([], {
        stdout: (l) => out.push(l),
        stderr: (l) => err.push(l),
        now: () => NOW,
        readInput: () => readStdinText(s, { isTTY: true, maxBytes: 1024, prompt: p.stream }),
        store,
      }).catch((e: Error) => (e.message === 'stop-after-store' ? -1 : Promise.reject(e)));
      await feed(s, steps);
      await settleAll();
      const code = await done;
      return { code, err: err.join('\n'), out: out.join('\n'), prompt: p.text(), store };
    };

    it.each([
      ['A, A, B 따로', [[0, 'a@example.com\n'], [10, 'a@example.com\n'], [10, 'b@example.org\n']]],
      ['확인 뒤 B 지연(200ms)', [[0, 'a@example.com\n'], [0, 'a@example.com\n'], [200, 'b@example.org\n']]],
      ['빈 첫 줄 뒤 A', [[0, '\n'], [50, 'a@example.com\n']]],
      ['공백 뒤 B(타이머 재시작)', [[0, 'a@example.com\n'], [0, 'a@example.com\n'], [200, ' \n'], [200, 'b@example.org\n']]],
    ])('%s → 2, store 미호출, multi, 값 출력 0', async (_n, steps) => {
      const r = await runSteps(steps as Array<[number, string]>);
      expect(r.code).toBe(2);
      expect(r.store).not.toHaveBeenCalled();
      expect(r.out).toBe('');
      expect(r.err).toContain('한 번에 한 계정 — 입력이 여러 줄이거나 확인 입력이 다르다');
      expect(`${r.prompt}${r.err}${r.out}`).not.toMatch(VALUE);
    });

    it('A, A 따로(구간 안 추가 없음) → store 호출까지 진행', async () => {
      const r = await runSteps([
        [0, 'a@example.com\n'],
        [30, 'a@example.com\n'],
      ]);
      expect(r.code).toBe(-1);
      expect(r.store).toHaveBeenCalledTimes(1);
      expect(r.prompt).toBe(P1 + P2);
      expect(`${r.prompt}${r.err}${r.out}`).not.toMatch(VALUE);
    });
  });
});

// 166(QA163 D1·D2, Codex164): canonical TTY 모사 — 커널 줄 버퍼가 줄바꿈 전 바이트를 붙잡고 있다가,
//   setRawMode(true) 가 되면 그 미완성 줄을 바로 넘긴다(rawprobe 실측). release 뒤(pause) 도착분은 스트림 버퍼에 남는다 = 셸로 갈 몫.
//   leftover() = 프로그램이 읽지 않은 바이트(커널 줄 버퍼 + 스트림 버퍼). 0 이어야 셸로 넘어갈 것이 없다.
class CanonicalTty extends Readable {
  readonly isTTY = true;
  isRaw = false;
  readonly rawCalls: boolean[] = [];
  private line = Buffer.alloc(0);
  constructor() {
    super({ read() {} });
  }
  /** 키 입력·붙여넣기 바이트가 터미널에 도착. canonical: 줄 단위로 넘기고 0x04 는 줄 끝(빈 줄이면 EOF). raw: 그대로. */
  type(s: string | Buffer): void {
    const b = typeof s === 'string' ? Buffer.from(s, 'utf8') : s;
    for (const byte of b) {
      if (this.isRaw) {
        this.push(Buffer.from([byte]));
        continue;
      }
      if (byte === 0x04) {
        if (this.line.length === 0) this.push(null);
        else this.flushLine();
        continue;
      }
      this.line = Buffer.concat([this.line, Buffer.from([byte])]);
      if (byte === 0x0a) this.flushLine();
    }
  }
  setRawMode(on: boolean): this {
    this.rawCalls.push(on);
    this.isRaw = on;
    if (on && this.line.length > 0) this.flushLine();
    return this;
  }
  leftover(): number {
    return this.line.length + this.readableLength;
  }
  private flushLine(): void {
    const l = this.line;
    this.line = Buffer.alloc(0);
    this.push(l);
  }
}

describe('readStdinText canonical TTY + raw 전환(166)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const tick = (): Promise<void> => new Promise((res) => setImmediate(res));
  const pass = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    await tick();
    await tick();
  };
  const A = 'a@example.com';
  const B = 'b@example.org';
  const NOW = new Date('2026-10-29T00:00:00Z');
  const MULTI = '한 번에 한 계정 — 입력이 여러 줄이거나 확인 입력이 다르다';

  /** runEraseCli 전체 — store 는 gate 가 풀릴 때까지 기다렸다가 'stop-after-store' 로 멈춘다(호출 여부만 본다). */
  const session = (): {
    tty: CanonicalTty;
    p: ReturnType<typeof sink>;
    err: string[];
    out: string[];
    store: ReturnType<typeof vi.fn>;
    openGate: () => void;
    done: Promise<number>;
    reader: () => ReturnType<typeof readStdinText>;
  } => {
    const tty = new CanonicalTty();
    const p = sink();
    const err: string[] = [];
    const out: string[] = [];
    let openGate = (): void => {};
    const gate = new Promise<void>((res) => (openGate = res));
    const store = vi.fn(async () => {
      await gate;
      throw new Error('stop-after-store');
    });
    let rd: ReturnType<typeof readStdinText> | undefined;
    const done = runEraseCli([], {
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => NOW,
      readInput: () => (rd = readStdinText(tty, { isTTY: true, maxBytes: 1024, prompt: p.stream })),
      store,
    }).catch((e: Error) => (e.message === 'stop-after-store' ? -1 : Promise.reject(e)));
    return { tty, p, err, out, store, openGate: () => openGate(), done, reader: () => rd! };
  };

  it('정상 A↵A↵ → 확인 줄에서 raw 켬, 첫 줄로 store 진행, release 에서 raw 복원(순서 [true,false]), 남은 바이트 0', async () => {
    const t = session();
    t.tty.type(`${A}\n`);
    await tick();
    expect(t.tty.rawCalls).toEqual([]); // 입력 줄은 canonical 그대로(에코·줄 편집)
    t.tty.type(`${A}\n`);
    await tick();
    expect(t.tty.rawCalls).toEqual([true]);
    await pass(300);
    expect(t.store).toHaveBeenCalledTimes(1);
    t.openGate();
    expect(await t.done).toBe(-1);
    expect(t.tty.rawCalls).toEqual([true]); // 판정 뒤에도 release 전까지 raw 유지(계속 소비)
    t.reader().release();
    t.reader().release(); // 멱등
    expect(t.tty.rawCalls).toEqual([true, false]);
    expect(t.tty.leftover()).toBe(0);
    expect(t.p.text()).toBe(P1 + P2);
  });

  it('A↵A↵B(마지막 줄 줄바꿈 없음, QA163 n1h) → raw 전환으로 B 를 받아 거부, store 0, 남은 바이트 0', async () => {
    const t = session();
    t.tty.type(`${A}\n${A}\n${B}`);
    await tick();
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.store).not.toHaveBeenCalled();
    expect(t.err.join('\n')).toContain(MULTI);
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
    expect(t.tty.rawCalls).toEqual([true, false]);
    expect(`${t.p.text()}${t.err.join('')}${t.out.join('')}`).not.toMatch(VALUE);
  });

  it('브래킷 붙여넣기 끝 표식(\\e[201~, 줄바꿈 없음 — n7) → 거부, 남은 바이트 0', async () => {
    const t = session();
    t.tty.type(`\x1b[200~${A}\n${A}\n\x1b[201~`);
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.store).not.toHaveBeenCalled();
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
  });

  it('A↵A↵ + 80줄 junk(p1) → 거부, 전부 소비(남은 바이트 0)', async () => {
    const t = session();
    const junk = Array.from({ length: 80 }, (_, i) => `junk${String(i).padStart(3, '0')}@example.net\n`).join('');
    t.tty.type(`${A}\n${A}\n${junk}`);
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.store).not.toHaveBeenCalled();
    expect(t.tty.leftover()).toBe(0);
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
  });

  it('A↵B↵ + junk 두 조각(p2, 상한 넘김) → 거부, 상한 뒤에도 끝까지 소비', async () => {
    const t = session();
    const j = (a: number, b: number): string => Array.from({ length: b - a }, (_, i) => `junk${a + i}@example.net\n`).join('');
    t.tty.type(`${A}\n${B}\n${j(0, 40)}`);
    await pass(50);
    t.tty.type(j(40, 80));
    await pass(300);
    expect(await t.done).toBe(2);
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
  });

  it('첫 줄 1100B + A↵(p3) → 상한 초과 = 멈춤 지점: raw 로 나머지까지 소비, 결과 null(읽기 오류 2), store 0', async () => {
    const t = session();
    t.tty.type(`${'x'.repeat(1100)}\n${A}\n`);
    await tick();
    expect(t.tty.rawCalls).toEqual([true]);
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.err.join('\n')).toContain('입력이 너무 길거나 읽지 못했다');
    expect(t.store).not.toHaveBeenCalled();
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
  });

  it('판정 뒤 store 지연 중 입력(0x03 포함) → 읽어 버리고 결과 불변(store 진행), release 뒤 입력만 남는다', async () => {
    const t = session();
    t.tty.type(`${A}\n${A}\n`);
    await pass(300);
    expect(t.store).toHaveBeenCalledTimes(1);
    t.tty.type(`${B}\n`);
    t.tty.type('\x03'); // raw 중 Ctrl-C — 판정 뒤라 무시(삭제 중 중단이 더 위험)
    t.tty.type('rm -rf ~'); // 줄바꿈 없는 입력도
    await pass(100);
    expect(t.tty.leftover()).toBe(0);
    t.openGate();
    expect(await t.done).toBe(-1);
    t.reader().release();
    t.tty.type('later'); // release 뒤(결과 뒤) — 이것만 셸 몫(문서화된 한계)
    expect(t.tty.leftover()).toBe(5);
  });

  it.each([
    ['0x03(Ctrl-C)', '\x03'],
    ['0x04(Ctrl-D)', '\x04'],
    ['ESC 시작 표식', '\x1b[200~'],
    ['ESC 끝 표식', '\x1b[201~'],
  ])('정착 구간 raw 중 %s → 거부, store 0', async (_n, junk) => {
    const t = session();
    t.tty.type(`${A}\n${A}\n`);
    await pass(50);
    t.tty.type(junk);
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.store).not.toHaveBeenCalled();
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
  });

  it('빈 첫 줄 뒤 미완성 A(줄바꿈 없음) → raw 로 받아 거부(빈 입력이 아니라 여러 줄)', async () => {
    const t = session();
    t.tty.type(`\n${A}`);
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.err.join('\n')).toContain(MULTI);
    t.reader().release();
    expect(t.tty.leftover()).toBe(0);
  });

  it('잘못된 UTF-8 첫 줄·확인 줄(같은 바이트) → 형식 오류 2, store 0', async () => {
    const t = session();
    const bad = Buffer.concat([Buffer.from([0x61, 0xc3]), Buffer.from('@example.com\n')]);
    t.tty.type(bad);
    t.tty.type(bad);
    await pass(300);
    expect(await t.done).toBe(2);
    expect(t.err.join('\n')).toContain('이메일 형식이 아니다');
    expect(t.store).not.toHaveBeenCalled();
    t.reader().release();
  });

  it('전체 상한 2s: 공백이 200ms 마다 계속 와도 거부로 끝, 그 뒤에도 release 전까지 소비', async () => {
    const t = session();
    t.tty.type(`${A}\n${A}\n`);
    for (let i = 0; i < 11; i++) {
      await pass(200);
      t.tty.type(' ');
    }
    expect(await t.done).toBe(2);
    expect(t.store).not.toHaveBeenCalled();
    t.tty.type(`${B}`);
    await tick();
    expect(t.tty.leftover()).toBe(0);
    t.reader().release();
  });

  it('release 를 판정 전에 부르면 결과 null, raw 를 켠 적 없으면 setRawMode 호출 없음', async () => {
    const tty = new CanonicalTty();
    const r = readStdinText(tty, { isTTY: true, maxBytes: 1024, prompt: sink().stream });
    tty.type(A); // 줄바꿈 전 — 커널 줄 버퍼에 남음
    r.release();
    expect(await r).toBeNull();
    expect(tty.rawCalls).toEqual([]);
  });
});

describe('installTtyRestore(166)', () => {
  it("'exit'·uncaughtExceptionMonitor·SIGINT/SIGTERM/SIGHUP 모두 release 를 부르고, 신호는 128+번호로 종료", () => {
    const proc = new EventEmitter() as unknown as NodeJS.Process & EventEmitter;
    const exit = vi.fn();
    (proc as unknown as { exit: typeof exit }).exit = exit;
    const release = vi.fn();
    const off = installTtyRestore(release, proc);
    proc.emit('exit', 0);
    proc.emit('uncaughtExceptionMonitor', new Error('x'));
    expect(release).toHaveBeenCalledTimes(2);
    proc.emit('SIGINT');
    proc.emit('SIGTERM');
    proc.emit('SIGHUP');
    expect(release).toHaveBeenCalledTimes(5);
    expect(exit.mock.calls.map((c) => c[0])).toEqual([130, 143, 129]);
    off();
    proc.emit('exit', 0);
    proc.emit('SIGINT');
    expect(release).toHaveBeenCalledTimes(5);
  });
});

// 실제 프로세스(config.privacy-boot 선례): 최소 env — 모두 DB 연결 전 종료 2.
//   159 LOW-2: 회귀로 store() 까지 가더라도 묘비·백업은 임시 디렉터리, DB 는 없는 경로 → 저장소·/data(C:\data) 에 쓰지 않는다.
describe('cli-erase 실제 실행 — 명령줄 거부·표준 입력', () => {
  const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const CLI = fileURLToPath(new URL('../privacy/cli-erase.ts', import.meta.url));
  let tmp = '';
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ws-cli-erase-'));
  });
  afterAll(() => {
    // 회귀 감지: 정상 경로에서는 임시 디렉터리에도 아무것도 생기지 않는다.
    expect(readdirSync(tmp)).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });
  const run = (args: string[], input: string): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, ['--import', TSX, CLI, ...args], {
      input,
      env: {
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        WS_ERASURE_FILE: join(tmp, 'erasures.jsonl'),
        WS_BACKUP_DIR: join(tmp, 'backup'),
        DATABASE_URL: `file:${join(tmp, 'no-such-dir', 'x.db').replace(/\\/g, '/')}`,
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it('--email=leak1@example.org → 2, stderr 에 값 없음 + 표준 입력 안내', () => {
    const r = run(['--email=leak1@example.org'], 'leak2@example.org\n');
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/leak|example\.org/i);
    expect(r.stderr).toContain('표준 입력');
    expect(r.stdout).toBe('');
  }, 90_000);

  it('인수 없음 + 빈 입력 → 2 (docker exec -i 확인 안내)', () => {
    const r = run([], '');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/비어 있다/);
    expect(r.stderr).toContain('-i');
    expect(r.stdout).toBe('');
  }, 90_000);

  it('인수 없음 + 여러 줄 입력 → 2, 값 출력 0', () => {
    const r = run([], 'leak1@example.org\nleak2@example.org\n');
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/leak|example\.org/i);
    expect(r.stderr).toMatch(/한 번에 한 계정 — 입력이 여러 줄이거나 확인 입력이 다르다/);
  }, 90_000);
});
