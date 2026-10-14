// 스냅샷 병합(클라만 — 계약 C-R5-2 · D5 · 레인 F SetupV3). 순수 함수.
//   레코드 = setups[typeId] · cages[typeId] · reactions(한 덩어리) · animalTypeId.
//   - setups: 항목 단위 병합(mergeSetup — 아래). 두 기기가 같은 동물의 다른 항목을 교대로 바꿔도 어느 쪽도 되돌려지지 않는다.
//     양쪽 v2·v3 레코드는 읽을 때 v3 로 승격(migrateSetup — 무효 레코드는 없는 것으로 본다).
//   - cages·reactions: 레코드마다 updatedAt 큰 쪽, 동률(또는 둘 다 시각 없음) = 로컬(불변).
//   - animalTypeId = 로컬 우선(로컬이 없을 때만 서버 값).
//   - 한쪽에만 있는 레코드는 그쪽이 이긴다(레코드 삭제 tombstone 없음 — D23 알려진 한계).
//   winner: 병합 결과가 로컬과 다름 = 서버 기여, 서버와 다름 = 로컬 기여. 로컬 기여만 → 'local', 서버만 → 'server',
//     둘 다(항목 병합으로 양쪽 모두와 달라진 레코드 포함) → 'mixed', 0 → 'none'.
//   pushNeeded = 로컬 기여가 하나라도 있음(서버 스냅샷을 바꿔야 함). toLocal = 로컬과 달라진 레코드(병합본).
import { migrateSetup, tidySetup } from '../checklist/setupStore';
import type { CageV1, SaveMergeWinner, SaveReactions, SaveV1, SetupV3 } from './contract';

export interface MergeResult {
  merged: SaveV1;
  /** 로컬에 써야 할 레코드(서버 승 또는 항목 병합본). */
  toLocal: {
    setups: Record<string, SetupV3>;
    cages: Record<string, CageV1>;
    reactions: SaveReactions | null;
    animalTypeId: string | null;
  };
  winner: SaveMergeWinner;
  pushNeeded: boolean;
}

