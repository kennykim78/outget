#!/usr/bin/env node
// 빌드 타임 사전 압축(R6 F2a) — 얇은 래퍼. 로직은 server/src/prerender/compress.ts, 실행은 컴파일된 server/dist.
//   선행: npm run build -w server && node scripts/prerender.mjs(프리렌더 HTML 까지 압축하려면 프리렌더 다음에).
//   사용: node scripts/precompress.mjs [<dir>]   (기본 <repo>/client/dist)
//   출력: 파일 수·원본→br/gz 합계 한 줄. 외부 통신 0, 신규 의존성 0(node:zlib).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const lib = fileURLToPath(new URL('../server/dist/prerender/compress.js', import.meta.url));
if (!existsSync(lib)) {
  process.stderr.write(`precompress: ${lib} 없음 — npm run build -w server 먼저\n`);
  process.exit(2);
}
const dir = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../client/dist', import.meta.url));
const { precompressDir } = await import(pathToFileURL(lib).href);
try {
  const { entries, removed } = precompressDir(dir);
  const sum = (k) => entries.reduce((a, e) => a + (e[k] ?? 0), 0);
  const raw = entries.reduce((a, e) => a + e.bytes, 0);
  process.stdout.write(`precompress — files ${entries.length}, raw ${raw}B → br ${sum('br')}B · gz ${sum('gzip')}B (stale removed ${removed})\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}
