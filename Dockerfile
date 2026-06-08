# Outget — 동일 오리진 단일 컨테이너(서버가 /api·/auth + client/dist SPA 서빙).
#   멀티스테이지: client 빌드 → server 빌드(prisma generate + tsc) → 경량 runtime.
#   불변식 ②: 자금 미보유(결제 모듈 없음). ⑤: 좌표 비저장. 외부 출처=네이버 지도 SDK뿐(①).

# ── 1) client 빌드 (vite → client/dist) ──────────────────────────────────────
FROM node:22-alpine AS client-build
WORKDIR /app
# 워크스페이스 설치를 위해 루트 + client 매니페스트 복사 후 client 의존성 설치.
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
RUN npm ci --workspace client --include-workspace-root
COPY tsconfig.base.json ./tsconfig.base.json
COPY client ./client
RUN npm run build --workspace client

# ── 2) server 빌드 (prisma generate + tsc → dist) ────────────────────────────
FROM node:22-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN npm ci --workspace server --include-workspace-root
COPY tsconfig.base.json ./tsconfig.base.json
COPY server ./server
# prisma client 생성(런타임 import 대상) 후 타입스크립트 컴파일.
RUN npm run prisma:generate --workspace server \
 && npm run build --workspace server

# ── 3) runtime (prod 의존성 + dist + prisma + client/dist) ───────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    DATABASE_URL=file:/data/prod.db \
    PORT=3001
WORKDIR /app

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
COPY --from=client-build /app/client/dist ./client/dist

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# /data 볼륨(SQLite prod.db) — 비루트 유저가 쓸 수 있도록 소유권 부여.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
WORKDIR /app/server

EXPOSE 3001

# 헬스체크: 동일 오리진 /health → { ok: true }.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

# 엔트리포인트: prisma migrate deploy → node dist/index.js (cwd=/app/server).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
