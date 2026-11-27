// 362 N4 — 몰 원제목 → 규격 값(parseTitleSpec). 순수·결정론(시계·난수·I/O 0). 피드 노출(exposure.ts selectFeedRows)만 쓴다.
//   fail-closed: 옵션 나열(「21/27/30cm」·「S/M/L」·「사이즈 선택」)·후보 2개 이상·단위 혼재·인치 → null(판단 불가 — 행 버림).
//   399: 숫자는 허용 목록(dimensionConfirmed)을 통과한 제목에서만 낸다.
//   398: 비교(미만·이하·이상·이내·까지·최대·약 등)·범위(20-30cm·대시 변형)·호환(케이지용·호환·맞는·장착) 표현도 null.
//   숫자는 단위가 붙은 값만, 품목별 고정 매핑표로만 넣는다(옵션 치수 임의 대응 금지). enum·boolean 은 긍정 사전으로만 채운다.
//   C4(362): mm 는 매핑표가 mm 필드를 둔 곳(cage·bird-cage barGapMm = 「간격」 표지, perch diameterMm)만, cm 와 한 제목에 섞이면 null.
//   값의 범위(specSchema min/max)는 여기서 보지 않는다 — selectFeedRows 가 rules.readSpecValue 로 본다.
//   반환 {} = 읽은 값 없음(규칙 키가 비면 selectFeedRows 가 행을 버린다). 제목을 고치거나 다시 쓰지 않는다(개작 0).
import type { SpecValue } from './types.js';

export type TitleSpec = Record<string, SpecValue>;

type Dict = ReadonlyArray<readonly [SpecValue, RegExp]>;

/** 품목 → 필드 → (값, 긍정어 패턴). 같은 필드에서 서로 다른 값이 둘 이상 걸리면 null. */
const ENUM_DICT: Readonly<Record<string, Readonly<Record<string, Dict>>>> = Object.freeze({
  wheel: {
    surface: [
      ['SOLID', /통면|막힌\s*판/],
      ['MESH', /메쉬|메시|망형|철망/],
      ['BAR', /봉형|살대/],
    ],
    mount: [
      ['STAND', /스탠드/],
      ['HANG', /걸이형|거는\s*형/],
    ],
  },
  cage: {
    type: [
      ['LIVING_BOX', /리빙\s*박스/],
      ['WIRE', /철망/],
      ['ACRYLIC', /아크릴/],
      ['GLASS_TANK', /수조/],
      ['GRID_PANEL', /C&C|조립식\s*패널/],
    ],
  },
  'bird-cage': {
    type: [
      ['WIRE', /철망|와이어/],
      ['ACRYLIC', /아크릴/],
    ],
  },
  perch: {
    material: [
      ['NATURAL_BRANCH', /자연목|나뭇가지|자연\s*가지/],
      ['WOOD', /원목|나무(?!가지)/],
      ['ROPE', /로프/],
      ['PLASTIC', /플라스틱/],
    ],
  },
  bedding: {
    material: [
      ['PAPER', /종이|페이퍼/],
      ['ASPEN', /아스펜/],
      ['HEMP', /헴프|대마/],
      ['CEDAR_PINE', /삼나무|소나무|시더|cedar|pine/i],
      ['HAY', /건초/],
      ['FLEECE', /플리스/],
      ['STRAW', /짚/],
    ],
    scented: [
      [false, /무향/],
      [true, /향\s*첨가|라벤더|허브\s*향/],
    ],
  },
  chew: {
    material: [
      ['UNTREATED_WOOD', /무(?:처리|가공|도색)\s*(?:나무|원목)/],
      ['MINERAL', /미네랄/],
    ],
  },
  hideout: {
    material: [
      ['WOOD', /원목|나무/],
      ['CERAMIC', /도자기|세라믹/],
      ['PLASTIC', /플라스틱/],
      ['CARDBOARD', /골판지|종이/],
    ],
  },
  'sand-bath': {
    sandType: [
      ['CHINCHILLA_SAND', /친칠라\s*(?:샌드|모래)/],
      ['DUST', /더스트/],
      ['REPTILE_SAND', /파충류/],
    ],
  },
});

