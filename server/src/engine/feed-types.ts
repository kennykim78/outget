// 362 N3 — 상품 피드(「많이 찾는 상품」 아래층) 타입·상수·순수 시각 함수. 순수·결정론(시계·난수·I/O 0).
//   피드 파일(server/product-feed/{coupang|aliexpress}.json)은 시드가 아니다 — 빌드 타임에 prerender/product-feed.ts 가 검사해 읽는다.
//   수수료·판매량·평점·리뷰 수·판매처명·productId 자리 없음(불변식 ④, 353 §2). 가격은 표시용 값일 뿐 정렬·노출 판정 인자가 아니다(불변식 ③).
//   이 파일은 providers.ts 를 import 하지 않는다(exposure.ts 가 이 파일을 쓰므로 — compliance C10-AFF-IMPORT).

export const FEED_PROVIDERS = Object.freeze(['COUPANG', 'ALIEXPRESS'] as const);
export type FeedProvider = (typeof FEED_PROVIDERS)[number];
/** 공급자 고정 순서(수수료와 무관 — 시험으로 고정). 정렬 2순위. */
export const FEED_PROVIDER_ORDER: readonly FeedProvider[] = Object.freeze(['COUPANG', 'ALIEXPRESS'] as const);

/** 생성 상한: 공급자 × (타입·품목)당 행 수. */
export const FEED_ROW_CAP = 10;
/** 화면 상한: L4 행 수(홈 레일은 품목당 1장). */
export const FEED_SCREEN_ROWS = 6;
/** generatedAt 뒤 이 시간을 넘으면 가격 줄 제거(noprice). */
export const FEED_PRICE_HOURS = 72;
/** generatedAt 뒤 이 시간을 넘으면 피드 블록 제거(nofeed). */
export const FEED_BLOCK_HOURS = 168;
const HOUR_MS = 3_600_000;

/** 블록 배지: LISTED_PASS 「표기 규격 통과」(○ 아님, 중립) · CHECK_NEEDED 「△ 규격 확인 필요」. */
export type FeedBadge = 'LISTED_PASS' | 'CHECK_NEEDED';

export interface FeedPrice {
  amount: number;
  currency: 'KRW';
}

/** 피드 파일 행(키 집합 고정 — 로더가 초과·누락 throw). */
export interface FeedRowRec {
  animalTypeId: string;
  supplyItemId: string;
  keyword: string;
  rank: number;
  title: string;
  url: string;
  imageUrl: string | null;
  price: FeedPrice | null;
  fetchedAt: string;
}

export interface FeedFile {
  v: 1;
  provider: FeedProvider;
  source: 'OFFICIAL_API';
  api: { method: string | null; sort: string | null };
  terms: { checkedAt: string | null; displayFields: string[] };
  generatedAt: string | null;
  rows: FeedRowRec[];
}

/** selectFeedRows 입력 행 = 파일 행 + 공급자(파일 단위 값을 행에 붙인 것). */
export interface FeedRowIn extends FeedRowRec {
  provider: FeedProvider;
}

/**
 * 정렬 키 — 가격이 들어올 자리가 없다(타입으로 차단, 불변식 ③). verdict(OK → BELOW_RECOMMENDED) → 공급자 고정순 → rank.
 *   CHECK_NEEDED 블록의 행은 verdict null(모두 같은 순위).
 */
export interface FeedSortKey {
  verdict: 'OK' | 'BELOW_RECOMMENDED' | null;
  provider: FeedProvider;
  rank: number;
}

const VERDICT_ORDER: Readonly<Record<string, number>> = Object.freeze({ OK: 0, BELOW_RECOMMENDED: 1, null: 2 });

export function compareFeedRows(a: FeedSortKey, b: FeedSortKey): number {
  return (
    VERDICT_ORDER[String(a.verdict)] - VERDICT_ORDER[String(b.verdict)] ||
    FEED_PROVIDER_ORDER.indexOf(a.provider) - FEED_PROVIDER_ORDER.indexOf(b.provider) ||
    a.rank - b.rank
  );
}

/**
 * 의료 효능어(불변식 ⑤) — 제목에 있으면 행을 버린다(개작 0). 린트 금지어(seed/lint.ts)와 별개로 피드 제목에만 쓴다.
 */
export const FEED_TITLE_DENY = /치료|효능|예방|영양제|처방|약용|질병|면역|살균|항균|구충|진정제|의약/;

/**
 * avoid 사전어 — 요구사항 avoid 문장에 이 낱말이 있고 제목에도 있으면 행을 버린다(「소나무 베딩」 등). 낱말 목록은 고정, 문장은 시드가 결정.
 */
export const FEED_AVOID_WORDS: readonly string[] = Object.freeze([
  '삼나무',
  '소나무',
  '시더',
  '편백',
  '솜',
  '코튼',
  '석영',
  '건축용',
  '런닝볼',
  '볼형',
  '도색',
  '접착제',
  '미네랄',
  '소금',
  '향 첨가',
  '플라스틱',
  '유리 수조',
  '카펫',
]);

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;

/** 일 수(1970-01-01 = 0) → 그레고리력 연·월·일(Howard Hinnant civil_from_days). */
function civilFromDays(z0: number): { y: number; m: number; d: number } {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: era * 400 + yoe + (m <= 2 ? 1 : 0), m, d };
}

