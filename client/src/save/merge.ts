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
//   R6 D1(SEC-5 · 다동물 감사 #15): 서버와 같은 검증기(@ws/save-validate validateSaveV1)로 보내기 전 스냅샷을 다듬는다.
//   - sanitizeSnapshot: 레코드 단위 사전 검증 — 무효 레코드(setups[id]·cages[id]·animalTypeId·반응 항목)만 버린다.
//     손상 레코드 1개 때문에 PUT 전체가 400 이 되어 동기화가 조용히 멈추지 않게.
//   - fitSnapshot: 32KB(SAVE_MAX_BYTES)·타입 20 상한에 맞춘다. 자르는 순서(정책, 결정적):
//       ⓪ 타입 수 > 20 → 선택 동물 먼저, 그다음 updatedAt 새것 순으로 20 개만
//       ① 해제 tombstone(uncheckedAt) — 모든 동물 통틀어 시각 오래된 것부터(잃으면 다른 기기 옛 체크가 되살아날 수 있을 뿐)
//       ② 반응(like·helpful) — 시각 오래된 것부터
//       ③ 선택하지 않은 동물의 레코드(setups·cages) — 그 동물의 마지막 변경(updatedAt 최댓값)이 오래된 것부터 통째로
//     선택 동물의 checks·답·케이지는 자르지 않는다. 그래도 넘치면 null(보내지 않음 — 서버도 거절할 본문).
//     자르는 것은 보내는 사본뿐 — 로컬 저장소는 그대로다.
import { MAX_REACTIONS, MAX_TYPES, SAVE_MAX_BYTES, isIsoTime, utf8ByteLength, validateSaveV1 } from '@ws/save-validate';
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

// ── R6 D1: 보내기 전 검증·크기 맞춤 ─────────────────────────────────────────

const EMPTY_SNAPSHOT_PART = (): SaveV1 => ({
  v: 1,
  animalTypeId: null,
  setups: {},
  cages: {},
  reactions: { like: {}, helpful: {}, updatedAt: null as unknown as string },
});

/** part 하나만 실은 최소 스냅샷이 서버 검증기를 통과하면 정규화된 값, 아니면 null. */
function accepted(part: Partial<SaveV1>): SaveV1 | null {
  const r = validateSaveV1({ ...EMPTY_SNAPSHOT_PART(), ...part });
  return r.ok ? (r.value as unknown as SaveV1) : null;
}

