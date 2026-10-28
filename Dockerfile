# WithSmall — 동일 오리진 단일 컨테이너(서버가 /api + 프리렌더된 client/dist 서빙).
#   멀티스테이지: client 빌드 → server 빌드(prisma generate + tsc + 프리렌더) → 경량 runtime.
#   불변식 ①: 무크롤링(외부 출처=네이버 지도 SDK뿐). ②: 분양·매칭 없음. ④: 플랫폼 자금 미보유(결제 모듈 없음).
#   ⑧: 실시간 위치 저장 안 함.
#   빌드 인자(R6 A1 — 프리렌더·vite 는 빌드 타임이라 값이 이미지에 구워진다, 시크릿 아님):
#     SITE_ORIGIN               필수. https 공개 오리진(canonical·sitemap·OG). 미설정·localhost·http 면 프리렌더가 빌드 실패(N-2).
#     VITE_NAVER_MAP_CLIENT_ID  선택. 네이버 지도 Client ID(공개 키, 콘솔 도메인 제한). 비우면 /vet 은 목록형(N-1).
#     WS_INDEXABLE              선택. 1 일 때만 robots Allow — 기본 0(비공개). 공개 결정은 Kenny.
#   예: docker build --build-arg SITE_ORIGIN=https://staging.example --build-arg VITE_NAVER_MAP_CLIENT_ID=<id> -t withsmall .

# 베이스 이미지는 다이제스트 고정(security 139 LOW-3 — 같은 태그가 다른 내용으로 바뀌어도 빌드가 따라가지 않는다).
#   node:22-alpine 멀티 아키텍처 인덱스 다이제스트(amd64 CI · arm64 운영 모두 포함). 갱신 절차: docs/ops/deploy.md 6절 '베이스 이미지 갱신'
#   (Dependabot docker 생태계가 주 1회 갱신 PR — .github/dependabot.yml). 세 단계가 같은 다이제스트여야 한다(deploy-config.test.mjs).

# ── 1) client 빌드 (vite → client/dist) ──────────────────────────────────────
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS client-build
WORKDIR /app
# 워크스페이스 설치를 위해 루트 + client 매니페스트 복사 후 client 의존성 설치.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
RUN npm ci --workspace client --include-workspace-root
COPY tsconfig.base.json ./tsconfig.base.json
COPY client ./client
# 클라가 별칭(@ws/engine·@ws/copy·@ws/events)으로 가져오는 서버 공용 순수 모듈(client/tsconfig.json paths · vite alias).
COPY server/src ./server/src
# N-1: 지도 Client ID 는 vite 가 빌드 시점에 import.meta.env 로 굽는다(useNaverMapLoader) — ENV 로 vite 에 전달.
ARG VITE_NAVER_MAP_CLIENT_ID=
ENV VITE_NAVER_MAP_CLIENT_ID=${VITE_NAVER_MAP_CLIENT_ID}
RUN npm run build --workspace client

# ── 2) server 빌드 (prisma generate + tsc → dist) ────────────────────────────
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS server-build
WORKDIR /app
# Prisma 엔진은 libssl 버전을 감지해 고른다 — alpine 기본 이미지엔 openssl 이 없어 openssl-1.1 엔진으로 잘못 떨어지고
#   런타임 migrate deploy 가 "Could not parse schema engine response" 로 실패했다(R6 A2 컨테이너 검증에서 재현). generate·runtime 모두 설치.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci --workspace server --include-workspace-root
COPY tsconfig.base.json ./tsconfig.base.json
COPY server ./server
# prisma client 생성(런타임 import 대상) 후 타입스크립트 컴파일.
RUN npm run prisma:generate --workspace server \
 && npm run build --workspace server
# 프리렌더 입력: client/dist(마커 포함 템플릿) · client/public(/assets 존재 검사) · scripts · server/seed(COPY server 에 포함).
COPY --from=client-build /app/client/dist ./client/dist
COPY client/public ./client/public
COPY scripts ./scripts
# 프리렌더 마스코트 SVG(cli.ts DEFAULT_MASCOTS = <repo>/docs/design/mascots → 이미지 /app/docs/design/mascots).
COPY docs/design/mascots ./docs/design/mascots
# 컴파일된 server/dist 엔진으로 프리렌더 → client/dist 에 정적 HTML 출력(seed:validate 오류 시 빌드 실패).
# 이어서 텍스트 사전 압축(.br/.gz, R6 F2a — node:zlib) → 컴플라이언스 스캔(--require-output: manifest 없거나 FAIL 이면
#   빌드 실패, 압축 사본 = 원본 바이트 검사 포함).
# N-2: SITE_ORIGIN 필수(cli.ts productionOriginProblem — 미설정·localhost·비 https 면 exit 2 = 빌드 실패).
#   VITE_NAVER_MAP_CLIENT_ID 는 존재 여부만 프리렌더에 쓰인다(/vet layout=map|list, 값은 산출물에 0 — G-4).
ARG SITE_ORIGIN
ARG WS_INDEXABLE=0
ARG VITE_NAVER_MAP_CLIENT_ID=
RUN NODE_ENV=production node scripts/prerender.mjs \
 && node scripts/precompress.mjs \
 && node scripts/compliance-scan.mjs --require-output