/** 숫자 매핑이 있는 품목(위 사전 품목 포함) — 매핑표 품목 집합(시험 고정). */
const NUMBER_ITEMS = ['cage', 'playpen', 'bird-cage', 'wheel', 'tubes', 'bird-bath', 'perch', 'bedding'] as const;
export const TITLE_SPEC_ITEMS: ReadonlySet<string> = new Set([...NUMBER_ITEMS, ...Object.keys(ENUM_DICT)]);

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const SEP = String.raw`\s*[x×X*＊]\s*`;
const UNIT = String.raw`(cm|mm|㎝|㎜)`;
/** 옵션 나열(숫자 / 숫자, 숫자~숫자)·선택형 문구. */
const OPTION_RE = /\d\s*[/~∼]\s*\d|택\s*1|옵션|사이즈\s*선택|색상\s*선택|선택\s*가능/;
/** S/M/L 류(대문자만 — cm/mm 같은 단위 오검출 방지). */
const SIZE_LIST_RE = /(?<![A-Za-z])X{0,3}[SML](?![A-Za-z])\s*\/\s*X{0,3}[SML](?![A-Za-z])/;
const INCH_RE = /인치|inch|\d\s*["″”]/i;
const LABELS = String.raw`(안쪽\s*지름|안지름|내경|지름|직경|깊이|높이|간격|길이|두께|폭|가로|세로)`;

// 398 — 비교·범위·호환 표현(fail-closed). 숫자가 정확한 제품 값이 아닐 수 있으면 null(행 버림).
/** 단위(치수·리터) 꼬리. */
const UNIT_ANY = String.raw`(?:cm|mm|㎝|㎜|L|리터)`;
/** 범위: 숫자(단위?) [하이픈·대시·물결] 숫자 — 「20-30cm」「20cm - 30cm」「20–30」「20cm~30cm」. 모델명 하이픈(HW-28)은 앞이 글자라 걸리지 않는다. */
const RANGE_RE = new RegExp(String.raw`\d\s*${UNIT_ANY}?\s*[-‐‑‒–—―−~∼～〜]\s*\d`, 'i');
/** 단위 나열: 「21cm/27cm」「21cm, 27cm」. */
const UNIT_LIST_RE = new RegExp(String.raw`\d\s*${UNIT_ANY}\s*[/,]\s*\d`, 'i');
/** 숫자 뒤 비교·근사: 미만·이하·이내·초과·이상·까지·부터·내외·전후·정도·가량·안팎·언더·오버·급·「N cm대」·↑↓·+. */
const SUFFIX_RE = new RegExp(
  String.raw`\d\s*${UNIT_ANY}(?![A-Za-z])\s*(?:미만|이하|이내|초과|이상|까지|부터|내외|전후|정도|가량|안팎|언더|오버|급|대(?![가-힣])|[↑↓▲▼+＋<>≤≥≦≧])`,
  'i',
);
/** 숫자 앞 비교·근사: 최대·최소·약·대략·max·min·up to·under·over·부호(~ < > ≤ ≥ ±). 라벨(지름 등)이 사이에 와도 잡는다. */
const PREFIX_RE = new RegExp(
  String.raw`(?:최대|최소|최장|최고|(?<![가-힣])약|대략|(?<![A-Za-z])(?:max|min|up\s*to|under|over)|[~∼～〜<>≤≥≦≧±])\s*(?:${LABELS}\s*:?\s*)?\d`,
  'i',
);
/** 호환·장착 문구 — 숫자가 다른 물건(케이지 등)의 크기를 가리킬 수 있다. */
const COMPAT_RE = /호환|맞는|맞춤|대응|적합|장착|부착|끼우는|들어가는|넣는|사용\s*가능/;
/** 「X용·X 전용·X 겸용」— X 가 동물어로 끝날 때만 허용(햄스터용·골든햄스터 전용). 그 밖(케이지용·27cm용) → null. */
const USE_RE = /([가-힣A-Za-z0-9]*?)\s*(?:전용|겸용|용)(?![가-힣])/g;
/** 한글 범위: 「20에서 30cm」「20부터 30」「20 내지 30」. */
const WORD_RANGE_RE = new RegExp(String.raw`\d\s*${UNIT_ANY}?\s*(?:에서|부터|내지)\s*\d`, 'i');
// 399 R-1 — 허용 목록: 숫자를 내는 제목은 모든 낱말이 아는 낱말이어야 한다(치수가 이 제품의 것이라고 확인되는 형태).
//   모르는 낱말(다른 물건·설치 문맥·새 표현)이 하나라도 있으면 숫자를 판정하지 않는다. 막을 문구를 더하지 않는다.
/** 품목 → 제품 명사(하나 이상 있어야 한다). */
const PRODUCT_NOUN: Readonly<Record<string, string>> = Object.freeze({
  cage: '케이지|리빙박스|사육장',
  playpen: '울타리|펜스|놀이장',
  'bird-cage': '새장|케이지',
  wheel: '쳇바퀴|휠',
  tubes: '터널|튜브',
  'bird-bath': '목욕통|목욕조|욕조',
  perch: '횃대',
  bedding: '베딩|깔짚',
});
const ANIMAL_USE: readonly string[] = [
  '햄스터', '골햄', '드워프', '로보', '로보로브스키', '정글리안', '저빌', '기니피그', '친칠라', '데구', '토끼', '고슴도치',
  '다람쥐', '래트', '쥐', '소동물', '설치류', '앵무새', '앵무', '잉꼬', '코뉴어', '조류', '새', '반려동물', '애완동물', '동물',
];
/** 제품 크기·특징만 말하는 낱말. */
const MODIFIER = '대형|중형|소형|특대형|특대|미니|무소음|저소음|골든';
const HOST = String.raw`(?:케이지|리빙\s*박스|사육장|새장|수조|어항)`;
/** 「케이지 미포함」 — 케이지류가 아닌 품목에서 다른 물건이 빠진다는 표시. */
const HOST_EXCLUDED_RE = new RegExp(String.raw`${HOST}\s*(?:미포함|별도\s*구매|별도|별매|제외)`, 'g');
const MEASURE_RE = new RegExp(
  String.raw`(?<=^|\s)(?:${LABELS}\s*:?\s*)?${NUM}(?:${SEP}${NUM}){0,2}\s*(?:cm|mm|㎝|㎜|L|리터)(?=\s|$)`,
  'gi',
);
const MODEL_TOKEN_RE = /^[A-Za-z]+-?\d+(?:-\d+)*$/;
/** 맨 앞의 영문 상표(TRIXIE 등). */
const BRAND_TOKEN_RE = /^(?!(?:cage|for|fit)$)[A-Za-z][A-Za-z-]*$/i;

function dimensionConfirmed(itemId: string, title: string): boolean {
  const noun = PRODUCT_NOUN[itemId];
  if (noun === undefined) return false;
  let t = title.replace(/[()[\]{}（）［］【】〔〕,·!]/g, ' ').replace(/리빙\s+박스/g, '리빙박스');
  if (!CAGE_ITEMS.has(itemId)) t = t.replace(HOST_EXCLUDED_RE, ' ');
  t = t.replace(MEASURE_RE, ' ');
  // enum 긍정 사전 구절(띄어쓰기 허용)은 통째로 지운다.
  for (const entries of Object.values(ENUM_DICT[itemId] ?? {})) {
    for (const [, re] of entries) t = t.replace(new RegExp(re.source, `${re.flags}g`), ' ');
  }
  const animal = `(?:${ANIMAL_USE.join('|')})(?:전용|겸용|용)?`;
  const known = new RegExp(`^(?:${animal}|${noun}|${MODIFIER}|전용|겸용)+$`);
  const tokens = t.split(/\s+/).filter((x) => x !== '');
  if (!new RegExp(noun).test(title.replace(/리빙\s+박스/g, '리빙박스'))) return false;
  return tokens.every((x, i) => known.test(x) || MODEL_TOKEN_RE.test(x) || (i === 0 && BRAND_TOKEN_RE.test(x)));
}

/** 단위 없는 숫자로 끝나는 모델명(HW28-01·WS-2030) — 범위 검사 전에만 지운다. 소수점·단위·범위 기호가 이어지면 남긴다. */
const MODEL_RE = /[A-Za-z]+-?\d+(?:-\d+)*(?![\dA-Za-z.]|\s*(?:[-‐‑‒–—―−~∼～〜]|cm|mm|㎝|㎜|L(?![A-Za-z])|리터))/g;
const CAGE_ITEMS: ReadonlySet<string> = new Set(['cage', 'playpen', 'bird-cage']);

function hasQualifier(title: string): boolean {
  // 괄호는 지워서 「27cm(미만)」「(최대) 30cm」도 같은 규칙으로 본다.
  const t = title.replace(/[()[\]{}（）［］【】〔〕]/g, ' ');
  if (WORD_RANGE_RE.test(t) || RANGE_RE.test(t.replace(MODEL_RE, ' '))) return true;
  if (UNIT_LIST_RE.test(t) || SUFFIX_RE.test(t) || PREFIX_RE.test(t) || COMPAT_RE.test(t)) return true;
  for (const m of t.matchAll(USE_RE)) {
    const noun = m[1];
    if (noun === '' || !ANIMAL_USE.some((a) => noun.endsWith(a))) return true;
  }
  return false;
}

interface Dims {
  values: number[];
  unit: 'cm' | 'mm';
}
interface Single {
  value: number;
  unit: 'cm' | 'mm';
  label: string | null;
}

const normUnit = (u: string): 'cm' | 'mm' => (u === 'mm' || u === '㎜' ? 'mm' : 'cm');
const normLabel = (l: string | undefined): string | null => (l === undefined ? null : l.replace(/\s+/g, ''));

/** 단위 붙은 치수(AxB(xC)unit)와 단일 값(라벨? N unit)을 뽑는다. 단위 없는 치수는 버린다. */
function scanNumbers(title: string): { dims: Dims[]; singles: Single[]; liters: number[] } {
  const dims: Dims[] = [];
  let rest = title.replace(new RegExp(`${NUM}${SEP}${NUM}(?:${SEP}${NUM})?\\s*${UNIT}?(?![A-Za-z])`, 'gi'), (_m, a, b, c, u) => {
    if (typeof u === 'string') dims.push({ values: [a, b, c].filter((x) => x !== undefined).map(Number), unit: normUnit(u.toLowerCase()) });
    return ' ';
  });
  const singles: Single[] = [];
  rest = rest.replace(new RegExp(`(?:${LABELS}\\s*:?\\s*)?${NUM}\\s*${UNIT}(?![A-Za-z])`, 'gi'), (_m, l, n, u) => {
    singles.push({ value: Number(n), unit: normUnit(String(u).toLowerCase()), label: normLabel(l) });
    return ' ';
  });
  const liters: number[] = [];
  for (const m of rest.matchAll(new RegExp(`${NUM}\\s*(?:L|리터)(?![A-Za-z])`, 'g'))) liters.push(Number(m[1]));
  return { dims, singles, liters };
}

/** 품목별 숫자 매핑. null = 판단 불가. */
function mapNumbers(itemId: string, s: ReturnType<typeof scanNumbers>): TitleSpec | null {
  const out: TitleSpec = {};
  const cmSingles = s.singles.filter((x) => x.unit === 'cm');
  const mmSingles = s.singles.filter((x) => x.unit === 'mm');
  const mmDims = s.dims.filter((d) => d.unit === 'mm');
  const cmDims = s.dims.filter((d) => d.unit === 'cm');
  const anyCm = cmSingles.length + cmDims.length > 0;
  const anyMm = mmSingles.length + mmDims.length > 0;
  // C4: cm 와 mm 가 한 제목에 섞이면 판단 불가.
  if (anyCm && anyMm && itemId !== 'bedding') return null;

  switch (itemId) {
    case 'wheel': {
      if (anyMm || s.dims.length > 0) return null;
      if (cmSingles.some((x) => x.label !== null && x.label !== '지름' && x.label !== '직경')) return null;
      if (cmSingles.length > 1) return null;
      if (cmSingles.length === 1) out.diameterCm = cmSingles[0].value;
      return out;
    }
    case 'cage':
    case 'playpen':
    case 'bird-cage': {
      if (mmDims.length > 0 || cmDims.length > 1 || cmSingles.length > 0) return null;
      if (mmSingles.length > 0) {
        if (itemId === 'playpen' || mmSingles.length > 1 || mmSingles[0].label !== '간격') return null;
        out.barGapMm = mmSingles[0].value;
      }
      if (cmDims.length === 1) {
        const [w, d, h] = cmDims[0].values;
        const keys = itemId === 'bird-cage' ? ['widthCm', 'depthCm', 'heightCm'] : ['floorWcm', 'floorDcm', 'heightCm'];
        out[keys[0]] = w;
        out[keys[1]] = d;
        if (h !== undefined) out[keys[2]] = h;
      }
      return out;
    }
    case 'tubes': {
      if (anyMm) return null;
      const inner = cmSingles.filter((x) => x.label === '내경' || x.label === '안지름' || x.label === '안쪽지름');
      if (inner.length > 1) return null;
      if (inner.length === 1) out.innerDiameterCm = inner[0].value;
      return out;
    }
    case 'perch': {
      if (anyCm || mmDims.length > 0) return null;
      if (mmSingles.some((x) => x.label !== null && x.label !== '지름' && x.label !== '직경' && x.label !== '두께')) return null;
      if (mmSingles.length > 1) return null;
      if (mmSingles.length === 1) out.diameterMm = mmSingles[0].value;
      return out;
    }
    case 'bird-bath': {
      if (anyMm || s.dims.length > 0) return null;
      for (const x of cmSingles) {
        const key = x.label === '내경' || x.label === '안지름' || x.label === '안쪽지름' ? 'shortSideCm' : x.label === '깊이' ? 'depthCm' : null;
        if (key === null || key in out) return null;
        out[key] = x.value;
      }
      return out;
    }
    case 'bedding': {
      if (s.liters.length > 1) return null;
      if (s.liters.length === 1) out.volumeL = s.liters[0];
      return out;
    }
    default:
      return out;
  }
}

/** 긍정 사전 — 필드마다 걸린 값이 하나일 때만. 둘 이상이면 null. */
function mapEnums(itemId: string, title: string): TitleSpec | null {
  const dict = Object.prototype.hasOwnProperty.call(ENUM_DICT, itemId) ? ENUM_DICT[itemId] : null;
  const out: TitleSpec = {};
  if (dict === null) return out;
  for (const [key, entries] of Object.entries(dict)) {
    const hits = new Set<SpecValue>();
    for (const [value, re] of entries) if (re.test(title)) hits.add(value);
    if (hits.size > 1) return null;
    if (hits.size === 1) out[key] = [...hits][0];
  }
  return out;
}

/**
 * 몰 원제목 → 규격 값. 매핑표 밖 품목 → {}. 판단 불가(옵션 나열·후보 2개 이상·단위 혼재·인치·사전 충돌) → null.
 *   결과의 키는 품목 specSchema 필드 키(매핑표가 고정). 값 범위 검사는 호출부(rules.readSpecValue).
 */
export function parseTitleSpec(supplyItemId: string, title: string): TitleSpec | null {
  if (typeof title !== 'string' || typeof supplyItemId !== 'string') return null;
  if (!TITLE_SPEC_ITEMS.has(supplyItemId)) return {};
  const t = title.normalize('NFC');
  if (OPTION_RE.test(t) || SIZE_LIST_RE.test(t) || INCH_RE.test(t) || hasQualifier(t)) return null;
  const nums = mapNumbers(supplyItemId, scanNumbers(t));
  if (nums === null) return null;
  if (Object.keys(nums).length > 0 && !dimensionConfirmed(supplyItemId, t)) return null;
  const enums = mapEnums(supplyItemId, t);
  if (enums === null) return null;
  return { ...enums, ...nums };
}

/** not_in·avoid 사전어(selectFeedRows): 이 품목·필드·값에 대응하는 긍정어 패턴(없으면 null). */
export function titleEnumPattern(supplyItemId: string, key: string, value: SpecValue): RegExp | null {
  const dict = Object.prototype.hasOwnProperty.call(ENUM_DICT, supplyItemId) ? ENUM_DICT[supplyItemId] : null;
  const entries = dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
  const hit = entries?.find(([v]) => v === value);
  return hit ? hit[1] : null;
}
