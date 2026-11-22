// 저렴 대체 팁 검증 V-TIP-0~5·K + W-TIP-CAT·W-TIP-LEN·W-TIP-REF2 (budget-tips.json, kind=REFERENCE — Kenny 2026-11-22, 302 r2).
//   REFERENCE 행은 사람 검수 없이 노출되는 별도 경로(engine isBudgetTipExposable). 그래서 여기 규칙이 불변식 3·4·5 의 유일한 기계 방어선이다.
//   V01(AI_DRAFT≠VERIFIED)·V02~V04·V09~V11 은 validate-review.ts 가 이 파일에도 그대로 적용한다(CONTENT_KEYS).
import {
  TIP_HAZARD_MIN_DOMAINS,
  TIP_HEALTH_HAZARDS,
  TIP_MAX_LIST,
  TIP_MAX_TEXT,
  TIP_MAX_TOTAL,
  isTipHazard,
  checkAnimalMinSpec,
  createCatalog,
  isTipSectionCategory,
  tipDistinctDomainCount,
  tipReferenceUrlProblem,
  type SpecValues,
} from '../engine/index.js';
import { asRec, asSeedBundle, isIsoDate, isNonEmptyStr, SEED_KEYS, type RawSeed, type Rec } from './common.js';
import type { Ctx } from './context.js';
import { sentenceCount } from './lint.js';

const KEY = 'budgetTips' as const;
const TEXT_ARRAYS = ['materials', 'steps', 'dimensions', 'cautions', 'mustCheck'] as const;
const REF_KEYS = ['title', 'url', 'siteName', 'checkedAt'];

/**
 * V-TIP-2 상호명(판매처·플랫폼) — 자유 텍스트 금지. 구할 곳은 sourceHint 고정 카피(prerender COPY.tips.sourceHint)로만.
 *   일반어와 겹치는 짧은 이름(「알리」=알리다)은 뒤 조사·「에서」 형태만 잡는다.
 */
export const TIP_SHOP_NAMES: readonly RegExp[] = [
  /다이소/, /아성다이소/, /알리\s*익스프레스/, /알리(?=에서|몰|직구|\s|$|[,.)」』])/, /aliexpress/i, /테무/, /temu/i,
  /쿠팡/, /coupang/i, /이마트/, /홈플러스/, /롯데마트/, /코스트코/, /이케아/, /ikea/i, /무인양품/, /모던하우스/,
  /자주\s*\(?JAJU\)?/, /버터\s*샵/, /오늘의\s*집/, /지마켓/, /g\s*마켓/i, /11번가/, /옥션/, /스마트스토어/, /네이버\s*쇼핑/,
  /ssg/i, /롯데온/, /위메프/, /티몬/, /인터파크/, /마켓컬리/, /컬리/, /아마존/, /amazon/i, /이베이/, /ebay/i, /당근\s*마켓/,
  /번개장터/, /중고나라/, /펫\s*프렌즈/, /어바웃펫/, /헬로마켓/, /잡화점\s*[A-Za-z가-힣]+점/,
];

/** V-TIP-2 URL·도메인 표기(외부 URL 은 references[].url 에만). */
const URL_LIKE = /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|kr|co\.kr|io|me|ly|to|shop|store)\b)/i;
/** V-TIP-2 가격·금액 표기(불변식 4). 숫자+원/천원/만원·₩·달러·「원대」「가격」. */
const PRICE_LIKE = /(?:\d[\d,.]*\s*(?:천|만)\s*원|\d[\d,.]*원(?!형|통|목|뿔|기둥|판|반)|\d[\d,.]*\s+원(?![가-힣])|\d[\d,.]*\s*(?:달러|불)(?![가-힣])|₩|\$\s*\d|\d\s*원대|가격|저렴이)/;

function texts(r: Rec): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  if (typeof r.substitute === 'string') out.push({ path: 'substitute', text: r.substitute });
  for (const f of TEXT_ARRAYS) {
    const arr = r[f];
    if (Array.isArray(arr)) arr.forEach((x, i) => typeof x === 'string' && out.push({ path: `${f}[${i}]`, text: x }));
  }
  return out;
}

function refTexts(r: Rec): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  if (!Array.isArray(r.references)) return out;
  r.references.forEach((x, i) => {
    const ref = asRec(x);
    for (const f of ['title', 'siteName'] as const) if (typeof ref?.[f] === 'string') out.push({ path: `references[${i}].${f}`, text: ref[f] as string });
  });
  return out;
}

/** V-TIP-2 한 문자열의 문제(없으면 빈 배열). 공개 — 시험·content-curator 도구용. */
export function tipTextProblems(text: string): string[] {
  const p: string[] = [];
  if (URL_LIKE.test(text)) p.push('URL·도메인 표기(외부 주소는 references[].url 에만)');
  if (PRICE_LIKE.test(text)) p.push('가격·금액 표기(불변식 4 — 가격 없음)');
  for (const re of TIP_SHOP_NAMES) {
    const m = re.exec(text);
    if (m) {
      p.push(`상호명 「${m[0]}」(구할 곳은 sourceHint 고정 카피로만)`);
      break;
    }
  }
  return p;
}

