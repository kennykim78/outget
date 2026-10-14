// 마스코트 동일성(R6 레인 H): client/public/mascots/*.svg 는 docs/design/mascots 원본의 바이트 사본이어야 한다.
// 이름 매핑 규칙: 파일명 동일(1:1). 개수·이름 집합도 같아야 한다.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PUBLIC_DIR = join(ROOT, 'client', 'public', 'mascots');
const DESIGN_DIR = join(ROOT, 'docs', 'design', 'mascots');

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const svgs = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.svg')).sort();

describe('mascot identity', () => {
  it('public 마스코트 8종과 디자인 원본의 파일명 집합이 같다', () => {
    expect(svgs(PUBLIC_DIR)).toHaveLength(8);
    expect(svgs(PUBLIC_DIR)).toEqual(svgs(DESIGN_DIR));
  });

  for (const name of svgs(PUBLIC_DIR)) {
    it(`${name} sha256 이 docs/design/mascots 와 같다`, () => {
      expect(sha256(join(PUBLIC_DIR, name))).toBe(sha256(join(DESIGN_DIR, name)));
    });
  }
});
