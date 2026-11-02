// 파일 수집·경량 JS 렉서 — compliance-scan 전용. 의존성 0.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git', 'coverage']);
export const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
// 키·설정 파일(QA198 LOW-1): 개인 키(.pem·.key — .crt 도 키를 함께 묶은 번들이 있어 넣는다)·TOML·INI·conf·properties·Terraform.
//   소스 규칙에서 이 확장자들은 C7(시크릿)만 탄다(코드·시드·패키지·HTML 규칙은 확장자·경로로 따로 고른다).
export const KEY_CONFIG_EXT = ['.pem', '.key', '.crt', '.toml', '.ini', '.conf', '.cfg', '.cnf', '.properties', '.tf', '.tfvars'];
export const TEXT_EXT = new Set([...CODE_EXT, '.json', '.yml', '.yaml', '.md', '.css', '.html', '.prisma', '.txt', '.env', '.sql', ...KEY_CONFIG_EXT]);

export const toPosix = (p) => p.split(sep).join('/');
export const relPosix = (root, abs) => toPosix(relative(root, abs));

/** dir 아래 파일(제외 디렉터리 건너뜀). 없는 dir 은 빈 목록. */
export function walk(dirAbs, out = []) {
  let entries;
  try {
    entries = readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const ent of entries) {
    const abs = join(dirAbs, ent.name);
    if (ent.isDirectory()) {
      if (!EXCLUDE_DIRS.has(ent.name)) walk(abs, out);
    } else if (ent.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 인덱스 → 1-based 줄 번호 함수. */
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^']);
const REGEX_KW = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'yield', 'await', 'instanceof', 'else', 'do']);

/**
 * 경량 JS/TS 렉서(정밀 파서 아님).
 *   code    = 주석만 공백화(문자열 유지) — URL·import·라우트 검사용
 *   bare    = 주석 + 문자열·정규식 내용 공백화(따옴표는 남김) — 식별자 검사용
 *   strings = 문자열 리터럴 내용(이스케이프 원문 그대로) + 시작 줄 + start/end 인덱스
 * 길이·줄바꿈은 보존한다. '·" 문자열은 줄바꿈에서 끝낸다(JSX 텍스트의 아포스트로피 피해를 한 줄로 제한).
 */
export function lexJs(src) {
  const n = src.length;
  const code = src.split('');
  const bare = src.split('');
  const strings = [];
  const lineOf = lineIndex(src);
  const blank = (arr, a, b) => {
    for (let k = a; k < b; k++) if (arr[k] !== '\n' && arr[k] !== '\r') arr[k] = ' ';
  };
  let lastSig = '';
  let lastWord = '';
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let e = src.indexOf('\n', i);
      if (e < 0) e = n;
      blank(code, i, e);
      blank(bare, i, e);
      i = e;
      continue;
    }
    if (c === '/' && d === '*') {
      let e = src.indexOf('*/', i + 2);
      e = e < 0 ? n : e + 2;
      blank(code, i, e);
      blank(bare, i, e);
      i = e;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      let text = '';
      while (k < n) {
        const ch = src[k];
        if (ch === '\\') {
          text += src.slice(k, k + 2);
          k += 2;
          continue;
        }
        if (ch === c) break;
        if (ch === '\n' && c !== '`') break;
        text += ch;
        k++;
      }
      blank(bare, i + 1, Math.min(k, n));
      const end = k < n && src[k] === c ? k + 1 : k;
      // start = 여는 따옴표 위치, end = 닫는 따옴표 다음(닫히지 않으면 끊긴 위치) — 인접 리터럴 접기·인수 영역 판정용(274).
      strings.push({ text, line: lineOf(i), quote: c, start: i, end });
      i = end;
      lastSig = 'a';
      lastWord = '';
      continue;
    }
    if (c === '/') {
      const isRegex = lastSig === '' || REGEX_PREV.has(lastSig) || REGEX_KW.has(lastWord);
      if (isRegex) {
        let k = i + 1;
        let inClass = false;
        while (k < n && src[k] !== '\n') {
          const ch = src[k];
          if (ch === '\\') {
            k += 2;
            continue;
          }
          if (ch === '[') inClass = true;
          else if (ch === ']') inClass = false;
          else if (ch === '/' && !inClass) break;
          k++;
        }
        blank(bare, i + 1, Math.min(k, n));
        i = k < n && src[k] === '/' ? k + 1 : k;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        lastSig = 'a';
        lastWord = '';
        continue;
      }
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      let k = i;
      while (k < n && /[A-Za-z0-9_$]/.test(src[k])) k++;
      lastWord = src.slice(i, k);
      lastSig = 'a';
      i = k;
      continue;
    }
    if (!/\s/.test(c)) {
      lastSig = c;
      lastWord = '';
    }
    i++;
  }
  return { code: code.join(''), bare: bare.join(''), strings };
}

/** prisma 스키마: // 주석 제거(줄 보존). */
export function stripSlashComments(src) {
  return src
    .split('\n')
    .map((l) => {
      const k = l.indexOf('//');
      return k < 0 ? l : l.slice(0, k);
    })
    .join('\n');
}
