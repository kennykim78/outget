// 362 N13 — 몰 공식 API 응답 → 피드 행 정규화(순수). 네트워크 구현 0: 호출은 주입된 transport 만 한다.
//   실제 transport(호스트·서명·요청)는 N15(키 발급·약관 확인, Kenny) 전까지 만들지 않는다 — 이 파일에 호스트 리터럴·fetch 없음.
//   남기는 값 = 상품명·링크·이미지·가격(KRW 만)뿐. 수수료·판매량·평점·상품 id·판매처는 읽지도 옮기지도 않는다(불변식 ④·⑤).
//   키 값은 어디에도 출력하지 않는다 — 오류는 환경변수 이름만.

/** 공급자별 필요 환경변수 이름(값은 다루지 않는다). */
export const PROVIDER_KEY_ENV = Object.freeze({
  COUPANG: Object.freeze(['COUPANG_PARTNERS_ACCESS_KEY', 'COUPANG_PARTNERS_SECRET_KEY']),
  ALIEXPRESS: Object.freeze(['ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_TRACKING_ID']),
});

/** transport 에 넘기는 자격 키 이름(환경변수 → 요청 필드). */
const CRED_FIELD = Object.freeze({
  COUPANG_PARTNERS_ACCESS_KEY: 'accessKey',
  COUPANG_PARTNERS_SECRET_KEY: 'secretKey',
  ALIEXPRESS_APP_KEY: 'appKey',
  ALIEXPRESS_APP_SECRET: 'appSecret',
  ALIEXPRESS_TRACKING_ID: 'trackingId',
});

/**
 * 링크·이미지 규칙은 이 파일에 두지 않는다(단일 소스 server/src/engine/providers.ts FEED_LINK_RE·FEED_IMAGE_HOSTS —
 *   제휴 호스트 리터럴 C10-AFF-HOST). 호출부가 rules = { linkRe, imageHosts } 로 주입한다. 주입이 없으면
 *   링크는 https 일반 형태만(로더가 정확 패턴을 다시 검사), 이미지는 전부 null.
 */
function isPlainHttps(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && raw.startsWith(`https://${u.hostname}/`);
  } catch {
    return false;
  }
}

/** 응답 필드 이름(공급자별, 읽는 필드만). 잠정값 — N15 첫 실호출로 확정. */
const FIELD = Object.freeze({
  COUPANG: Object.freeze({ title: 'productName', url: 'productUrl', image: 'productImage', price: 'productPrice', currency: null }),
  ALIEXPRESS: Object.freeze({ title: 'product_title', url: 'promotion_link', image: 'product_main_image_url', price: 'target_sale_price', currency: 'target_sale_price_currency' }),
});

export const FEED_ROW_CAP = 10;

/** 자격 확인 — 값은 돌려주되 출력하지 않는다. 없으면 이름만. */
export function providerCreds(provider, env) {
  const names = PROVIDER_KEY_ENV[provider];
  if (!names) return { ok: false, missing: [`(알 수 없는 공급자 ${String(provider)})`] };
  const missing = names.filter((n) => typeof env?.[n] !== 'string' || env[n].trim() === '');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, creds: Object.fromEntries(names.map((n) => [CRED_FIELD[n], env[n]])) };
}

const ZW_RE = /[­​-‏⁠﻿]/g;
/** 금지어 검사(seed/lint.ts 보다 엄격): NFKC·제로폭 제거 후, 공백 유지·제거 두 형태 모두에서 banned·stems 하나라도 걸리면 true. */
export function titleBanned(title, bannedJson) {
  const spaced = String(title).normalize('NFKC').replace(ZW_RE, '').replace(/\s+/g, ' ');
  const stripped = spaced.replace(/ /g, '');
  const list = [...(bannedJson?.banned ?? []), ...(bannedJson?.stems ?? [])];
  return list.some((w) => {
    const re = new RegExp(w.pattern, 'iu');
    return re.test(spaced) || re.test(stripped);
  });
}

function cleanTitle(s) {
  if (typeof s !== 'string') return null;
  const t = s
    .normalize('NFKC')
    .replace(ZW_RE, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 0 && t.length <= 200 ? t : null;
}

function imageOf(raw, hosts) {
  if (!isPlainHttps(raw)) return null;
  return Array.isArray(hosts) && hosts.includes(new URL(raw).hostname) ? raw : null;
}

function priceOf(provider, item) {
  const f = FIELD[provider];
  // 쿠팡 응답은 원화 정수(통화 필드 없음, 잠정). 알리는 통화 필드가 KRW 일 때만.
  if (f.currency !== null && item[f.currency] !== 'KRW') return null;
  const raw = item[f.price];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? { amount: n, currency: 'KRW' } : null;
}

/**
 * 응답 아이템 하나 → { title, url, imageUrl, price } 또는 null(제목·링크 불량).
 *   displayFields(약관 확인 결과)에 없는 imageUrl·price 는 null. rules = { linkRe?: RegExp, imageHosts?: string[] }.
 */
export function normalizeItem(provider, item, displayFields, rules = {}) {
  const f = FIELD[provider];
  if (!f || !item || typeof item !== 'object') return null;
  const title = cleanTitle(item[f.title]);
  const rawUrl = item[f.url];
  const url = isPlainHttps(rawUrl) && (!(rules.linkRe instanceof RegExp) || rules.linkRe.test(rawUrl)) ? rawUrl : null;
  if (title === null || url === null) return null;
  return {
    title,
    url,
    imageUrl: displayFields.includes('imageUrl') ? imageOf(item[f.image], rules.imageHosts) : null,
    price: displayFields.includes('price') ? priceOf(provider, item) : null,
  };
}

/**
 * 주입 transport 래퍼. transport(req) → { method, sort, items[] }. 실제 transport 는 아직 없다(N15).
 * @param {{ provider: 'COUPANG'|'ALIEXPRESS', creds: object, transport: Function }} o
 */
export function createShopApi({ provider, creds, transport }) {
  if (typeof transport !== 'function') throw new Error('shop-api: transport 주입 필요(실호출 구현 없음 — N15)');
  if (!PROVIDER_KEY_ENV[provider]) throw new Error('shop-api: 알 수 없는 공급자');
  return {
    async search(keyword, limit = FEED_ROW_CAP) {
      const res = await transport({ provider, keyword, limit, creds });
      const items = Array.isArray(res?.items) ? res.items : [];
      const id = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : null);
      return { method: id(res?.method), sort: id(res?.sort), items };
    },
  };
}
