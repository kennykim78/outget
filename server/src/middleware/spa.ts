import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import { decode, ENCODING_SUFFIX, type Encoding, isPrecompressible } from '../prerender/compress.js';

// SPA(클라이언트 빌드) 정적 서빙 — 동일 오리진 단일 컨테이너 배포 전용.
//   app.ts 에서 NODE_ENV==='production' 일 때만 mountSpa(app) 으로 마운트한다.
//   테스트(non-prod)는 미마운트 → hardening.test 의 404·CSP default-src 'none' 동작 보존.
//
// 불변식 ①(무크롤링·외부출처 최소): SPA HTML 응답 CSP 의 외부 허용 출처는
//   네이버 지도(oapi.map.naver.com / *.map.naver.com / *.pstatic.net) 뿐이고, 그것도 /vet·/vet/* 응답에만(D21).
//   API/auth/health 응답은 securityHeaders 의 default-src 'none' 을 그대로 유지한다.

// client/dist 경로를 실행 위치에 견고하게 해석한다(ESM: import.meta.dirname / __dirname 대체).
//   - 로컬 prod: server/dist/middleware/spa.js → ../../../client/dist
//   - 도커 runtime: 복사 레이아웃에 맞춰 후보를 순차 탐색한다.
const HERE = path.dirname(fileURLToPath(import.meta.url));

