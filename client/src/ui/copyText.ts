// 카피 조회(D3 — 단일 소스 @ws/copy). 경로로 찾고, 없으면 null → 호출부는 그 요소를 그리지 않는다(한국어 하드코딩 0).
//   C1(copy.ts 새 카피 26)이 들어오면 같은 경로로 자동 연결된다. 필요한 경로 목록은 _workspace/29_fe1_r4.md F4·F5 절.
import { COPY, formatCopy } from '@ws/copy';

function walk(path: string): unknown {
  let cur: unknown = COPY;
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null || !Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** 경로의 문자열(없으면 null). */
export function copyAt(path: string): string | null {
  const v = walk(path);
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 경로의 템플릿을 formatCopy 로 채운다. 없거나 토큰을 채울 수 없으면 null(fail-closed). */
export function copyFmt(path: string, vars: Record<string, string | number>): string | null {
  const t = copyAt(path);
  if (t === null) return null;
  try {
    return (formatCopy as (template: string, vars: Record<string, string | number>) => string)(t, vars);
  } catch {
    return null;
  }
}
