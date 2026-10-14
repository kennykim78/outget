// 리포 경로·경계 판정(플레이라이트가 읽는 CJS 쪽 파일 공용). serve.mts 는 같은 판정을 자체로 가진다(ESM).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const SEED_DIR = join(REPO_ROOT, 'server', 'seed');

export function isInsideRepo(p: string): boolean {
  const rel = relative(REPO_ROOT, resolve(p));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** server/seed/*.json 원문 해시 — E2E 전후 디스크 시드가 바뀌지 않았음을 단언하는 데 쓴다(불변식 ⑦). */
export function seedFilesDigest(dir: string = SEED_DIR): string {
  const h = createHash('sha256');
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    h.update(`${name}\n`);
    h.update(readFileSync(join(dir, name)));
  }
  return h.digest('hex');
}
