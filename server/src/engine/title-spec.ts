// 362 N4 — 몰 원제목 → 규격 값(parseTitleSpec). 순수·결정론(시계·난수·I/O 0). 피드 노출(exposure.ts selectFeedRows)만 쓴다.
//   fail-closed: 옵션 나열(「21/27/30cm」·「S/M/L」·「사이즈 선택」)·후보 2개 이상·단위 혼재·인치 → null(판단 불가 — 행 버림).
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
  if (OPTION_RE.test(t) || SIZE_LIST_RE.test(t) || INCH_RE.test(t)) return null;
  const nums = mapNumbers(supplyItemId, scanNumbers(t));
  if (nums === null) return null;
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
