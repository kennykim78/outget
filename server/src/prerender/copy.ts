// 프리렌더 고정 UI 카피(시드 사실 아님). 원본: UX-기획.md v2.3.1 §3.1·§4·§7, 디자인-브리프.md 카피 규칙,
// 제품기획 §6.3, PRD US-001·US-014(병원 빈 상태). 사육·규격·의료 사실은 여기 두지 않는다(시드 → resolveRequirement).
// 금지어(불변식 5)·브리프 금지 표현·의료 단정 0 은 prerender.primitives.test.ts 가 lintText 로 강제.
// 빈 상태 문구는 오케스트레이터 결정(결정 매트릭스) — `_workspace/19_backend_r3_laneF1.md` 표.

import type { AnimalGroup } from '../engine/domain.js';

const SENTENCES = new Set<string>();
/** 문장형 문구 등록("~요" 존댓말 검사 대상). 값은 그대로 돌려준다. */
function sent<T extends string>(s: T): T {
  SENTENCES.add(s);
  return s;
}

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

function deepFreeze<T>(o: T): DeepReadonly<T> {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(o);
  }
  return o as DeepReadonly<T>;
}

/** 친구 선택 질문 — 홈 선택 바와 L1 제목이 같은 문장을 쓴다(286 U4: L1 제목 「어떤 친구인가요?」 대체). */
const PICK_QUESTION = '어떤 친구와 함께하나요?';

