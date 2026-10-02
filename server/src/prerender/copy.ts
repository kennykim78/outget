// 프리렌더 고정 UI 카피(시드 사실 아님). 원본: UX-기획.md v2.3.1 §3.1·§4·§7, 디자인-브리프.md 카피 규칙,
// 제품기획 §6.3, PRD US-001·US-014(병원 빈 상태). 사육·규격·의료 사실은 여기 두지 않는다(시드 → resolveRequirement).
// 금지어(불변식 5)·브리프 금지 표현·의료 단정 0 은 prerender.primitives.test.ts 가 lintText 로 강제.
// 빈 상태 문구는 오케스트레이터 결정(결정 매트릭스) — `_workspace/19_backend_r3_laneF1.md` 표.

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
    chooseFriend: '친구 선택',
    changeFriend: '친구 바꾸기',
    supplies: '용품 찾기',
    vet: '병원',
    tabHome: '홈',
    tabSupplies: '용품',
    tabVet: '병원',
    seeAll: '전체',
  },
  /** UX §3.1 A — 동물 미선택(콜드스타트) 4섹션. */
  homeA: {
    heroTitle: sent('작은 친구를 처음부터 제대로 준비해요'),
    heroCta: '어떤 친구인가요?',
    featureChips: ['지금 필요한 것', '규격 판정', '구성안', '동네 병원'],
    reviewsTitle: '실제 이용 후기 — 이용이 확인된 분들만',
    reviewVerifiedChip: '이용 확인',
    introTitle: 'WithSmall 소개 — 작은 친구의 첫 준비를 이렇게 도와요',
    /** 소개 슬라이드 4(K1, R4 클라이언트용). 순서 = featureChips. 프리렌더는 칩 라벨을 제목으로만 쓴다. */
    introSlides: [
      {
        title: sent('지금 필요한 것부터 알려 드려요'),
        body: sent('친구마다 먼저 준비할 것과 나중에 해도 되는 것이 달라요. 지금은 필요 없는 것도 이유와 함께 보여 드려요.'),
      },
      {
        title: sent('막연한 말 대신 숫자로 말해요'),
        body: sent('제품 치수를 넣으면 기준에 맞는지, 쓰던 환경과 맞는지 나눠서 알려 드려요. 이유와 검수 날짜도 함께 보여요.'),
      },
      {
        title: sent('처음 준비하는 구성을 보여 드려요'),
        body: sent('실속, 균형, 기존 물품 활용처럼 왜 이 조합인지가 먼저 나오는 구성안이에요. 가격은 참고 범위로만 보여요.'),
      },
      {
        title: sent('가까운 병원을 찾아볼 수 있어요'),
        body: sent('진료 동물을 확인한 병원을 보여 드려요. 방문 전에는 전화로 한 번 더 확인해 주세요.'),
      },
    ],
    startTitle: sent('어떤 친구와 함께하시나요?'),
    startCta: '어떤 친구인가요?',
    startNote: sent('가입 없이 바로 시작해요'),
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
    introTry: '지금 해보기',
  },
  /** R4 C1 — 가로 레일 이전/다음 버튼. */
  rail: { prev: '이전 보기', next: '다음 보기' },
  /** R4 C1 — 구성안 카드 개수. */
  bundle: { itemCount: '{n}개', newCount: '새로 {n}개' },
  /** UX §3.1 B — 동물 선택: 컨텍스트 헤더 + 5섹션. 숫자는 L3 이후(D18) — 프리렌더는 nowBeforeSetup 만. */
  homeB: {
    nowTitle: '지금 필요한 것',
    nowBeforeSetup: sent('필수 준비를 먼저 확인해요'),
    bundlesTitle: '처음 준비한다면',
    productsTitle: '기준에 맞는 준비물',
    vetTitle: '우리 동네 병원',
    vetLink: '우리 동네 병원 보기',
    saveTitle: sent('{animal} 준비, 이어서 할까요?'),
    saveCta: '지금 필요한 것 보기',
    saveLink: '다른 기기에서도 이어서 — 이메일로 저장',
    nowEmpty: sent('검수를 마친 준비 목록을 정리하고 있어요'),
    bundlesEmpty: sent('검수를 마친 구성안을 준비하고 있어요'),
    productsEmpty: sent('기준을 확인한 준비물을 정리하고 있어요'),
    /** R4 C1 — 클라이언트 전용(L3 이후 숫자). */
    aliasLine: sent('{alias}라고도 불러요'),
    nowRemaining: sent('필수 {n}개 남았어요'),
    nowDone: '필수 준비 끝',
    deviceOnly: sent('이 기기에만 저장돼요'),
    doneTitle: sent('필수 준비가 끝났어요 — 권장 항목도 볼까요?'),
    doneCta: '권장 항목 보기',
  },
  /** R4 C1 — L1 친구 선택(스펙22 §7.3). 후보 안내일 뿐 종을 확정하지 않는다(브리프 고정 문구). */
  picker: {
    unsure: '잘 모르겠어요',
    searchHint: sent('이름이나 별명으로 찾아 드려요'),
    candidateNote: sent('후보 안내일 뿐, 종을 확정하지 않아요'),
    confirm: sent('이 친구가 맞아요'),
    backToGroups: '‹ 그룹 선택',
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
    requiredLeft: '필수 {n}개 미완료',
    summaryTitle: '오늘 바로 데려와도 되는 준비',
    requiredDone: '필수 준비 끝',
    recommendedNote: sent('권장 항목도 살펴보세요'),
    resetSetup: '내 상황 다시 설정',
    saveAsk: sent('지금 준비 상태를 저장해 둘까요?'),
    storageUnavailable: sent('이 기기에 저장할 수 없어요. 지금 화면에서만 유지돼요'),
    itemDetailAria: '{name} 자세히',
    owned: '보유',
  },
  /** 상태 글리프 라벨(문장 아님). 글리프 문자는 GLYPH. */
  glyphLabel: {
    ready: '준비완료',
    first: '먼저 준비',
    check: '확인 필요',
    later: '나중에',
    fail: '기준 미달',
    unknown: '확인 전',
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
    lastVerified: '마지막 검수',
    matchingProducts: '이 항목에 맞는 준비물',
    alternativesNote: sent('이것 대신 아래 용품으로도 구성할 수 있어요'),
    searchKeyword: '검색어',
    source: '출처',
    notNow: sent('지금은 필요 없어요'),
    close: '닫기',
  },
  /** UX §4 L5 — 프리렌더는 정적 폼만(판정은 클라이언트). */
  checkLayer: {
    title: '규격 확인',
    intro: sent('제품 치수를 넣으면 제품 규격과 내 환경 호환을 나눠서 알려 드려요'),
    noScript: sent('판정은 자바스크립트를 켜면 할 수 있어요'),
    submit: '판정하기',
    /** 스펙22 §4-4 — specSchema optional 필드 라벨 뒤 " · 선택". */
    optional: '선택',
  },
  /** UX §4 L7 · §5 — 가격·판매처 없음, "구매" 단어 없음. */
  product: {
    badge: '기준 충족',
    /** 스펙22 §4-2 — imageAsset 없을 때 대체 타일 라벨(브리프). */
    imagePending: '이미지 준비 중',
    reasonsTitle: 'WithSmall 추천 이유',
    reasonSpecMet: '규격 충족',
    reasonProfileMatch: '프로필 일치',
    findWithCondition: '이 조건으로 찾기',
  },
  /** UX §4 L8 — /save 는 SPA 셸. */
  save: {
    title: '이메일로 저장해 둘까요?',
    description: sent('선택한 동물과 준비 상태만 저장해요. 비밀번호 없이 메일의 링크로 확인해요.'),
    submit: '인증 메일 보내기',
    later: '나중에 할게요',
    noAds: sent('광고 메일은 보내지 않아요'),
  },
  /** PRD US-014 · 계획 §4. 의료 판단 없음 — "병원에 문의"까지. */
  vet: {
    title: '우리 동네 병원',
    emptyAll: sent('전화로 확인한 병원을 준비하고 있어요'),
    emptyRegion: sent('이 지역엔 아직 확인된 병원이 없어요'),
    reportLink: '제보하기',
    nearbyLink: '인접 지역 보기',
    reportedBadge: '제보됨·확인 전',
    regionsTitle: '지역',
    treats: '진료 동물',
    call: '전화',
    directions: '길찾기',
    night: '야간',
    emergency: '응급',
    visitNote: sent('방문 전에 진료 동물과 시간을 전화로 확인해 주세요'),
  },
  supplies: {
    title: '용품으로 찾기',
    intro: sent('용품을 고르면 친구별 기준을 보여 드려요'),
    chooseAnimal: '어떤 친구가 쓰나요?',
    empty: sent('검수를 마친 용품 기준을 준비하고 있어요'),
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
    cta: '어떤 친구인가요?',
    groupSmall: '소동물',
    groupParrot: '앵무새',
    home: '홈으로',
  },
  setup: {
    itemsTitle: '포함 항목',
    rangeTitle: '참고 범위',
    /** estimatedRangeText 옆에 항상(K1). */
    priceNote: sent('참고 범위예요. 실제 가격은 판매처마다 달라요'),
    detailLink: '구성안 자세히 보기',
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
  footer: {
    identity: sent('WithSmall은 쇼핑몰이 아니라 준비 도우미예요'),
    health: sent('건강이 걱정되면 병원에 문의해 주세요'),
  },
});

