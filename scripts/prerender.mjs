#!/usr/bin/env node
// 빌드 타임 프리렌더 — 얇은 래퍼(D1·D2). 렌더 로직은 server/src/prerender/*.ts, 실행은 컴파일된 server/dist.
//   선행: npm run build -w client && npm run build -w server
//   사용: node scripts/prerender.mjs [--seed-dir <dir>] [--out <dir>] [--site-origin <url>] [--public-dir <dir>] [--now YYYY-MM-DD]
//   env: SITE_ORIGIN(기본 http://localhost:3001), WS_INDEXABLE=1 일 때만 robots Allow.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cli = fileURLToPath(new URL('../server/dist/prerender/cli.js', import.meta.url));
if (!existsSync(cli)) {
  process.stderr.write(`prerender: ${cli} 없음 — npm run build -w server 먼저\n`);
  process.exit(2);
}
const { runPrerenderCli } = await import(pathToFileURL(cli).href);
const d = new Date();
const p = (n) => String(n).padStart(2, '0');
process.exitCode = await runPrerenderCli(process.argv.slice(2), {
  stdout: (l) => process.stdout.write(`${l}\n`),
  stderr: (l) => process.stderr.write(`${l}\n`),
  env: process.env,
  today: () => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
});