function resolveClientDist(): string {
  const candidates = [
    // 로컬: server/dist/middleware → repo/client/dist
    path.resolve(HERE, '../../../client/dist'),
    // server 작업 디렉터리 기준(npm -w server start)
    path.resolve(process.cwd(), '../client/dist'),
    // 도커 runtime: /app/client/dist (server dist 와 형제로 복사)
    path.resolve(HERE, '../../client/dist'),
    path.resolve(process.cwd(), 'client/dist'),
    path.resolve(process.cwd(), './client/dist'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  // 못 찾으면 첫 후보를 반환(자산 없으면 fallback 핸들러가 처리).
  return candidates[0];
}

// SPA(HTML) 응답 전용 CSP — securityHeaders 의 default-src 'none' 을 덮어쓴다(R5 B3-3, D21 경로 분리, SEC L4).
//   기본: 외부 출처 0, 스크립트는 같은 오리진 파일만('unsafe-inline' 없음 — 프리렌더 HTML 의 인라인 <script> 는
//   type=application/json 데이터 블록뿐이라 실행 대상이 아니다. compliance C8-OUT-SAFE 가 실행형 인라인을 막는다).
//   style 'unsafe-inline' 은 유지(React style 속성·지도 SDK 인라인 스타일).
const CSP_COMMON_TAIL = [
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'", // Pretendard self-host(번들 woff2, 같은 오리진) — 외부 폰트 호스트 0(불변식 ①).
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

export const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  ...CSP_COMMON_TAIL,
].join('; ');

// /vet·/vet/* 전용: 네이버 지도 JS v3 SDK(script — useNaverMapLoader 가 <script src> 로 동적 주입, 인라인 불필요)
//   + 지도 타일/이미지(img) + SDK 통신(connect)만 외부 허용(불변식 ①, D21).
export const VET_CSP = [
  "default-src 'self'",
  "script-src 'self' https://oapi.map.naver.com",
  "img-src 'self' data: blob: https://*.map.naver.com https://*.pstatic.net",
  "connect-src 'self' https://*.map.naver.com",
  ...CSP_COMMON_TAIL,
].join('; ');

/** 정규화된 요청 경로 → CSP. 지도 호스트는 /vet 과 그 하위만. */
export function cspForPath(p: string): string {
  return p === '/vet' || p.startsWith('/vet/') ? VET_CSP : SPA_CSP;
}

// 정적 자산이 아닌, SPA 라우팅 대상이 되는 HTML GET 요청인지 판별.
//   /api·/auth·/health 는 app.ts 에서 이미 라우팅되어 여기(fallback)에 도달하지 않지만,
//   방어적으로 prefix 를 제외한다(혹시 라우터 미스 시에도 SPA HTML 을 API 경로에 주지 않음).
function isSpaHtmlRequest(reqPath: string): boolean {
  if (reqPath.startsWith('/api')) return false;
  if (reqPath.startsWith('/auth')) return false;
  if (reqPath.startsWith('/health')) return false;
  return true;
}

/** 프리렌더 전용 SPA 경로(URL 은 있지만 정적 HTML 이 없는 화면 — L8 이메일 저장). */
export const SPA_ONLY_PATHS: ReadonlySet<string> = new Set(['/save']);

export type NormalizedPath =
  | { kind: 'ok'; path: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'bad' };

/** 원문: 소문자·숫자·'-'·'/' 와 %XX(16진 2자리)만. */
const RAW_PATH_RE = /^(?:[a-z0-9\-/]|%[0-9A-Fa-f]{2})+$/;
const DECODED_PATH_RE = /^[a-z0-9\-/가-힣]+$/;

/**
 * 요청 경로 정규화(manifest 모드, 계획 F4): 원문은 소문자·숫자·'-'·'/'·'%' 만, percent-decode 후 NFC,
 *   디코드 결과는 소문자·숫자·'-'·'/'·한글 음절만('.'·'\'·'%'·공백·제어문자 → bad). 빈 세그먼트('//') bad.
 *   후행 '/' 는 제거 경로로 301.
 */
export function normalizeRequestPath(raw: string): NormalizedPath {
  if (typeof raw !== 'string' || !raw.startsWith('/') || !RAW_PATH_RE.test(raw)) return { kind: 'bad' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw).normalize('NFC');
  } catch {
    return { kind: 'bad' };
  }
  if (!DECODED_PATH_RE.test(decoded) || !decoded.startsWith('/')) return { kind: 'bad' };
  if (decoded.length > 1 && decoded.endsWith('/')) {
    const trimmed = decoded.replace(/\/+$/, '');
    if (trimmed === '' || trimmed.includes('//')) return { kind: 'bad' };
    return { kind: 'redirect', location: trimmed.split('/').map((seg) => encodeURIComponent(seg)).join('/') };
  }
  if (decoded.includes('//')) return { kind: 'bad' };
  return { kind: 'ok', path: decoded };
}

interface ManifestRoute {
  file: string;
  status: number;
}

/** prerender-manifest.json → (경로 → dist 내부 절대 파일). 없거나 손상이면 null(현행 동작, D16). */
function loadManifest(clientDist: string): Map<string, ManifestRoute> | null {
  const manPath = path.join(clientDist, 'prerender-manifest.json');
  if (!fs.existsSync(manPath)) return null;
  let m: unknown;
  try {
    m = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  } catch {
    return null;
  }
  const routes = (m as { routes?: unknown })?.routes;
  if (!Array.isArray(routes)) return null;
  const out = new Map<string, ManifestRoute>();
  for (const r of routes as Array<Record<string, unknown>>) {
    if (typeof r?.path !== 'string' || typeof r.file !== 'string') continue;
    const abs = containedFile(clientDist, r.file);
    if (!abs) continue;
    out.set(r.path.normalize('NFC'), { file: abs, status: r.kind === 'NOT_FOUND' ? 404 : 200 });
  }
  return out;
}

/** dist 내부의 실제 파일만(path.resolve 포함 검사). */
function containedFile(root: string, rel: string): string | null {
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  if (!abs.startsWith(base + path.sep)) return null;
  return abs;
}

// ── R6 F2a: 사전 압축본(.br/.gz) 협상 ─────────────────────────────────────────
//   빌드(scripts/precompress.mjs)가 만든 사본만 보낸다(런타임 압축 0). HTML 은 런타임 변형 경로가 없다(sendFile 그대로) —
//   프리렌더 HTML·셸·404 모두 같은 규칙. 사본이 원본과 다르면(재프리렌더 후 미압축 등) 보내지 않는다(내용 검증 캐시).
//   헤더: Content-Encoding · Vary: Accept-Encoding · 원본 Content-Type(send 와 같은 계산) · 인코딩별 ETag.
//   Cache-Control·Last-Modified 는 send 기본값(원본 서빙과 같은 정책), CSP 는 호출자가 정한 값 그대로.

const ENCODINGS: readonly Encoding[] = ['br', 'gzip'];

/**
 * Accept-Encoding → 받을 수 있는 사전 압축 코딩(선호 순). q=0 은 거부, q 높은 순, 같으면 br 먼저.
 *   '*' 는 명시되지 않은 코딩에 적용, x-gzip 은 gzip 별칭.
 */
export function acceptedEncodings(header: string | string[] | undefined): Encoding[] {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return [];
  const q = new Map<string, number>();
  for (const part of raw.split(',')) {
    const [name, ...params] = part.split(';');
    const n = name.trim().toLowerCase();
    if (n === '' || q.has(n)) continue;
    let v = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*(.*?)\s*$/i.exec(p);
      if (!m) continue;
      v = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(m[1]) ? Number(m[1]) : 0; // 형식 오류 q → 거부
    }
    q.set(n, v);
  }
  const of = (e: Encoding): number => q.get(e) ?? (e === 'gzip' ? q.get('x-gzip') : undefined) ?? q.get('*') ?? 0;
  return ENCODINGS.filter((e) => of(e) > 0).sort((a, b) => of(b) - of(a)); // 안정 정렬 → 동률이면 br 먼저
}

