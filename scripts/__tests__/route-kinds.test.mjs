// scripts/lib/rules-output.mjs 의 ROUTE_KINDS 복사본 = server/src/engine/public.ts ROUTE_KINDS (텍스트 파싱, 의존성 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const strings = (src) => [...src.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);

test('ROUTE_KINDS: scripts 복사본 = 엔진 public.ts', () => {
  const ts = readFileSync(resolve(ROOT, 'server', 'src', 'engine', 'public.ts'), 'utf8');
  const mjs = readFileSync(resolve(ROOT, 'scripts', 'lib', 'rules-output.mjs'), 'utf8');
  const tsM = /export const ROUTE_KINDS = \[([\s\S]*?)\] as const;/.exec(ts);
  const mjsM = /const ROUTE_KINDS = new Set\(\[([\s\S]*?)\]\);/.exec(mjs);
  assert.ok(tsM, 'public.ts 에서 ROUTE_KINDS 배열을 찾지 못함');
  assert.ok(mjsM, 'rules-output.mjs 에서 ROUTE_KINDS 집합을 찾지 못함');
  // 주석 속 따옴표 문자열은 제외
  const tsList = strings(tsM[1].replace(/\/\/.*$/gm, ''));
  const mjsList = strings(mjsM[1].replace(/\/\/.*$/gm, ''));
  assert.ok(tsList.length >= 10, `엔진 목록이 비정상적으로 짧음: ${tsList.length}`);
  assert.deepEqual([...mjsList].sort(), [...tsList].sort());
});