export const COPY = deepFreeze({
  site: {
    name: 'WithSmall',
    homeTitle: 'WithSmall — 작은 친구의 첫 준비',
    titleSuffix: ' — WithSmall',
    description: sent('작은 반려동물을 처음 맞을 때, 지금 필요한 것과 아직 필요 없는 것을 종별 기준으로 정리해 드려요.'),
    typeTitle: '{animal} 준비 — 지금 필요한 것과 규격',
    typeDescription: sent('{animal} 준비에 지금 필요한 것과 아직 필요 없는 것을 종별 기준으로 정리해 드려요.'),
  },
  nav: {
    logo: 'WithSmall',
    /** 헤더 CTA(미선택) — R3 시안 v1b 헤더 「친구 선택하기」(U2b, D1: 선택되면 같은 자리가 동물 칩). */
    chooseFriend: '친구 선택하기',
    changeFriend: '친구 바꾸기',
    /** /supplies 본문 링크 라벨(misc.ts 홈 외 본문) — 헤더 메뉴 라벨은 menuSupplies. */
    supplies: '용품 찾기',
    /** 헤더 메뉴 3(R3·R4 시안: 준비물 · 크기 확인 · 병원, U2b). */
    menuSupplies: '준비물',
    menuSpecCheck: '크기 확인',
    vet: '병원',
    /** 모바일(≤767) 메뉴 단추(R4 시안 「메뉴」, D2: 하단 탭바 대신). */
    menu: '메뉴',
    /** 메뉴 목록(nav) 접근 이름. */
    menuLabel: '주 메뉴',
    seeAll: '전체',
    skipToMain: '본문으로 건너뛰기',
  },
  /** 홈 A(동물 미선택) — R3 승인 시안 v1b(286 U3a): 히어로(큰 한 문장 + 부제 + 선택 바) … 하단 CTA. 후기·소개 섹션 없음(D6). */
  homeA: {
    heroTitle: '작은 친구와의 시작, 꼭 필요한 것부터',
    heroSub: sent('준비물부터 크기까지, 함께 골라요.'),
    /** 히어로 선택 바(입력 아님 — /pick 링크, 하이드레이션 후 L1). L1 제목(picker.title)과 같은 문장(286 U4 통일). */
    heroBar: PICK_QUESTION,
    reviewsTitle: '실제 이용 후기 — 이용이 확인된 분들만',
    reviewVerifiedChip: '이용 확인',
    startTitle: sent('어떤 친구와 함께하나요?'),
    startBody: sent('작은 친구와의 첫날, 필요한 것부터 함께 골라요.'),
    startCta: '친구 선택하기',
    /**
     * 286 U3b 「처음 준비, 여기서 시작해요」 시작 카드 3 — 고정 UI 문구(수치·품목명 없음, 종 공통).
     *   대상: CHECKLIST → /{slug}(L2) · SPEC_CHECK → /{slug}/check/{item}(L5) · SETUP → /{slug}/setup. 미선택이면 L1 경유(intent.ts).
     */
    startersTitle: '처음 준비, 여기서 시작해요',
    starters: {
      CHECKLIST: { title: '꼭 필요한 것 먼저', sub: '우리 친구에게 필요한 준비물' },
      SPEC_CHECK: { title: '크기 확인', sub: '준비물 크기를 숫자로' },
      SETUP: { title: '구성안', sub: '한눈에 보는 첫 준비' },
    },
    /**
     * 286 U3c·U3d·U3e 설명 섹션(R3 시안 v1b 순서: 필요/불필요 → 숫자 → 함께 살 집 → 병원) — 고정 UI 문구만. 품목명·숫자·동물·병원은
     *   전부 ws-data(시드 노출 값)에서 오고(engine home-a.ts), 데이터가 없으면 섹션 자체가 없다(D12 ①). {animal} = 대표 타입 표시명.
     */
    needEyebrow: '{animal} 첫 준비 예시',
    needTitle: sent('지금 필요 없는 것도 알려 드려요'),
    needBody: sent('처음부터 모두 갖출 필요는 없으니까요. 우리 친구와 지금의 준비에 맞춰 골라요.'),
    needLink: '필요한 것부터 살펴보기',
    needCol: sent('필요해요'),
    notNowCol: sent('지금은 필요 없어요'),
    figuresTitle: sent('숫자로 알려 드려요'),
    figuresSub: '눈대중 대신, 몸에 맞는 크기로.',
    figuresEyebrow: '{animal} 예시',
    figuresLink: '내 준비물 크기 확인하기',
    habitatsTitle: sent('함께 살 집을 살펴봐요'),
    habitatsLead: sent('먹고, 쉬고, 움직이는 공간이에요.'),
    vetTitle: sent('진료하는 병원만 보여 드려요'),
    vetSub: sent('우리 친구를 진료하는 곳을 찾아요.'),
    /** {name} = vetGroups.* 표시명. 행 오른쪽 = 그 그룹 노출 타입 중 노출 병원이 진료하는 것(이름 · 구분). */
    vetRow: '{name} 진료 병원',
    /**
     * 287 S4(Kenny 2026-11-16 결정 4) — 병원 행 그룹명 전용. 진료 구분은 「조류」(앵무새 외 조류 진료와 같은 말).
     *   L1·404·그룹 페이지는 COPY.groups(「앵무새」) 그대로(F3 — 범위 밖). AnimalGroup 누락 = 타입 오류.
     */
    vetGroups: { SMALL_MAMMAL: '소동물', PARROT: '조류' } satisfies Record<AnimalGroup, string>,
    popularTitle: '요즘 많이 찾는 준비',
    /** R4 C1 — 클라이언트 전용(프리렌더 미사용). */
    continueLink: '이어서: {animal}',
    reviewPause: '멈추기',
    reviewResume: '다시 흐르게 하기',
    reviewAction: {
      CHECKLIST: '내 준비 확인해보기',
      SPEC_CHECK: '규격 확인해보기',
      SETUP: '처음 준비 구성안 보기',
      VET: '동네 병원 보기',
    },
  },
  /** R4 C1 — 가로 레일 이전/다음 버튼. */
  rail: { prev: '이전 보기', next: '다음 보기' },
  /** R4 C1 — 구성안 카드 개수. */
  bundle: { itemCount: '{n}개', newCount: '새로 {n}개' },
  /** UX §3.1 B — 동물 선택: 컨텍스트 헤더 + 5섹션. 숫자는 L3 이후(D18) — 프리렌더는 nowBeforeSetup 만. */
  /**
   * 홈 B(동물 선택) — R4 시안 home_selected(R4-2): 컨텍스트 헤더(눈썹·이름·바꾸기) → 지금 필요한 것(요약 카드 + 남은 항목 카드)
   *   → 나중에 필요한 것(NOT_NOW 시드 레코드) → 처음 준비한다면(구성안 레일) → {용품} 규격 확인(최소 규격 숫자 = 엔진 minSpecFigure)
   *   → 기준에 맞는 준비물(상품 레일) → 병원(카드 레일 또는 빈 안내) → 저장 안내. R4-2b 에서 PRD US-003 섹션 복원.
   *   숫자·품목명은 전부 ws-data(시드 → resolveRequirement)에서 — 여기엔 고정 UI 문구만.
   */
  homeB: {
    contextEyebrow: '함께하는 친구',
    /** 컨텍스트 헤더 「바꾸기」(보이는 글자) — 접근 이름은 nav.changeFriend(보이는 글자를 포함). */
    change: '바꾸기',
    nowTitle: '지금 필요한 것',
    nowLead: sent('남은 준비부터 하나씩 살펴봐요.'),
    nowCardTitle: '꼭 필요한 것 먼저',
    nowBeforeSetup: sent('필수 준비를 먼저 확인해요'),
    /** R4 C1 — 클라이언트 전용(L3 이후 숫자). */
    nowCount: sent('필수 {total}가지 중 {n}가지가 남았어요.'),
    nowCta: '남은 준비 {n}개 살펴보기',
    /** L3 전·판정 대기 중 주 버튼(숫자 없음). */
    nowCtaStart: '지금 필요한 것 보기',
    /** 모바일 줄 — 아직 준비 중인 필수 항목 이름 앞 라벨(준비완료 줄은 ✓ 글리프 + 숨김 라벨). */
    nowPendingLabel: '아직 준비 중',
    nowEmpty: sent('검수를 마친 준비 목록을 정리하고 있어요'),
    laterTitle: '나중에 필요한 것',
    /** 홈 B 구성안 레일 제목 · 구성안 페이지(/setup) 제목(R4-2b — PRD US-003 ③ 복원). */
    bundlesTitle: '처음 준비한다면',
    /** 홈 B 상품 레일 제목(R4-2b — PRD US-003 ④ 복원). 노출 상품 0 이면 섹션 없음. */
    productsTitle: '기준에 맞는 준비물',
    specTitle: '{name} 규격 확인',
    specBasis: '{animal} 기준',
    specMine: '내 {name} 확인하기',
    /** {animal} = objectParticle(표시명) — 「골든햄스터를」. */
    vetTitle: '{animal} 진료하는 병원',
    vetLead: sent('지역을 고르면 확인된 병원을 보여 드려요.'),
    vetAsk: sent('방문 전 진료 여부를 병원에 문의해 주세요.'),
    vetLink: '지역으로 병원 찾기',
    /** R4-2b(Kenny 11-14) — 이 동물을 진료하는 노출 병원 0(시드 SLOT 뿐)일 때. 허구 병원 0. */
    vetEmpty: sent('확인된 병원이 아직 없어요'),
    saveTitle: sent('준비한 내용을 이어서 볼까요?'),
    saveLink: '이메일로 저장하기',
    /** DR-5 MINOR-2 — 연결 상태 저장 안내 링크(홈 B 링크 관례: › 없음). */
    saveLinked: '이 기기와 메일에 저장되고 있어요',
    doneLine: sent('필수 준비가 끝났어요 — 권장 항목도 볼까요?'),
    doneCta: '권장 항목 보기',
    /** L1 후보 별칭 줄(AnimalPicker·프리렌더 /pick 공용). */
    aliasLine: sent('{alias}라고도 불러요'),
    /** L2 기기 저장 안내(ChecklistLayer). */
    deviceOnly: sent('이 기기에만 저장돼요'),
  },
  /** R4 C1 — L1 친구 선택(스펙22 §7.3). 후보 안내일 뿐 종을 확정하지 않는다(브리프 고정 문구). */
  picker: {
    /** L1 레이어 제목 — /pick 정적 aside·layerRegistry 공용. 홈 선택 바(homeA.heroBar)와 한 문장(286 U4). */
    title: PICK_QUESTION,
    /** 그룹 단계 부제·다음 안내·주 버튼(R3 L1 시안 + R4 fix). {name} = 그룹 표시명(groups.*). */
    groupsLead: sent('함께할 친구에게 맞춰 준비해요.'),
    groupsNext: sent('다음 단계에서 세부 종을 골라요.'),
    groupCta: '{name} 친구 고르기',
    unsure: '잘 모르겠어요',
    searchHint: sent('이름이나 별명으로 찾아 드려요'),
    candidateNote: sent('후보 안내일 뿐, 종을 확정하지 않아요'),
    confirm: sent('이 친구가 맞아요'),
    backToGroups: '‹ 그룹 선택',
    /** P1 MINOR-7 — '잘 모르겠어요' 일치 0건(PLANNED 일치일 때만 planned.title). */
    noMatch: sent('찾는 친구가 아직 없어요. 지금은 그룹에서 고를 수 있는 친구만 준비를 도와드려요'),
  },
  /** R4 C1 — L3 두 질문(처음 키워요 / 이미 키우고 있어요). */
  setupQ: {
    q1Title: sent('처음 키우나요?'),
    q2Title: sent('이미 가진 게 있나요?'),
    firstTime: '처음 키워요',
    already: '이미 키우고 있어요',
    owned: '이미 가진 것',
    skip: '건너뛰기',
    next: '다음',
  },
  /** R4 C1 — L2 체크리스트(PRD US-005). 권장 안내·저장 불가 안내는 PRD 원문이 없어 작성. */
  checklist: {
    /** 286 U6(R3 체크리스트 시안) — L2 스텝 레이어 제목·머리 제목·부제·남은 개수·주 버튼. 클라이언트 전용(프리렌더 미사용). */
    layerTitle: '준비 체크리스트',
    lead: '꼭 필요한 것 먼저',
    leadSub: sent('{animal}의 첫 준비예요.'),
    requiredLeft: sent('꼭 필요한 것 {n}개 남았어요'),
    /** 필수 항목이 0개인 타입(ZERO) — 「0개 남았어요」 대신. */
    requiredNone: sent('이 친구는 꼭 필요한 항목이 따로 없어요'),
    nextCta: '남은 준비물 살펴보기',
    summaryTitle: '오늘 바로 데려와도 되는 준비',
    requiredDone: '필수 준비 끝',
    recommendedNote: sent('권장 항목도 살펴보세요'),
    resetSetup: '내 상황 다시 설정',
    saveAsk: sent('지금 준비 상태를 저장해 둘까요?'),
    /** 레인 0(51_architect_persona_fix) — 저장 연결 상태 링크. 링크 관례(›, sent 아님)는 compatRegisterLink와 동일. */
    saveLinked: '이 기기와 메일에 저장되고 있어요 ›',
    storageUnavailable: sent('이 기기에 저장할 수 없어요. 지금 화면에서만 유지돼요'),
    itemDetailAria: '{name} 자세히',
    owned: '보유',
  },
  /** 상태 라벨(문장 아님). 글리프 문자는 GLYPH(later 는 글리프 없음 — 단어만). 판정 단어는 L5(verdict.markOk·productBelowMin·markNone·markInput)와 같다. */
  glyphLabel: {
    ok: '기준 충족',
    ready: '준비완료',
    first: '먼저 준비',
    check: '확인 필요',
    later: '나중에',
    fail: '최소 규격 미달',
    none: '기준 없음',
    unknown: '입력 필요',
  },
  /** UX §4 L4 — 섹션 순서 고정: 왜 → 조건 → 주의 → 피할 것 → 대안. */
  supplyLayer: {
    why: '왜',
    conditions: '조건',
    min: '최소',
    recommended: '권장',
    caution: '주의',
    avoid: '피할 것',
    alternatives: '대안',
    checkSpec: '규격 확인',
    findWithCondition: '이 조건으로 찾기',
    findCoupang: '이 조건으로 쿠팡에서 찾기',
    findNaver: '이 조건으로 네이버에서 찾기',
    /** R4-3(R4 시안 affiliate_candidates): 렌더 필터를 통과한 상인 링크가 0개일 때 비활성 상인 버튼 라벨(시안 원문). */
    merchantPending: '상인 링크 준비 중',
    lastVerified: '마지막 검수',
    matchingProducts: '이 항목에 맞는 준비물',
    alternativesNote: sent('이것 대신 아래 용품으로도 구성할 수 있어요'),
    searchKeyword: '검색어',
    source: '출처',
    notNow: sent('지금은 필요 없어요'),
    close: '닫기',
    /** R5 C1 — L4 확장(스펙33 §5.1·§9). 검색 블록 라벨은 findWithCondition 재사용. */
    searchCopyAria: '검색어 복사',
    searchCopied: sent('복사했어요'),
    compatSubLabel: '내 케이지 기준',
    compatSubNote: sent('용품의 최소 규격을 넣어 본 결과예요'),
    /** 155 안 A(작업 177 디자인 확정): requirementCompat.usedRecommended 일 때 compatSubNote 대신(클라이언트 분기 SupplyLayer.tsx, 작업 179). */
    compatSubNoteRecommended: sent('최소 규격이 정하지 않은 값은 권장 규격을 넣어 본 결과예요'),
    compatRegisterLink: '내 케이지를 등록하면 맞는지 알려 드려요 ›',
    cageEntryRegister: '내 케이지 등록 ›',
    cageEntryEdit: '내 케이지 수정 ›',
    markReady: '준비했어요',
    /** R4-4(R4 시안 l4_supply): 검수 행(마지막 검수 · 출처 · 👍⚠) 섹션 머리 — 시안 원문. */
    reviewTitle: '검수 내용',
  },
  /** R5 C1 — L5 VerdictCard 판정 표시(스펙33 §3). 판정어는 정보일 뿐 추천 아님. 헤드라인 숫자는 표시 함수가 "최소 {v}{u} · 입력 {a}{u}"로 조립. */
  verdict: {
    productLine: '제품 규격',
    compatLine: '내 환경 호환',
    resultRegion: '판정 결과',
    overall: '종합',
    basisSuffix: '기준',
    min: '최소',
    recommended: '권장',
    input: '입력',
    productOk: '권장 기준까지 충족',
    productBelowRecommended: '최소 기준 충족 · 권장 미만',
    productBelowMin: '최소 규격 미달',
    productCheck: '판정할 정보가 더 필요해요',
    /** arch-23 A6 — 종별 규격 기준 없음(엔진 isNoCriteria). 사유 문장은 엔진 Reason.message 를 그대로 쓴다. */
    productNoCriteria: '종별 규격 기준 없음',
    compatOk: '현재 케이지에서 사용 가능한 조건',
    compatCheck: '공간 조건 재확인',
    compatBelowMin: '현재 케이지 조건에서 최소 요구 미충족',
    compatNoCage: sent('내 케이지를 등록하면 호환도 알려 드려요'),
    compatNoCageLink: '내 케이지 등록 ›',
    compatNoRule: sent('이 용품은 케이지와 따로 맞춰 볼 조건이 없어요'),
    fixedNote: sent('판정은 입력한 값과 종별 기준을 비교한 결과예요'),
    moreReasons: '그 밖에 {n}개',
    yes: '예',
    no: '아니오',
    /**
     * 286 U5b — L5 결과 상태(R4 fix 4상태 규칙표: ○ 기준 충족 · △ 확인 필요 · ✕ 조금 작아요 · — 기준 없음).
     *   판정 계산은 엔진만. 숫자는 Reason.expected/actual·해석된 minSpec 값에서만(불변식 ⑥). 「기준 검수 대기」 문구 없음(⑦ VERIFIED만 노출).
     */
    markOk: '기준 충족',
    markCheck: '확인 필요',
    markSmall: '조금 작아요',
    markNone: '기준 없음',
    markInput: '입력 필요',
    titleOk: sent('{name} 기준을 충족해요'),
    titleBelowRecommended: sent('최소 기준은 충족하고 권장에는 못 미쳐요'),
    titleSmall: sent('{name} 크기가 최소 기준보다 작아요'),
    titleBelowMin: sent('{name} 최소 기준에 맞지 않는 항목이 있어요'),
    titleNoCriteria: sent('{animal} 기준값이 없는 용품이에요'),
    /** 제품 단은 충족인데 내 케이지 호환이 CHECK·BELOW_MIN 일 때의 제목(성공 문장 금지). 제품 미달 제목은 그대로. */
    titleOkCompatCheck: sent('{name} 크기는 충족해요, 케이지와는 확인이 필요해요'),
    titleOkCompatBelowMin: sent('{name} 크기는 충족해요, 케이지와는 맞지 않는 조건이 있어요'),
    titleBelowRecommendedCompatCheck: sent('최소 기준은 충족해요, 케이지와는 확인이 필요해요'),
    titleBelowRecommendedCompatBelowMin: sent('최소 기준은 충족해요, 케이지와는 맞지 않는 조건이 있어요'),
    /** 「최소 {필드명}」 — 숫자 규칙이 여럿이면 minSpecLabel. */
    minOf: '최소 {name}',
    minSpecLabel: '최소 규격',
    mine: '내 {name}',
    /** 차이 줄 — {n} = Reason.expected − Reason.actual(표시용 뺄셈만), {unit} = specSchema 라벨 단위. */
    shortBy: sent('최소 {name}보다 {n}{unit} 작아요'),
    reenter: '다시 입력하기',
    seeBasis: '{name} 기준 살펴보기',
    /** D6-B(Kenny 2026-11-14) — L5 결과 아래 승인 후기 1건의 제목. 후기가 0건이면 제목째 그리지 않는다(빈 상태 문구 없음). */
    reviewTitle: '크기 확인에 도움 된 점',
  },
  /** R5 C1 — L6 내 케이지(PRD US-010). 필드 라벨은 cage specSchema(시드)가 정한다. */
  cage: {
    title: '내 케이지',
    basis: '내 케이지 기준',
    edit: '수정',
    register: '등록',
    save: '저장',
    delete: '등록 지우기',
    deviceOnly: sent('이 기기에만 저장돼요'),
    /** DR m-2 — L6 범위 밖 입력 안내. */
    outOfRange: sent('입력할 수 있는 범위를 벗어났어요'),
    backTo: '‹ {name}',
    stepSpecCheck: '크기 확인',
    stepNow: '지금 필요한 것',
    /**
     * R4-5(R4 시안 l6_my_cage) — 등록한 케이지 보기(케이지가 있을 때 L6 첫 화면). 숫자는 저장값·해석된 minSpec·엔진 결과만(⑥).
     *   자체 최소 규격(케이지 vs 동물 최소, engine.specCheck 제품 단) ≠ 용품 간 호환(engine.requirementCompat).
     */
    registeredTitle: '등록한 케이지',
    floorLabel: '바닥 가로 × 세로',
    editCta: '등록값 수정하기',
    /** 자체 최소 규격 OK 제목(시안 원문 「케이지 최소 규격 충족」). {name} = 케이지 용품명(시드). 그 밖 판정은 L5 verdictTitle 재사용. */
    selfOk: '{name} 최소 규격 충족',
    selfNote: sent('표시한 치수 기준만 비교한 결과예요.'),
    /** 용품 간 호환 제목 — {name} = 용품명 + 와/과(comitativeParticle). CHECK 는 시안 원문, BELOW_MIN 은 L5 「케이지와는 맞지 않는 조건이 있어요」와 같은 말. */
    compatCheckTitle: '{name} 함께 확인해요',
    compatBelowMinTitle: '{name} 맞지 않는 조건이 있어요',
    /** R4-8(R4 시안 states_board) — L6 빈 상태(케이지 없음): 폼 위 머리 + 저장 버튼 문구. */
    emptyTitle: '등록한 케이지가 없어요',
    emptyBody: sent('케이지 크기를 입력하면 기준에 맞는지 함께 확인할 수 있어요.'),
    emptyCta: '케이지 등록하기',
    /** R4-8 — L6 등록값 보기의 판정(카탈로그) 불러오는 중 · 실패. 진행률 숫자 없음. */
    loadingTitle: '함께 쓸 수 있는지 확인 중이에요',
    loadingBody: sent('등록한 케이지와 준비물의 호환 조건을 불러오고 있어요.'),
    loadingWait: sent('잠시만 기다려 주세요.'),
    loadFailTitle: '호환 정보를 불러오지 못했어요',
    loadFailBody: sent('입력한 크기는 그대로 남아 있어요. 잠시 후 다시 시도해 주세요.'),
    retry: '다시 시도하기',
  },
  /** R5 C1 — 반응(PRD US-015; 스펙33 §2.3). 숫자는 R5 미표시(키 없음). */
  reaction: {
    helpful: '도움됐어요',
    recheck: '다시 확인해 주세요',
    recheckThanks: sent('알려 주셔서 고마워요'),
    like: '마음에 들어요',
  },
  /** UX §4 L5 — 프리렌더는 정적 폼만(판정은 클라이언트). */
  checkLayer: {
    /** 286 U5a — 제목행 「크기 확인」(R3 시안). 페이지 <title>·경로 표시는 「크기 확인 · {용품}」. */
    title: '크기 확인',
    /** 286 U5a — 입력 상태 큰 문장. {name} = 용품명(시드). */
    ask: sent('{name} 규격을 알려 주세요'),
    noScript: sent('판정은 자바스크립트를 켜면 할 수 있어요'),
    submit: '확인하기',
    /** 스펙22 §4-4 — specSchema optional 필드 라벨 뒤 " · 선택". */
    optional: '선택',
    unavailable: '지금은 판정할 수 없어요. 잠시 뒤 다시 열어 주세요',
  },
  /** UX §4 L7 · §5 — 가격·판매처 없음, "구매" 단어 없음. */
  product: {
    badge: '기준 충족',
    /** 스펙22 §4-2 — imageAsset 없을 때 대체 타일 라벨(브리프). */
    imagePending: '이미지 준비 중',
    reasonsTitle: 'WithSmall 추천 이유',
    findWithCondition: '이 조건으로 찾기',
    /** R5 C1 — L7(스펙33 §5.4). 템플릿: {animal}·{name}(=용품명). */
    reasonSpecRecommended: '{animal} 권장 규격 충족',
    reasonSpecMinimum: '{animal} 최소 규격 충족',
    reasonProfileTpl: '{name} 요구사항과 일치',
    reasonCageOk: '내 케이지와 호환',
    reasonCageCheck: '내 케이지 공간 조건 재확인',
    reasonCageBelowMin: '내 케이지 조건에서 최소 요구 미충족',
    likeAria: '마음에 들어요',
    supplyBasisLink: '{name} 기준 보기 ›',
    priceNote: sent('가격·판매처는 검색 결과에서 확인해요'),
  },
  /**
   * 259 제휴 고지(PRD US-012 개정안·111/261 §1) — 쿠팡 파트너스 권장 문구 원문 그대로(약관상 변경 금지).
   *   하우스 톤 '~요' 예외 1문장이라 sent() 로 등록하지 않는다. 제휴 링크가 실제로 렌더될 때만 쓴다(위치 A·B).
   */
  affiliate: {
    coupang: '이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  },
  /** UX §4 L8 — /save 는 SPA 셸. PRD US-025 고정 문구 3개 + R5 상태 문구(스펙33 §7). */
  save: {
    title: '이메일로 저장해 둘까요?',
    description: sent('선택한 동물과 준비 상태만 저장해요. 비밀번호 없이 메일의 링크로 확인해요.'),
    /** R4-7(R4 시안 l8_email) — 채운 버튼 하나 「저장 링크 받기」(이전 「인증 메일 보내기」). */
    submit: '저장 링크 받기',
    later: '나중에 할게요',
    noAds: sent('광고 메일은 보내지 않아요'),
    /** R4-7 — 입력 라벨·자리 표시(시안 원문). 자리 표시는 형식 예시일 뿐 값이 아니다. */
    emailLabel: '이메일',
    emailPlaceholder: 'name@example.com',
    /**
     * Kenny 2026-11-16 결정 2(287 S2) — 입력 칸 아래 안내 한 줄(시안 l8_email 자리).
     *   사실: 15분 = MAGIC_TTL_MS, 한 번 = consume 원자 기록, 연결은 「이 기기 연결하기」를 누른 기기(열기만으론 연결 안 됨).
     */
    linkNote: sent('링크는 15분 안에 한 번만 쓸 수 있어요. 링크로 연결한 기기에서 준비 내용을 볼 수 있어요.'),
    sending: '보내고 있어요',
    sentTitle: '메일을 보냈어요',
    /** 287 S2 — 「누르면 저장이 끝나요」는 사실과 달라 정정: 열기 → connectCta 클릭 때 연결(글자 일치). */
    sentBody: sent('메일의 링크를 열고 「이 기기 연결하기」를 누르면 그 기기와 연결돼요. 링크는 15분 동안 한 번만 쓸 수 있어요.'),
    notReceived: '메일이 오지 않았나요?',
    resend: '다시 보내기',
    /** R4-8(R4 시안 states_board 「저장 실패」) — 링크 요청 실패(429·네트워크·서버) 상태 머리. 입력은 그대로 두고 버튼은 resend. */
    sendFailTitle: '저장 링크를 보내지 못했어요',
    sendFailBody: sent('입력한 이메일은 그대로 남아 있어요. 주소를 확인하고 다시 시도해 주세요.'),
    resendWait: '{n}초 뒤 다시 보낼 수 있어요',
    otherAddress: '다른 주소로 보내기',
    errorFormat: sent('이메일 주소를 다시 확인해 주세요'),
    errorNetwork: sent('지금은 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요'),
    confirmedTitle: '저장했어요',
    confirmedBody: sent('다른 기기에서도 이메일 링크로 이어서 볼 수 있어요'),
    mergedLocal: sent('이 기기의 준비 상태로 저장했어요'),
    mergedServer: sent('저장해 둔 준비 상태를 불러왔어요'),
    /** P1 MAJOR-1 — 로컬·서버 모두 비어 있는 기기에서 연결: 저장할 준비가 없음(빈 PUT 금지). */
    connectedEmpty: sent('이 기기를 연결했어요. 아직 저장된 준비가 없어요. 준비하던 기기에서 메일을 다시 받아 링크를 열어 주세요'),
    /** P1 MAJOR-1 — 보냄 화면: 링크는 이 기기에서 열어야 이 기기의 준비가 저장됨. */
    sentSameDevice: sent('지금 이 기기에서 메일의 링크를 열어 주세요'),
    expiredTitle: '링크를 쓸 수 없어요',
    expiredBody: sent('링크는 15분 동안 한 번만 쓸 수 있어요. 다시 보내 드릴까요?'),
    resendVerify: '인증 메일 다시 보내기',
    signedInTitle: '이메일로 저장 중이에요',
    signedInNote: sent('준비 상태가 자동으로 저장돼요'),
    disconnect: '이 기기에서 연결 해제',
    /** PRD US-025 SaveDot 툴팁·sr-only. */
    dotTitle: '이메일로 저장 중',
    summaryRemaining: '필수 {n}개 남음',
    summaryCage: '내 케이지',
    close: '닫기',
    unavailable: sent('지금은 이메일로 저장할 수 없어요. 이 기기에는 그대로 남아 있어요'),
    verifying: '확인하고 있어요',
    /** SEC-3 M-1 — 매직링크 복귀 시 자동 verify 대신 명시 버튼. */
    connectCta: '이 기기 연결하기',
    /** DR M-3 — /save#t= 연결 화면 제목·본문(입력 화면 문구 재사용 금지). */
    connectTitle: '이 기기를 연결할까요?',
    /** DR-5 MINOR-1 — 첫 PUT 보류 확인 화면 제목(verify 완료 상태). 질문은 confirmMasked 본문 하나. */
    confirmTitle: '이 기기를 연결했어요',
    /** 코드 리뷰 M4 — 연결(verify) 네트워크·5xx 실패. 토큰은 남아 있어 다시 누르면 된다. */
    connectError: '지금은 연결할 수 없어요. 잠시 뒤 다시 눌러 주세요',
    connectBody: sent('연결하면 저장해 둔 준비 상태와 이 기기의 준비 상태를 하나로 맞춰요. 직접 요청한 메일이 아니라면 연결하지 말고 닫아 주세요'),
    /** SEC-3 M-1 — 마스킹 이메일(k***@e***.com)만. 토큰 규칙상 {name} 슬롯을 쓴다(formatCopy 허용 토큰). */
    linkedAs: sent('{name}에 저장하고 있어요'),
    /** R6 레인 0.2 — 첫 PUT 보류 확인(마스킹 이메일 {name}). */
    confirmMasked: sent('{name}에 저장할까요?'),
    confirmCta: '이 주소로 저장하기',
    /** 89 스펙 §2 — L8 저장 정보 지우기·이 기기 정보 지우기(PRD US-025 보완). {n} = privacy/policy.ts BACKUP_RETENTION_DAYS. */
    eraseLink: '저장한 정보 지우기',
    deviceLink: '이 기기 정보 지우기',
    backLabel: '이전 화면으로',
    eraseTitle: '저장한 정보를 지울까요?',
    eraseIntro: sent('{name} 주소로 저장한 정보를 지워요.'),
    eraseIntroNoName: sent('이 이메일로 저장한 정보를 지워요.'),
    eraseListTitle: '지우는 정보',
    eraseItemEmail: '이메일 주소',
    eraseItemState: '저장해 둔 동물 선택과 준비 상태(체크, 내 케이지, 반응)',
    eraseOtherDevices: sent('이 주소로 연결한 다른 기기도 연결이 풀려요. 다른 기기에 남아 있는 준비 상태는 그 기기에 그대로 있어요.'),
    eraseBackup: sent('백업 사본에서는 {n}일 안에 함께 지워져요.'),
    eraseFinal: sent('지운 정보는 다시 되살릴 수 없어요.'),
    eraseWipeDevice: '이 기기의 준비 상태도 지우기',
    eraseWipeDeviceHint: sent('선택하지 않으면 이 기기의 준비 상태는 남고 연결만 풀려요.'),
    eraseCta: '저장한 정보 지우기',
    erasing: sent('지우고 있어요'),
    eraseCancel: sent('그만둘게요'),
    eraseLimited: sent('짧은 시간에 요청이 많았어요. 잠시 뒤 다시 눌러 주세요.'),
    eraseFailed: sent('지금은 지울 수 없어요. 저장한 정보는 그대로 있어요. 잠시 뒤 다시 눌러 주세요.'),
    erasedTitle: '저장한 정보를 지웠어요',
    erasedBody: sent('이 기기와 다른 기기의 이메일 연결도 모두 풀었어요.'),
    erasedDeviceKept: sent('이 기기의 준비 상태는 남아 있어요. 다시 저장하려면 메일 링크를 새로 받아 주세요.'),
    erasedDeviceWiped: sent('이 기기의 준비 상태도 지웠어요.'),
    toStart: '처음 화면으로',
    reauthTitle: '다시 연결해야 지울 수 있어요',
    reauthBody: sent('이 기기의 이메일 연결이 끝나 있어요. 메일의 링크로 다시 연결한 뒤 지워 주세요.'),
    reauthKept: sent('저장한 정보와 이 기기의 준비 상태는 그대로 있어요.'),
    deviceTitle: '이 기기 정보를 지울까요?',
    deviceBody: sent('이 기기에 남은 동물 선택, 준비 상태, 내 케이지, 반응을 지워요.'),
    deviceLinkedNote: sent('이 기기의 이메일 연결도 풀려요. 이메일로 저장한 정보는 남아 있어요. 그것까지 지우려면 아래 링크를 눌러 주세요.'),
    deviceCta: '이 기기 정보 지우기',
    deviceDoneTitle: '이 기기 정보를 지웠어요',
    deviceDoneBody: sent('처음 화면부터 다시 시작할 수 있어요.'),
    deviceLogoutPending: sent('연결 해제는 인터넷이 연결되면 마저 끝내요.'),
  },
  /** PRD US-014 · 계획 §4. 의료 판단 없음 — "병원에 문의"까지. */
  vet: {
    title: '우리 동네 병원',
    emptyAll: sent('전화로 확인한 병원을 준비하고 있어요'),
    emptyRegion: sent('이 지역엔 아직 확인된 병원이 없어요'),
    reportLink: '제보하기',
    nearbyLink: '인접 지역 보기',
    reportedBadge: '제보됨·확인 전',
    /** R4-6(R4 시안 hospital_list) 「지역 선택」. 시안의 시/도·시/군/구 선택 상자는 미적용(지역 링크 유지 — 보고서 확인거리). */
    regionsTitle: '지역 선택',
    /** P5 레인 E — 필터 칩 줄 라벨(지역 칩 줄과 구분). */
    filtersTitle: '조건',
    /** P5 레인 E — ≤767 지역 칩 줄이 넘칠 때만 보이는 힌트. */
    regionsMore: sent('옆으로 넘겨 보세요'),
    treats: '진료 동물',
    call: '전화',
    directions: '길찾기',
    night: '야간',
    emergency: '응급',
    /** R4-6 — 제목 바로 아래 한 줄(시안 원문). 이전 「방문 전에 진료 동물과 시간을 전화로 확인해 주세요」(페이지 하단). */
    visitNote: sent('방문 전 진료 여부를 병원에 문의해 주세요.'),
    /** R4-6 — 진료 동물이 정해졌을 때(필터 또는 ?treats= 노출 타입) 제목. UX §7 고정 문구 「{동물} 진료하는 병원」. */
    animalTitle: '{animal} 진료하는 병원',
    /** R4-6 — 진료 동물 필터 칩 「{name} 진료」(시안 「✓ 골든햄스터 진료」). */
    treatsChip: '{name} 진료',
    /** R4-6 — 병원 0(목록 빈 상태) 제목. 본문은 emptyAll/emptyRegion. */
    emptyTitle: '확인된 병원이 아직 없어요',
    /** R5 C1 — /vet 페이지(스펙33 §5.8). 병원 제보는 /vet 하단 접힘 섹션(오케스트레이터 조정, K-6). */
    all: '전체',
    listTab: '목록',
    mapTab: '지도',
    mapAria: '지도',
    mapHint: sent('지도에서 병원을 눌러 보세요'),
    filterNoResult: sent('조건에 맞는 병원이 없어요'),
    /** P3 — 필터 변경 시 결과 갱신 낭독(시각 표시 없음, sr-only live). */
    filterUpdated: sent('조건에 맞는 병원 목록으로 바꿨어요'),
    filterClear: '필터 지우기',
    regionTitle: '{name} · 우리 동네 병원',
    verifiedBadge: '전화 확인',
    /** PRD US-013 빈 상태 "이 지역엔 아직 확인된 병원이 없어요 — 제보하기 / 인접 지역 보기"의 두 링크는 reportLink·nearbyLink. */
    reportTitle: '이 지역에 병원을 알고 계세요?',
    reportName: '병원명',
    reportAddress: '주소',
    reportTreats: '진료 동물',
    reportPhone: '연락처',
    reportSubmit: '제보 보내기',
    reportThanks: sent('제보해 주셔서 고마워요. 확인한 뒤에 보여 드릴게요'),
    reportError: sent('지금은 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요'),
    /** 278(Kenny ORDERS §46-3): 하루 한도 초과(429 REPORT_DAILY_LIMIT) 정직한 안내. */
    reportDaily: sent('오늘 제보가 많아요, 내일 다시 보내 주세요'),
    reportInvalid: sent('입력한 내용을 다시 확인해 주세요'),
  },
  supplies: {
    title: '용품으로 찾기',
    intro: sent('용품을 고르면 친구별 기준을 보여 드려요'),
    chooseAnimal: '어떤 친구가 쓰나요?',
    empty: sent('검수를 마친 용품 기준을 준비하고 있어요'),
    aliasLine: sent('{alias}라고도 불러요'),
  },
  /** PRD US-001 — PLANNED 타입·잘못된 slug. */
  planned: {
    badge: '준비 중',
    title: sent('아직 준비 중인 친구예요'),
    otherTypes: '다른 친구 보기',
  },
  notFound: {
    title: sent('페이지를 찾을 수 없어요'),
    body: sent('주소가 바뀌었거나 아직 준비 중인 페이지예요'),
    cta: PICK_QUESTION,
    groupSmall: '소동물',
    groupParrot: '앵무새',
    home: '홈으로',
    /** 레인 0(51_architect_persona_fix) — 404에서 병원 페이지로 잇는 링크 라벨. */
    vetLink: '동네 병원 찾기',
  },
  setup: {
    itemsTitle: '포함 항목',
    rangeTitle: '참고 범위',
    /** estimatedRangeText 옆에 항상(K1). */
    priceNote: sent('참고 범위예요. 실제 가격은 판매처마다 달라요'),
    detailLink: '구성안 자세히 보기',
    /** R5 C1 — USED_MIX + L3 전 안내(스펙33 §5.7). */
    usedMixNote: sent('가진 물품을 알려 주면 새로 준비할 것만 보여 드려요'),
    usedMixLink: '가진 물품 알려 주기 ›',
    title: '{animal} · 처음 준비한다면',
  },
  credits: {
    title: '사진 출처',
    author: '저작자',
    license: '라이선스',
    source: '출처',
    intro: sent('사용 조건을 확인한 사진만 써요. 원작자와 라이선스를 함께 밝혀요.'),
    footerLink: '사진 출처',
    /** R4 D6 — /credits 항상 생성, 표기할 사진 0이면 빈 상태. */
    empty: sent('지금은 출처를 밝혀야 하는 사진이 없어요'),
    /** S1 M-3 — CC BY 표기: 저작자·라이선스(증서 링크)·수정 여부·원본. */
    modified: '수정 여부',
    modifiedYes: '수정함',
    modifiedNo: '수정 없음',
    original: '원본 보기',
    /** 사진 source 코드 → 표시명(이미지-소싱.md 기록 필드, validate-structure PHOTO_SOURCES). 없는 코드는 이름 없이 원본 링크만. */
    sourceName: {
      WIKIMEDIA: 'Wikimedia Commons',
      UNSPLASH: 'Unsplash',
      PEXELS: 'Pexels',
      PIXABAY: 'Pixabay',
      OWN: '직접 촬영',
      SELLER: '제조사 제공',
      AFFILIATE: '제휴 이미지',
    },
  },
  /** PRD US-001 그룹, US-008 카테고리 그리드(SupplyCategory 순서). */
  groups: { SMALL_MAMMAL: '소동물', PARROT: '앵무새' },
  categories: {
    CAGE: '케이지',
    WHEEL: '쳇바퀴',
    BEDDING: '베딩',
    FOOD: '먹이',
    WATER: '급수',
    HIDE: '은신처',
    BATH: '목욕',
    TOY: '장난감',
    HEALTH: '건강',
    ETC: '기타',
  },
  /** UX §4 L2(필수/권장/선택/NOT_NOW), PRD US-007 orderHint 문구. */
  priority: { REQUIRED: '필수', RECOMMENDED: '권장', OPTIONAL: '선택', NOT_NOW: '지금은 필요 없어요' },
  orderHint: {
    BEFORE_ARRIVAL: '입양 전에 준비',
    FIRST_WEEK: '첫 주 안에 준비',
    AFTER_ADAPTATION: '적응한 뒤에 준비',
    AS_NEEDED: '필요할 때 준비',
  },
  /** 규격 조건 한 줄 조립용(값·라벨은 시드 specSchema). */
  spec: { gte: '이상', lte: '이하', notIn: '제외', none: '없음', when: '일 때' },
  situation: { FIRST_TIME: '처음 준비', ALREADY: '이미 함께하는 중' },
  /** 푸터(U2b·D3 최소 범위, R3 시안 v1b): 로고 · 한 줄 소개 · 처리방침 · 사진 출처(credits.footerLink) · 의료 고지 · ©. 소개·문의 페이지 없음. */
  footer: {
    tagline: '작은 친구와 함께하는 첫 준비',
    /** 불변식 ⑤ 고지 — 시안 문구 그대로. */
    medical: '의료 판단을 대신하지 않아요',
    /** R6 레인 0.2 — 푸터 개인정보 처리방침 링크 라벨. */
    privacy: '개인정보 처리방침',
    copyright: '© WithSmall',
  },
  /** /privacy 페이지 틀(계획 86 P8). 본문 사실은 prerender/privacy-content.ts. */
  privacy: {
    title: '개인정보 처리방침',
    description: sent('위드스몰이 어떤 개인정보를 왜 받고, 얼마나 보관하고, 어떻게 지우는지 적었어요.'),
    toc: '차례',
    version: '버전',
    effectiveDate: '시행일',
    notApplicable: '해당 없음',
    previousTitle: '이전 버전',
    previousNone: sent('이전 버전이 없어요. 이 버전이 첫 버전이에요.'),
  },
  /** R6 레인 0.2 — 접근성 보조 문구(sr-only). */
  a11y: {
    newWindow: '(새 창)',
  },
  /** R6 레인 0.2 — 그룹 페이지: UI 안내만(사실 값 없음). */
  group: {
    intro: sent('어떤 친구인지 골라 주세요. 지금 준비를 도와드릴 수 있는 친구만 보여 드려요'),
    /** 그룹 표시명(slug 첫 세그먼트 키) — 56 G3 D1. */
    names: { hamster: '햄스터', parrot: '앵무새' },
  },
});

export type Copy = typeof COPY;

/** 89 스펙 §2 eraseBackup {n} — 기간 숫자 단일 출처(privacy/policy.ts, 순수 상수 모듈)를 클라가 @ws/copy 로 받는다. */
export { BACKUP_RETENTION_DAYS } from '../privacy/policy.js';

/**
 * 상태 글리프 — 텍스트 문자, 색만으로 상태를 말하지 않는다. 프리렌더·클라이언트 공용 단일 소스(R4-1: 판정이 보이는 모든 곳이 이 표 하나).
 *   판정 4상태(R4 fix status_glyph_rules): ok ○ 기준 충족 · check △ 확인 필요 · fail ✕ 미달 · none — 기준 없음(○ 와 다른 글리프)
 *     + unknown ? 입력 필요(값 누락 CHECK). 아이콘 + 색 + 단어를 항상 함께.
 *   준비 상태(판정 아님): ready ✓ 준비완료 · first ! 먼저 준비. 「나중에」는 글리프 없이 단어만(○ 는 기준 충족 전용 — R4-1).
 */
export const GLYPH = deepFreeze({ ok: '○', check: '△', fail: '✕', none: '—', unknown: '?', ready: '✓', first: '!' });

function collect(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x, out);
}

