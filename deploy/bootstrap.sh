#!/bin/sh
# WithSmall 새 호스트 준비(Oracle Cloud A1.Flex arm64 — Ubuntu 24.04 권장, Oracle Linux 8/9 도 처리). root 로 한 번 실행, 여러 번 실행해도 결과가 같다(멱등).
#   사용(이 저장소의 deploy/ 폴더를 서버에 올린 뒤):
#     sudo sh deploy/bootstrap.sh --image-repo ghcr.io/<owner>/<repo> --deploy-pubkey "ssh-ed25519 AAAA... gha-deploy"
#   하는 일:
#     1) 자동 보안 업데이트(unattended-upgrades / dnf-automatic) · 시간대 UTC
#     2) Docker 공식 저장소에서 docker-ce + compose 플러그인(arm64·amd64 자동)
#     3) journald 7일·500M(앱·Caddy 로그 = journald, 개인정보 처리방침 '서버 오류 기록 7일'과 같은 값 — policy.ts SERVER_LOG_RETENTION_DAYS)
#        syslog 사본 0: ForwardToSyslog=no + rsyslog 가 있으면 withsmall-* 태그를 버린다(imjournal 경로 포함) — 사본이 logrotate 4주를 따르지 않게.
#        7일 보장: 활성 파일 MaxFileSec=1day 로 매일 순환 + 매일 타이머 journalctl --rotate --vacuum-time=(7-2)d(QA122 HIGH-1).
#     4) 방화벽: Ubuntu 는 iptables INPUT 의 Oracle 기본 REJECT 앞에 80·443/tcp·443/udp(ufw 쓰지 않음), Oracle Linux 는 firewalld.
#        OCI 콘솔 Security List 인그레스도 따로 열어야 한다(docs/ops/deploy.md 8절).
#     5) deploy 사용자(docker 그룹) + 강제 명령 키(restrict,command=deploy-gate.sh) · sshd 강화(비밀번호·root 로그인 끔)
#     6) /opt/withsmall/{bin,state,data,data/backup}: data 는 1000:1000 750(컨테이너 node 사용자)
#     7) compose.yaml·Caddyfile·deploy.sh·deploy-gate.sh 복사, deploy.conf 작성, server.env·caddy.env 없으면 예시로 만든다(0600, deploy 소유).
#        server.env 의 시크릿 3개(__SET_ME__)는 이 서버에서 openssl 로 채운다 — 값은 출력하지 않는다. caddy.env 는 Kenny 가 채운다.
#   인수 검사만(아무것도 바꾸지 않음): WS_BOOTSTRAP_ARGS_ONLY=1 — scripts/__tests__/deploy-config.test.mjs.
#   하지 않는 것: GHCR 로그인(PAT — Kenny 가 deploy 사용자로 직접), 시크릿 출력, 외부 백업, 지도·메일 설정.
set -eu
LC_ALL=C
export LC_ALL

log() { printf '[bootstrap] %s\n' "$*"; }
die() { log "FAIL: $*" >&2; exit 1; }

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=/opt/withsmall
DEPLOY_USER=deploy
JOURNAL_DAYS=7
IMAGE_REPO=""
PUBKEY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --image-repo) IMAGE_REPO="${2:-}"; shift 2 ;;
    --deploy-pubkey) PUBKEY="${2:-}"; shift 2 ;;
    *) die "알 수 없는 인수: $1" ;;
  esac
done