// send(=express.static·res.sendFile) 와 같은 Content-Type 계산(mime v1 + charset) — 원본 응답과 바이트 단위 동일.
const sendMime = (express.static as unknown as { mime: { lookup(p: string): string | null; charsets: { lookup(t: string): string | false } } }).mime;
function sendContentType(file: string): string {
  const type = sendMime.lookup(file) ?? 'application/octet-stream';
  const charset = sendMime.charsets.lookup(type);
  return type + (charset ? `; charset=${charset}` : '');
}

interface VariantCheck {
  sig: string;
  ok: boolean;
}

/** 사본이 원본과 같은 내용인지(해제 = 원본 바이트) — (원본·사본 크기·mtime) 서명별 1회 검증. */
function verifiedVariant(file: string, enc: Encoding, cache: Map<string, VariantCheck>): fs.Stats | null {
  const encFile = file + ENCODING_SUFFIX[enc];
  let o: fs.Stats;
  let s: fs.Stats;
  try {
    o = fs.statSync(file);
    s = fs.statSync(encFile);
  } catch {
    return null;
  }
  if (!o.isFile() || !s.isFile()) return null;
  const sig = `${o.size}:${o.mtimeMs}:${s.size}:${s.mtimeMs}`;
  const hit = cache.get(encFile);
  if (hit && hit.sig === sig) return hit.ok ? s : null;
  let ok = false;
  try {
    ok = decode(enc, fs.readFileSync(encFile)).equals(fs.readFileSync(file));
  } catch {
    ok = false;
  }
  cache.set(encFile, { sig, ok });
  return ok ? s : null;
}

/**
 * 보낼 파일 결정 + 인코딩 헤더. 사본이 하나라도 있으면 Vary: Accept-Encoding(원본을 보내도 — 공유 캐시 혼선 방지).
 *   반환값이 file 과 같으면 원본(호출자가 기존 방식으로 보낸다).
 */
function negotiate(req: Request, res: Response, file: string, cache: Map<string, VariantCheck>): string {
  if (!isPrecompressible(file)) return file;
  const present = ENCODINGS.filter((e) => fs.existsSync(file + ENCODING_SUFFIX[e]));
  if (present.length === 0) return file;
  res.vary('Accept-Encoding');
  for (const enc of acceptedEncodings(req.headers['accept-encoding'])) {
    if (!present.includes(enc)) continue;
    const st = verifiedVariant(file, enc, cache);
    if (!st) continue;
    res.setHeader('Content-Type', sendContentType(file));
    res.setHeader('Content-Encoding', enc);
    // 인코딩별 ETag(send 의 W/"size-mtime" 형식 + 코딩 접미사) — 원본·br·gz 가 서로 다른 표현으로 검증된다.
    res.setHeader('ETag', `W/"${s16(st.size)}-${s16(Math.floor(st.mtimeMs))}-${enc}"`);
    return file + ENCODING_SUFFIX[enc];
  }
  return file;
}
const s16 = (n: number): string => n.toString(16);

/** 협상해 보내고, 사본 전송이 시작 전에 실패하면 인코딩 헤더를 걷고 fallback(원본 경로). */
function sendNegotiated(req: Request, res: Response, file: string, cache: Map<string, VariantCheck>, fallback: () => void): void {
  const target = negotiate(req, res, file, cache);
  if (target === file) {
    fallback();
    return;
  }
  res.sendFile(target, (err) => {
    if (!err || res.headersSent) return;
    res.removeHeader('Content-Encoding');
    res.removeHeader('ETag');
    res.removeHeader('Content-Type');
    fallback();
  });
}