/** COPY 의 모든 문자열(중복 제거, 선언 순서). sentencesOnly 면 문장형만. */
export function allCopyStrings(opts: { sentencesOnly?: boolean } = {}): string[] {
  const all: string[] = [];
  collect(COPY, all);
  const uniq = [...new Set(all)];
  return opts.sentencesOnly ? uniq.filter((s) => SENTENCES.has(s)) : uniq;
}

const TOKEN_RE = /\{([a-zA-Z]+)\}/g;
const ALLOWED_TOKENS = new Set(['animal', 'n', 'total', 'alias', 'name', 'unit']);

/** `{animal}`·`{n}`·`{total}`(숫자)·`{alias}`·`{name}`·`{unit}`(단위 — 빈 문자열 허용) 토큰을 채운다. 미지 토큰·값 누락은 throw. 결과는 호출부가 escapeHtml. */
export function formatCopy(
  template: string,
  vars: { animal?: string; n?: number; total?: number; alias?: string; name?: string; unit?: string },
): string {
  return template.replace(TOKEN_RE, (_m, name: string) => {
    if (!ALLOWED_TOKENS.has(name)) throw new Error(`copy: 알 수 없는 토큰 {${name}}`);
    const v = (vars as Record<string, string | number | undefined>)[name];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v !== 'string') throw new Error(`copy: {${name}} 값이 없다`);
    return v;
  });
}

/**
 * 목적격 조사(을/를)를 붙인다 — 한글 음절로 끝나면 받침 유무로, 아니면(영문·숫자 등) 「을(를)」.
 *   표시명(시드 displayName)에 붙이는 표시 규칙일 뿐 사실값이 아니다.
 */
export function objectParticle(word: string): string {
  const w = word.trim();
  const last = w.charCodeAt(w.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return `${w}${(last - 0xac00) % 28 === 0 ? '를' : '을'}`;
  return `${w}을(를)`;
}

/**
 * 공동격 조사(와/과)를 붙인다 — objectParticle 과 같은 규칙(받침 있으면 「과」, 없으면 「와」, 한글 음절이 아니면 「와(과)」).
 *   표시명(시드 용품명)에 붙이는 표시 규칙일 뿐 사실값이 아니다(R4-5 L6 「쳇바퀴와 함께 확인해요」).
 */
export function comitativeParticle(word: string): string {
  const w = word.trim();
  const last = w.charCodeAt(w.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) return `${w}${(last - 0xac00) % 28 === 0 ? '와' : '과'}`;
  return `${w}와(과)`;
}