export type Copy = typeof COPY;

/**
 * 상태 글리프(스펙22 §2.0·§4-1) — 텍스트 문자, 색만으로 상태를 말하지 않는다. 프리렌더·클라이언트 공용 단일 소스.
 *   ready ✓ 준비됨·기준 충족 · first ! 먼저 준비 · check △ 확인 필요 · later ○ 나중에 · fail ✕ 미달 · unknown ? 알 수 없음.
 */
export const GLYPH = deepFreeze({ ready: '✓', first: '!', check: '△', later: '○', fail: '✕', unknown: '?' });

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
const ALLOWED_TOKENS = new Set(['animal', 'n', 'alias', 'name']);

/** `{animal}`·`{n}`(숫자)·`{alias}`·`{name}` 토큰을 채운다. 미지 토큰·값 누락은 throw. 결과는 호출부가 escapeHtml. */
export function formatCopy(
  template: string,
  vars: { animal?: string; n?: number; alias?: string; name?: string },
): string {
  return template.replace(TOKEN_RE, (_m, name: string) => {
    if (!ALLOWED_TOKENS.has(name)) throw new Error(`copy: 알 수 없는 토큰 {${name}}`);
    const v = (vars as Record<string, string | number | undefined>)[name];
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (typeof v !== 'string') throw new Error(`copy: {${name}} 값이 없다`);
    return v;
  });
}