case "$IMAGE_REPO" in
  ghcr.io/*/*) case "$IMAGE_REPO" in *[!a-z0-9./_-]*) die "--image-repo 는 소문자(ghcr.io/<owner>/<repo>)" ;; esac ;;
  *) die "--image-repo ghcr.io/<owner>/<repo> 필요" ;;
esac
case "$PUBKEY" in
  ssh-ed25519\ *|ecdsa-sha2-*\ *) : ;;
  *) die "--deploy-pubkey 에 공개키 한 줄(ssh-ed25519 ...) 필요 — 비밀키를 넣지 말 것" ;;
esac
case "$PUBKEY" in *PRIVATE*) die "비밀키처럼 보인다 — 공개키(.pub)만" ;; esac
# 한 줄·키 하나만: 개행·CR 이 섞이면 둘째 줄이 restrict 없이 authorized_keys 에 들어간다(QA122 LOW-2).
NL="$(printf '\nx')"; NL="${NL%x}"
CR="$(printf '\r')"
case "$PUBKEY" in *"$NL"*|*"$CR"*) die "--deploy-pubkey 에 개행이 있다 — 공개키 한 줄(키 하나)만" ;; esac
# 형식: <종류> <base64> [주석]. 둘째 칸이 base64 가 아니거나 같은 줄에 키 종류가 또 나오면(키 두 개) 거부.
key_b64="$(printf '%s' "$PUBKEY" | awk '{print $2}')"
case "$key_b64" in ''|*[!A-Za-z0-9+/=]*) die "--deploy-pubkey 형식 오류(<종류> <base64> [주석])" ;; esac
if ! printf '%s' "$PUBKEY" | awk '{ for (i = 3; i <= NF; i++) if ($i ~ /^(ssh-|ecdsa-sha2-|sk-)/ || $i ~ /^AAAA[A-Za-z0-9+\/=]{16,}$/) exit 1 }'; then
  die "--deploy-pubkey 에 키가 둘 이상 — 키 하나만"
fi
unset key_b64
if [ "${WS_BOOTSTRAP_ARGS_ONLY:-0}" = "1" ]; then log "인수 검사 통과(WS_BOOTSTRAP_ARGS_ONLY)"; exit 0; fi
[ "$(id -u)" = "0" ] || die "root 로 실행(sudo)"
for f in compose.yaml Caddyfile deploy.sh deploy-gate.sh server.env.example caddy.env.example; do
  [ -f "$SRC_DIR/$f" ] || die "$SRC_DIR/$f 없음 — deploy/ 폴더 전체를 올린다"
done

[ -r /etc/os-release ] || die "/etc/os-release 없음"
. /etc/os-release
case "${ID:-}" in
  ubuntu) OS=ubuntu ;;
  ol|oracle) OS=oracle ;;
  *) die "지원 OS: Ubuntu 24.04 / Oracle Linux 8·9 (현재 ${ID:-?})" ;;
esac
log "OS=$OS ${VERSION_ID:-} arch=$(uname -m)"

# ── 1) 업데이트·시간대 ─────────────────────────────────────────────
if [ "$OS" = ubuntu ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -yq ca-certificates curl gnupg unattended-upgrades iptables-persistent openssl
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOT
else
  dnf -y install ca-certificates curl dnf-automatic openssl firewalld dnf-plugins-core
  sed -i 's/^apply_updates *=.*/apply_updates = yes/' /etc/dnf/automatic.conf || true
  systemctl enable --now dnf-automatic.timer
fi
timedatectl set-timezone UTC 2>/dev/null || ln -sf /usr/share/zoneinfo/UTC /etc/localtime

# ── 4) 방화벽(도커보다 먼저 — 저장 규칙에 도커 체인이 섞이지 않게) ─────────
if [ "$OS" = ubuntu ]; then
  open_rule() {
    if iptables -C INPUT -p "$1" -m state --state NEW -m "$1" --dport "$2" -j ACCEPT 2>/dev/null; then return 0; fi
    pos="$(iptables -L INPUT --line-numbers -n | awk '$2=="REJECT"{print $1; exit}')"
    if [ -n "$pos" ]; then
      iptables -I INPUT "$pos" -p "$1" -m state --state NEW -m "$1" --dport "$2" -j ACCEPT
    else
      iptables -A INPUT -p "$1" -m state --state NEW -m "$1" --dport "$2" -j ACCEPT
    fi
    log "iptables INPUT 허용 $1/$2"
  }
  open_rule tcp 80
  open_rule tcp 443
  open_rule udp 443
  if ! systemctl is-active --quiet docker 2>/dev/null; then
    netfilter-persistent save
  else
    log "docker 가 이미 돌고 있어 규칙 저장을 건너뜀 — 도커 체인이 저장되지 않게 docs/ops/deploy.md 8절 수동 저장 참고"
  fi