# ── 3) runtime (prod 의존성 + dist + prisma + client/dist) ───────────────────
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
# SQLITE_TMPDIR(QA148 MED-1): SQLite 임시 파일(VACUUM 은 살아 있는 데이터 크기만큼)을 /data 볼륨 안에 둔다 — read_only 루트에서는
#   /var/tmp 가 쓰기 불가라 tmpfs /tmp(64m)로 떨어져 DB 가 약 64MB 를 넘으면 VACUUM 이 "database or disk is full" 로 실패했다.
#   엔트리포인트가 0700 으로 만든다. /data/backup(정리 대상)·erasures.jsonl 과 겹치지 않는 숨김 폴더.
ENV NODE_ENV=production \
    DATABASE_URL=file:/data/prod.db \
    SQLITE_TMPDIR=/data/.sqlite-tmp \
    PORT=3001
WORKDIR /app
# Prisma 엔진 libssl(위 server-build 와 같은 이유).
RUN apk add --no-cache openssl

# 헬스체크용 wget 은 alpine 기본 제공(busybox). 비루트 실행 준비.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
# 운영 의존성만 설치(devDeps 제외).
RUN npm ci --workspace server --include-workspace-root --omit=dev

# 빌드 산출물 복사: server dist + prisma 스키마/마이그레이션 + 생성된 prisma client + client/dist.
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/prisma ./server/prisma
# 생성된 prisma client(@prisma/client + .prisma/client 엔진) 복사 — 런타임 import 누락 방지.
COPY --from=server-build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=server-build /app/node_modules/@prisma/client ./node_modules/@prisma/client
# prisma CLI(devDep, --omit=dev 로 미설치) — entrypoint 의 migrate deploy 에 필요.
COPY --from=server-build /app/node_modules/prisma ./node_modules/prisma
COPY --from=server-build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=server-build /app/client/dist ./client/dist
# N-3: 시드 원본(DRAFT 그대로) — entrypoint 의 node dist/seed/cli-load.js 가 적재(DEFAULT_SEED_DIR = dist/seed/../../seed = /app/server/seed).
#   노출 여부는 엔진 판정(VERIFIED·규격)이 결정한다 — 적재 ≠ 노출.
COPY --from=server-build /app/server/seed ./server/seed

# 빌드에 쓴 SITE_ORIGIN 을 런타임에도 남긴다 — env 검사가 PUBLIC_ORIGIN 불일치를 경고(config/env.ts). 시크릿 아님.
ARG SITE_ORIGIN
ENV SITE_ORIGIN=${SITE_ORIGIN}

COPY docker-entrypoint.sh ./docker-entrypoint.sh
# 백업 정리(개수 WS_BACKUP_KEEP + 나이 WS_BACKUP_MAX_AGE_DAYS) — 엔트리포인트가 sh 로 호출한다.
COPY scripts/prune-backups.sh ./scripts/prune-backups.sh
RUN chmod +x ./docker-entrypoint.sh

# /data 볼륨(SQLite prod.db) — 비루트 유저가 쓸 수 있도록 /data 만 소유권 부여.
#   /app 은 root 소유 그대로(COPY·npm ci 가 root) — app 사용자(node)는 코드·의존성·프리렌더 산출물을 바꾸지 못한다(security 139 LOW-2).
#   운영 compose 는 여기에 read_only + tmpfs /tmp 를 더한다(deploy/compose.yaml) — 쓰기는 /data 볼륨과 /tmp 뿐.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
WORKDIR /app/server

EXPOSE 3001

# 헬스체크: 동일 오리진 /health → { ok: true }.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

# 엔트리포인트(cwd=/app/server): env 검사 → /data/prod.db 백업(최근 5개·최대 7일, scripts/prune-backups.sh) → prisma migrate deploy → 시드 적재 → node dist/index.js.
#   어느 단계든 실패하면 기동하지 않는다.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
