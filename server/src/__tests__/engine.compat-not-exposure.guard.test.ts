// 가드(155 계획 6절 4단계, 작업 178 — 불변식 3·6): requirementCompat 의 권장 채움은 체크리스트 △·L4 안내 전용.
//   ① 노출(exposure.ts)·시드 검증/적재(src/seed/**)·프리렌더 투영·정렬(src/prerender/**)·부팅 코드는
//      requirementCompat / requirementBaseline / minSpecBaseline / productCageCompat(작업 185, L7 표시 전용) 을 import·호출하지 않는다(소스 스캔, 주석 제외).
//   ② CuratedProduct 최소 규격 판정(checkProfileMinSpec = meetsMinSpec, checkAnimalMinSpec = 노출 규격)은
//      레거시 계산(evaluateProductStage 직접 호출)과 모든 시드 상품 × 모든 해당 동물에서 같다.
//   ①-예외(작업 228, 총괄 승인 A' — Kenny 추인 대기, ORDERS §19): seed/validate-compat-quality.ts 한 파일만 이름으로 제외.
//      대신 보상 단언 (a) 진단은 WARN 뿐 (b) import 는 seed/validate.ts 하나뿐 (c) validate.ts 에서 ERROR 0 일 때만 호출.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkAnimalMinSpec, checkProfileMinSpec, createCatalog, evaluateProductStage, resolveRequirement } from '../engine/index.js';
import type { SpecValues } from '../engine/index.js';
import { Collector, type RawSeed, type Rec, type SeedKey } from '../seed/common.js';
import { buildCtx } from '../seed/context.js';
import { readSeedDirRaw } from '../seed/read.js';
import { validateSeed } from '../seed/validate.js';
import { checkCompatMinRecMix, checkCompatOr, checkCompatOwnedProbe } from '../seed/validate-compat-quality.js';
import { realSeed, unsignRaw } from './fixtures/prerender-seed.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts|js|mjs)$/.test(n) ? [p] : [];
  });
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const FORBIDDEN = /\b(requirementCompat|requirementBaseline|minSpecBaseline|productCageCompat)\b/;

const relOf = (p: string) => relative(SRC, p).replace(/\\/g, '/');

// 가드 ① 예외 — 정확히 이 파일 하나(이름 일치, 와일드카드·디렉터리 예외 금지).
//   이유: R07c(보유품 의존성 탐침)·R07e(최소·권장 키 혼합)는 시드 작성 단계의 품질 경고(WARN 전용)이고,
//   minSpecBaseline·requirementBaseline 은 표본 입력을 만드는 데만 쓴다. 이 모듈은 seed/cli-load.ts·prerender/cli.ts 의
//   validateSeed 안에서 실행은 되지만(ERROR 0 일 때만), ERROR 를 낼 수 없으므로 그 결과가 적재·노출·프리렌더 판정
//   (오류 시 exit 1·meetsMinSpec·노출 집합)에 쓰이지 않는다 — WARN 은 건수 출력뿐.
//   총괄 승인 A'(작업 228, ORDERS §19) — Kenny 추인 대기. 되돌리기 = 이 변경 커밋 revert(예외가 빠지면 가드 ① 이 다시 빨강).
//   보상 단언 (a)(b)(c)가 "WARN 전용 · validate.ts 에서만 import · ERROR 0 일 때만 호출"을 고정한다.
const COMPAT_QUALITY = 'seed/validate-compat-quality.ts';
const EXEMPT: readonly string[] = [COMPAT_QUALITY];

const GUARDED_ALL = [
  join(SRC, 'engine', 'exposure.ts'),
  join(SRC, 'index.ts'),
  ...walk(join(SRC, 'boot')),
  ...walk(join(SRC, 'seed')),
  ...walk(join(SRC, 'prerender')),
];
const GUARDED = GUARDED_ALL.filter((p) => !EXEMPT.includes(relOf(p)));

