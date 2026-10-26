#!/bin/sh
# WithSmall DB 백업 정리(P6). POSIX sh + busybox(alpine) 호환 — find -mmin / ls / sort / tail 만 사용.
#   사용: sh prune-backups.sh [--check]
#   입력(env): WS_BACKUP_DIR(기본 /data/backup), WS_BACKUP_KEEP(기본 5, 1 이상 정수),
#              WS_BACKUP_MAX_AGE_DAYS(기본 7, 1 이상 POLICY_MAX_AGE(7) 이하 정수 — 101 MED-1)
#   규칙: ① 수정 시각이 MAX_AGE_DAYS 일을 넘긴 prod-*.db ② 남은 것 중 최신 KEEP 개 밖 — 둘 다 적용.
#         삭제 시 짝 파일(-journal, -wal)도 함께 지운다. 이름의 UTC 타임스탬프는 사전순 = 시간순.
#   검증 실패(0·음수·비숫자 등)면 에러 메시지 + 종료 코드 2, 아무것도 지우지 않는다. --check 는 검증만.
set -eu

log() { printf '[prune-backups] %s\n' "$*"; }

BACKUP_DIR="${WS_BACKUP_DIR:-/data/backup}"
KEEP="${WS_BACKUP_KEEP:-5}"
MAX_AGE="${WS_BACKUP_MAX_AGE_DAYS:-7}"
# server/src/privacy/policy.ts BACKUP_RETENTION_DAYS 와 같아야 한다(패리티 테스트: scripts/__tests__/prune-backups.test.mjs).
#   이보다 오래 남는 백업은 묘비(retainUntil) 만료 뒤 복원되면 지운 계정을 되살린다.
POLICY_MAX_AGE=7

is_pos_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ]
}

if ! is_pos_int "$KEEP"; then
  log "invalid WS_BACKUP_KEEP='$KEEP' (1 이상의 정수 필요; 0·음수·비숫자 거부)" >&2
  exit 2
fi
if ! is_pos_int "$MAX_AGE"; then
  log "invalid WS_BACKUP_MAX_AGE_DAYS='$MAX_AGE' (1 이상의 정수 필요; 0·음수·비숫자 거부)" >&2
  exit 2
fi
if [ "$MAX_AGE" -gt "$POLICY_MAX_AGE" ]; then
  log "invalid WS_BACKUP_MAX_AGE_DAYS='$MAX_AGE' (${POLICY_MAX_AGE} 이하 필요; 처리방침·묘비 보존 기간 초과 거부)" >&2
  exit 2
fi

[ "${1:-}" = "--check" ] && exit 0
[ -d "$BACKUP_DIR" ] || exit 0

remove_set() {
  rm -f "$1" "$1-journal" "$1-wal"
  log "backup pruned $1 ($2)"
}

# ① 나이 상한 — 런타임(privacy/retention.ts: now − N×24h 보다 오래된 것)과 같게 분 단위(-mmin)로 판정. -mtime 은 일 단위 내림이라 약 N+1일부터 지운다.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prod-*.db' -mmin +"$((MAX_AGE * 1440))" | while IFS= read -r old; do
  remove_set "$old" "older than ${MAX_AGE}d"
done

# ② 개수 상한(① 이후 남은 것 기준)
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'prod-*.db' | sort -r | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
  remove_set "$old" "beyond keep=${KEEP}"
done
