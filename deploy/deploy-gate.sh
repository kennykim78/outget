#!/bin/sh
# SSH 강제 명령(authorized_keys: restrict,command="/opt/withsmall/bin/deploy-gate.sh" <키>) — 배포 키로는 이 두 명령만 된다.
#   허용: "deploy sha-<소문자 16진 12자>" | "rollback"   (정규식 ^(deploy sha-[0-9a-f]{12}|rollback)$ 와 같음)
#   그 밖(빈 명령·셸·개행·추가 인자)은 거부, 종료 코드 2. case 패턴은 문자열 전체와 맞아 개행을 끼워 넣을 수 없다.
#   테스트: scripts/__tests__/deploy-sh.test.mjs (WS_DEPLOY_SH 로 deploy.sh 경로 재정의).
set -eu
LC_ALL=C
export LC_ALL
DEPLOY_SH="${WS_DEPLOY_SH:-/opt/withsmall/bin/deploy.sh}"
cmd="${SSH_ORIGINAL_COMMAND:-}"
case "$cmd" in
  rollback)
    exec sh "$DEPLOY_SH" rollback ;;
  "deploy sha-"[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f])
    exec sh "$DEPLOY_SH" deploy "${cmd#deploy }" ;;
  *)
    printf '[deploy-gate] rejected\n' >&2
    exit 2 ;;
esac