else
  systemctl enable --now firewalld
  firewall-cmd --permanent --add-service=http --add-service=https
  firewall-cmd --permanent --add-port=443/udp
  firewall-cmd --reload
fi

# ── 2) Docker(공식 저장소) ─────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  if [ "$OS" = ubuntu ]; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "${VERSION_CODENAME:?}" > /etc/apt/sources.list.d/docker.list
    apt-get update -q
    apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
fi
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  # 컨테이너 로그 = journald(아래 7일 보관). 도커 자체 json 로그 파일을 남기지 않는다.
  printf '{\n  "log-driver": "journald"\n}\n' > /etc/docker/daemon.json
fi
systemctl enable docker >/dev/null 2>&1 || true
systemctl restart docker

# ── 3) journald 7일·500M · syslog 사본 0 ─────────────────────────────
# 드롭인 이름 zz-* — /usr/lib/systemd/journald.conf.d/syslog.conf(rsyslog 패키지, ForwardToSyslog=yes)보다 뒤에 정렬돼 이긴다.
#   MaxRetentionSec 는 보관(archived) 파일 단위로만 지운다 → MaxFileSec=1day 로 활성 파일을 매일 닫는다.
mkdir -p /etc/systemd/journald.conf.d
rm -f /etc/systemd/journald.conf.d/withsmall.conf
cat > /etc/systemd/journald.conf.d/zz-withsmall.conf <<EOT
[Journal]
SystemMaxUse=500M
MaxRetentionSec=${JOURNAL_DAYS}day
MaxFileSec=1day
ForwardToSyslog=no
EOT
systemctl restart systemd-journald
# 매일: 활성 파일을 닫고(--rotate) 마지막 항목이 (일수-2)일보다 오래된 보관 파일 삭제.
#   파일 하나 = 최대 하루(+타이머 지연) → 가장 오래된 항목의 최대 나이 ≈ (일수-2) + 1 + 지연·누락 여유 1일 ≤ 일수.
VACUUM_DAYS=$((JOURNAL_DAYS - 2))
cat > /etc/systemd/system/withsmall-journal-vacuum.service <<EOT
[Unit]
Description=WithSmall journal ${JOURNAL_DAYS}-day retention (privacy policy SERVER_LOG_RETENTION_DAYS)

[Service]
Type=oneshot
ExecStart=/usr/bin/journalctl --rotate --vacuum-time=${VACUUM_DAYS}d
EOT
cat > /etc/systemd/system/withsmall-journal-vacuum.timer <<'EOT'
[Unit]
Description=WithSmall journal retention (daily)

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
EOT
systemctl daemon-reload
systemctl enable --now withsmall-journal-vacuum.timer
# rsyslog: ForwardToSyslog=no 는 imuxsock(Ubuntu) 경로만 끊는다. imjournal(Oracle Linux 기본)은 저널을 직접 읽으므로
#   컨테이너 태그(compose logging.options.tag = withsmall-*)는 rsyslog 에서 버린다 — /var/log/syslog·messages 에 사본 0.
if [ -d /etc/rsyslog.d ] || command -v rsyslogd >/dev/null 2>&1; then
  mkdir -p /etc/rsyslog.d
  cat > /etc/rsyslog.d/00-withsmall-drop.conf <<'EOT'
# WithSmall: 앱·Caddy 컨테이너 기록은 journald(7일)에만 — syslog 파일 사본 0(처리방침 '서버 오류 기록').
if ($programname startswith 'withsmall-') or ($syslogtag startswith 'withsmall-') then stop
EOT
  if command -v rsyslogd >/dev/null 2>&1; then
    rsyslogd -N1 >/dev/null 2>&1 || die "rsyslog 설정 검사 실패(/etc/rsyslog.d/00-withsmall-drop.conf)"
    systemctl restart rsyslog 2>/dev/null || log "rsyslog 재시작 실패 — 확인 필요"
  fi
  log "rsyslog: withsmall-* 기록 버림"
