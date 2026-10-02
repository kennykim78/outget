// seedDigest — manifest.seedDigest 결속 값. scripts/lib/seed-exposure.mjs seedDigest() 와 **같은 알고리즘**
//   (lane E 계약, D9): seedDir 의 *.json 파일명을 코드 유닛 순 정렬 → 파일마다 `${name}\n` + 본문(UTF-8, BOM 제거,
//   CRLF→LF) + `\n` 을 sha256 에 차례로 → 소문자 hex 64자. 동등성은 prerender.cli.test.ts 가 두 구현을 비교해 잠근다.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function seedDigest(seedDir: string): string {
  const names = readdirSync(seedDir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = createHash('sha256');
  for (const name of names) {
    let text = readFileSync(join(seedDir, name), 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n/g, '\n');
    h.update(`${name}\n`, 'utf8');
    h.update(text, 'utf8');
    h.update('\n', 'utf8');
  }
  return h.digest('hex');
}
