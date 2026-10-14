// R6 F2a — 빌드 타임 텍스트 사전 압축(.br quality 11 · .gz level 9). 신규 의존성 0(node:zlib).
//   대상: client/dist 의 텍스트 산출물(PRECOMPRESS_EXT) 중 ≥ PRECOMPRESS_MIN_BYTES, 압축본이 원본보다 작을 때만 사본을 쓴다.
//   실행: scripts/precompress.mjs(프리렌더 직후, 컴플라이언스 스캔 전). 서빙: middleware/spa.ts 가 Accept-Encoding 으로 고른다.
//   결정론: 같은 입력 → 같은 바이트(gzip 헤더 mtime 0, 빌드 시각 미기록). 재실행 시 이전 사본·고아 사본을 먼저 지운다.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync, gzipSync } from 'node:zlib';

export const PRECOMPRESS_EXT: ReadonlySet<string> = new Set(['.html', '.css', '.js', '.json', '.svg', '.xml', '.txt', '.webmanifest']);
export const PRECOMPRESS_MIN_BYTES = 1024;

export type Encoding = 'br' | 'gzip';
export const ENCODING_SUFFIX: Readonly<Record<Encoding, string>> = { br: '.br', gzip: '.gz' };

export function isPrecompressible(file: string): boolean {
  return PRECOMPRESS_EXT.has(extname(file).toLowerCase());
}

export function brotli(buf: Buffer): Buffer {
  return brotliCompressSync(buf, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
}

export function gzip(buf: Buffer): Buffer {
  return gzipSync(buf, { level: 9 });
}

/** 압축본 → 원본 바이트(검증용). 손상이면 throw. */
export function decode(enc: Encoding, buf: Buffer): Buffer {
  return enc === 'br' ? brotliDecompressSync(buf) : gunzipSync(buf);
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(abs, out);
    else if (ent.isFile()) out.push(abs);
  }
  return out;
}

export interface PrecompressEntry {
  file: string;
  bytes: number;
  br: number | null;
  gzip: number | null;
}

export interface PrecompressResult {
  entries: PrecompressEntry[];
  /** 지운 이전·고아 사본 수. */
  removed: number;
}

const isEncodedCopy = (f: string): boolean => f.endsWith('.br') || f.endsWith('.gz');

/**
 * dir 아래 텍스트 산출물에 .br·.gz 사본을 쓴다. 기존 사본(.br/.gz)은 모두 먼저 지운다 — 원본이 바뀌거나 사라진 뒤
 *   남은 사본이 다른 내용을 서빙하지 않게(서빙 측도 내용 검증을 한 번 더 한다).
 */
export function precompressDir(dir: string): PrecompressResult {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`precompress: 디렉터리 없음 ${dir}`);
  let removed = 0;
  for (const f of walkFiles(dir)) {
    if (isEncodedCopy(f) && isPrecompressible(f.slice(0, -3))) {
      rmSync(f, { force: true });
      removed++;
    }
  }
  const entries: PrecompressEntry[] = [];
  for (const f of walkFiles(dir)) {
    if (!isPrecompressible(f)) continue;
    const src = readFileSync(f);
    if (src.length < PRECOMPRESS_MIN_BYTES) continue;
    const e: PrecompressEntry = { file: f, bytes: src.length, br: null, gzip: null };
    for (const enc of ['br', 'gzip'] as const) {
      const out = enc === 'br' ? brotli(src) : gzip(src);
      if (out.length >= src.length) continue;
      writeFileSync(f + ENCODING_SUFFIX[enc], out);
      e[enc] = out.length;
    }
    entries.push(e);
  }
  return { entries, removed };
}
