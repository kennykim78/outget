#!/bin/sh
# deploy.sh 테스트용 가짜 docker(scripts/__tests__/deploy-sh.test.mjs). 실제 도커를 부르지 않는다.
#   상태: $FAKE_DIR/{calls.log, images, running, stopped}
#   조절: $FAKE_DIR/unhealthy(헬스 실패 이미지 목록) · $FAKE_DIR/mutate(기동 시 prod.db 를 MUTATED 로 바꿀 이미지 — 마이그레이션 흉내)
#         $FAKE_DIR/mig/<태그>(마이그레이션 목록, 기본 "0001_init ") · $FAKE_DIR/nopull(pull 실패 이미지) · FAKE_ARCH(기본 arm64)
#         FAKE_DATA = 호스트 data 폴더(-v 와 같은 경로)
#         $FAKE_DIR/norestore(배포 전 백업 복원 스크립트 실패) · $FAKE_DIR/slow_pull(초 — pull 중 대기, 신호 테스트)
#         $FAKE_DIR/slow_backup(초 — 배포 전 백업 중 대기, kill -9 테스트)
#         $FAKE_DIR/slow_up(초 — compose up 중 대기, DB 를 바꾸는 단계의 신호·kill -9 테스트, QA131 LOW-9)
#         $FAKE_DIR/migfail(마이그레이션 목록 조회 docker run 이 목록 일부를 찍은 뒤 125 로 실패 — 비었으면 모든 이미지, 아니면 적힌 태그만, QA133 LOW-12)
#         $FAKE_DIR/slow_prune(초 — 성공 뒤 image ls 중 대기, settle 뒤 신호 테스트, QA133 LOW-13)
#         $FAKE_DIR/restore_mvfail(복원 스크립트의 마지막 mv 만 실패 — QA127 LOW-5) · $FAKE_DIR/nodiscard(새 DB 치우기 실패 — LOW-6)
#         $FAKE_DIR/noorphan(고아 짝 파일 정리 docker run 실패 — security 139 LOW-7)
set -eu
D="${FAKE_DIR:?}"
printf '%s\n' "$*" >> "$D/calls.log"
inlist() { [ -f "$2" ] && grep -qxF "$1" "$2"; }
tagof() { printf '%s' "${1##*:}"; }

case "$1" in
  pull)
    if inlist "$2" "$D/nopull"; then exit 1; fi
    if [ -f "$D/slow_pull" ]; then sleep "$(cat "$D/slow_pull")"; fi
    inlist "$2" "$D/images" || printf '%s\n' "$2" >> "$D/images"
    printf '%s: Pulling from fake (progress)\n' "${2##*:}"
    ;;
  image)
    case "$2" in
      inspect)
        if [ "$3" = "--format" ]; then printf '%s\n' "${FAKE_ARCH:-arm64}"; else inlist "$3" "$D/images"; fi ;;
      ls)
        if [ -f "$D/slow_prune" ]; then sleep "$(cat "$D/slow_prune")"; fi
        [ -f "$D/images" ] && cat "$D/images" || true ;;
      rm) if [ -f "$D/images" ]; then grep -vxF "$3" "$D/images" > "$D/images.tmp" || true; mv "$D/images.tmp" "$D/images"; fi ;;
      prune) : ;;
    esac
    ;;
  run)
    shift
    host=""; img=""; script=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --rm) shift ;;
        --network|--entrypoint) shift 2 ;;
        -v) host="${2%:/data}"; shift 2 ;;
        -c) script="$2"; shift 2 ;;
        sh) shift ;;
        *) img="$1"; shift ;;
      esac
    done
    case "$script" in
      *prisma/migrations*)
        t="$(tagof "$img")"
        if [ -f "$D/migfail" ] && { [ ! -s "$D/migfail" ] || inlist "$t" "$D/migfail"; }; then printf '0001_init '; echo "fake error mid-run" >&2; exit 125; fi
        if [ -f "$D/mig/$t" ]; then cat "$D/mig/$t"; else printf '0001_init '; fi ;;
      *prod.db.restore*)
        if [ -f "$D/norestore" ]; then exit 1; fi
        if [ -f "$D/restore_mvfail" ]; then script="$(printf '%s' "$script" | sed 's#^mv /data/prod.db.restore /data/prod.db ||#false ||#')"; fi
        s="$(printf '%s' "$script" | sed "s#/data#$host#g")"
        sh -c "$s" ;;
      *"orphan sidecar"*)
        if [ -f "$D/noorphan" ]; then exit 1; fi
        s="$(printf '%s' "$script" | sed "s#/data#$host#g")"
        sh -c "$s" ;;
      *faileddeploy*)
        if [ -f "$D/nodiscard" ]; then exit 1; fi
        s="$(printf '%s' "$script" | sed "s#/data#$host#g")"
        sh -c "$s" ;;
      *)
        # /data → 호스트 폴더로 바꿔 실제로 실행(백업·복원 동작 검증).
        case "$script" in *-predeploy.db*) if [ -f "$D/slow_backup" ]; then sleep "$(cat "$D/slow_backup")"; fi ;; esac
        s="$(printf '%s' "$script" | sed "s#/data#$host#g")"
        sh -c "$s" ;;
    esac
    ;;
  compose)
    envf=""; sub=""
    shift
    while [ $# -gt 0 ]; do
      case "$1" in
        --project-name|--project-directory|-f) shift 2 ;;
        --env-file) envf="$2"; shift 2 ;;
        *) sub="$1"; shift; break ;;
      esac
    done
    case "$sub" in
      up)
        img="$(sed -n 's/^WS_IMAGE=//p' "$envf")"
        if [ -f "$D/slow_up" ]; then sleep "$(cat "$D/slow_up")"; fi
        printf '%s\n' "$img" > "$D/running"
        rm -f "$D/stopped"
        if inlist "$img" "$D/mutate"; then printf 'MUTATED' > "${FAKE_DATA:?}/prod.db"; fi
        # 실제 compose 처럼 진행 출력(stderr) — deploy.sh 는 이것을 state/deploy.log 로만 보내야 한다(QA127 MED-3).
        printf ' Container withsmall-app-1  Started (%s)
' "$img" >&2
        ;;
      stop) : > "$D/stopped" ;;
      ps) if [ -f "$D/running" ] && [ ! -f "$D/stopped" ]; then echo cid123; fi ;;
    esac
    ;;
  inspect)
    img="$(cat "$D/running")"
    if inlist "$img" "$D/unhealthy"; then echo unhealthy; else echo healthy; fi
    ;;
  *) exit 1 ;;
esac