export interface MountSpaOptions {
  /** 테스트·특수 배치용. 기본은 resolveClientDist(). */
  clientDist?: string;
}

export function mountSpa(app: Express, opts: MountSpaOptions = {}): void {
  const clientDist = path.resolve(opts.clientDist ?? resolveClientDist());
  const indexHtml = path.join(clientDist, 'index.html');
  const manifest = loadManifest(clientDist);
  const variants = new Map<string, VariantCheck>();

  // F2a: 정적 자산의 사전 압축본 — 원본이 dist 안의 실제 파일이고 사본이 검증될 때만. 아니면 express.static 이 원본.
  //   '..'·dot 세그먼트·역슬래시·NUL 은 손대지 않고 express.static 에 넘긴다(기존 거부 동작 유지).
  const precompressedStatic: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      next();
      return;
    }
    if (/[\\\0]/.test(rel) || rel.split('/').some((seg) => seg.startsWith('.')) || !isPrecompressible(rel)) {
      next();
      return;
    }
    const abs = containedFile(clientDist, rel.replace(/^\/+/, ''));
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      next();
      return;
    }
    sendNegotiated(req, res, abs, variants, () => next());
  };
  app.use(precompressedStatic);

  // 정적 자산 서빙. index:false → 디렉터리 요청에 자동 index.html 응답 금지, redirect:false → 디렉터리 301 금지
  //   (아래 핸들러가 CSP 와 함께 처리). '..' 등은 send 가 거부 → fallthrough 로 아래에서 404.
  app.use(express.static(clientDist, { index: false, redirect: false }));

  if (manifest) {
    // 프리렌더 모드(D16): manifest 라우트 → 파일, /save → 셸, 그 외 404.html(404).
    const shell = fs.existsSync(path.join(clientDist, 'shell.html')) ? path.join(clientDist, 'shell.html') : indexHtml;
    const notFound = path.join(clientDist, '404.html');
    const sendHtml = (req: Request, res: Response, file: string, status: number, csp: string): void => {
      if (!fs.existsSync(file)) {
        res.status(404).type('text/plain').send('Not Found');
        return;
      }
      res.status(status);
      res.setHeader('Content-Security-Policy', csp);
      sendNegotiated(req, res, file, variants, () => res.sendFile(file));
    };
    const prerendered: RequestHandler = (req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || !isSpaHtmlRequest(req.path)) {
        next();
        return;
      }
      const n = normalizeRequestPath(req.path);
      if (n.kind === 'redirect') {
        const q = req.originalUrl.indexOf('?');
        res.redirect(301, n.location + (q >= 0 ? req.originalUrl.slice(q) : ''));
        return;
      }
      if (n.kind === 'ok') {
        const csp = cspForPath(n.path);
        const r = manifest.get(n.path);
        if (r) {
          sendHtml(req, res, r.file, r.status, csp);
          return;
        }
        if (SPA_ONLY_PATHS.has(n.path)) {
          sendHtml(req, res, shell, 200, csp);
          return;
        }
        sendHtml(req, res, notFound, 404, csp);
        return;
      }
      sendHtml(req, res, notFound, 404, SPA_CSP);
    };
    app.use(prerendered);
    return;
  }

  // 현행(manifest 없음): 자산에 매칭되지 않은 GET(HTML 진입) → index.html + SPA 전용 CSP.
  const fallback: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (!isSpaHtmlRequest(req.path)) {
      next();
      return;
    }
    if (!fs.existsSync(indexHtml)) {
      next();
      return;
    }
    // securityHeaders 의 default-src 'none' 을 SPA CSP 로 덮어쓴다.
    //   경로가 정규화되지 않으면(bad) 지도 호스트 없는 기본 CSP.
    const n = normalizeRequestPath(req.path);
    res.setHeader('Content-Security-Policy', n.kind === 'ok' ? cspForPath(n.path) : SPA_CSP);
    sendNegotiated(req, res, indexHtml, variants, () => res.sendFile(indexHtml));
  };

  app.use(fallback);
}