/**
 * ISO 8601 시각(초 필수, Z 또는 ±HH:MM) → epoch ms. 형식·달력 값이 틀리면 null. 실행 환경 TZ 와 무관(Date.UTC 산술만).
 */
export function parseFeedInstant(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i]));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const days = Date.UTC(y, mo - 1, d) / 86_400_000;
  const c = civilFromDays(days);
  if (c.y !== y || c.m !== mo || c.d !== d) return null;
  let offMin = 0;
  if (m[7] !== 'Z') {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 14 || om > 59) return null;
    offMin = (m[8] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  return Date.UTC(y, mo - 1, d, h, mi, se) - offMin * 60_000;
}

/** epoch ms → Asia/Seoul(UTC+9, 일광절약 없음) 연·월·일. 실행 환경 TZ 와 무관. */
export function seoulDate(ms: number): { year: number; month: number; day: number } {
  const c = civilFromDays(Math.floor((ms + 9 * HOUR_MS) / 86_400_000));
  return { year: c.y, month: c.m, day: c.d };
}

/** ms → ISO(초 단위, +09:00 표기). feed-manifest priceUntil·blockUntil 용. */
export function seoulIso(ms: number): string {
  const k = ms + 9 * HOUR_MS;
  const c = civilFromDays(Math.floor(k / 86_400_000));
  const sod = Math.floor((((k % 86_400_000) + 86_400_000) % 86_400_000) / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(c.y, 4)}-${p(c.m)}-${p(c.d)}T${p(Math.floor(sod / 3600))}:${p(Math.floor((sod % 3600) / 60))}:${p(sod % 60)}+09:00`;
}

export type FeedStage = 'full' | 'noprice' | 'nofeed';

/** buildAt 기준 피드 단계: ≤72h full · ≤168h noprice · 그 뒤 nofeed. generatedAt 없음(빈 파일) → nofeed. */
export function feedStage(buildAtMs: number, generatedAt: string | null): FeedStage {
  const g = parseFeedInstant(generatedAt);
  if (g === null) return 'nofeed';
  const age = buildAtMs - g;
  if (age > FEED_BLOCK_HOURS * HOUR_MS) return 'nofeed';
  if (age > FEED_PRICE_HOURS * HOUR_MS) return 'noprice';
  return 'full';
}

/** 만료 시각(ms): 가격 줄 제거 = generatedAt + 72h, 블록 제거 = + 168h. */
export function feedDeadlines(generatedAtMs: number): { priceUntil: number; blockUntil: number } {
  return { priceUntil: generatedAtMs + FEED_PRICE_HOURS * HOUR_MS, blockUntil: generatedAtMs + FEED_BLOCK_HOURS * HOUR_MS };
}

/** 가격 표기 「12,900원」 — 프리렌더·클라 공용(정수 KRW 만, 지역화 API 미사용 → 결정론). */
export function feedPriceText(amount: number): string {
  return `${String(Math.trunc(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

/** 362 N9 — 피드가 살아 있는 단계(파일·마크업이 있는 단계). */
export type FeedLiveStage = Exclude<FeedStage, 'nofeed'>;

/** 피드 JSON dist 상대 파일: {slug}/feed/{item}.json(full) · {item}.noprice.json. 같은 오리진 경로는 앞에 「/」(feedJsonPath). */
export function feedJsonFile(slug: string, itemId: string, stage: FeedLiveStage): string {
  return `${slug}/feed/${itemId}${stage === 'full' ? '' : '.noprice'}.json`;
}

/** 레이어 L4 가 읽는 같은 오리진 상대 경로(외부 호스트 0 — 클라는 이 함수 결과만 fetch). */
export function feedJsonPath(slug: string, itemId: string, stage: FeedLiveStage): string {
  return `/${feedJsonFile(slug, itemId, stage)}`;
}

/** 피드 산출물 목록 파일(dist 최상위) — 빌드(site.ts)가 쓰고 런타임(spa.ts)이 읽는다. */
export const FEED_MANIFEST_FILE = 'feed-manifest.json';

/** 페이지 HTML 변형 파일 이름(기본 파일 = 피드 없음 = 피드 꺼짐 빌드와 바이트 동일). */
export const FEED_PAGE_VARIANT: Readonly<Record<FeedLiveStage, string>> = Object.freeze({ full: 'index.feed.html', noprice: 'index.feed-noprice.html' });

/** 기본 페이지 파일(…/index.html) → 단계 변형 파일. index.html 로 끝나지 않으면 null. */
export function feedVariantFile(file: string, stage: FeedLiveStage): string | null {
  if (file !== 'index.html' && !file.endsWith('/index.html')) return null;
  return `${file.slice(0, file.length - 'index.html'.length)}${FEED_PAGE_VARIANT[stage]}`;
}

/** 확인일 YYYY-MM-DD → { month, day }(가격 줄 「{M}월 {D}일 확인」). 형식 밖이면 null. */
export function feedCheckedParts(checkedOn: unknown): { month: number; day: number } | null {
  if (typeof checkedOn !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkedOn);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}
