// 저장(이메일 연결) 계약 — 타입·인터페이스만(계약 C-R5-1 · C-R5-2 클라 측 · C-R5-9). 런타임 코드 0.
//   - 로컬 레코드 모양(ws.setup v2 · ws.context.{typeId}.cage v1 · ws.reactions v1 · ws.save v1)과
//     서버 스냅샷 SaveV1(GET/PUT /api/save 본문)의 클라 측 타입을 한곳에 둔다.
//   - 불변식 ⑧: 어떤 레코드에도 이메일·토큰·세션 id·좌표·지역·자유 질의 필드가 없다(키 이름은 lib/storage 가 강제).
//   - 병합은 클라만(setups = 항목 단위 SetupV3 규칙, 그 외 레코드마다 updatedAt 큰 쪽, 동률 로컬, animalTypeId 로컬 우선) — merge.ts.

/** 체크 출처. PURCHASED = L4 [준비했어요]. */
export type ReadySource = 'OWNED' | 'PURCHASED' | 'UNKNOWN';

export interface SetupCheck {
  source: ReadySource;
  at: string;
}

/** ws.setup.{typeId} v2 = v1 + updatedAt(모든 변경 시 갱신, D6). */
export interface SetupV2 {
  v: 2;
  firstTime: boolean | null;
  owned: string[];
  /** null = L3 전. */
  answeredAt: string | null;
  startedAt: string;
  checks: Record<string, SetupCheck>;
  reached100At: string | null;
  updatedAt: string;
}

/**
 * ws.setup.{typeId} v3(레인 F 계약) = v2 필드 그대로 + uncheckedAt(항목 해제 tombstone: id → 해제 시각 ISO).
 *   키 순서 = 서버 검증기 계약 순서(checks 다음 uncheckedAt). 병합은 항목 단위(merge.ts mergeSetup):
 *   - 항목마다 max(checks[id].at, uncheckedAt[id]) 이 이김, 동률 로컬.
 *   - owned·firstTime·answeredAt = 답 단위 LWW(answeredAt). startedAt·reached100At = null 아닌 값 중 최솟값.
 *   - updatedAt = 사용자 변경 시각 최댓값(병합 판정에 쓰지 않음).
 *   - tombstone 정리(쓰기 시): 같은 id 의 더 새 체크가 있으면 제거, 90일 초과 제거, 200 상한 초과 시 오래된 것부터.
 */
export interface SetupV3 {
  v: 3;
  firstTime: boolean | null;
  owned: string[];
  /** null = L3 전. */
  answeredAt: string | null;
  startedAt: string;
  checks: Record<string, SetupCheck>;
  uncheckedAt: Record<string, string>;
  reached100At: string | null;
  updatedAt: string;
}

export type CageType = 'LIVING_BOX' | 'WIRE' | 'ACRYLIC' | 'OTHER';

/** ws.context.{typeId}.cage v1(D7). barGapMm 은 WIRE 만. 값 범위 = cage specSchema. 삭제 = 키 삭제. */
export interface CageV1 {
  v: 1;
  type: CageType;
  floorWcm: number;
  floorDcm: number;
  heightCm: number;
  barGapMm?: number;
  updatedAt: string;
}

/** ws.reactions v1(D8) — 👍(helpful)·⚠(recheck) 독립 토글. key → 누른 시각. */
export interface ReactionsV1 {
  v: 1;
  /** productId → iso */
  like: Record<string, string>;
  /** "SUPPLY_ITEM:"+id → iso */
  helpful: Record<string, string>;
  /** 로컬 전용(D22 — 저장 대상 아님). */
  recheck: Record<string, string>;
  updatedAt: string;
}

/** 스냅샷에 실리는 반응(recheck 제외, D22). */
export type SaveReactions = Pick<ReactionsV1, 'like' | 'helpful' | 'updatedAt'>;

/** ws.save v1 — 연결 여부·마지막 동기화 시각만(이메일·토큰·세션 id 금지). */
export interface SaveStateV1 {
  v: 1;
  linked: boolean;
  lastSyncAt: string | null;
  /** SEC-3 L-3: 연결 해제 DELETE /auth/session 이 서버에 닿지 않음 → 부팅·L8 열 때 다시 보낸다. 있으면 항상 true. */
  pendingLogout?: true;
}

/** 서버 스냅샷(C-R5-2). typeId = slug, 타입 ≤ 20, checks ≤ 200 — 서버 검증기가 강제. */
export interface SaveV1 {
  v: 1;
  animalTypeId: string | null;
  /** 보내는 쪽은 항상 v3. 받는 서버본은 v2 일 수 있다 — mergeSnapshots 가 읽을 때 v3 로 승격. */
  setups: Record<string, SetupV3>;
  cages: Record<string, CageV1>;
  reactions: SaveReactions;
}

/** GET /api/save 응답 · PUT 409 본문의 지금 서버본. */
export interface SaveGetResponse {
  snapshot: SaveV1 | null;
  updatedAt: string | null;
}

/**
 * PUT /api/save 본문(H1 낙관적 동시성). baseUpdatedAt = 마지막으로 본 서버 행의 updatedAt(GET·PUT 200·409 응답), 행 없음 = null.
 *   서버 응답: 200 {updatedAt} | 409 {error:'conflict', snapshot, updatedAt}(지금 서버본) | 428(baseUpdatedAt 없음) | 400 | 401 | 413 | 415 | 429.
 */
export interface SavePutRequest {
  snapshot: SaveV1;
  baseUpdatedAt: string | null;
}

/** PUT 결과(클라 측). updatedAt = 200 의 새 행 시각, current = 409 의 지금 서버본. status 0 = 네트워크 오류. */
export interface SavePutResult {
  status: number;
  updatedAt?: string;
  current?: SaveGetResponse;
}

/** 병합 결과(save_merge 이벤트 winner). */
export type SaveMergeWinner = 'local' | 'server' | 'mixed' | 'none';

export type SaveableKey = 'setups' | 'cages' | 'reactions' | 'animalType';

/**
 * 스냅샷 한 조각을 맡는 로컬 저장소(C-R5-9). setupStore·cageStore(FE2), reactionStore(FE1).
 *   export = 지금 로컬 값(검증된 것만) · import = 검증 후 로컬에 쓴다(무효 레코드는 건너뜀, 없는 레코드는 그대로 — D23)
 *   subscribe = 이 조각이 바뀔 때마다 호출(같은 탭 + 다른 탭). 반환 = 해제.
 */
export interface Saveable<P> {
  readonly key: SaveableKey;
  export(): P;
  import(p: P): void;
  subscribe(fn: () => void): () => void;
}

/** 조각별 페이로드 타입. */
export interface SavePayloads {
  setups: SaveV1['setups'];
  cages: SaveV1['cages'];
  reactions: SaveReactions;
  animalType: string | null;
}
