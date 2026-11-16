// AI 핸들 판정 단일 정의(QA 82 D2, 불변식 7) — ai-handle.json ↔ TS(seed/ai-handle.ts) ↔ mjs(scripts/lib/ai-handle.mjs) 패리티,
//   seed:validate V11(행 verifiedBy·specVerifiedBy)·G07(매니페스트 signedBy), apply-review-signatures 입력 거부.
//   실시드는 메모리 복사본만 변조(디스크 변경 0). 기준일 고정.
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SeedBundle } from '../engine/index.js';
import { CONTENT_KEYS, SEED_FILES, type RawSeed } from '../seed/common.js';
import { AI_HANDLE_RE, isAiHandle } from '../seed/ai-handle.js';
import type { SignatureEntry } from '../seed/signatures.js';
import { validateSeed, type ValidateResult } from '../seed/validate.js';
import { DWARF_PREVIEW_AS_OF, applyMjs, dwarfAllCheckedResult, dwarfPacketK1, dwarfSignedWith, realSeed } from './fixtures/prerender-seed.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const mjs = (await import(pathToFileURL(join(ROOT, 'scripts', 'lib', 'ai-handle.mjs')).href)) as {
  AI_HANDLE_RE: RegExp;
  isAiHandle: (v: unknown) => boolean;
};
const NOW = DWARF_PREVIEW_AS_OF;

type Row = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const run = (raw: RawSeed, manifest: unknown): ValidateResult => validateSeed(raw, { now: NOW, signatures: { missing: false, data: manifest } });
const rules = (r: ValidateResult): string[] => [...new Set(r.errors.map((i) => i.rule))].sort();
const rowOf = (s: RawSeed, key: keyof RawSeed, id: string): Row => {
  const r = ((s as Record<string, unknown[]>)[key] as Row[]).find((x) => x.id === id);
  if (!r) throw new Error(`${String(key)}#${id} 없음`);
  return r;
};

// QA 82 D2 통과 사례(거부해야 함) + 변형.
const REJECT = [
  'chatgpt', 'claude3', 'ai_kenny', 'GPT-4', 'ops bot', 'claude', 'ChatGPT', 'kenny_ai', 'kenny-ai', 'ai', 'AI', 'ai2', 'ai-review',
  'openai', 'OpenAI-team', 'gemini', 'Gemini-Pro', 'llm', 'my-llm', 'robot', 'ＣｈａｔＧＰＴ', 'cl​aude', 'kenny ai',
];
// 오탐 금지(사람 이름 — 'ai' 가 영문자 사이에 낀 경우 포함).
const ALLOW = ['kenny', 'daisy', 'maia', 'Maida', 'kai', 'raimund', 'keeper-hidden-name', '김검수', 'operator-01', 'Haiden'];

describe('AI 핸들 판정 — 단일 정의(ai-handle.json) TS ↔ mjs 패리티', () => {
  it('정규식 원문 같음', () => {
    expect(AI_HANDLE_RE.source).toBe(mjs.AI_HANDLE_RE.source);
    expect(AI_HANDLE_RE.flags).toBe(mjs.AI_HANDLE_RE.flags);
  });
  it.each(REJECT)('거부: %s', (h) => {
    expect(isAiHandle(h)).toBe(true);
    expect(mjs.isAiHandle(h)).toBe(true);
  });
  it.each(ALLOW)('허용: %s', (h) => {
    expect(isAiHandle(h)).toBe(false);
    expect(mjs.isAiHandle(h)).toBe(false);
  });
  it('문자열 아님 → false(형식 검사는 호출자 몫)', () => {
    for (const v of [null, undefined, 1, {}, ['claude']]) {
      expect(isAiHandle(v)).toBe(false);
      expect(mjs.isAiHandle(v)).toBe(false);
    }
  });
});