function time(x: unknown): number {
  if (typeof x !== 'string') return Number.NEGATIVE_INFINITY;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** 키 정렬 직렬화 — 내용 동일 비교용. */
function canon(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canon).join(',')}]`;
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function emptyReactions(): SaveReactions {
  return { like: {}, helpful: {}, updatedAt: new Date(0).toISOString() };
}

/** 반응 레코드가 "있다" = 키가 하나라도 있거나, 한 번이라도 바뀐 적(updatedAt > epoch) 있음. */
function hasReactions(r: SaveReactions | null | undefined): r is SaveReactions {
  if (!r) return false;
  return Object.keys(r.like ?? {}).length > 0 || Object.keys(r.helpful ?? {}).length > 0 || time(r.updatedAt) > 0;
}

type Pick2 = 'local' | 'server' | 'same';

function pick<T extends { updatedAt?: string | null }>(l: T | undefined, s: T | undefined): Pick2 {
  if (l === undefined && s === undefined) return 'same';
  if (s === undefined) return 'local';
  if (l === undefined) return 'server';
  if (same(l, s)) return 'same';
  return time(s.updatedAt) > time(l.updatedAt) ? 'server' : 'local';
}

type ItemEvent = { kind: 'check'; t: number; check: SetupV3['checks'][string] } | { kind: 'uncheck'; t: number; at: string };

/** 한쪽 레코드에서 항목 id 의 마지막 사건(체크가 엄밀히 새것일 때만 체크 — tidySetup 과 같은 규칙). */
function lastEvent(s: SetupV3, id: string): ItemEvent | null {
  const c = has(s.checks, id) ? s.checks[id] : undefined;
  const u = has(s.uncheckedAt, id) ? s.uncheckedAt[id] : undefined;
  if (c && (u === undefined || time(c.at) > time(u))) return { kind: 'check', t: time(c.at), check: c };
  if (u !== undefined) return { kind: 'uncheck', t: time(u), at: u };
  return null;
}

function minTime(a: string, b: string): string {
  return time(b) < time(a) ? b : a;
}

function minNonNull(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return minTime(a, b);
}

/**
 * 같은 동물 레코드 둘의 항목 단위 병합(F 계약). 동률은 언제나 로컬(l).
 *   - checks/uncheckedAt: 항목마다 양쪽의 마지막 사건 중 시각이 큰 쪽. 체크면 checks 에, 해제면 uncheckedAt 에.
 *   - firstTime·owned·answeredAt: 답 단위 LWW(answeredAt, null = 가장 옛것).
 *   - startedAt·reached100At: null 아닌 값 중 최솟값. updatedAt: 최댓값(판정에 쓰지 않음).
 *   - 결과는 tidySetup(시각 무관 규칙만 — 90일 정리는 쓰기 시점에) 을 거친다.
 */
export function mergeSetup(l: SetupV3, s: SetupV3): SetupV3 {
  const answer = time(s.answeredAt) > time(l.answeredAt) ? s : l;
  const ids = [...new Set([...Object.keys(l.checks), ...Object.keys(l.uncheckedAt), ...Object.keys(s.checks), ...Object.keys(s.uncheckedAt)])].sort();
  const checks: SetupV3['checks'] = {};
  const uncheckedAt: SetupV3['uncheckedAt'] = {};
  for (const id of ids) {
    const le = lastEvent(l, id);
    const se = lastEvent(s, id);
    const win = le && se ? (se.t > le.t ? se : le) : (le ?? se);
    if (!win) continue;
    if (win.kind === 'check') checks[id] = { source: win.check.source, at: win.check.at };
    else uncheckedAt[id] = win.at;
  }
  return tidySetup({
    v: 3,
    firstTime: answer.firstTime,
    owned: [...answer.owned],
    answeredAt: answer.answeredAt,
    startedAt: minTime(l.startedAt, s.startedAt),
    checks,
    uncheckedAt,
    reached100At: minNonNull(l.reached100At, s.reached100At),
    updatedAt: time(s.updatedAt) > time(l.updatedAt) ? s.updatedAt : l.updatedAt,
  });
}

export function mergeSnapshots(local: SaveV1, server: SaveV1 | null): MergeResult {
  let localWins = 0;
  let serverWins = 0;
  const toLocal: MergeResult['toLocal'] = { setups: {}, cages: {}, reactions: null, animalTypeId: null };

  function mergeRecords<T extends { updatedAt?: string | null }>(
    l: Record<string, T>,
    s: Record<string, T>,
    sink: Record<string, T>,
  ): Record<string, T> {
    const out: Record<string, T> = {};
    const ids = [...new Set([...Object.keys(l), ...Object.keys(s)])].sort();
    for (const id of ids) {
      const lv = has(l, id) ? l[id] : undefined;
      const sv = has(s, id) ? s[id] : undefined;
      const p = pick(lv, sv);
      if (p === 'server' && sv !== undefined) {
        serverWins++;
        sink[id] = sv;
        out[id] = sv;
      } else if (lv !== undefined) {
        if (p === 'local') localWins++;
        out[id] = lv;
      }
    }
    return out;
  }

  /** setups: 항목 단위. 결과는 항상 v3(다음 PUT 에 실리는 서버 v2 레코드도 v3 로 나간다). */
  function mergeSetups(l: Record<string, unknown>, s: Record<string, unknown>): Record<string, SetupV3> {
    const out: Record<string, SetupV3> = {};
    const ids = [...new Set([...Object.keys(l), ...Object.keys(s)])].sort();
    for (const id of ids) {
      const lRaw = has(l, id) ? l[id] : undefined;
      const sRaw = has(s, id) ? s[id] : undefined;
      const lv = lRaw === undefined ? null : migrateSetup(lRaw);
      const sv = sRaw === undefined ? null : migrateSetup(sRaw);
      let m: SetupV3;
      if (lv && sv) m = mergeSetup(lv, sv);
      else if (lv) m = lv;
      else if (sv) m = sv;
      else continue;
      // 승격본 대비 비교 — v2→v3 승격만으로는 쓰기·push 하지 않는다(무효 레코드 = 없음 → 상대 것이 채운다).
      if (!same(m, lv)) {
        serverWins++;
        toLocal.setups[id] = m;
      }
      if (!same(m, sv)) localWins++;
      out[id] = m;
    }
    return out;
  }

  const setups = mergeSetups(local.setups ?? {}, server?.setups ?? {});
  const cages = mergeRecords(local.cages ?? {}, server?.cages ?? {}, toLocal.cages);

  const lr = hasReactions(local.reactions) ? local.reactions : undefined;
  const sr = hasReactions(server?.reactions) ? server?.reactions : undefined;
  let reactions: SaveReactions;
  const rp = pick(lr, sr);
  if (rp === 'server' && sr) {
    serverWins++;
    toLocal.reactions = sr;
    reactions = sr;
  } else {
    if (rp === 'local') localWins++;
    reactions = lr ?? sr ?? local.reactions ?? emptyReactions();
  }

  const la = local.animalTypeId ?? null;
  const sa = server?.animalTypeId ?? null;
  let animalTypeId: string | null = la ?? sa;
  if (la !== null && la !== sa) localWins++;
  else if (la === null && sa !== null) {
    serverWins++;
    toLocal.animalTypeId = sa;
    animalTypeId = sa;
  }

  const winner: SaveMergeWinner =
    localWins > 0 && serverWins > 0 ? 'mixed' : localWins > 0 ? 'local' : serverWins > 0 ? 'server' : 'none';
  return {
    merged: { v: 1, animalTypeId, setups, cages, reactions },
    toLocal,
    winner,
    pushNeeded: localWins > 0,
  };
}