/** 반응 항목 단위 거르기 — 통과한 키만, 넘치면 시각 새것부터 MAX_REACTIONS 개. */
function sanitizeReactions(r: SaveReactions | null | undefined): SaveReactions {
  const out: SaveReactions = { like: {}, helpful: {}, updatedAt: emptyReactions().updatedAt };
  if (!r || typeof r !== 'object') return out;
  const whole = accepted({ reactions: r });
  if (whole) return { ...whole.reactions, updatedAt: whole.reactions.updatedAt ?? out.updatedAt };
  for (const kind of ['like', 'helpful'] as const) {
    const src = r[kind];
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    const ok = Object.entries(src).filter(([k, v]) => {
      const one = { like: {}, helpful: {}, updatedAt: null as unknown as string, [kind]: { [k]: v } };
      return accepted({ reactions: one }) !== null;
    });
    ok.sort((a, b) => time(b[1]) - time(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [k, v] of ok.slice(0, MAX_REACTIONS)) out[kind][k] = v;
  }
  if (isIsoTime(r.updatedAt)) out.updatedAt = r.updatedAt;
  return out;
}

/**
 * 레코드 단위 사전 검증(서버 검증기와 같은 소스). 통과한 레코드만 남긴 스냅샷 + 버린 레코드 수.
 *   전체가 통과하면 그대로(정규화본). 타입 수·32KB 는 여기서 보지 않는다(fitSnapshot 몫).
 */
export function sanitizeSnapshot(s: SaveV1): { value: SaveV1; dropped: number } {
  const whole = validateSaveV1(s);
  if (whole.ok) return { value: whole.value as unknown as SaveV1, dropped: 0 };
  let dropped = 0;
  let animalTypeId: string | null = null;
  if (s.animalTypeId !== null && s.animalTypeId !== undefined) {
    if (accepted({ animalTypeId: s.animalTypeId })) animalTypeId = s.animalTypeId;
    else dropped++;
  }
  const setups: SaveV1['setups'] = {};
  for (const [id, rec] of Object.entries(s.setups ?? {})) {
    const ok = accepted({ setups: { [id]: rec } });
    if (ok && ok.setups[id]) setups[id] = ok.setups[id];
    else dropped++;
  }
  const cages: SaveV1['cages'] = {};
  for (const [id, rec] of Object.entries(s.cages ?? {})) {
    const ok = accepted({ cages: { [id]: rec } });
    if (ok && ok.cages[id]) cages[id] = ok.cages[id];
    else dropped++;
  }
  const reactions = sanitizeReactions(s.reactions);
  dropped +=
    Object.keys(s.reactions?.like ?? {}).length -
    Object.keys(reactions.like).length +
    Object.keys(s.reactions?.helpful ?? {}).length -
    Object.keys(reactions.helpful).length;
  return { value: { v: 1, animalTypeId, setups, cages, reactions }, dropped };
}

const bytes = (s: SaveV1): number => utf8ByteLength(JSON.stringify(s));

/** 정렬된 후보를 앞에서부터 k 개 지웠을 때 32KB 이하가 되는 최소 k(이진 탐색 — 지울수록 작아진다). 다 지워도 넘치면 n. */
function minDrop(n: number, sizeAfter: (k: number) => number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sizeAfter(mid) <= SAVE_MAX_BYTES) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** 한 동물의 마지막 변경 시각(setup·cage updatedAt 최댓값). */
function typeTime(s: SaveV1, id: string): number {
  return Math.max(time(s.setups[id]?.updatedAt), time(s.cages[id]?.updatedAt));
}

/**
 * 32KB · 타입 20 상한에 맞춘 사본(정책은 파일 머리 주석 ⓪~③). 이미 통과하면 같은 객체.
 *   keepTypeId = 자르지 않을 동물(기본 = 스냅샷의 animalTypeId). 다 잘라도 넘치면 null.
 */
export function fitSnapshot(s: SaveV1, keepTypeId: string | null = s.animalTypeId): SaveV1 | null {
  if (validateSaveV1(s).ok) return s;
  let cur: SaveV1 = { ...s, setups: { ...s.setups }, cages: { ...s.cages }, reactions: { ...s.reactions } };

  // ⓪ 타입 수 상한
  const rank = (ids: string[]): string[] =>
    [...ids].sort((a, b) => (a === keepTypeId ? -1 : b === keepTypeId ? 1 : typeTime(cur, b) - typeTime(cur, a) || (a < b ? -1 : 1)));
  for (const field of ['setups', 'cages'] as const) {
    const ids = Object.keys(cur[field]);
    if (ids.length <= MAX_TYPES) continue;
    const keep = new Set(rank(ids).slice(0, MAX_TYPES));
    const next: Record<string, unknown> = {};
    for (const id of ids) if (keep.has(id)) next[id] = cur[field][id];
    cur = { ...cur, [field]: next };
  }
  if (validateSaveV1(cur).ok) return cur;

  // ① tombstone — 전 동물 통틀어 오래된 것부터
  const tombs: Array<[string, string, number]> = [];
  for (const [typeId, rec] of Object.entries(cur.setups)) {
    for (const [itemId, t] of Object.entries(rec.uncheckedAt ?? {})) tombs.push([typeId, itemId, time(t)]);
  }
  tombs.sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const withoutTombs = (base: SaveV1, k: number): SaveV1 => {
    if (k === 0) return base;
    const gone = new Map<string, Set<string>>();
    for (const [typeId, itemId] of tombs.slice(0, k)) {
      let set = gone.get(typeId);
      if (!set) gone.set(typeId, (set = new Set()));
      set.add(itemId);
    }
    const setups: SaveV1['setups'] = {};
    for (const [typeId, rec] of Object.entries(base.setups)) {
      const g = gone.get(typeId);
      if (!g) {
        setups[typeId] = rec;
        continue;
      }
      const uncheckedAt: Record<string, string> = {};
      for (const [itemId, t] of Object.entries(rec.uncheckedAt)) if (!g.has(itemId)) uncheckedAt[itemId] = t;
      setups[typeId] = { ...rec, uncheckedAt };
    }
    return { ...base, setups };
  };
  {
    const base = cur;
    cur = withoutTombs(base, minDrop(tombs.length, (k) => bytes(withoutTombs(base, k))));
  }
  if (validateSaveV1(cur).ok) return cur;

  // ② 반응 — 오래된 것부터
  const reacts: Array<['like' | 'helpful', string, number]> = [];
  for (const kind of ['like', 'helpful'] as const) {
    for (const [k, t] of Object.entries(cur.reactions[kind] ?? {})) reacts.push([kind, k, time(t)]);
  }
  reacts.sort((a, b) => a[2] - b[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const withoutReacts = (base: SaveV1, k: number): SaveV1 => {
    if (k === 0) return base;
    const gone = new Set(reacts.slice(0, k).map(([kind, key]) => `${kind}\u0000${key}`));
    const like: Record<string, string> = {};
    const helpful: Record<string, string> = {};
    for (const [key, t] of Object.entries(base.reactions.like)) if (!gone.has(`like\u0000${key}`)) like[key] = t;
    for (const [key, t] of Object.entries(base.reactions.helpful)) if (!gone.has(`helpful\u0000${key}`)) helpful[key] = t;
    return { ...base, reactions: { ...base.reactions, like, helpful } };
  };
  {
    const base = cur;
    cur = withoutReacts(base, minDrop(reacts.length, (k) => bytes(withoutReacts(base, k))));
  }
  if (validateSaveV1(cur).ok) return cur;

  // ③ 선택하지 않은 동물 레코드 — 마지막 변경이 오래된 동물부터 통째로
  const others = [...new Set([...Object.keys(cur.setups), ...Object.keys(cur.cages)])]
    .filter((id) => id !== keepTypeId)
    .sort((a, b) => typeTime(cur, a) - typeTime(cur, b) || (a < b ? -1 : 1));
  for (const id of others) {
    const setups = { ...cur.setups };
    const cages = { ...cur.cages };
    delete setups[id];
    delete cages[id];
    cur = { ...cur, setups, cages };
    if (validateSaveV1(cur).ok) return cur;
  }
  return null;
}