describe('seed:validate V11·G07 — 검수자·서명자 AI 핸들', () => {
  const signed = (): { raw: RawSeed; manifest: SignatureEntry[] } => {
    const { seed, manifest } = dwarfSignedWith();
    return { raw: clone(seed) as unknown as RawSeed, manifest: clone(manifest) };
  };

  it('기준: 서명 시드(kenny) errors 0', () => {
    const { raw, manifest } = signed();
    expect(run(raw, manifest).errors).toEqual([]);
  });

  it('QA 82 재현: 모든 kenny 를 claude 로 바꾼 서명 시드 → V11·G07 (이전엔 errors 0)', () => {
    const { raw, manifest } = signed();
    for (const k of CONTENT_KEYS) {
      for (const r of (raw as Record<string, Row[]>)[k]) {
        for (const f of ['verifiedBy', 'specVerifiedBy']) if (r[f] === 'kenny') r[f] = 'claude';
      }
    }
    for (const e of manifest) e.signedBy = 'claude';
    const res = run(raw, manifest);
    expect(rules(res)).toEqual(['G07', 'V11']);
    expect(res.errors.filter((i) => i.rule === 'G07')).toHaveLength(manifest.length);
  });

  it.each(['chatgpt', 'claude3', 'ai_kenny'])('상품 verifiedBy·specVerifiedBy·signedBy = %s → V11 2건 + G07 1건만', (h) => {
    const { raw, manifest } = signed();
    const p = rowOf(raw, 'curatedProducts', 'cp-dw-001');
    p.verifiedBy = h;
    p.specVerifiedBy = h;
    const e = manifest.find((x) => x.file === SEED_FILES.curatedProducts && x.id === 'cp-dw-001');
    if (!e) throw new Error('entry 없음');
    e.signedBy = h;
    const res = run(raw, manifest);
    expect(rules(res)).toEqual(['G07', 'V11']);
    expect(res.errors.filter((i) => i.rule === 'V11').map((i) => [i.id, i.path]).sort()).toEqual([
      ['cp-dw-001', 'specVerifiedBy'],
      ['cp-dw-001', 'verifiedBy'],
    ]);
  });

  it.each(['kenny', 'daisy', 'maia'])('사람 핸들 %s 로 일관 서명 → errors 0', (h) => {
    const { raw, manifest } = signed();
    for (const k of CONTENT_KEYS) {
      for (const r of (raw as Record<string, Row[]>)[k]) {
        for (const f of ['verifiedBy', 'specVerifiedBy']) if (r[f] === 'kenny') r[f] = h;
      }
    }
    for (const e of manifest) e.signedBy = h;
    expect(run(raw, manifest).errors).toEqual([]);
  });

  it('V11 은 상태 무관(매니페스트 생략·DRAFT 행의 verifiedBy 에도)', () => {
    const raw = clone(realSeed()) as unknown as RawSeed;
    const r = rowOf(raw, 'supplyItems', 'wheel');
    r.verifiedBy = 'gpt-helper';
    const res = validateSeed(raw, { now: NOW });
    expect(res.errors.filter((i) => i.rule === 'V11').map((i) => i.id)).toEqual(['wheel']);
  });
});

describe('apply-review-signatures — signedBy AI 핸들 거부(같은 판정)', () => {
  const filesOf = (s: SeedBundle): Record<string, unknown[]> =>
    Object.fromEntries(CONTENT_KEYS.map((k) => [SEED_FILES[k], clone((s as unknown as Record<string, unknown[]>)[k])]));
  const apply = (signedBy: string) => () =>
    applyMjs.applySignatures(filesOf(realSeed()), [], dwarfPacketK1(), { ...dwarfAllCheckedResult(NOW), signedBy }, { now: NOW });

  it.each(['chatgpt', 'claude3', 'ai_kenny', 'GPT-4', 'gemini'])('거부: %s', (h) => {
    expect(apply(h)).toThrow(/AI 핸들/);
  });
  it.each(['kenny', 'daisy', 'maia'])('허용: %s', (h) => {
    expect(apply(h)().manifest.every((e) => e.signedBy === h)).toBe(true);
  });
});