describe('가드 ①: 노출·검증·프리렌더 경로는 호환 가상 입력을 쓰지 않는다', () => {
  it('대상 파일 집합 전제(핵심 파일 포함)', () => {
    const rel = GUARDED.map((p) => relative(SRC, p).replace(/\\/g, '/'));
    for (const must of ['engine/exposure.ts', 'seed/validate-products.ts', 'seed/validate-engine.ts', 'seed/cli-load.ts', 'prerender/project.ts']) {
      expect(rel).toContain(must);
    }
  });
  it('requirementCompat·requirementBaseline·minSpecBaseline·productCageCompat 참조 0', () => {
    const hits = GUARDED.filter((p) => FORBIDDEN.test(stripComments(readFileSync(p, 'utf8')))).map((p) => relative(SRC, p));
    expect(hits).toEqual([]);
  });
  it('스캐너 자체 점검: 엔진 spec-check.ts 에서는 잡힌다', () => {
    expect(FORBIDDEN.test(stripComments(readFileSync(join(SRC, 'engine', 'spec-check.ts'), 'utf8')))).toBe(true);
  });

  it('예외는 정확히 1개 파일(이름 일치) — 실재하고, 대상 집합에서 그 하나만 빠진다', () => {
    expect(EXEMPT).toEqual([COMPAT_QUALITY]);
    for (const e of EXEMPT) expect(e).not.toMatch(/[*?]|\/$/);
    const all = GUARDED_ALL.map(relOf);
    const kept = new Set(GUARDED.map(relOf));
    expect(all).toContain(COMPAT_QUALITY);
    expect(all.filter((r) => !kept.has(r))).toEqual([COMPAT_QUALITY]);
  });

  // ── 보상 단언(작업 228) ──────────────────────────────────────────────
  const qualitySrc = stripComments(readFileSync(join(SRC, ...COMPAT_QUALITY.split('/')), 'utf8'));
  const NOW = '2026-11-16'; // 실서명일 이상(옛 값 2026-11-03)
  /** 주입 바탕 = 서명 전 기준(4 패킷 미서명, 메모리) — ERROR 유무만 바꿔 R07c·R07e 를 보는 시험이라 서명 상태와 무관해야 한다. */
  const SEED_BASE: RawSeed = unsignRaw(readSeedDirRaw(join(SRC, '..', 'seed')).raw);
  const RULE = 'cr-syrian-wheel-cage-bedding'; // a = wheel, b = cage(seed.validate-compat-quality.test.ts 와 같은 자리)
  const rowOf = (s: RawSeed, key: SeedKey, id: string): Rec => {
    const r = (s[key] ?? []).find((x) => (x as Rec).id === id);
    if (!r) throw new Error(`fixture: ${key}#${id} 없음`);
    return r as Rec;
  };
  /** 메모리 사본에만 expr 주입(+선택: 권장 전용 키 자리표시). 시드 사실 불변, 주입값은 사실이 아니다. */
  const violating = (expr: string, silentRec = false): Required<RawSeed> => {
    const s = structuredClone(SEED_BASE) as Required<RawSeed>;
    const rule = (rowOf(s, 'compatibilityRules', RULE).rules as Rec[])[0];
    rule.expr = expr;
    if (silentRec) {
      rule.onFail = 'BELOW_MIN';
      ((rowOf(s, 'supplyRequirements', 'req-syrian-wheel').recommendedSpec as Rec).rules as Rec[]).push({
        key: 'silent',
        op: 'eq',
        value: true,
        reason: '검증용 자리표시',
      });
    }
    return s;
  };
  const FIXTURES: Array<[label: string, seed: Required<RawSeed>, rule: string]> = [
    ['R07c', violating('b.heightCm == b.heightCm'), 'R07c'],
    ['R07d', violating('a.diameterCm >= 1 || b.heightCm >= 1000'), 'R07d'],
    ['R07e', violating('a.diameterCm + 20 <= b.heightCm && a.silent == true', true), 'R07e'],
  ];

  it('(a-소스) validate-compat-quality 는 ERROR 진단을 낼 수 없다 — ctx.out 은 .warn( 으로만, ERROR·error·add·severity·issues 0', () => {
    expect(qualitySrc).not.toMatch(/\bERROR\b/);
    expect(qualitySrc).not.toMatch(/['"`]error['"`]/i);
    expect(qualitySrc).not.toMatch(/\.\s*error\s*\(/);
    expect(qualitySrc).not.toMatch(/\bseverity\b/);
    expect(qualitySrc).not.toMatch(/\bCollector\b/);
    expect(qualitySrc).not.toMatch(/\.\s*issues\b/);
    expect(qualitySrc).not.toMatch(/\bout\s*\.\s*add\s*\(/);
    const uses = [...qualitySrc.matchAll(/\bctx\s*\.\s*out\b(?:\s*\.\s*(\w+)\s*\()?/g)].map((m) => m[1] ?? '(별칭·비호출)');
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((u) => u !== 'warn')).toEqual([]);
  });

  it('(a-행동) 위반 픽스처로 모듈 함수 직접 호출 → 기대 진단이 나오고 전부 WARN', () => {
    for (const [label, s, expectRule] of FIXTURES) {
      const out = new Collector();
      const ctx = buildCtx(s, { now: NOW }, out);
      const before = out.issues.length;
      checkCompatOr(ctx);
      checkCompatOwnedProbe(ctx, s);
      checkCompatMinRecMix(ctx, s);
      const got = out.issues.slice(before);
      expect([label, got.some((i) => i.rule === expectRule)]).toEqual([label, true]);
      expect([label, got.filter((i) => i.severity !== 'WARN').map((i) => `${i.severity}:${i.rule}`)]).toEqual([label, []]);
    }
  });

  it('(b) validate-compat-quality 를 import 하는 소스는 seed/validate.ts 하나뿐(노출·index·boot·적재·프리렌더 0)', () => {
    const IMPORT_RE = /\b(?:from|import)\s*\(?\s*['"`][^'"`]*validate-compat-quality(?:\.[cm]?[jt]s)?['"`]/;
    const ANY_REF = /validate-compat-quality/;
    const srcFiles = walk(SRC).filter((p) => !relOf(p).startsWith('__tests__/') && relOf(p) !== COMPAT_QUALITY);
    const importers = srcFiles.filter((p) => IMPORT_RE.test(stripComments(readFileSync(p, 'utf8')))).map(relOf);
    expect(importers).toEqual(['seed/validate.ts']);
    // 이름 조각을 쓰는 다른 참조(동적 경로 등)도 허용 목록 밖에서는 0.
    const refs = srcFiles.filter((p) => ANY_REF.test(stripComments(readFileSync(p, 'utf8')))).map(relOf);
    expect(refs).toEqual(['seed/validate.ts']);
    // 명시 대상(노출·index·boot·적재 경로·프리렌더) — 위 허용 목록의 중복 확인 + 파일 실재 전제.
    const LOAD_PATH = ['seed/cli-load.ts', 'seed/load.ts', 'seed/plan.ts', 'seed/map.ts', 'seed/read.ts'];
    const seedRel = walk(join(SRC, 'seed')).map(relOf);
    for (const r of LOAD_PATH) expect(seedRel).toContain(r);
    const named = [
      join(SRC, 'engine', 'exposure.ts'),
      join(SRC, 'index.ts'),
      ...walk(join(SRC, 'boot')),
      ...walk(join(SRC, 'prerender')),
      ...LOAD_PATH.map((r) => join(SRC, ...r.split('/'))),
    ];
    expect(named.filter((p) => ANY_REF.test(stripComments(readFileSync(p, 'utf8')))).map(relOf)).toEqual([]);
  });

  // ── 보완(QA229 G1·G6) — re-export·별칭 export 우회, 파일 단위 예외의 함수 범위 고정 ──────────
  const QUALITY_FNS = ['checkCompatOr', 'checkCompatOwnedProbe', 'checkCompatMinRecMix'];
  const ENGINE_FORBIDDEN = ['requirementCompat', 'requirementBaseline', 'minSpecBaseline', 'productCageCompat'];
  const IDENT = /^[A-Za-z_$][\w$]*$/;
  /** 소스(주석 제거)의 export 정보 — 선언 export(종류·이름), `export {…}` 지정자(로컬·내보낸 이름 둘 다), re-export 출처, `export *`·default. */
  const exportsOf = (src: string) => {
    const decl: Array<{ kind: string; name: string }> = [];
    for (const m of src.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(function\*?|class|interface|enum|type(?!\s*\{)|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
      decl.push({ kind: m[1].replace('*', ''), name: m[2] });
    }
    const braceNames: string[] = [];
    const from: string[] = [];
    for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}\s*(?:from\s*['"`]([^'"`]+)['"`])?/g)) {
      for (const spec of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        for (const part of spec.replace(/^type\s+/, '').split(/\s+as\s+/)) braceNames.push(part.trim());
      }
      if (m[2]) from.push(m[2]);
    }
    const star = [...src.matchAll(/\bexport\s*\*\s*(?:as\s+[\w$]+\s*)?from\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    const dflt = (src.match(/\bexport\s+default\b|\bexport\s*=/g) ?? []).length;
    return { decl, braceNames, from: [...from, ...star], star: star.length, dflt };
  };
  const validateSrc = stripComments(readFileSync(join(SRC, 'seed', 'validate.ts'), 'utf8'));

  it('(보완1) validate.ts — 그 모듈에서 가져오는 이름 = 정확히 R07c·R07d·R07e 3함수(별칭·namespace·default import 0)', () => {
    const clauses = [...validateSrc.matchAll(/\bimport\s+([\s\S]*?)\s*from\s*['"`]([^'"`]+)['"`]/g)]
      .filter((m) => /validate-compat-quality/.test(m[2]))
      .map((m) => m[1].trim());
    expect(clauses.length).toBe(1);
    expect(clauses[0]).toMatch(/^\{[^}]*\}$/);
    const specs = clauses[0].slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean);
    for (const s of specs) expect(s).toMatch(IDENT); // `a as b`·`type a` 없음
    expect([...specs].sort()).toEqual([...QUALITY_FNS].sort());
  });

  it('(보완1) validate.ts — 그 모듈 re-export·export * 0, export 목록에 3함수·엔진 금지 함수 이름 0, export 목록 고정', () => {
    const e = exportsOf(validateSrc);
    expect(e.star).toBe(0);
    expect(e.dflt).toBe(0);
    expect(e.from.filter((f) => /validate-compat-quality/.test(f))).toEqual([]);
    const names = [...e.decl.map((d) => d.name), ...e.braceNames];
    expect(names.filter((n) => QUALITY_FNS.includes(n) || ENGINE_FORBIDDEN.includes(n))).toEqual([]);
    // 값 export 는 validateSeed 하나(래퍼·별칭 const export 로 3함수를 밖에 내보내는 우회 차단). 타입 export 는 이름만 고정.
    expect(e.decl.filter((d) => d.kind !== 'interface' && d.kind !== 'type')).toEqual([{ kind: 'function', name: 'validateSeed' }]);
    expect([...names].sort()).toEqual(['ExposureSummary', 'ValidateOptions', 'ValidateResult', 'validateSeed']);
    expect([...e.from].sort()).toEqual(['./context.js', './validate-engine.js']);
  });

  it('(보완2) 예외 모듈 export 목록 고정(전부 function 선언) — 금지 함수 별칭 export·re-export·default 0', () => {
    const e = exportsOf(qualitySrc);
    expect(e.star).toBe(0);
    expect(e.dflt).toBe(0);
    expect(e.from).toEqual([]);
    expect(e.braceNames).toEqual([]); // `export { minSpecBaseline as x }` 류 0
    expect(e.decl).toEqual(
      ['checkCompatOr', 'strLiterals', 'directLiterals', 'literalValues', 'combos', 'checkCompatOwnedProbe', 'checkCompatMinRecMix'].map((name) => ({ kind: 'function', name })),
    );
    // `export const x = minSpecBaseline` 류 — 위 목록이 전부 function 이라 이미 막히지만 직접도 확인.
    expect(qualitySrc).not.toMatch(/\bexport\s+(?:const|let|var)\b/);
    // 엔진 금지 함수의 import 별칭(`minSpecBaseline as m`)으로 이름 스캔을 피하는 우회 0.
    expect(qualitySrc).not.toMatch(new RegExp(String.raw`\b(?:${ENGINE_FORBIDDEN.join('|')})\s+as\b`));
  });

  it('(보완3, G6) 예외 모듈 안 금지 함수 사용은 R07c·R07e 와 그 내부 헬퍼(inputVariants)로 한정 — checkCompatOr(조건 없이 호출) 0', () => {
    // 최상위 선언 단위로 자른다(열 0 에서 시작하는 줄 = 새 선언, `}`·`)`·`]`·빈 줄은 이어짐).
    const segs: Array<{ name: string; body: string }> = [];
    for (const line of qualitySrc.split('\n')) {
      if (/^[^\s})\]]/.test(line)) {
        const m = line.match(/^(?:export\s+)?(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/);
        segs.push({ name: m ? m[1] : /^import\b/.test(line) ? 'import' : `?${line.slice(0, 30)}`, body: line });
      } else if (segs.length > 0) {
        segs[segs.length - 1].body += `\n${line}`;
      }
    }
    const names = segs.map((s) => s.name);
    expect(names.filter((n) => n.startsWith('?'))).toEqual([]); // 알 수 없는 최상위 구문 0(분할 전제)
    const declNames = names.filter((n) => n !== 'import'); // import 문은 여러 개일 수 있다
    expect(new Set(declNames).size).toBe(declNames.length);
    for (const must of [...QUALITY_FNS, 'inputVariants']) expect(names).toContain(must);
    const FORBIDDEN_G = new RegExp(String.raw`\b(?:${ENGINE_FORBIDDEN.join('|')})\b`);
    // 직접 사용 + 전이(오염 선언을 이름으로 참조하는 선언도 오염).
    const tainted = new Set(segs.filter((s) => FORBIDDEN_G.test(s.body)).map((s) => s.name));
    for (let changed = true; changed; ) {
      changed = false;
      for (const s of segs) {
        if (tainted.has(s.name)) continue;
        if ([...tainted].some((t) => t !== 'import' && new RegExp(String.raw`\b${t.replace(/\$/g, '\\$')}\b`).test(s.body))) {
          tainted.add(s.name);
          changed = true;
        }
      }
    }
    const ALLOWED_TAINT = ['import', 'inputVariants', 'checkCompatOwnedProbe', 'checkCompatMinRecMix'];
    expect([...tainted].filter((n) => !ALLOWED_TAINT.includes(n))).toEqual([]);
    expect(tainted.has('checkCompatOr')).toBe(false);
    const orBody = segs.find((s) => s.name === 'checkCompatOr')?.body ?? '';
    expect(orBody).toMatch(/^export function checkCompatOr\b/);
    expect(orBody).not.toMatch(FORBIDDEN_G);
  });

  it('(c-소스) validate.ts 에서 R07c·R07e 호출은 각 1회, "ERROR 0 일 때만" 조건문 안', () => {
    const lines = stripComments(readFileSync(join(SRC, 'seed', 'validate.ts'), 'utf8')).split('\n');
    for (const fn of ['checkCompatOwnedProbe', 'checkCompatMinRecMix']) {
      const calls = lines.filter((l) => new RegExp(String.raw`\b${fn}\s*\(`).test(l));
      expect([fn, calls.length]).toEqual([fn, 1]);
      const gated = new RegExp(
        String.raw`^\s*if\s*\(\s*!\s*out\.issues\.some\(\s*\(?\s*i\s*\)?\s*=>\s*i\.severity\s*===\s*'ERROR'\s*\)\s*\)\s*` + fn + String.raw`\(\s*ctx\s*,\s*raw\s*\)\s*;\s*$`,
      );
      expect([fn, gated.test(calls[0] ?? '')]).toEqual([fn, true]);
      // 함수 값 전달(콜백·별칭) 우회 금지 — 호출 줄 외 참조는 import 줄뿐.
      const refs = lines.filter((l) => new RegExp(String.raw`\b${fn}\b`).test(l));
      expect([fn, refs.filter((l) => !/^\s*import\b/.test(l) && l !== calls[0])]).toEqual([fn, []]);
    }
  });

  it('(c-행동) ERROR 가 있는 시드 → R07c·R07e 0, 같은 픽스처에서 ERROR 만 빼면 나온다(대조)', () => {
    for (const [label, s, expectRule] of FIXTURES.filter(([, , r]) => r !== 'R07d')) {
      const ok = validateSeed(s, { now: NOW });
      expect([label, ok.errors.map((i) => i.rule)]).toEqual([label, []]);
      expect([label, ok.warnings.some((i) => i.rule === expectRule)]).toEqual([label, true]);
      const broken = structuredClone(s);
      (broken.compatibilityRules as unknown[]).push(42); // S01 ERROR(배열 원소가 객체가 아님)
      const bad = validateSeed(broken, { now: NOW });
      expect([label, bad.errors.length > 0]).toEqual([label, true]);
      expect([label, bad.warnings.filter((i) => i.rule === 'R07c' || i.rule === 'R07e').map((i) => i.rule)]).toEqual([label, []]);
    }
  });
});

describe('가드 ②: 시드 상품 최소 규격 판정 = 레거시 계산', () => {
  const seed = realSeed();
  const cat = createCatalog(seed);
  const products = seed.curatedProducts;

  it('시드 상품이 있다(빈 격자 방지)', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it('checkProfileMinSpec(meetsMinSpec 단일 지점) — 프로필 기본 요구사항 제품 단계와 같다', () => {
    let n = 0;
    for (const p of products) {
      for (const cp of p.careProfileIds) {
        const base = cat.requirementsByProfile.get(cp)?.get(p.supplyItemId);
        const item = cat.supplyItems.get(p.supplyItemId);
        if (!base || !item) continue;
        const legacy = evaluateProductStage(item.specSchema, base.minSpec, base.recommendedSpec, p.specValues as SpecValues);
        const now = checkProfileMinSpec(cat, cp, p.supplyItemId, p.specValues as SpecValues);
        expect([p.id, cp, now]).toEqual([
          p.id,
          cp,
          { meets: legacy.verdict === 'OK' || legacy.verdict === 'BELOW_RECOMMENDED', verdict: legacy.verdict, reasons: legacy.reasons },
        ]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('checkAnimalMinSpec(노출 규격) — resolveRequirement 제품 단계와 같다(모든 해당 동물)', () => {
    let n = 0;
    for (const p of products) {
      for (const at of seed.animalTypes.filter((a) => a.careProfileId !== null && p.careProfileIds.includes(a.careProfileId))) {
        const r = resolveRequirement(cat, at.id, p.supplyItemId);
        if (!r) continue;
        const legacy = evaluateProductStage(r.item.specSchema, r.minSpec, r.recommendedSpec, p.specValues as SpecValues);
        const now = checkAnimalMinSpec(cat, at.id, p.supplyItemId, p.specValues as SpecValues);
        expect([p.id, at.id, now]).toEqual([
          p.id,
          at.id,
          { meets: legacy.verdict === 'OK' || legacy.verdict === 'BELOW_RECOMMENDED', verdict: legacy.verdict, reasons: legacy.reasons },
        ]);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