fi

# ── 5) deploy 사용자·SSH ──────────────────────────────────────────
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/sh "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
home="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
printf 'restrict,command="%s/bin/deploy-gate.sh" %s\n' "$ROOT" "$PUBKEY" > "$home/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$home/.ssh/authorized_keys"
chmod 0600 "$home/.ssh/authorized_keys"

mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-withsmall.conf <<'EOT'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
MaxAuthTries 3
# authorized_keys environment=·~/.ssh/environment 로 WS_* 등 env 주입 금지 — 기본값에 기대지 않고 명시(QA133 INFO-11).
PermitUserEnvironment no
EOT
if sshd -t; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || log "sshd reload 실패 — 재부팅 시 적용"
else
  rm -f /etc/ssh/sshd_config.d/10-withsmall.conf
  die "sshd 설정 검사 실패 — 강화 설정을 되돌림"
fi

# ── 6) 폴더 ─────────────────────────────────────────────────────
install -d -m 0755 -o root -g root "$ROOT" "$ROOT/bin"
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ROOT/state"
install -d -m 0750 -o 1000 -g 1000 "$ROOT/data" "$ROOT/data/backup"

# ── 7) 파일 ─────────────────────────────────────────────────────
install -m 0644 -o root -g root "$SRC_DIR/compose.yaml" "$ROOT/compose.yaml"
install -m 0644 -o root -g root "$SRC_DIR/Caddyfile" "$ROOT/Caddyfile"
install -m 0755 -o root -g root "$SRC_DIR/deploy.sh" "$ROOT/bin/deploy.sh"
install -m 0755 -o root -g root "$SRC_DIR/deploy-gate.sh" "$ROOT/bin/deploy-gate.sh"
printf '# bootstrap.sh 가 작성. 시크릿 아님.\nWS_IMAGE_REPO=%s\n' "$IMAGE_REPO" > "$ROOT/deploy.conf"
chmod 0644 "$ROOT/deploy.conf"

if [ ! -f "$ROOT/server.env" ]; then
  umask 077
  # CR 제거(Windows 체크아웃 CRLF 방어 — .gitattributes deploy/** eol=lf 와 이중).
  tr -d '\r' < "$SRC_DIR/server.env.example" > "$ROOT/server.env.tmp"
  for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET REACTION_KEY_SECRET; do
    # 값은 awk 의 환경으로만 넘긴다(명령 인수 = 프로세스 목록에 보이지 않게, QA122 LOW-4).
    WS_SECRET="$(openssl rand -hex 32)" WS_KEY="$k" awk '$0 == ENVIRON["WS_KEY"] "=__SET_ME__" { print ENVIRON["WS_KEY"] "=" ENVIRON["WS_SECRET"]; next } { print }' \
      "$ROOT/server.env.tmp" > "$ROOT/server.env.tmp2"
    mv "$ROOT/server.env.tmp2" "$ROOT/server.env.tmp"
    grep -Eq "^$k=[0-9a-f]{64}\$" "$ROOT/server.env.tmp" || { rm -f "$ROOT/server.env.tmp"; die "server.env $k 시크릿 채우기 실패"; }
  done
  mv "$ROOT/server.env.tmp" "$ROOT/server.env"
  log "server.env 작성(시크릿 3개 생성, 값 출력 없음)"
fi
if [ ! -f "$ROOT/caddy.env" ]; then
  umask 077
  tr -d '\r' < "$SRC_DIR/caddy.env.example" > "$ROOT/caddy.env"
  log "caddy.env 작성 — WS_BASIC_USER·WS_BASIC_HASH 를 채워야 배포된다"
fi
chown "$DEPLOY_USER:$DEPLOY_USER" "$ROOT/server.env" "$ROOT/caddy.env"
chmod 0600 "$ROOT/server.env" "$ROOT/caddy.env"

log "완료. 다음: (1) caddy.env 채우기 (2) deploy 사용자로 GHCR 로그인 (3) DNS 확인 후 첫 배포 — docs/ops/deploy.md 8절"