export function checkTips(ctx: Ctx, raw: RawSeed, sound: boolean): void {
  const { out } = ctx;

  // V-TIP-K — kind 키(REFERENCE 면제 표지)는 budgetTips 에만. 다른 파일 행에 있으면 면제가 새는 통로 → ERROR.
  for (const key of SEED_KEYS) {
    if (key === KEY) continue;
    for (const { rec, id } of ctx.rows[key]) {
      if (Object.hasOwn(rec, 'kind')) out.error('V-TIP-K', key, id, 'kind', '`kind`(REFERENCE 면제 표지)는 budget-tips.json 행에만 — 다른 콘텐츠는 VERIFIED 규칙 그대로');
      if (Object.hasOwn(rec, 'references')) out.error('V-TIP-K', key, id, 'references', '`references`(외부 글 참조)는 budget-tips.json 행에만');
    }
  }

  for (const { rec: r, id } of ctx.rows[KEY]) {
    // V-TIP-0 형식·참조
    if (r.kind !== 'REFERENCE') out.error('V-TIP-0', KEY, id, 'kind', `kind 는 REFERENCE (현재 ${JSON.stringify(r.kind)})`);
    const profileId = r.careProfileId as string;
    const itemId = r.supplyItemId as string;
    if (!ctx.byId.careProfiles.has(profileId)) out.error('V-TIP-0', KEY, id, 'careProfileId', `CareProfile ${String(profileId)} 없음`);
    const item = ctx.byId.supplyItems.get(itemId);
    if (!item) out.error('V-TIP-0', KEY, id, 'supplyItemId', `SupplyItem ${String(itemId)} 없음`);
    else if (!ctx.reqPairs.has(`${profileId}|${itemId}`)) out.error('V-TIP-0', KEY, id, 'supplyItemId', `(${String(profileId)}, ${itemId}) 요구사항 없음 — 팁은 요구사항이 있는 용품에만`);
    if (item && !isTipSectionCategory(item.category)) {
      out.warn('W-TIP-CAT', KEY, id, 'supplyItemId', `${itemId}(${String(item.category)}) 는 /tips 섹션 밖 — 1차 미표시(O-1)`);
    }
    if (r.animalTypeIds !== undefined) {
      if (!Array.isArray(r.animalTypeIds) || r.animalTypeIds.length === 0) out.error('V-TIP-0', KEY, id, 'animalTypeIds', '생략하거나 비지 않은 배열');
      else
        r.animalTypeIds.forEach((t, i) => {
          const at = ctx.byId.animalTypes.get(t as string);
          if (!at) out.error('V-TIP-0', KEY, id, `animalTypeIds[${i}]`, `AnimalType ${String(t)} 없음`);
          else if (at.careProfileId !== profileId) out.error('V-TIP-0', KEY, id, `animalTypeIds[${i}]`, `${String(t)} 의 careProfileId(${String(at.careProfileId)}) ≠ ${String(profileId)}`);
        });
    }
    if (Array.isArray(r.hazards)) {
      const seen = new Set<string>();
      r.hazards.forEach((h, i) => {
        if (!isTipHazard(h)) out.error('V-TIP-0', KEY, id, `hazards[${i}]`, `알 수 없는 위험 태그 ${JSON.stringify(h)}`);
        else if (seen.has(h)) out.error('V-TIP-0', KEY, id, `hazards[${i}]`, `중복 ${h}`);
        else seen.add(h);
      });
    }
    for (const f of TEXT_ARRAYS) {
      const arr = r[f];
      if (!Array.isArray(arr)) continue; // 타입은 S03
      arr.forEach((x, i) => {
        if (!isNonEmptyStr(x)) out.error('V-TIP-0', KEY, id, `${f}[${i}]`, '비지 않은 문자열');
      });
    }
    if (!Array.isArray(r.references) || r.references.length === 0) {
      out.error('V-TIP-0', KEY, id, 'references', '외부 글 참조 1개 이상(REFERENCE 노출 조건)');
    } else {
      r.references.forEach((x, i) => {
        const p = `references[${i}]`;
        const ref = asRec(x);
        if (!ref) return out.error('V-TIP-0', KEY, id, p, '참조는 {title,url,siteName,checkedAt} 객체');
        for (const k of Object.keys(ref)) if (!REF_KEYS.includes(k)) out.error('V-TIP-0', KEY, id, `${p}.${k}`, '알 수 없는 키(참조는 title·url·siteName·checkedAt 만)');
        if (!isNonEmptyStr(ref.title)) out.error('V-TIP-0', KEY, id, `${p}.title`, 'title 이 비었다');
        if (!isNonEmptyStr(ref.siteName)) out.error('V-TIP-0', KEY, id, `${p}.siteName`, 'siteName 이 비었다');
        if (!isIsoDate(ref.checkedAt)) out.error('V-TIP-0', KEY, id, `${p}.checkedAt`, 'YYYY-MM-DD');
        const why = tipReferenceUrlProblem(ref.url);
        if (why) out.error('V-TIP-0', KEY, id, `${p}.url`, `원문 URL 거부: ${why} (O-4 — 판매처·상품·제휴 URL 금지)`);
      });
    }

    // V-TIP-1 위험 태그 ↔ contentKind(독성·섭취 → HEALTH 강제, 나머지는 CARE/HEALTH)
    if (r.contentKind !== 'CARE' && r.contentKind !== 'HEALTH') out.error('V-TIP-1', KEY, id, 'contentKind', `팁은 CARE 또는 HEALTH (현재 ${String(r.contentKind)})`);
    const hz = Array.isArray(r.hazards) ? r.hazards : [];
    if (hz.some((h) => (TIP_HEALTH_HAZARDS as readonly unknown[]).includes(h)) && r.contentKind !== 'HEALTH') {
      out.error('V-TIP-1', KEY, id, 'contentKind', '독성·섭취 위험 태그(TOXIC_MATERIAL·INGESTION) 행은 contentKind HEALTH');
    }
    // W-TIP-REF2(총괄 ②(b)) — 위험 태그 팁은 서로 다른 사이트 도메인 참조 2곳 이상일 때만 노출(엔진 tipHazardSourcesOk). 미달이면 숨김.
    if (hz.length > 0) {
      const d = tipDistinctDomainCount(r.references);
      if (d < TIP_HAZARD_MIN_DOMAINS) out.warn('W-TIP-REF2', KEY, id, 'references', `위험 태그 팁은 서로 다른 사이트 도메인 참조 ${TIP_HAZARD_MIN_DOMAINS}곳 이상일 때만 노출 (현재 ${d}곳) — 숨김`);
    }

    // V-TIP-2 자유 텍스트: URL·가격·상호명 금지(참조 title·siteName 포함)
    for (const t of [...texts(r), ...refTexts(r)]) {
      for (const msg of tipTextProblems(t.text)) out.error('V-TIP-2', KEY, id, t.path, msg);
    }

    // V-TIP-4 최소 구성: 만드는 순서 ≥ 1, 위험 태그가 없으면 주의점·꼭 확인할 것 ≥ 1
    const len = (f: string): number => (Array.isArray(r[f]) ? (r[f] as unknown[]).length : 0);
    if (len('steps') < 1) out.error('V-TIP-4', KEY, id, 'steps', '만드는 순서 1개 이상');
    if (len('materials') < 1) out.error('V-TIP-4', KEY, id, 'materials', '필요한 물품 1개 이상');
    if (hz.length === 0 && len('cautions') + len('mustCheck') < 1) out.error('V-TIP-4', KEY, id, 'cautions', '위험 태그가 없으면 주의점 또는 꼭 확인할 것 1개 이상');
    if (hz.length > 0 && len('cautions') < 1) out.error('V-TIP-4', KEY, id, 'cautions', '위험 태그가 있으면 주의점 1개 이상');

    // V-TIP-5 길이 상한(넉넉하게 — 개요 5~10문장 수용, Kenny 2026-11-22) + W-TIP-LEN 분량 부족 경고(O-3)
    let total = 0;
    let sentences = 0;
    for (const t of texts(r)) {
      total += t.text.length;
      sentences += Math.max(1, sentenceCount(t.text));
      if (t.text.length > TIP_MAX_TEXT) out.error('V-TIP-5', KEY, id, t.path, `${t.text.length}자 > ${TIP_MAX_TEXT}자`);
    }
    for (const f of TEXT_ARRAYS) if (len(f) > TIP_MAX_LIST) out.error('V-TIP-5', KEY, id, f, `${len(f)}개 > ${TIP_MAX_LIST}개`);
    if (total > TIP_MAX_TOTAL) out.error('V-TIP-5', KEY, id, '', `본문 합 ${total}자 > ${TIP_MAX_TOTAL}자`);
    const bodySentences = sentences - (typeof r.substitute === 'string' ? 1 : 0);
    if (bodySentences < 5) out.warn('W-TIP-LEN', KEY, id, '', `개요 ${bodySentences}문장 — 링크를 열지 않아도 알 만한 5~10문장 권장(O-3)`);
  }

  // V-TIP-3 specExample — 엔진 판정(동물별 최소 규격)이 BELOW_MIN 이면 ERROR(저렴 대체품이 최소 규격 우회 통로가 되지 않게, 불변식 3).
  if (!sound) return;
  const cat = createCatalog(asSeedBundle(raw));
  for (const { rec: r, id } of ctx.rows[KEY]) {
    const ex = asRec(r.specExample);
    if (!ex) continue;
    const types = [...cat.animalTypes.values()].filter(
      (t) => t.careProfileId === r.careProfileId && (!Array.isArray(r.animalTypeIds) || r.animalTypeIds.includes(t.id)),
    );
    for (const t of types) {
      const res = checkAnimalMinSpec(cat, t.id, r.supplyItemId as string, ex as SpecValues);
      if (res.verdict === 'BELOW_MIN') out.error('V-TIP-3', KEY, id, 'specExample', `${t.id} 최소 규격 미달 — 최소 규격 미달 예시는 팁에 둘 수 없다(불변식 3)`);
    }
  }
}
