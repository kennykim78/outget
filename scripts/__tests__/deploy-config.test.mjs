// deploy/ 정적 검사 — 접속 기록 0(Caddy·compose), 수동 실행만(deploy.yml), 시크릿 0(저장소), 로그 보관 7일 패리티.
//   Kenny 2026-10-27: 내부 테스트, workflow_dispatch 만, basic_auth, "접속 기록 남기지 않음".
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

test('Caddyfile: basic_auth 는 env 자리만, 해시·평문 0 · noindex · -Server · www 302', () => {
  const blocks = caddyBlocks(CADDY);
  const apex = blocks.find((b) => b.head === 'withsmall.kr');
  const words = apex.lines.map((l) => l.words.join(' '));
  const ba = apex.lines.findIndex((l) => l.words[0] === 'basic_auth');
  assert.ok(ba >= 0, 'basic_auth');
  assert.deepEqual(apex.lines[ba + 1].words, ['{$WS_BASIC_USER}', '{$WS_BASIC_HASH}']);
  assert.doesNotMatch(CADDY, /\$2[aby]\$\d\d\$/, 'bcrypt 해시가 저장소에');
  assert.ok(words.includes('-Server'));
  assert.ok(words.includes('X-Robots-Tag "noindex, nofollow"'));
  assert.ok(words.includes('reverse_proxy app:3001'));
  // 오류 응답(401·502)에도 -Server·noindex — 지연 헤더는 오류 경로에 안 붙는다(로컬 caddy 2.10 재현).
  const he = apex.lines.findIndex((l) => l.words[0] === 'handle_errors');
  assert.ok(he >= 0, 'handle_errors');
  const heBody = apex.lines.slice(he + 1).filter((l) => l.depth === apex.lines[he].depth + 1).map((l) => l.words.join(' '));
  assert.ok(heBody.includes('header -Server'));
  assert.ok(heBody.includes('header X-Robots-Tag "noindex, nofollow"'));
  assert.ok(!words.some((w) => /Strict-Transport-Security/i.test(w)), '내부 테스트 동안 HSTS 끔');
  const www = blocks.find((b) => b.head === 'www.withsmall.kr');
  assert.ok(www.lines.some((l) => l.words.join(' ') === 'redir https://withsmall.kr{uri} 302'));
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
  assert.match(caddy, /env_file:\n\s+- \.\/caddy\.env/);
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
  assert.match(BOOTSTRAP, /chmod 0600 "\$ROOT\/server\.env" "\$ROOT\/caddy\.env"/);
  assert.match(BOOTSTRAP, /PasswordAuthentication no/);
  // QA133 INFO-11: 배포 키로 env(WS_ROOT·WS_DOCKER 등) 주입 불가를 기본값이 아니라 설정으로 고정.
  assert.match(BOOTSTRAP, /^PermitUserEnvironment no$/m);
  assert.doesNotMatch(BOOTSTRAP, /environment="/);
  // 시크릿 값은 출력하지 않는다(생성 값 변수 v 를 echo/printf/log 하지 않음).
  assert.doesNotMatch(BOOTSTRAP, /(echo|printf|log)[^\n]*\$v\b/);
});

test('예시 env: 시크릿 자리는 __SET_ME__ 만, 값 0', () => {
  for (const f of ['server.env.example', 'caddy.env.example', 'deploy.conf.example']) {
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
  const m = /\nif \[ ! -f "\$ROOT\/server\.env" \]; then\n([\s\S]*?)\nfi\nif \[ ! -f "\$ROOT\/caddy\.env" \]; then\n([\s\S]*?)\nfi\n/.exec(BOOTSTRAP);
  assert.ok(m, 'server.env·caddy.env 블록');
  assert.doesNotMatch(m[1], /\bsed\b/, '시크릿을 sed 인수로 넘기지 않는다(프로세스 목록)');
  const dir = mkdtempSync(join(tmpdir(), 'ws-boot-env-'));
  try {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'root'));
    mkdirSync(join(dir, 'bin'));
    const crlf = (t) => t.replace(/\r?\n/g, '\r\n');
    writeFileSync(join(dir, 'src', 'server.env.example'), crlf(read('deploy', 'server.env.example')));
    writeFileSync(join(dir, 'src', 'caddy.env.example'), crlf(read('deploy', 'caddy.env.example')));
    // openssl 대역(값 고정 아님: 호출마다 다른 64hex).
    writeFileSync(join(dir, 'bin', 'openssl'), '#!/bin/sh\nn=$(cat "$0.n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$0.n"\nprintf "%064x\\n" "$n"\n', { mode: 0o755 });
    const script = `set -eu\nlog() { :; }\ndie() { echo "DIE $*" >&2; exit 1; }\nSRC_DIR='${fwdp(join(dir, 'src'))}'\nROOT='${fwdp(join(dir, 'root'))}'\nif [ ! -f "$ROOT/server.env" ]; then\n${m[1]}\nfi\nif [ ! -f "$ROOT/caddy.env" ]; then\n${m[2]}\nfi\n`;
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
    assert.ok(!readFileSync(join(dir, 'root', 'caddy.env'), 'utf8').includes('\r'), 'caddy.env CR');
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
  const run = (key) => spawnSync(SH_BIN, [fwdp(join(ROOT, 'deploy', 'bootstrap.sh')), '--image-repo', 'ghcr.io/owner/repo', '--deploy-pubkey', key], {
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
