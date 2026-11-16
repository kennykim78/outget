// 제휴 꺼짐 기준선(259 단계 0, 258 T-③b) — HEAD 7ba51a1 에서 제휴 코드 변경 전에 만든 프리렌더 산출물 sha256.
//   대상 빌드 3개(메모리): 실시드(REAL_AS_OF 2026-11-16, 옛 2026-11-02) · promotedTwo(골든+합성 2타입, FIXTURE_AS_OF) · dwarfPreview(DWARF_PREVIEW_AS_OF).
//   빌드 입력 = client/index.html(소스 템플릿) · origin http://localhost:3001 · seedDigest 'a'×64 · indexable true.
//   제휴 옵션 없이(꺼짐) 만든 파일마다 sha256 → off-baseline.sha256.json. prerender.affiliate-toggle.test.ts 가 같은 함수로 재계산해 비교한다.
//   재생성(의도한 산출물 변경 뒤에만, 273): gen-baseline.ts(지정 리비전 코드로 독립 생성 — 권장) 또는 WS_AFF_BASELINE_WRITE=1(현재 코드, 차이 목록 출력).
//     절차 전문은 prerender.affiliate-toggle.test.ts 머리 주석. 커밋 메시지에 사유·명령을 남긴다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SeedBundle } from '../../../engine/index.js';
import type { BuildSiteOptions, SiteBuild } from '../../../prerender/site.js';
import { DWARF_PREVIEW_AS_OF, FIXTURE_AS_OF, dwarfPreview, promotedTwo, realSeed } from '../prerender-seed.js';

const here = dirname(fileURLToPath(import.meta.url));
export const BASELINE_FILE = join(here, 'off-baseline.sha256.json');
export const TEMPLATE = readFileSync(join(here, '..', '..', '..', '..', '..', 'client', 'index.html'), 'utf8');
export const REAL_AS_OF = '2026-11-16'; // 실서명일 이상(옛 값 2026-11-02) — 디스크 verifiedAt 2026-11-16 이 노출 기준일보다 미래가 되지 않게

export interface BaselineCase {
  name: string;
  seed: () => SeedBundle;
  asOf: string;
}

export const BASELINE_CASES: readonly BaselineCase[] = [
  { name: 'real', seed: realSeed, asOf: REAL_AS_OF },
  { name: 'promotedTwo', seed: () => promotedTwo(), asOf: FIXTURE_AS_OF },
  { name: 'dwarfPreview', seed: dwarfPreview, asOf: DWARF_PREVIEW_AS_OF },
];

export function baseOptions(asOf: string): BuildSiteOptions {
  return { template: TEMPLATE, origin: 'http://localhost:3001', seedDigest: 'a'.repeat(64), indexable: true, asOf };
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** 빌드 파일 → sha256(경로 정렬). */
export function hashFiles(b: SiteBuild): Record<string, string> {
  return Object.fromEntries([...b.files.keys()].sort().map((k) => [k, sha256(b.files.get(k) as string)]));
}
