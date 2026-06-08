#!/bin/sh
# Outget 동일 오리진 컨테이너 엔트리포인트.
#   1) SQLite 스키마를 /data 볼륨에 적용(prisma migrate deploy — 비대화형, 운영용).
#   2) 서버 기동(node dist/index.js) — exec 로 PID 1 교체(SIGTERM 우아한 종료 전달).
set -e

npx prisma migrate deploy

exec node dist/index.js
