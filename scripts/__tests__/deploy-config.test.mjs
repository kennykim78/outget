// deploy/ 정적 검사 — 접속 기록 0(Caddy·compose), 수동 실행만(deploy.yml), 시크릿 0(저장소), 로그 보관 7일 패리티.
//   Kenny 2026-10-27: 내부 테스트, workflow_dispatch 만, "접속 기록 남기지 않음".
//   Kenny 2026-11-02(ORDERS §40): 비밀번호(basic_auth) 없음 — 공개 접근, 검색 노출 차단(X-Robots-Tag noindex·robots Disallow)은 유지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const CADDY = read('deploy', 'Caddyfile');
const COMPOSE = read('deploy', 'compose.yaml');
const WORKFLOW = read('.github', 'workflows', 'deploy.yml');
const BOOTSTRAP = read('deploy', 'bootstrap.sh');

/** Caddyfile → 최상위 블록 [{ head, lines: [{depth, words}] }]. 주석·빈 줄 제외, 따옴표 안 # 은 다루지 않는다(이 파일엔 없음). */
function caddyBlocks(text) {
  const blocks = [];
  let depth = 0;
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    const words = line.split(/\s+/);
    if (depth === 0) {
      cur = { head: line.replace(/\s*\{$/, ''), lines: [] };
      blocks.push(cur);
    } else {
      cur.lines.push({ depth, words });
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    assert.ok(depth >= 0, `Caddyfile 괄호 불균형: ${raw}`);
  }
  assert.equal(depth, 0, 'Caddyfile 괄호 불균형(끝)');
  return blocks;
}

test('Caddyfile: 사이트 블록에 log 지시어 0(접속 기록 없음), 전역 기본 로거는 http 네임스페이스 전체 제외', () => {
  const blocks = caddyBlocks(CADDY);
  const global = blocks.filter((b) => b.head === '' || b.head === '{');
  const sites = blocks.filter((b) => !(b.head === '' || b.head === '{'));
  assert.equal(global.length, 1, '전역 옵션 블록 1개');
  assert.deepEqual(sites.map((b) => b.head).sort(), ['withsmall.kr', 'www.withsmall.kr']);
  for (const s of sites) {
    for (const l of s.lines) {
      assert.notEqual(l.words[0], 'log', `${s.head}: log 지시어(접속 기록)`);
      assert.notEqual(l.words[0], 'log_append', s.head);
      assert.notEqual(l.words[0], 'log_skip', s.head);
      assert.notEqual(l.words[0], 'encode', `${s.head}: encode 없음(앱이 사전 압축본 서빙)`);
    }
  }
  const g = global[0].lines;
  const logIdx = g.findIndex((l) => l.words[0] === 'log');
  assert.ok(logIdx >= 0, '전역 log default 블록');
  assert.deepEqual(g[logIdx].words, ['log', 'default', '{']);
  const excl = g.find((l) => l.words[0] === 'exclude');
  assert.ok(excl, 'exclude 줄');
  assert.ok(excl.words.includes('http'), 'http 전체 제외(http.log.access·http.log.error·http.handlers·http.stdlib)');
  assert.ok(!g.some((l) => l.words[0] === 'include'), 'include 를 쓰면 제외 목록이 무력화될 수 있다');
  // 전역에서 access 로그 켜는 옵션 금지.
  assert.doesNotMatch(CADDY, /^\s*(log_credentials|trusted_proxies|client_ip_headers)\b/m);
});

test('Caddyfile: 비밀번호 없음(basic_auth 0 · env 자리 0, ORDERS §40) · noindex · -Server · www 302', () => {
  const blocks = caddyBlocks(CADDY);
  const apex = blocks.find((b) => b.head === 'withsmall.kr');
  const words = apex.lines.map((l) => l.words.join(' '));
  // 어느 블록·깊이에서도 인증 지시어 없음(basicauth 는 옛 이름) — 제휴 심사자가 바로 연다.
  for (const b of blocks) {
    for (const l of b.lines) assert.ok(!/^(basic_?auth|forward_auth)$/i.test(l.words[0]), `${b.head}: ${l.words.join(' ')}`);
  }
  assert.doesNotMatch(CADDY.replace(/(^|\s)#.*$/gm, ''), /\{\$[A-Z_]+|\{env\./, 'Caddyfile 은 환경 변수를 읽지 않는다(caddy.env 없음 — {$X}·{env.X} 둘 다, QA262 INFO-4)');
  assert.doesNotMatch(CADDY, /\$2[aby]\$\d\d\$/, 'bcrypt 해시가 저장소에');
  assert.ok(words.includes('-Server'));
  assert.ok(words.includes('X-Robots-Tag "noindex, nofollow"'));
  // noindex 가 모든 경로에 붙는다 — apex 의 header 블록은 경로 매처 없이 하나(QA262 LOW-1).
  const hdrDepth = apex.lines.find((l) => l.words[0] === 'reverse_proxy').depth;
  const hdr = apex.lines.filter((l) => l.words[0] === 'header' && l.depth === hdrDepth);
  assert.deepEqual(hdr.map((l) => l.words), [['header', '{']], 'apex header 블록은 매처 없이 하나');
  assert.ok(words.includes('reverse_proxy app:3001'));
  // 오류 응답(502 등)에도 -Server·noindex — 지연 헤더는 오류 경로에 안 붙는다(로컬 caddy 2.10 재현).
  const he = apex.lines.findIndex((l) => l.words[0] === 'handle_errors');
  assert.ok(he >= 0, 'handle_errors');
  const heBody = apex.lines.slice(he + 1).filter((l) => l.depth === apex.lines[he].depth + 1).map((l) => l.words.join(' '));
  assert.ok(heBody.includes('header -Server'));
  assert.ok(heBody.includes('header X-Robots-Tag "noindex, nofollow"'));
  assert.ok(!words.some((w) => /Strict-Transport-Security/i.test(w)), '내부 테스트 동안 HSTS 끔');
  const www = blocks.find((b) => b.head === 'www.withsmall.kr');
  assert.ok(www.lines.some((l) => l.words.join(' ') === 'redir https://withsmall.kr{uri} 302'));
});

// 264(Kenny ORDERS §41, security 257 4a·4b): Phase 0 동안 운영자 경로만 외부 404. 저장 흐름(US-025)은 열어 둔다.
//   /auth/logout 은 저장 흐름이 아니라 운영자 로그아웃(auth.routes.ts:134), 클라 미사용 — 막지 않아도 무해(bcrypt 없음·refresh 쿠키 필요).
const OPERATOR_BLOCKED = ['/auth/login', '/auth/login/', '/auth/refresh', '/auth/refresh/', '/auth/me', '/auth/me/', '/admin', '/admin/*'];
// 열어 두는 경로: 저장 흐름(server/src/save/magic.routes.ts) + 운영자 로그아웃(위 주석) — 하나라도 매처에 걸리면 안 된다.
const SAVE_FLOW_OPEN = ['/auth/magic/request', '/auth/magic/verify', '/auth/session', '/auth/logout'];

/** Caddy path 매처 한 패턴이 경로와 맞는지(정확 일치 또는 끝 '*' 접두, 대소문자 무시 — Caddy MatchPath 와 같은 범위만). */
function caddyPathMatches(pattern, path) {
  const p = pattern.toLowerCase();
  const x = path.toLowerCase();
  if (p.endsWith('*') && !p.slice(0, -1).includes('*')) return x.startsWith(p.slice(0, -1));
  if (p.includes('*')) return null; // 이 파일에서 쓰지 않는 형태 — 판정 불가로 실패시킨다
  return x === p;
}

/** apex 블록의 운영자 404 구성 → 막는 경로 목록. 어긋나면 throw(변이 시험이 같은 함수를 쓴다). */
function operatorGuard(text) {
  const apex = caddyBlocks(text).find((b) => b.head === 'withsmall.kr');
  assert.ok(apex, 'apex 블록');
  const top = apex.lines.find((l) => l.words[0] === 'reverse_proxy').depth;
  const at = apex.lines.filter((l) => l.depth === top);
  const matchers = at.filter((l) => l.words[0].startsWith('@'));
  assert.deepEqual(matchers.map((l) => l.words[0]), ['@operator'], 'apex 이름 매처는 @operator 하나');
  const m = matchers[0].words;
  assert.equal(m[1], 'path', '@operator 는 path 매처 한 줄(블록·다른 매처 없음)');
  assert.ok(m.length > 2 && !m.includes('{'), '@operator path 목록');
  const paths = m.slice(2);
  // respond @operator 404 — 상태만, 본문 0. error(오류 경로 → handle_errors) 가 아니라 respond(위 header 블록이 그대로 붙음).
  const resp = at.filter((l) => l.words[0] === 'respond');
  assert.deepEqual(resp.map((l) => l.words), [['respond', '@operator', '404']], 'respond @operator 404 한 줄(본문 없음)');
  assert.ok(!apex.lines.some((l) => l.words[0] === 'error'), 'error 지시어 0(오류 경로로 보내지 않는다)');
  assert.ok(!at.some((l) => /^(handle|handle_path|route)$/.test(l.words[0])), 'handle/route 블록 0 — 순서는 Caddy 기본 지시어 순서(respond 가 reverse_proxy 앞)');
  const idx = (w) => at.findIndex((l) => l.words[0] === w);
  assert.ok(idx('@operator') < idx('respond') && idx('respond') < idx('reverse_proxy'), '매처 → respond → reverse_proxy 순서(읽기 순서)');
  for (const open of SAVE_FLOW_OPEN) {
    for (const p of paths) {
      const hit = caddyPathMatches(p, open);
      assert.notEqual(hit, null, `판정 못 하는 패턴 ${p}`);
      assert.equal(hit, false, `${p} 가 저장 흐름 ${open} 을 막는다`);
    }
    // 대소문자·끝 슬래시 변형도 열려 있어야 한다.
    for (const v of [open.toUpperCase(), `${open}/`]) assert.ok(!paths.some((p) => caddyPathMatches(p, v)), `저장 흐름 변형 ${v} 이 막힘`);
  }
  return paths;
}

test('Caddyfile 264: 운영자 경로 외부 404 — 목록 정확히, 저장 흐름(/auth/magic/*·/auth/session)·운영자 로그아웃(/auth/logout) 미차단', () => {
  assert.deepEqual(operatorGuard(CADDY), OPERATOR_BLOCKED);
  // 실제 운영자 경로가 전부 막힌다(대소문자 무시 — Express 라우팅도 같음).
  for (const x of ['/auth/login', '/AUTH/Login', '/auth/login/', '/auth/refresh', '/auth/refresh/', '/auth/me', '/auth/me/', '/admin', '/admin/', '/admin/ping', '/Admin/Ping']) {
    assert.ok(OPERATOR_BLOCKED.some((p) => caddyPathMatches(p, x)), x);
  }
  // 앱 공개 경로는 그대로.
  for (const x of ['/', '/privacy', '/health', '/api/events', '/api/save', '/api/vets/reports', '/auth/magic/verify', '/auth/session', '/auth/logout', '/administrator-guide']) {
    assert.ok(!OPERATOR_BLOCKED.some((p) => caddyPathMatches(p, x)), x);
  }
});

test('Caddyfile 264 변이: 경로 빠짐·저장 흐름 차단·error 로 바꿈·본문 추가·매처 이름 변경·순서 바꿈은 모두 실패', () => {
  const swap = (a, b) => {
    assert.ok(CADDY.includes(a), `변이 원본 없음: ${a}`);
    return CADDY.replace(a, b);
  };
  const line = '@operator path /auth/login /auth/login/ /auth/refresh /auth/refresh/ /auth/me /auth/me/ /admin /admin/*';
  const mutants = {
    '로그인 빠짐': swap(line, line.replace('/auth/login /auth/login/ ', '')),
    'admin/* 빠짐': swap(line, line.replace(' /admin/*', '')),
    'magic 차단': swap(line, `${line} /auth/magic/*`),
    'auth 전체 차단': swap(line, '@operator path /auth/* /admin /admin/*'),
    'session 차단': swap(line, `${line} /auth/session`),
    'logout 차단': swap(line, `${line} /auth/logout`),
    'error 경로': swap('respond @operator 404', 'error @operator 404'),
    '본문 추가': swap('respond @operator 404', 'respond @operator "Not Found" 404'),
    '상태 바꿈': swap('respond @operator 404', 'respond @operator 403'),
    'respond 없음': swap('\trespond @operator 404\n', ''),
    '매처 이름': CADDY.replaceAll('@operator', '@ops'),
  };
  for (const [name, text] of Object.entries(mutants)) {
    assert.throws(() => assert.deepEqual(operatorGuard(text), OPERATOR_BLOCKED), `변이 "${name}" 가 통과했다`);
  }
  // 순서: respond 를 reverse_proxy 뒤로.
  const reordered = CADDY.replace('\trespond @operator 404\n', '').replace('\treverse_proxy app:3001\n', '\treverse_proxy app:3001\n\trespond @operator 404\n');
  assert.notEqual(reordered, CADDY);
  assert.throws(() => operatorGuard(reordered), '순서 변이 통과');
  // 원본은 통과(변이 함수 자체가 늘 throw 하는 것이 아님).
  assert.doesNotThrow(() => operatorGuard(CADDY));
});

test('deploy.yml: 트리거는 workflow_dispatch 하나뿐', () => {
  const lines = WORKFLOW.split('\n');
  const onIdx = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(onIdx >= 0, '최상위 on: 블록');
  assert.equal(lines.filter((l) => /^(on|"on"|'on'|true):/.test(l)).length, 1, 'on: 한 번');
  const keys = [];
  for (let i = onIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = /^ {2}([A-Za-z_]+):/.exec(l);
    if (m) keys.push(m[1]);
  }
  assert.deepEqual(keys, ['workflow_dispatch']);
  assert.doesNotMatch(WORKFLOW, /^[ \t]*(pull_request|pull_request_target|workflow_run|schedule|repository_dispatch|workflow_call):/m);
  // push: 는 build-push-action 의 with.push(깊은 들여쓰기)만 — 트리거 깊이(0~4칸)에는 없다.
  assert.doesNotMatch(WORKFLOW, /^[ \t]{0,4}push:/m);
});

test('deploy.yml: 시크릿은 build-args 에 없고 env 로만, provenance false, 이미지 태그 sha-<12>', () => {
  const ba = /build-args:\s*\|\n((?: {12}.*\n)+)/.exec(WORKFLOW);
  assert.ok(ba, 'build-args 블록');
  assert.doesNotMatch(ba[1], /secrets\./, 'build-args 에 secrets');
  assert.deepEqual(
    ba[1].trim().split('\n').map((l) => l.trim().split('=')[0]),
    ['SITE_ORIGIN', 'WS_INDEXABLE', 'VITE_NAVER_MAP_CLIENT_ID'],
  );
  assert.match(WORKFLOW, /provenance: false/);
  assert.match(WORKFLOW, /tag=sha-\$\{GITHUB_SHA::12\}/);
  for (const s of ['DEPLOY_SSH_KEY', 'DEPLOY_HOST', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_USER']) {
    assert.match(WORKFLOW, new RegExp(`\\$\\{\\{ secrets\\.${s} \\}\\}`), s);
  }
  // secrets.* 는 env: 값으로만(run 스크립트 본문에 직접 펼치지 않는다 — 로그·셸 주입 차단).
  for (const l of WORKFLOW.split('\n').filter((x) => x.includes('secrets.'))) {
    assert.match(l, /^\s+(?:[A-Z_]+|password): \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/, l);
  }
  assert.match(WORKFLOW, /StrictHostKeyChecking=yes/);
  assert.doesNotMatch(WORKFLOW, /StrictHostKeyChecking=no/);
});

test('compose: app 은 호스트 포트 0·journald, caddy 만 80/443, 이미지는 WS_IMAGE 필수', () => {
  const svc = (name) => {
    const m = new RegExp(`^ {2}${name}:\\n((?: {4,}.*\\n|\\n)+)`, 'm').exec(COMPOSE);
    assert.ok(m, name);
    return m[1];
  };
  const app = svc('app');
  const caddy = svc('caddy');
  assert.doesNotMatch(app, /^\s+ports:/m, 'app 호스트 포트 공개 금지');
  assert.match(app, /image: \$\{WS_IMAGE:\?/);
  assert.match(app, /env_file:\n\s+- \.\/server\.env/);
  // basic_auth 폐기(ORDERS §40): caddy 는 env 파일·환경 변수를 받지 않는다 — 서버에 옛 caddy.env 가 없어도 기동.
  assert.doesNotMatch(caddy, /^\s+(env_file|environment):/m, 'caddy env_file/environment');
  assert.doesNotMatch(COMPOSE.replace(/^\s*#.*$/gm, ''), /caddy\.env/, 'compose 에 caddy.env 참조(주석 제외)');
  for (const s of [app, caddy]) assert.match(s, /logging:\n\s+driver: journald/);
  assert.match(caddy, /- "80:80"/);
  assert.match(caddy, /- "443:443"/);
  assert.doesNotMatch(COMPOSE, /SECRET\s*[:=]|PASSWORD|_HASH\s*[:=]/i);
});

test('서버 오류 기록 보관: bootstrap journald 일수 = policy.ts SERVER_LOG_RETENTION_DAYS', () => {
  const policy = read('server', 'src', 'privacy', 'policy.ts');
  const p = /export const SERVER_LOG_RETENTION_DAYS = (\d+);/.exec(policy);
  assert.ok(p, 'policy.ts SERVER_LOG_RETENTION_DAYS');
  const b = /^JOURNAL_DAYS=(\d+)$/m.exec(BOOTSTRAP);
  assert.ok(b, 'bootstrap JOURNAL_DAYS');
  assert.equal(b[1], p[1]);
  assert.match(BOOTSTRAP, /MaxRetentionSec=\$\{JOURNAL_DAYS\}day/);
  assert.match(BOOTSTRAP, /"log-driver": "journald"/);
});

test('bootstrap: ufw 안 씀, Oracle REJECT 앞 삽입, 강제 명령 키, data 1000:1000 750, env 0600', () => {
  assert.doesNotMatch(BOOTSTRAP, /^\s*ufw\b/m);
  assert.match(BOOTSTRAP, /iptables -I INPUT "\$pos"/);
  assert.match(BOOTSTRAP, /restrict,command="%s\/bin\/deploy-gate\.sh"/);
  assert.match(BOOTSTRAP, /install -d -m 0750 -o 1000 -g 1000 "\$ROOT\/data"/);
  assert.match(BOOTSTRAP, /^chmod 0600 "\$ROOT\/server\.env"$/m);
  // caddy.env 는 만들지 않고(예시 복사 0), 옛 bootstrap 이 만든 것은 지운다(ORDERS §40).
  assert.doesNotMatch(BOOTSTRAP, /caddy\.env\.example/);
  assert.doesNotMatch(BOOTSTRAP, /> "\$ROOT\/caddy\.env"/);
  assert.match(BOOTSTRAP, /^  rm -f "\$ROOT\/caddy\.env"$/m);
  assert.doesNotMatch(BOOTSTRAP, /caddy\.env 채우기|WS_BASIC/);
  assert.match(BOOTSTRAP, /PasswordAuthentication no/);
  // QA133 INFO-11: 배포 키로 env(WS_ROOT·WS_DOCKER 등) 주입 불가를 기본값이 아니라 설정으로 고정.
  assert.match(BOOTSTRAP, /^PermitUserEnvironment no$/m);
  assert.doesNotMatch(BOOTSTRAP, /environment="/);
  // 시크릿 값은 출력하지 않는다(생성 값 변수 v 를 echo/printf/log 하지 않음).
  assert.doesNotMatch(BOOTSTRAP, /(echo|printf|log)[^\n]*\$v\b/);
});

test('예시 env: 시크릿 자리는 __SET_ME__ 만, 값 0', () => {
  assert.ok(!existsSync(join(ROOT, 'deploy', 'caddy.env.example')), 'caddy.env.example 은 없다(basic_auth 폐기)');
  for (const f of ['server.env.example', 'deploy.conf.example']) {
    const t = read('deploy', f);
    for (const l of t.split('\n')) {
      if (l.startsWith('#') || l.trim() === '') continue;
      const [k, ...rest] = l.split('=');
      const v = rest.join('=');
      if (/SECRET|KEY|HASH|USER$/.test(k)) assert.ok(v === '' || v === '__SET_ME__' || v === "'__SET_ME__'", `${f} ${k}`);
    }
  }
  const s = read('deploy', 'server.env.example');
  assert.match(s, /^TRUST_PROXY=1$/m);
  assert.match(s, /^NODE_ENV=production$/m);
  assert.match(s, /^PUBLIC_ORIGIN=https:\/\/withsmall\.kr$/m);
});

// 377 S5: 상품 피드 env 이름이 예시에 있고 값은 비어 있다.
test('예시 env: 상품 피드 이름 7개 — 빈 값만', () => {
  const names = ['WS_PRODUCT_FEED', 'WS_FEED_IMG_HOSTS', 'COUPANG_PARTNERS_ACCESS_KEY', 'COUPANG_PARTNERS_SECRET_KEY',
    'ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET', 'ALIEXPRESS_TRACKING_ID'];
  for (const [f, t] of [['.env.example', read('.env.example')], ['deploy/server.env.example', read('deploy', 'server.env.example')]]) {
    for (const n of names) {
      const hits = t.split(String.fromCharCode(10)).filter((l) => new RegExp(`^(?:# )?${n}=`).test(l));
      assert.deepEqual(hits.map((l) => l.replace(/^# /, '')), [`${n}=`], `${f} ${n}`);
    }
  }
});

test('deploy/*.sh: sh -n 문법 통과', () => {
  const sh = process.platform === 'win32'
    ? [process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'usr', 'bin', 'sh.exe'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'bin', 'sh.exe')].find((p) => p && existsSync(p))
    : 'sh';
  assert.ok(sh, 'POSIX sh');
  const files = readdirSync(join(ROOT, 'deploy')).filter((f) => f.endsWith('.sh'));
  assert.deepEqual(files.sort(), ['bootstrap.sh', 'deploy-gate.sh', 'deploy.sh']);
  for (const f of files) {
    const r = spawnSync(sh, ['-n', join(ROOT, 'deploy', f).replace(/\\/g, '/')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    assert.match(read('deploy', f), /^#!\/bin\/sh\n/, `${f} shebang`);
    assert.match(read('deploy', f), /\nset -eu\n/, `${f} set -eu`);
  }
});

// ── QA122 후속 ─────────────────────────────────────────────────
const SH_BIN = process.platform === 'win32'
  ? [process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'usr', 'bin', 'sh.exe'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'Git', 'bin', 'sh.exe')].find((p) => p && existsSync(p))
  : 'sh';
const fwdp = (p) => p.replace(/\\/g, '/');
/** bootstrap.sh 의 `cat > <path> <<EOT|'EOT'` 본문. */
function heredoc(path) {
  const esc = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const m = new RegExp(`cat > ${esc} <<'?EOT'?\\n([\\s\\S]*?)\\nEOT\\n`).exec(BOOTSTRAP);
  assert.ok(m, `heredoc ${path}`);
  return m[1];
}

test('QA122 HIGH-1: journald 드롭인 — ForwardToSyslog=no · MaxFileSec=1day · MaxRetentionSec=일수 · syslog.conf 보다 뒤 정렬', () => {
  const name = /cat > \/etc\/systemd\/journald\.conf\.d\/([a-z0-9-]+\.conf) <</.exec(BOOTSTRAP)?.[1];
  assert.ok(name, 'journald 드롭인');
  // 같은 디렉터리군(/etc·/run·/usr/lib)의 드롭인은 파일명 순으로 적용, 뒤가 이긴다 — rsyslog 패키지의 syslog.conf(ForwardToSyslog=yes)를 이겨야 한다.
  assert.ok(name > 'syslog.conf', `${name} 는 syslog.conf 보다 뒤에 정렬돼야`);
  assert.match(BOOTSTRAP, /rm -f \/etc\/systemd\/journald\.conf\.d\/withsmall\.conf/, '옛 드롭인 정리');
  const body = heredoc(`/etc/systemd/journald.conf.d/${name}`);
  const kv = Object.fromEntries(body.split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
  assert.equal(body.split('\n')[0], '[Journal]');
  assert.equal(kv.ForwardToSyslog, 'no');
  assert.equal(kv.MaxFileSec, '1day');
  assert.equal(kv.MaxRetentionSec, '${JOURNAL_DAYS}day');
  assert.equal(kv.SystemMaxUse, '500M');
  for (const k of ['ForwardToWall', 'ForwardToConsole', 'ForwardToKMsg']) assert.ok(!(k in kv) || kv[k] === 'no', k);
});

test('QA122 HIGH-1: 매일 타이머 rotate+vacuum — 가장 오래된 항목 ≤ 처리방침 일수(파일 하루 + vacuum 일수)', () => {
  const policy = read('server', 'src', 'privacy', 'policy.ts');
  const days = Number(/export const SERVER_LOG_RETENTION_DAYS = (\d+);/.exec(policy)[1]);
  assert.match(BOOTSTRAP, /^VACUUM_DAYS=\$\(\(JOURNAL_DAYS - 2\)\)$/m);
  const svc = heredoc('/etc/systemd/system/withsmall-journal-vacuum.service');
  assert.match(svc, /^Type=oneshot$/m);
  assert.match(svc, /^ExecStart=\/usr\/bin\/journalctl --rotate --vacuum-time=\$\{VACUUM_DAYS\}d$/m);
  const timer = heredoc('/etc/systemd/system/withsmall-journal-vacuum.timer');
  assert.match(timer, /^OnCalendar=daily$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
  assert.match(BOOTSTRAP, /systemctl enable --now withsmall-journal-vacuum\.timer/);
  // 보관 파일 하나 = 최대 하루(MaxFileSec=1day·매일 --rotate). 그 파일의 마지막 항목이 VACUUM_DAYS 보다 오래되면 지워진다
  //   → 가장 오래된 항목의 최대 나이 = VACUUM_DAYS + 1(파일 폭) + 1(타이머 지연·RandomizedDelaySec 여유) ≤ 처리방침.
  const journalDays = Number(/^JOURNAL_DAYS=(\d+)$/m.exec(BOOTSTRAP)[1]);
  assert.equal(journalDays, days);
  assert.ok(journalDays - 2 + 1 + 1 <= days);
  assert.ok(journalDays - 2 >= 1, 'vacuum 일수 ≥ 1');
});

test('QA122 HIGH-1: rsyslog 가 있으면 withsmall-* 태그 버림(imjournal 경로 포함) — compose 태그가 전부 그 접두사', () => {
  const name = /cat > \/etc\/rsyslog\.d\/([a-z0-9-]+\.conf) <</.exec(BOOTSTRAP)?.[1];
  assert.ok(name, 'rsyslog 드롭');
  // Ubuntu 50-default.conf(*.* → /var/log/syslog)·RHEL rsyslog.conf 규칙보다 앞(include 순서).
  assert.ok(name < '50-default.conf' && /^0\d-/.test(name), name);
  const body = heredoc(`/etc/rsyslog.d/${name}`);
  assert.match(body, /^if \(\$programname startswith 'withsmall-'\) or \(\$syslogtag startswith 'withsmall-'\) then stop$/m);
  assert.match(BOOTSTRAP, /rsyslogd -N1/, '설정 검사');
  const tags = [...COMPOSE.matchAll(/^\s+tag: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(tags.sort(), ['withsmall-app', 'withsmall-caddy']);
  for (const t of tags) assert.ok(t.startsWith('withsmall-'), t);
});

test('QA122 HIGH-1: compose 로그 드라이버는 서비스마다 journald(json-file·local 은 시간 기준 정리가 없다)', () => {
  const services = [...COMPOSE.matchAll(/^ {2}([a-z][a-z0-9_-]*):\n/gm)].map((m) => m[1]);
  const inServices = COMPOSE.slice(COMPOSE.indexOf('services:'), COMPOSE.indexOf('\nvolumes:'));
  const svcNames = [...inServices.matchAll(/^ {2}([a-z][a-z0-9_-]*):$/gm)].map((m) => m[1]);
  assert.deepEqual(svcNames.sort(), ['app', 'caddy']);
  assert.ok(services.length >= 2);
  const drivers = [...COMPOSE.matchAll(/^\s+driver: (\S+)$/gm)].map((m) => m[1]);
  assert.deepEqual(drivers, svcNames.map(() => 'journald'));
  assert.doesNotMatch(COMPOSE, /json-file|driver: local|max-size|max-file/);
  assert.doesNotMatch(BOOTSTRAP, /json-file/);
});

test('QA122 MED-2: deploy/ 전체 eol=lf(.gitattributes) — git check-attr + autocrlf=true 새 체크아웃 재현', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
  const files = readdirSync(join(ROOT, 'deploy'));
  const r = spawnSync('git', ['check-attr', 'eol', '--', ...files.map((f) => `deploy/${f}`)], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, files.length);
  for (const l of lines) assert.match(l, /: eol: lf$/, l);
  // 새 체크아웃: autocrlf=true 저장소에 .gitattributes + 예시 env 를 커밋 → 작업 트리 삭제 → checkout → CR 0.
  const dir = mkdtempSync(join(tmpdir(), 'ws-eol-'));
  try {
    const g = (...a) => {
      const x = spawnSync('git', ['-c', 'core.autocrlf=true', '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, encoding: 'utf8' });
      assert.equal(x.status, 0, `${a.join(' ')}: ${x.stderr}`);
      return x;
    };
    g('init', '-q');
    g('config', 'core.autocrlf', 'true');
    writeFileSync(join(dir, '.gitattributes'), readFileSync(join(ROOT, '.gitattributes')));
    mkdirSync(join(dir, 'deploy'));
    for (const f of files) writeFileSync(join(dir, 'deploy', f), readFileSync(join(ROOT, 'deploy', f)));
    g('add', '-A');
    g('commit', '-q', '-m', 'x');
    rmSync(join(dir, 'deploy'), { recursive: true, force: true });
    g('checkout', '--', '.');
    for (const f of files) assert.ok(!readFileSync(join(dir, 'deploy', f)).includes(0x0d), `${f}: CR 이 있다`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA122 MED-2: bootstrap server.env 채우기 — CRLF 예시에서도 시크릿 3개 64hex, 나머지 줄 그대로, CR 0', { skip: !SH_BIN }, () => {
  const m = /\nif \[ ! -f "\$ROOT\/server\.env" \]; then\n([\s\S]*?)\nfi\n/.exec(BOOTSTRAP);
  assert.ok(m, 'server.env 블록');
  assert.doesNotMatch(m[1], /\bsed\b/, '시크릿을 sed 인수로 넘기지 않는다(프로세스 목록)');
  const dir = mkdtempSync(join(tmpdir(), 'ws-boot-env-'));
  try {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'root'));
    mkdirSync(join(dir, 'bin'));
    const crlf = (t) => t.replace(/\r?\n/g, '\r\n');
    writeFileSync(join(dir, 'src', 'server.env.example'), crlf(read('deploy', 'server.env.example')));
    // openssl 대역(값 고정 아님: 호출마다 다른 64hex).
    writeFileSync(join(dir, 'bin', 'openssl'), '#!/bin/sh\nn=$(cat "$0.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$0.n"\nprintf "%064x\\n" "$n"\n', { mode: 0o755 });
    const script = `set -eu\nlog() { :; }\ndie() { echo "DIE $*" >&2; exit 1; }\nSRC_DIR='${fwdp(join(dir, 'src'))}'\nROOT='${fwdp(join(dir, 'root'))}'\nif [ ! -f "$ROOT/server.env" ]; then\n${m[1]}\nfi\n`;
    writeFileSync(join(dir, 'run.sh'), script);
    const sep = process.platform === 'win32' ? ';' : ':';
    const r = spawnSync(SH_BIN, [fwdp(join(dir, 'run.sh'))], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}${sep}${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stderr);
    const env = readFileSync(join(dir, 'root', 'server.env'), 'utf8');
    assert.ok(!env.includes('\r'), 'server.env CR');
    assert.ok(!env.split('\n').some((l) => !l.startsWith('#') && l.includes('__SET_ME__')), 'server.env 값 줄에 __SET_ME__ 남음');
    const secrets = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'REACTION_KEY_SECRET'].map((k) => new RegExp(`^${k}=([0-9a-f]{64})$`, 'm').exec(env)?.[1]);
    for (const s of secrets) assert.ok(s, env);
    assert.equal(new Set(secrets).size, 3, '키마다 다른 값');
    assert.equal(env.replace(/^(JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|REACTION_KEY_SECRET)=.*$/gm, '$1=__SET_ME__'), read('deploy', 'server.env.example'));
    assert.equal(r.stdout + r.stderr, '', '출력 0(시크릿 노출 없음)');
    assert.ok(!existsSync(join(dir, 'root', 'server.env.tmp')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA127 LOW-8: bootstrap 시크릿은 어떤 명령의 argv 에도 없다(awk·grep·mv·tr·rm·openssl argv 기록) + 채우기 줄 정적 형태', { skip: !SH_BIN }, () => {
  const m = /\nif \[ ! -f "\$ROOT\/server\.env" \]; then\n([\s\S]*?)\nfi\n/.exec(BOOTSTRAP);
  assert.ok(m, 'server.env 블록');
  // 정적: 값은 환경 변수(WS_SECRET=… awk)로만, awk -v·명령 인수로 넘기지 않는다.
  const fill = m[1].split('\n').filter((l) => /openssl rand/.test(l));
  assert.equal(fill.length, 1, '시크릿 생성 줄 하나');
  assert.match(fill[0], /^\s*WS_SECRET="\$\(openssl rand -hex 32\)" WS_KEY="\$k" awk '/);
  assert.doesNotMatch(m[1], /awk\s+(-\S+\s+)*-v\b/, 'awk -v 는 argv(프로세스 목록)에 값이 보인다');
  assert.match(m[1], /ENVIRON\["WS_SECRET"\]/);
  const dir = mkdtempSync(join(tmpdir(), 'ws-boot-argv-'));
  try {
    for (const d of ['src', 'root', 'bin']) mkdirSync(join(dir, d));
    writeFileSync(join(dir, 'src', 'server.env.example'), read('deploy', 'server.env.example'));
    const argvLog = fwdp(join(dir, 'argv.log'));
    // 호출마다 다른 64hex(앞뒤가 고정 표식이라 우연 일치 없음).
    writeFileSync(join(dir, 'bin', 'openssl'), `#!/bin/sh\nprintf '%s\\n' "openssl $*" >> '${argvLog}'\nn=$(cat "$0.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$0.n"\nprintf "c0ffee%052xbeef00\\n" "$n"\n`, { mode: 0o755 });
    const wrap = ['awk', 'grep', 'mv', 'tr', 'rm', 'cat', 'head', 'sed'];
    const real = spawnSync(SH_BIN, ['-c', wrap.map((c) => `command -v ${c}`).join('; ')], { encoding: 'utf8' }).stdout.trim().split('\n');
    assert.equal(real.length, wrap.length, `실제 경로: ${real}`);
    wrap.forEach((c, i) => {
      writeFileSync(join(dir, 'bin', c), `#!/bin/sh\nprintf '%s\\n' "${c} $*" >> '${argvLog}'\nexec '${real[i]}' "$@"\n`, { mode: 0o755 });
    });
    const script = `set -eu\nlog() { :; }\ndie() { echo "DIE $*" >&2; exit 1; }\nSRC_DIR='${fwdp(join(dir, 'src'))}'\nROOT='${fwdp(join(dir, 'root'))}'\nif [ ! -f "$ROOT/server.env" ]; then\n${m[1]}\nfi\n`;
    writeFileSync(join(dir, 'run.sh'), script);
    const sep = process.platform === 'win32' ? ';' : ':';
    const r = spawnSync(SH_BIN, [fwdp(join(dir, 'run.sh'))], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}${sep}${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stderr);
    const env = readFileSync(join(dir, 'root', 'server.env'), 'utf8');
    const secrets = [...env.matchAll(/^[A-Z_]+_SECRET=([0-9a-f]{64})$/gm)].map((x) => x[1]);
    assert.equal(secrets.length, 3, env);
    for (const s of secrets) assert.match(s, /^c0ffee[0-9a-f]{52}beef00$/, '가짜 openssl 값이 쓰였다');
    const argv = readFileSync(argvLog, 'utf8');
    for (const c of ['awk', 'openssl', 'grep', 'mv', 'tr']) assert.match(argv, new RegExp(`^${c} `, 'm'), `${c} 호출이 기록되지 않음(래퍼 무력)`);
    for (const s of secrets) {
      assert.ok(!argv.includes(s), `argv 에 시크릿: ${argv.split('\n').find((l) => l.includes(s))}`);
      assert.ok(!argv.includes(s.slice(0, 32)) && !argv.includes(s.slice(32)), 'argv 에 시크릿 일부');
      assert.ok(!(r.stdout + r.stderr).includes(s), '출력에 시크릿');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA122 LOW-2: --deploy-pubkey 는 한 줄·키 하나만(개행·CR·키 둘·base64 아님 거부)', { skip: !SH_BIN }, () => {
  const run = (key) => spawnSync(SH_BIN, [fwdp(join(ROOT, 'deploy', 'bootstrap.sh')), '--image-repo', 'ghcr.io/owner/repo', '--deploy-pubkey', key, '--admin-user', 'ubuntu'], {
    encoding: 'utf8',
    env: { ...process.env, WS_BOOTSTRAP_ARGS_ONLY: '1' },
  });
  const K1 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl gha-deploy';
  const K2 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl other';
  let r = run(K1);
  assert.equal(r.status, 0, r.stderr);
  r = run('ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=');
  assert.equal(r.status, 0, r.stderr);
  for (const bad of [
    `${K1}\n${K2}`,
    `${K1}\n`,
    `${K1}\r`,
    `${K1}\r\n${K2}`,
    `${K1} ${K2}`,
    `${K1} AAAAC3NzaC1lZDI1NTE5AAAAIBBBBnkVzrm0SdG6`,
    'ssh-ed25519 not*base64 c',
    'ssh-ed25519 ',
    'ssh-rsa AAAAB3NzaC1yc2E c',
    'command="sh" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMq x',
    ['-----', 'BEGIN OPENSSH PRIVATE KEY', '-----'].join(''), // 리터럴로 쓰면 C7-SECRET 이 잡는다(테스트 입력일 뿐)
  ]) {
    r = run(bad);
    assert.equal(r.status, 1, JSON.stringify(bad));
    assert.match(r.stderr, /deploy-pubkey|비밀키/, JSON.stringify(bad));
  }
  // 인수 검사는 root 확인·OS 변경보다 앞 — WS_BOOTSTRAP_ARGS_ONLY 없이 잘못된 키면 root 이전에 거부.
  const iArgs = BOOTSTRAP.indexOf('WS_BOOTSTRAP_ARGS_ONLY:-0');
  assert.ok(iArgs > 0 && iArgs < BOOTSTRAP.indexOf('[ "$(id -u)" = "0" ]') && iArgs < BOOTSTRAP.indexOf('apt-get'));
});

test('QA122 LOW-4: deploy.yml build-push 첫 단계가 이 커밋의 ci.yml 최신 실행 completed·success 를 요구', () => {
  const bp = WORKFLOW.slice(WORKFLOW.indexOf('  build-push:'), WORKFLOW.indexOf('\n  deploy:'));
  assert.match(bp, /permissions:\n\s+contents: read\n\s+packages: write\n\s+actions: read\n/);
  const steps = [...bp.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]);
  assert.equal(steps[0], 'Require green CI (ci.yml) on this commit');
  assert.equal(steps[1], 'Checkout');
  const guard = bp.slice(bp.indexOf(steps[0]), bp.indexOf('- name: Checkout'));
  assert.match(guard, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(guard, /secrets\./);
  assert.match(guard, /actions\/workflows\/ci\.yml\/runs\?head_sha=\$\{GITHUB_SHA\}/);
  assert.match(guard, /\[ "\$latest" != "completed success" \]/);
  assert.match(guard, /exit 1/);
  assert.ok(existsSync(join(ROOT, '.github', 'workflows', 'ci.yml')));
});

// ── security 139 / lane 145 ───────────────────────────────────
const CI = read('.github', 'workflows', 'ci.yml');
const DOCKERFILE = read('Dockerfile');
const DEPLOY_SH_TEXT = read('deploy', 'deploy.sh');

test('139 MED-4: 모든 서드파티 Action 은 40자 커밋 SHA + 버전 주석, checkout 은 persist-credentials: false', () => {
  for (const [name, wf] of [['ci.yml', CI], ['deploy.yml', WORKFLOW]]) {
    const uses = [...wf.matchAll(/^\s*(?:-\s+)?uses:\s*(.+)$/gm)].map((m) => m[1].trim());
    assert.ok(uses.length > 0, name);
    for (const u of uses) {
      if (u.startsWith('./')) continue; // 로컬 액션은 고정 대상 아님
      assert.match(u, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, `${name}: ${u}`);
    }
    // checkout 마다 바로 아래 with: 에 persist-credentials: false.
    const lines = wf.split('\n');
    lines.forEach((l, i) => {
      if (!/uses:\s*actions\/checkout@/.test(l)) return;
      const ind = /^(\s*)/.exec(l)[1].length;
      const block = [];
      for (let k = i + 1; k < lines.length && (lines[k].trim() === '' || /^(\s*)/.exec(lines[k])[1].length >= ind) && !/^\s*- /.test(lines[k]); k++) block.push(lines[k]);
      assert.ok(block.some((b) => /^\s+persist-credentials: false\s*$/.test(b)), `${name}:${i + 1} checkout persist-credentials`);
    });
  }
});

test('139 MED-4: dependabot — github-actions·npm 주 1회(+ docker·compose 다이제스트)', () => {
  const dep = read('.github', 'dependabot.yml');
  assert.match(dep, /^version: 2$/m);
  const eco = [...dep.matchAll(/- package-ecosystem: (\S+)\n\s+directory: (\S+)\n\s+schedule:\n\s+interval: (\S+)/g)].map((m) => [m[1], m[2], m[3]]);
  const by = Object.fromEntries(eco.map(([e, d, i]) => [e, { d, i }]));
  for (const e of ['github-actions', 'npm', 'docker', 'docker-compose']) assert.equal(by[e]?.i, 'weekly', e);
  assert.equal(by['github-actions'].d, '/');
  assert.equal(by.npm.d, '/');
  assert.equal(by['docker-compose'].d, '/deploy');
});

test('139 LOW-1: deploy.yml — require-main 이 먼저, build-push·deploy(rollback 포함)는 main 일 때만', () => {
  const jobs = [...WORKFLOW.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);
  assert.deepEqual(jobs, ['require-main', 'build-push', 'deploy']);
  const rm = WORKFLOW.slice(WORKFLOW.indexOf('  require-main:'), WORKFLOW.indexOf('\n  build-push:'));
  assert.match(rm, /REF: \$\{\{ github\.ref \}\}/);
  assert.match(rm, /if \[ "\$REF" != "refs\/heads\/main" \]; then/);
  assert.match(rm, /exit 1/);
  const bp = WORKFLOW.slice(WORKFLOW.indexOf('  build-push:'), WORKFLOW.indexOf('\n  deploy:'));
  assert.match(bp, /^ {4}needs: require-main$/m);
  assert.match(bp, /^ {4}if: inputs\.action == 'deploy' && github\.ref == 'refs\/heads\/main'$/m);
  const dp = WORKFLOW.slice(WORKFLOW.indexOf('\n  deploy:'));
  assert.match(dp, /^ {4}needs: \[require-main, build-push\]$/m);
  const cond = /^ {4}if: (.+)$/m.exec(dp)[1];
  assert.match(cond, /needs\.require-main\.result == 'success'/);
  assert.match(cond, /github\.ref == 'refs\/heads\/main'/);
});

test('139 LOW-2: compose — app·caddy 모두 read_only + tmpfs /tmp(noexec) + mem·cpus·pids 상한, cap 전부 제거', () => {
  const svc = (name) => new RegExp(`^ {2}${name}:\\n((?: {4,}.*\\n|\\n)+)`, 'm').exec(COMPOSE)[1];
  for (const name of ['app', 'caddy']) {
    const s = svc(name);
    assert.match(s, /^ {4}read_only: true$/m, name);
    assert.match(s, /^ {4}tmpfs:\n {6}- \/tmp:rw,noexec,nosuid,nodev,size=\d+m$/m, name);
    assert.match(s, /^ {4}mem_limit: \d+[mg]$/m, name);
    assert.match(s, /^ {4}cpus: \d+(\.\d+)?$/m, name);
    assert.match(s, /^ {4}pids_limit: \d+$/m, name);
    assert.match(s, /cap_drop:\n\s+- ALL/, name);
    assert.match(s, /no-new-privileges:true/, name);
  }
  // app 쓰기는 /data 볼륨뿐(+ tmpfs).
  assert.deepEqual([...svc('app').matchAll(/^ {6}- (\.\/\S+):(\S+)$/gm)].map((m) => m[2]), ['/data']);
});

test('운영 호스트 A1.Flex 1 OCPU(vCPU 1): compose cpus 는 각 서비스 1.0 이하 — 넘으면 docker 가 컨테이너 생성을 거부(ORDERS §33)', () => {
  const svc = (name) => new RegExp(`^ {2}${name}:\\n((?: {4,}.*\\n|\\n)+)`, 'm').exec(COMPOSE)[1];
  for (const name of ['app', 'caddy']) {
    const cpus = Number(/^ {4}cpus: (\d+(?:\.\d+)?)$/m.exec(svc(name))[1]);
    assert.ok(cpus > 0 && cpus <= 1.0, `${name} cpus=${cpus}`);
  }
});

test('139 LOW-2: Dockerfile — /app 은 root 소유 그대로(chown 은 /data 만), 비루트 실행', () => {
  assert.doesNotMatch(DOCKERFILE, /chown[^\n]*\/app/, '/app chown 금지');
  assert.match(DOCKERFILE, /^RUN mkdir -p \/data && chown node:node \/data$/m);
  assert.match(DOCKERFILE, /^USER node$/m);
  // CI 스모크도 운영과 같은 격리(read-only·tmpfs·상한)로 기동하고 /app 쓰기 불가를 확인한다.
  assert.match(CI, /--read-only --tmpfs \/tmp:rw,noexec,nosuid,nodev,size=64m/);
  assert.match(CI, /--memory 1g --cpus 1\.5 --pids-limit 256/);
  assert.match(CI, /if \[ -w "\$d" \]; then echo "writable: \$d"; exit 1; fi/);
});

test('139 LOW-3: 베이스·Caddy 이미지 다이제스트 고정(세 단계 같은 node 다이제스트)', () => {
  const froms = [...DOCKERFILE.matchAll(/^FROM (\S+)/gm)].map((m) => m[1]);
  assert.equal(froms.length, 3);
  for (const f of froms) assert.match(f, /^node:22-alpine@sha256:[0-9a-f]{64}$/, f);
  assert.equal(new Set(froms).size, 1, '세 단계 같은 다이제스트');
  const images = [...COMPOSE.matchAll(/^\s+image: (\S+)$/gm)].map((m) => m[1]);
  const caddy = images.filter((i) => i.startsWith('caddy:'));
  assert.equal(caddy.length, 1);
  assert.match(caddy[0], /^caddy:2\.\d+-alpine@sha256:[0-9a-f]{64}$/);
  // 문서의 해시 생성 명령도 같은 이미지(태그만 다르면 다른 Caddy 로 해시를 만든다).
  const doc = read('docs', 'ops', 'deploy.md');
  assert.ok(doc.includes(caddy[0]), 'deploy.md 6절 베이스 이미지 갱신의 caddy 이미지 = compose 이미지');
});

test('139 LOW-5: sshd 드롭인 — AllowUsers deploy·관리 계정, 포워딩·터널 끔, 잠김 확인이 바꾸기 전', () => {
  const body = heredoc('/etc/ssh/sshd_config.d/10-withsmall.conf');
  const kv = Object.fromEntries(body.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => [l.split(' ')[0], l.split(' ').slice(1).join(' ')]));
  assert.equal(kv.AllowUsers, '${DEPLOY_USER} ${ADMIN_USER}');
  for (const k of ['AllowTcpForwarding', 'AllowAgentForwarding', 'AllowStreamLocalForwarding', 'X11Forwarding', 'PermitTunnel', 'PasswordAuthentication', 'PermitRootLogin', 'PermitUserEnvironment']) {
    assert.equal(kv[k], 'no', k);
  }
  const lock = BOOTSTRAP.indexOf('[ -s "$admin_home/.ssh/authorized_keys" ] || die');
  assert.ok(lock > 0, '관리 계정 authorized_keys 확인');
  for (const later of ['apt-get update', 'cat > /etc/ssh/sshd_config.d/10-withsmall.conf', 'systemctl restart docker']) {
    assert.ok(lock < BOOTSTRAP.indexOf(later), `잠김 확인이 ${later} 보다 앞`);
  }
});

test('139 LOW-5: --admin-user 검사(인수만) — 없음·root·deploy·형식 오류 거부, SUDO_USER 기본값', { skip: !SH_BIN }, () => {
  const K1 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl gha-deploy';
  const env0 = { ...process.env, WS_BOOTSTRAP_ARGS_ONLY: '1' };
  delete env0.SUDO_USER;
  const run = (extra, env = env0) => spawnSync(SH_BIN, [fwdp(join(ROOT, 'deploy', 'bootstrap.sh')), '--image-repo', 'ghcr.io/owner/repo', '--deploy-pubkey', K1, ...extra], { encoding: 'utf8', env });
  assert.equal(run(['--admin-user', 'ubuntu']).status, 0);
  assert.equal(run([], { ...env0, SUDO_USER: 'ubuntu' }).status, 0);
  for (const bad of [[], ['--admin-user', ''], ['--admin-user', 'root'], ['--admin-user', 'deploy'], ['--admin-user', 'Ubuntu'], ['--admin-user', 'a b'], ['--admin-user', '-x'], ['--admin-user', 'u;id']]) {
    const r = run(bad);
    assert.equal(r.status, 1, JSON.stringify(bad));
    assert.match(r.stderr, /admin-user/, JSON.stringify(bad));
  }
  assert.equal(run([], { ...env0, SUDO_USER: 'root' }).status, 1);
});

test('139 MED-3 / 150 MED-B: 운영자 접속 기록 1년 — 매시·vacuum 직전 내보내기, auth·authpriv, logrotate 매일 366개·366일, 웹·앱 기록 7일 그대로', () => {
  const days = Number(/^ADMIN_LOG_DAYS=(\d+)$/m.exec(BOOTSTRAP)[1]);
  assert.ok(days >= 365 && days <= 366, `'1년' 문자 그대로(${days}일)`);
  assert.doesNotMatch(BOOTSTRAP, /ADMIN_LOG_MONTHS/);
  const lr = heredoc('/etc/logrotate.d/withsmall-admin');
  assert.match(lr, /^\/var\/log\/withsmall-admin\/access\.log \{$/m);
  assert.match(lr, /^\tdaily$/m);
  assert.match(lr, /^\trotate \$\{ADMIN_LOG_DAYS\}$/m);
  assert.match(lr, /^\tmaxage \$\{ADMIN_LOG_DAYS\}$/m);
  assert.match(lr, /^\tifempty$/m, '빈 날도 순환 — 파일 하나 = 하루');
  assert.match(lr, /^\tcreate 0600 root root$/m);
  assert.doesNotMatch(lr, /notifempty|monthly|weekly/);
  // 처리방침 보유 기간 표의 '운영자 접속 기록' 행이 1년이라고 말한다(패리티).
  const pc = read('server', 'src', 'prerender', 'privacy-content.ts');
  assert.match(pc, /\['운영자 접속 기록', '[^']*1년[^']*'\]/);
  const timer = heredoc('/etc/systemd/system/withsmall-admin-log.timer');
  assert.match(timer, /^OnCalendar=hourly$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(BOOTSTRAP, /systemctl enable --now withsmall-admin-log\.timer/);
  const vac = heredoc('/etc/systemd/system/withsmall-journal-vacuum.service');
  assert.match(vac, /^ExecStartPre=-\/usr\/local\/sbin\/withsmall-admin-log-export$/m, 'vacuum 전에 내보내되 실패해도 7일 정리');
  assert.ok(vac.indexOf('ExecStartPre=') < vac.indexOf('ExecStart='));
  const ex = heredoc('/usr/local/sbin/withsmall-admin-log-export');
  assert.match(ex, /SYSLOG_FACILITY=4 SYSLOG_FACILITY=10/);
  assert.match(ex, /--cursor-file=/);
  assert.doesNotMatch(ex, /withsmall-app|withsmall-caddy|_SYSTEMD_UNIT|CONTAINER/, '앱·Caddy 기록은 내보내지 않는다');
  // 7일 쪽은 그대로(처리방침 SERVER_LOG_RETENTION_DAYS) — journald 드롭인·vacuum 일수 불변, Caddy 접속 기록 0 불변(위 테스트들).
  assert.match(BOOTSTRAP, /^JOURNAL_DAYS=7$/m);
  // deploy.sh 단계 줄은 authpriv 로(내보내기가 고른다), 태그는 withsmall-* 가 아니다(rsyslog 버림 규칙·앱 기록과 구분).
  assert.match(DEPLOY_SH_TEXT, /"\$ADMIN_LOGGER" -p authpriv\.info -t ws-admin-deploy -- "\$\*"/);
  assert.match(ex, / ws-admin-deploy/);
});

test('139 MED-3: 내보내기 동작 — 운영 계정 줄·deploy 단계 줄만, 이메일 가림, 커서로 이어 읽기, 실패 시 커서 되돌림', { skip: !SH_BIN }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-adminlog-'));
  try {
    for (const d of ['bin', 'out', 'state']) mkdirSync(join(dir, d));
    const P = (x) => fwdp(join(dir, x));
    writeFileSync(join(dir, 'users'), '# c\ndeploy\nubuntu\n');
    const ex = heredoc('/usr/local/sbin/withsmall-admin-log-export')
      .replaceAll('/var/log/withsmall-admin', P('out'))
      .replaceAll('/var/lib/withsmall-admin', P('state'))
      .replaceAll('/etc/withsmall-admin-users', P('users'));
    writeFileSync(join(dir, 'export.sh'), `${ex}\n`);
    // 가짜 journalctl: 커서 = 읽은 줄 수. FAKE_JFAIL 이 있으면 커서를 쓴 뒤 실패(최악 경우).
    writeFileSync(join(dir, 'bin', 'journalctl'), `#!/bin/sh
printf '%s\\n' "$*" >> '${P('argv.log')}'
cf=""
for a in "$@"; do case "$a" in --cursor-file=*) cf="\${a#--cursor-file=}" ;; esac; done
start=0; [ -f "$cf" ] && start=$(cat "$cf")
total=$(wc -l < '${P('journal')}' | tr -d ' ')
tail -n +$((start + 1)) '${P('journal')}'
echo "$total" > "$cf"
[ ! -f '${P('jfail')}' ]
`, { mode: 0o755 });
    const H = '2026-10-28T01:00:00.000000+00:00 ws-host';
    const lines = [
      `${H} sshd[100]: Accepted publickey for deploy from 203.0.113.5 port 5000 ssh2: ED25519 SHA256:abc`,
      `${H} sshd[101]: Invalid user admin from 198.51.100.7 port 4000`,
      `${H} sudo[102]:   ubuntu : TTY=pts/0 ; PWD=/home/ubuntu ; USER=deploy ; COMMAND=/usr/bin/docker exec x node dist/privacy/cli-erase.js --email some.one+x@mail.example.com`,
      `${H} ws-admin-deploy[103]: 시작: deploy sha-aaaaaaaaaaaa (pid 9, 기록 state/deploy.log)`,
      `${H} sshd[104]: Connection closed by 198.51.100.8 port 1 [preauth]`,
      `${H} sshd[105]: pam_unix(sshd:session): session opened for user ubuntu(uid=1000) by ubuntu(uid=0)`,
      `${H} sshd[106]: Failed publickey for ubuntux from 198.51.100.9 port 2 ssh2`,
      `${H} ws-admin-deploy: 종료 코드 0`,
      // 150 MED-A: 운영 계정 이름을 댄 스캐너 줄 — 1년 기록에 없어야 한다(198.51.100.x 는 아래에서 전부 없음을 본다).
      `${H} sshd[110]: Connection closed by authenticating user ubuntu 198.51.100.20 port 3 [preauth]`,
      `${H} sshd[111]: Failed publickey for ubuntu from 198.51.100.21 port 4 ssh2: ED25519 SHA256:zzz`,
      `${H} sshd[112]: Disconnected from authenticating user deploy 198.51.100.22 port 5 [preauth]`,
      `${H} sshd-session[113]: Invalid user ubuntu-old from 198.51.100.23 port 6`,
      `${H} sshd[114]: error: maximum authentication attempts exceeded for ubuntu from 198.51.100.24 port 7 ssh2 [preauth]`,
      `${H} sshd-session[115]: Failed password for deploy from 198.51.100.25 port 8 ssh2`,
      // 150 LOW-1: 비 ASCII 로컬 파트·IDN·= 붙은 형태도 통째로 가린다.
      `${H} sudo[116]:   ubuntu : TTY=pts/0 ; PWD=/home/ubuntu ; USER=deploy ; COMMAND=/usr/bin/x --email=홍길동@예시.한국 --to jörg@bücher.example`,
      // 남아야 하는 운영 줄: 세션 닫힘·logind.
      `${H} sshd[117]: pam_unix(sshd:session): session closed for user ubuntu`,
      `${H} systemd-logind[118]: New session 4 of user ubuntu.`,
    ];
    writeFileSync(join(dir, 'journal'), `${lines.join('\n')}\n`);
    const sep = process.platform === 'win32' ? ';' : ':';
    const run = () => spawnSync(SH_BIN, [P('export.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}${sep}${process.env.PATH}` } });
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    const log1 = readFileSync(join(dir, 'out', 'access.log'), 'utf8');
    const got = log1.trim().split('\n').map((l) => /(sshd|sudo|ws-admin-deploy|systemd-logind)(\[\d+\])?:/.exec(l)?.[0]);
    assert.deepEqual(got, ['sshd[100]:', 'sudo[102]:', 'ws-admin-deploy[103]:', 'sshd[105]:', 'ws-admin-deploy:', 'sudo[116]:', 'sshd[117]:', 'systemd-logind[118]:']);
    assert.ok(!log1.includes('198.51.100'), '스캐너 시도(운영 계정 이름을 댄 것 포함)의 IP 는 1년 기록에 없다');
    assert.doesNotMatch(log1, /preauth|Failed |Invalid user|authenticating user/);
    assert.ok(!log1.includes('mail.example.com') && log1.includes('--email <email>'), '이메일 가림');
    assert.ok(log1.includes('--email=<email> --to <email>'), '비 ASCII·IDN 이메일 가림');
    assert.ok(!/홍길동|예시\.한국|jörg|bücher/.test(log1));
    assert.match(readFileSync(join(dir, 'argv.log'), 'utf8'), /SYSLOG_FACILITY=4 SYSLOG_FACILITY=10/);
    // 이어 읽기: 새 줄만 덧붙는다.
    writeFileSync(join(dir, 'journal'), `${lines.join('\n')}\n${H} sshd[107]: Accepted publickey for ubuntu from 203.0.113.6 port 1 ssh2\n`);
    assert.equal(run().status, 0);
    const log2 = readFileSync(join(dir, 'out', 'access.log'), 'utf8');
    assert.equal(log2, `${log1}${H} sshd[107]: Accepted publickey for ubuntu from 203.0.113.6 port 1 ssh2\n`);
    // journalctl 실패: 커서 되돌림 → 기록 그대로, 다음 실행이 같은 줄을 다시 읽는다.
    writeFileSync(join(dir, 'journal'), `${readFileSync(join(dir, 'journal'), 'utf8')}${H} sshd[108]: Disconnected from user deploy 203.0.113.5 port 5000\n`);
    writeFileSync(join(dir, 'jfail'), '');
    r = run();
    assert.notEqual(r.status, 0);
    assert.equal(readFileSync(join(dir, 'out', 'access.log'), 'utf8'), log2);
    assert.equal(readFileSync(join(dir, 'state', 'cursor'), 'utf8').trim(), String(lines.length + 1));
    rmSync(join(dir, 'jfail'));
    assert.equal(run().status, 0);
    assert.match(readFileSync(join(dir, 'out', 'access.log'), 'utf8'), /sshd\[108\]: Disconnected from user deploy/);
    assert.deepEqual(readdirSync(join(dir, 'state')).sort(), ['cursor']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA152 LOW-2: 이메일 가림 확대 — 인코딩·변형 형태, 기존 17형태, 쓸모 있는 줄 보존, 변이 판별', { skip: !SH_BIN }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-adminmask-'));
  try {
    for (const d of ['bin', 'out', 'state']) mkdirSync(join(dir, d));
    const P = (x) => fwdp(join(dir, x));
    writeFileSync(join(dir, 'users'), 'deploy\nubuntu\n');
    const exOrig = heredoc('/usr/local/sbin/withsmall-admin-log-export');
    assert.match(exOrig, /sed -E \\\n/, '가림 sed 가 내보내기 스크립트 안에 있다');
    writeFileSync(join(dir, 'bin', 'journalctl'), `#!/bin/sh
cf=""
for a in "$@"; do case "$a" in --cursor-file=*) cf="\${a#--cursor-file=}" ;; esac; done
cat '${P('journal')}'
echo 1 > "$cf"
`, { mode: 0o755 });
    const sep = process.platform === 'win32' ? ';' : ':';
    const H = '2026-10-28T01:00:00.000000+00:00 ws-host';
    // 내보내기가 고르도록 전부 ws-admin-deploy 태그 줄. payload → 기록에 남은 payload.
    const mask = (script, payloads) => {
      for (const d of ['out', 'state']) { rmSync(join(dir, d), { recursive: true, force: true }); mkdirSync(join(dir, d)); }
      const ex = script.replaceAll('/var/log/withsmall-admin', P('out')).replaceAll('/var/lib/withsmall-admin', P('state')).replaceAll('/etc/withsmall-admin-users', P('users'));
      writeFileSync(join(dir, 'export.sh'), `${ex}\n`);
      writeFileSync(join(dir, 'journal'), `${payloads.map((p) => `${H} ws-admin-deploy[1]: ${p}`).join('\n')}\n`);
      const r = spawnSync(SH_BIN, [P('export.sh')], { encoding: 'utf8', env: { ...process.env, PATH: `${join(dir, 'bin')}${sep}${process.env.PATH}` } });
      assert.equal(r.status, 0, r.stderr);
      return readFileSync(join(dir, 'out', 'access.log'), 'utf8').trim().split('\n').map((l) => l.slice(`${H} ws-admin-deploy[1]: `.length));
    };
    // LOW-2 생존 형태(원문 조각 → 기록에 있으면 안 되는 문자열).
    const survivors = [
      ['u user%40gmail.com v', ['gmail', '%40']],
      ['u user%40GMAIL.COM v', ['GMAIL', '%40']],
      ['u 홍＠예시.한국 v', ['홍', '＠', '예시']],
      ['u bob(at)example.com v', ['bob', 'example']],
      ['u BOB[AT]example.com v', ['BOB', 'example']],
      ['u bob[at]example.com v', ['bob', 'example']],
      ['u bob At example.com v', ['bob', 'example']],
      ['--email "Kim Lee"@x.com --n 1', ['Kim', 'Lee', 'x.com']],
      ["--email 'Kim Lee'@x.com --n 1", ['Kim', 'Lee', 'x.com']],
      ['--email "Kim Lee@x.com --n 1', ['Kim', 'Lee', 'x.com']],
      ['--email "Kim Lee"%40x.com --n 1', ['Kim', 'Lee', 'x.com']],
      ['--email "Kim Lee"＠x.com --n 1', ['Kim', 'Lee', 'x.com']],
      // QA248-r1/r2: 닫히지 않은 따옴표 앞이 공백·= 이 아닌 구두점이어도 열린 구간 전체를 가린다(규칙 3 시작 조건).
      ['u ("Kim Lee@x.com) v', ['Kim', 'Lee', 'x.com']],
      ['u a,"a b@c.com v', ['"a ', 'c.com']],
      ['u :"a b@c.com v', ['"a ', 'c.com']],
      ['u EMAIL:"Kim Lee@x.com v', ['Kim', 'Lee', 'x.com']],
      ['u a=b@c.com v', ['a=b', 'c.com']],
      ['--email=a=b@c.com v', ['a=b', 'c.com']],
    ];
    const got = mask(exOrig, survivors.map((s) => s[0]));
    survivors.forEach(([src, bad], i) => {
      assert.ok(got[i].includes('<email>'), `${src} → ${got[i]}`);
      for (const b of bad) assert.ok(!got[i].includes(b), `${src} → ${got[i]} (${b} 남음)`);
    });
    // 기존 17형태(152 §3) — 계속 가려진다.
    const old = [
      '--email=홍길동@예시.한국', '<a@b.co>', 'mailto:kim@x.com', 'p@[192.0.2.1]', 'x@xn--bcher-kva.example', 'Jörg.Ü@bücher.de', 'a@b',
      '"quoted.local"@x.com', "'single'@x.com", 'EMAIL:kim@x.com,', '(lee@x.com)', 'some.one+x@mail.example.com', 'a@b@c', '--to=jörg@bücher.example', 'u@x.com;', '--email some.one@x.com', '홍길동@예시.한국',
    ];
    const gotOld = mask(exOrig, old.map((s) => `k ${s} v`));
    old.forEach((src, i) => {
      assert.ok(gotOld[i].includes('<email>') && !/@|x\.com|bücher|예시|jörg|kim|lee/i.test(gotOld[i]), `${src} → ${gotOld[i]}`);
    });
    // 쓸모 있는 부분은 남는다(과잉 가림이어도 이 조각은 그대로).
    const keep = [
      'Accepted publickey for ubuntu from 203.0.113.6 port 1 ssh2: ED25519 SHA256:abc',
      '  ubuntu : TTY=pts/0 ; PWD=/home/ubuntu ; USER=deploy ; COMMAND=/usr/bin/docker exec x node dist/privacy/cli-erase.js --email some.one+x@mail.example.com',
      '  ubuntu : TTY=pts/0 ; PWD=/home/ubuntu ; USER=deploy ; COMMAND=/usr/bin/docker compose up -d',
      'pam_unix(sshd:session): session opened for user ubuntu(uid=1000) by ubuntu(uid=0)',
      '시작: deploy sha-aaaaaaaaaaaa (pid 9, 기록 state/deploy.log)',
      '종료 코드 0',
    ];
    // QA248: 닫는 따옴표에서 시작하지 않고(뒤 명령 보존), at 규칙은 도메인꼴만.
    keep.push(
      'COMMAND=/bin/sh -c echo "hi"; /usr/bin/docker exec x y --email a@b.com',
      'COMMAND=/bin/sh -c at now -f /tmp/job',
      'COMMAND=/usr/bin/journalctl --since today at 09:00',
    );
    const gotKeep = mask(exOrig, keep);
    assert.equal(gotKeep[6], 'COMMAND=/bin/sh -c echo "hi"; /usr/bin/docker exec x y --email <email>');
    assert.equal(gotKeep[7], keep[7]);
    assert.equal(gotKeep[8], keep[8]);
    assert.equal(mask(exOrig, ['--email=a@b.com'])[0], '--email=<email>', '옵션 이름 보존');
    assert.equal(mask(exOrig, ['u kim at example.com v'])[0], 'u <email> v');
    assert.equal(gotKeep[0], keep[0]);
    assert.equal(gotKeep[1], keep[1].replace('some.one+x@mail.example.com', '<email>'));
    assert.match(gotKeep[1], /TTY=pts\/0 ; PWD=\/home\/ubuntu ; USER=deploy ; COMMAND=\/usr\/bin\/docker exec x node dist\/privacy\/cli-erase\.js --email <email>$/);
    assert.deepEqual(gotKeep.slice(2, 6), keep.slice(2, 6));
    // 변이: 새 대안 하나를 빼면 해당 형태가 살아남아 위 단언이 깨진다 = 시험이 그 대안을 지킨다.
    const cut = (from, to) => { assert.ok(exOrig.includes(from), `변이 대상 없음: ${from}`); return exOrig.replaceAll(from, to); };
    const surv = (script, src) => mask(script, [src])[0];
    assert.ok(surv(cut('%40', 'ZZZ'), 'u user%40gmail.com v').includes('gmail'), '%40 대안 제거 → 생존');
    assert.ok(surv(cut('＠', '＃'), 'u 홍＠예시.한국 v').includes('예시'), '＠ 대안 제거 → 생존');
    assert.ok(surv(cut('\\([aA][tT]\\)|', ''), 'u bob(at)example.com v').includes('example'), '(at) 대안 제거 → 생존');
    assert.ok(surv(cut("  -e 's/\"[^\"]*\"(@|%40|＠)/Q\\1/g' \\\n", ''), '--email "Kim Lee"@x.com --n 1').includes('Kim'), '따옴표 로컬 파트 규칙 제거 → 앞부분 생존');
    assert.ok(surv(cut('(--?[[:alnum:]_-]+=)?[^[:space:]]*', '()[^[:space:]=]*'), 'u a=b@c.com v').includes('a='), '= 포함 로컬 파트 규칙 되돌리면 → 앞부분 생존');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('139 LOW-7: deploy.sh 고아 짝 파일 정리 일수 = prune-backups.sh POLICY_MAX_AGE = policy.ts BACKUP_RETENTION_DAYS', () => {
  const policy = Number(/export const BACKUP_RETENTION_DAYS = (\d+);/.exec(read('server', 'src', 'privacy', 'policy.ts'))[1]);
  const prune = Number(/^POLICY_MAX_AGE=(\d+)$/m.exec(read('scripts', 'prune-backups.sh'))[1]);
  const dep = Number(/^BACKUP_MAX_AGE_DAYS=(\d+)$/m.exec(DEPLOY_SH_TEXT)[1]);
  assert.equal(dep, policy);
  assert.equal(prune, policy);
  assert.match(DEPLOY_SH_TEXT, /-mmin \+'"\$\(\(BACKUP_MAX_AGE_DAYS \* 1440\)\)"'/);
});

test('139 MED-5: CODEOWNERS — deploy/·workflows·Dockerfile 등록', () => {
  const co = read('.github', 'CODEOWNERS');
  for (const p of ['/deploy/', '/.github/workflows/', '/Dockerfile', '/.github/dependabot.yml', '/docker-entrypoint.sh']) {
    assert.match(co, new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} @kennykim78$`, 'm'), p);
  }
});

test('QA148 MED-1: SQLITE_TMPDIR 는 /data 볼륨 안(백업 폴더·erasures 밖) — 이미지 ENV·compose·CI 스모크 같은 값, 엔트리포인트가 0700 으로 만든다', () => {
  const want = '/data/.sqlite-tmp';
  const runtime = DOCKERFILE.slice(DOCKERFILE.indexOf('AS runtime'));
  assert.ok(runtime.split('\n').some((l) => l.trim() === `SQLITE_TMPDIR=${want} \\`), 'Dockerfile runtime ENV');
  assert.ok(COMPOSE.includes(`    environment:\n      - SQLITE_TMPDIR=${want}\n`), 'compose app environment');
  assert.ok(CI.includes(`-e SQLITE_TMPDIR=${want} \\\n`), 'ci.yml 스모크');
  const ep = read('docker-entrypoint.sh');
  assert.match(ep, /mkdir -p "\$SQLITE_TMPDIR" && chmod 0700 "\$SQLITE_TMPDIR"/);
  assert.ok(ep.indexOf('mkdir -p "$SQLITE_TMPDIR"') < ep.indexOf('log "migrate deploy"'), '마이그레이션·VACUUM 전에 만든다');
  // 백업 정리(prod-*.db, /data/backup)·삭제 기록(/data/erasures.jsonl)과 겹치지 않는다.
  assert.ok(!want.startsWith('/data/backup'));
  assert.ok(!/prod-.*\.db/.test(want));
  assert.notEqual(want, '/data');
});

test('ORDERS §40: deploy.yml 외부 확인 = 공개 200 + robots.txt "Disallow: /" 줄 + X-Robots-Tag noindex(401 기대 0), 재시도 6×5초·10초 제한', () => {
  const step = /\n {6}- name: (External check[^\n]*)\n([\s\S]*?)(?=\n {6}- name: |\n\S|$)/.exec(WORKFLOW);
  assert.ok(step, 'External check 단계');
  assert.doesNotMatch(step[1], /basic_auth|401/, step[1]);
  const body = step[2];
  assert.doesNotMatch(body, /401|basic_auth/);
  assert.match(body, /"\$SITE_ORIGIN\/"/);
  assert.match(body, /"\$SITE_ORIGIN\/robots\.txt"/);
  assert.match(body, /grep -qxF 'Disallow: \/'/, 'Disallow: / 는 줄 전체 일치(Disallow: /save 를 통과시키지 않게)');
  assert.match(body, /grep -qiE '\^x-robots-tag:\.\*noindex'/);
  assert.match(body, /for _ in 1 2 3 4 5 6; do/);
  assert.match(body, /sleep 5/);
  assert.equal((body.match(/--max-time 10/g) || []).length, 2);
  // 리다이렉트를 따라가면 다른 호스트의 200+noindex 로도 통과한다(QA262 LOW-2).
  assert.doesNotMatch(body, /(^|\s)(-L|--location)(\s|$)|curl\s+-[A-Za-z]*L/, '외부 확인 curl 은 리다이렉트를 따라가지 않는다');
  assert.ok(!/(^|\n)#[^\n]*basic_auth 401/.test(WORKFLOW), '머리 주석 basic_auth 401');
  // deploy.sh 사전 점검은 server.env 만(옛 서버의 caddy.env 예시가 배포를 막지 않게).
  assert.match(read('deploy', 'deploy.sh'), /^  for f in server\.env; do$/m);
});

test('ORDERS §40: 외부 확인 스크립트 실행(가짜 curl) — 200+Disallow+noindex 만 통과, 401·색인 robots·noindex 없음·robots 404 는 실패', { skip: !SH_BIN }, () => {
  const step = /\n {6}- name: External check[^\n]*\n[\s\S]*?\n {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/.exec(WORKFLOW);
  assert.ok(step, 'External check run 블록');
  const script = step[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  // 앱의 실제 robots(WS_INDEXABLE=0) 출력 — server/src/prerender/robots.ts DISALLOW_ALL.
  const rm = /const DISALLOW_ALL = '([^']*)'/.exec(read('server', 'src', 'prerender', 'robots.ts'));
  assert.ok(rm, 'robots.ts DISALLOW_ALL');
  const disallowAll = rm[1].replace(/\\n/g, '\n');
  const indexable = 'User-agent: *\nAllow: /\nDisallow: /save\n\nSitemap: https://withsmall.kr/sitemap.xml\n';
  const goodHdr = 'HTTP/2 200\r\ncontent-type: text/html\r\nx-robots-tag: noindex, nofollow\r\n\r\n';
  const dir = mkdtempSync(join(tmpdir(), 'ws-extcheck-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'f'));
    writeFileSync(join(dir, 'bin', 'curl'), [
      '#!/bin/sh',
      'o=; d=; url=',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -o) o="$2"; shift 2 ;;',
      '    -D) d="$2"; shift 2 ;;',
      '    -w|--max-time) shift 2 ;;',
      '    -*) shift ;;',
      '    *) url="$1"; shift ;;',
      '  esac',
      'done',
      'echo "$url" >> "$FAKE_DIR/urls"',
      'case "$url" in',
      '  */robots.txt) if [ "$o" != /dev/null ]; then cat "$FAKE_DIR/robots" > "$o"; fi; printf %s "$(cat "$FAKE_DIR/robots.code")" ;;',
      '  *) if [ -n "$d" ]; then cat "$FAKE_DIR/headers" > "$d"; fi; printf %s "$(cat "$FAKE_DIR/root.code")" ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(dir, 'bin', 'sleep'), '#!/bin/sh\n:\n', { mode: 0o755 });
    writeFileSync(join(dir, 'run.sh'), script);
    const sep = process.platform === 'win32' ? ';' : ':';
    const run = ({ code = '200', hdr = goodHdr, robots = disallowAll, rcode = '200' }) => {
      const f = join(dir, 'f');
      writeFileSync(join(f, 'root.code'), code);
      writeFileSync(join(f, 'headers'), hdr);
      writeFileSync(join(f, 'robots'), robots);
      writeFileSync(join(f, 'robots.code'), rcode);
      writeFileSync(join(f, 'urls'), '');
      const r = spawnSync(SH_BIN, [fwdp(join(dir, 'run.sh'))], {
        encoding: 'utf8',
        env: { ...process.env, SITE_ORIGIN: 'https://withsmall.kr', FAKE_DIR: fwdp(f), PATH: `${join(dir, 'bin')}${sep}${process.env.PATH}` },
      });
      const urls = readFileSync(join(f, 'urls'), 'utf8').trim().split('\n').filter(Boolean);
      return { status: r.status, out: r.stdout + r.stderr, urls };
    };
    let r = run({});
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /external status: 200/);
    assert.deepEqual(r.urls, ['https://withsmall.kr/', 'https://withsmall.kr/robots.txt'], '통과면 한 번에 멈춘다');
    const bad = {
      '401(옛 basic_auth)': { code: '401' },
      '색인 허용 robots(Disallow: /save 만)': { robots: indexable },
      'X-Robots-Tag 가 noindex 아님': { hdr: 'HTTP/2 200\r\nx-robots-tag: all\r\n\r\n' },
      'robots.txt 404': { rcode: '404' },
    };
    // (사례마다 6회 재시도 — Windows 에선 사례당 20초대. 사례는 판정 갈래마다 하나씩만.)
    for (const [name, c] of Object.entries(bad)) {
      r = run(c);
      assert.notEqual(r.status, 0, `${name}: 통과하면 안 된다\n${r.out}`);
      assert.equal(r.urls.filter((u) => u === 'https://withsmall.kr/').length, 6, `${name}: 6번 재시도`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// 264(ORDERS §41, security ⑤b): 배포 뒤 외부에서 운영자 경로 404 를 확인한다(§40 외부 확인 단계 바로 뒤의 별도 단계 — §40 단계 단언은 그대로).
const OPS_STEP_RE = /\n {6}- name: (Operator paths 404 check[^\n]*)\n[\s\S]*?\n {8}run: \|\n((?: {10}[^\n]*\n|\n)+)/;

test('264 deploy.yml: 운영자 경로 404 확인 단계 — §40 외부 확인 뒤, POST /auth/login·/AUTH/LOGIN·/admin/ping 404, GET /auth/session ≠404, 404 에 noindex, -L 없음', () => {
  const m = OPS_STEP_RE.exec(WORKFLOW);
  assert.ok(m, 'Operator paths 404 check 단계');
  assert.ok(WORKFLOW.indexOf('- name: External check') < m.index, '§40 외부 확인 단계 뒤');
  assert.ok(m.index < WORKFLOW.indexOf('- name: Remove SSH key'), 'SSH 키 제거 단계 앞(같은 deploy job)');
  const body = m[2];
  assert.match(body, /-X POST "\$SITE_ORIGIN\/auth\/login"/);
  assert.match(body, /-X POST "\$SITE_ORIGIN\/AUTH\/LOGIN"/);
  assert.match(body, /"\$SITE_ORIGIN\/admin\/ping"/);
  assert.match(body, /"\$SITE_ORIGIN\/auth\/session"/);
  assert.match(body, /tr -d '\\r' < "\$t\/h" \| grep -qiE '\^x-robots-tag:\.\*noindex'/);
  assert.equal((body.match(/--max-time 10/g) || []).length, 4);
  assert.doesNotMatch(body, /(^|\s)(-L|--location)(\s|$)|curl\s+-[A-Za-z]*L/, '리다이렉트를 따라가지 않는다');
  assert.doesNotMatch(body, /\/auth\/magic/, '저장 흐름 쓰기 경로(메일 발송)는 건드리지 않는다');
});

test('264 deploy.yml: 운영자 경로 404 확인 실행(가짜 curl) — 정상만 통과, 하나라도 어긋나면 실패(3번 재시도)', { skip: !SH_BIN }, () => {
  const m = OPS_STEP_RE.exec(WORKFLOW);
  assert.ok(m, 'run 블록');
  const script = m[2].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'ws-opscheck-'));
  try {
    mkdirSync(join(dir, 'bin'));
    mkdirSync(join(dir, 'f'));
    // 응답 표: f/<키>.code (키 = login·upper·admin·session), 헤더는 -D 로 f/login.headers.
    writeFileSync(join(dir, 'bin', 'curl'), [
      '#!/bin/sh',
      'o=; d=; url=; meth=GET',
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -o) o="$2"; shift 2 ;;',
      '    -D) d="$2"; shift 2 ;;',
      '    -X) meth="$2"; shift 2 ;;',
      '    -w|--max-time) shift 2 ;;',
      '    -*) shift ;;',
      '    *) url="$1"; shift ;;',
      '  esac',
      'done',
      'echo "$meth $url" >> "$FAKE_DIR/urls"',
      'case "$meth $url" in',
      '  "POST https://withsmall.kr/auth/login") k=login ;;',
      '  "POST https://withsmall.kr/AUTH/LOGIN") k=upper ;;',
      '  "GET https://withsmall.kr/admin/ping") k=admin ;;',
      '  "GET https://withsmall.kr/auth/session") k=session ;;',
      '  *) k=other ;;',
      'esac',
      'if [ -n "$d" ]; then cat "$FAKE_DIR/$k.headers" > "$d" 2>/dev/null || : > "$d"; fi',
      'printf %s "$(cat "$FAKE_DIR/$k.code" 2>/dev/null || echo 000)"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeFileSync(join(dir, 'bin', 'sleep'), '#!/bin/sh\n:\n', { mode: 0o755 });
    writeFileSync(join(dir, 'run.sh'), script);
    const sep = process.platform === 'win32' ? ';' : ':';
    const good404 = 'HTTP/2 404\r\nx-robots-tag: noindex, nofollow\r\ncontent-length: 0\r\n\r\n';
    const run = ({ login = '404', upper = '404', admin = '404', session = '200', hdr = good404 }) => {
      const f = join(dir, 'f');
      for (const [k, v] of Object.entries({ login, upper, admin, session })) writeFileSync(join(f, `${k}.code`), v);
      writeFileSync(join(f, 'login.headers'), hdr);
      writeFileSync(join(f, 'urls'), '');
      const r = spawnSync(SH_BIN, [fwdp(join(dir, 'run.sh'))], {
        encoding: 'utf8',
        env: { ...process.env, SITE_ORIGIN: 'https://withsmall.kr', FAKE_DIR: fwdp(f), PATH: `${join(dir, 'bin')}${sep}${process.env.PATH}` },
      });
      const urls = readFileSync(join(f, 'urls'), 'utf8').trim().split('\n').filter(Boolean);
      return { status: r.status, out: r.stdout + r.stderr, urls };
    };
    let r = run({});
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /operator paths: POST \/auth\/login 404 · POST \/AUTH\/LOGIN 404 · \/admin\/ping 404 · GET \/auth\/session 200 · 404 X-Robots-Tag noindex=yes/);
    assert.deepEqual(r.urls, [
      'POST https://withsmall.kr/auth/login',
      'POST https://withsmall.kr/AUTH/LOGIN',
      'GET https://withsmall.kr/admin/ping',
      'GET https://withsmall.kr/auth/session',
    ], '통과면 한 번에 멈춘다');
    assert.equal(run({ session: '401' }).status, 0, '세션 401 도 "막히지 않음"');
    const bad = {
      '로그인 열림(앱 401)': { login: '401' },
      '대문자 경로 열림': { upper: '401' },
      '관리 경로 열림': { admin: '401' },
      '세션까지 막힘(404)': { session: '404' },
      '세션 연결 실패(000)': { session: '000' },
      '404 에 noindex 없음': { hdr: 'HTTP/2 404\r\ncontent-length: 0\r\n\r\n' },
    };
    for (const [name, c] of Object.entries(bad)) {
      r = run(c);
      assert.notEqual(r.status, 0, `${name}: 통과하면 안 된다\n${r.out}`);
      assert.equal(r.urls.filter((u) => u === 'POST https://withsmall.kr/auth/login').length, 3, `${name}: 3번 재시도`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bootstrap: 호스트 이름이 배포·관리 계정 이름과 같으면 변경 전에 멈춘다(QA152 LOW-1)', () => {
  const guard = BOOTSTRAP.indexOf('host_short=');
  assert.ok(guard > 0, 'host_short 가드');
  assert.match(BOOTSTRAP, /case "\$host_short" in\s*\n\s*"\$DEPLOY_USER"\|"\$ADMIN_USER"\) die /);
  // 시스템을 바꾸는 첫 단계(OS 확인) 전에 있어야 한다.
  assert.ok(guard < BOOTSTRAP.indexOf('[ -r /etc/os-release ]'), '가드가 OS 확인보다 앞');
});
