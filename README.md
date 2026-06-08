# Outget (아웃겟)

지도 기반 아울렛 구매대행 **당근형 양면 매칭 보드**. 서버는 매칭/UGC/신뢰 표면을
소유하지만 **결제 처리자가 아니다** — 자금은 플랫폼을 거치지 않는다.

모노레포: `client`(Vite + React PWA) + `server`(Express + Prisma/SQLite).

## 양면 보드 흐름

```
구매자(역경매 요청)  ─┐
                      ├─▶  매칭(Match) ─▶ 인앱 채팅(증빙·고지·신고 허브)
대행자(광고·일정)    ─┘                        │
                                               ▼
        외부 안전결제 딥링크(네이버페이/토스/KCP)  ──▶  소비자 → 대행자 직행
        (서버는 딥링크 생성·상태 안내만; 자금 미경유)
```

UGC: 할인소식(DiscountPost) · 현장 확인가(VerifiedPrice). 거버넌스: 신고 → 즉시 블라인드
→ 이의/재게시(notice-and-takedown) + 분쟁 채널. 신뢰: 무금전 바운티 · 뱃지 · 평판 · 대행자 지위 인증.

## 문서

- 제품 요구사항: [docs/planning-artifacts/PRD.md](docs/planning-artifacts/PRD.md)
- 아키텍처: [docs/planning-artifacts/architecture.md](docs/planning-artifacts/architecture.md)
- 불변식·하네스: [CLAUDE.md](CLAUDE.md)

## 설정

1. 환경 변수: `.env.example` → `.env` 복사 후 값 채우기.
   - `VITE_NAVER_MAP_CLIENT_ID` — 네이버 지도 JS v3 Client ID. 콘솔에서 **도메인 제한**을 설정할 것.
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — 무작위 시크릿(생성법은 `.env.example` 주석 참고). 커밋 금지.
   - `DATABASE_URL` — SQLite 경로(로컬 기본 `file:./dev.db`).
2. 의존성 설치: 루트에서 `npm install`(워크스페이스 일괄).
3. DB 스키마: `npm run prisma:migrate -w server`(개발 — `prisma migrate dev`).

## 개발

두 프로세스를 따로 띄운다(클라이언트가 `/api`·`/auth` 를 서버로 프록시).

```bash
npm run dev --workspace server   # http://localhost:3001  (Express)
npm run dev --workspace client   # http://localhost:5173  (Vite, /api·/auth → :3001 프록시)
```

apiFetch 는 **상대경로**(동일 오리진 전제)다. dev 에서는 Vite 프록시가, prod 에서는
동일 오리진 서버가 그 전제를 충족한다.

## 프로덕션 (동일 오리진)

서버가 빌드된 SPA(`client/dist`)를 직접 서빙한다 — CORS 불필요, 별도 정적 호스트 불필요.

```bash
npm run build --workspace client          # → client/dist
npm run build --workspace server          # → server/dist (tsc)
# 동일 오리진 기동(마이그레이션 적용 + 서버):
cd server && NODE_ENV=production npm run start:prod
#   start:prod = prisma migrate deploy && node dist/index.js
```

- `NODE_ENV=production` 일 때만 SPA 정적 서빙이 마운트된다. dev/test 에서는 미마운트
  (그래서 `GET /no-such-route` 가 404 로 유지된다).
- API/auth/health 응답 CSP 는 `default-src 'none'`. **SPA(HTML) 응답에만** 별도 CSP 로
  네이버 지도 출처(`oapi.map.naver.com` · `*.map.naver.com` · `*.pstatic.net`)만 허용한다.

## 배포 (도커)

단일 컨테이너(동일 오리진). SQLite 는 `/data` 볼륨에 영속한다.

```bash
docker build -t outget .
docker run -d -p 3001:3001 \
  -v outget-data:/data \
  -e JWT_ACCESS_SECRET=... \
  -e JWT_REFRESH_SECRET=... \
  outget
#   ENV 기본값: NODE_ENV=production, DATABASE_URL=file:/data/prod.db, PORT=3001
#   엔트리포인트가 prisma migrate deploy 후 서버를 기동한다. HEALTHCHECK=/health.
```

시크릿은 **런타임 주입**(이미지·repo 에 굽지 않음). 분리 정적 호스팅(서버와 다른 오리진)은
apiFetch 의 상대경로 전제를 깨뜨리므로 권장하지 않는다 — 동일 오리진 컨테이너를 쓸 것.

## 불변식 (요약 — 상세는 CLAUDE.md)

1. **무크롤링** — 외부 사이트 본문/이미지 자동 수집 금지. 정가 조회는 네이버쇼핑 API(약관 내)만.
2. **자금 미보유** — 결제대금이 플랫폼 계좌/PG 가맹점을 거치지 않는다. 소비자 → 외부 안전결제 → 대행자 직행.
3. **외부 링크 무보증** — 사용자가 붙인 안전결제 링크를 검증·보증하는 로직 금지(경고 문구는 프론트 소관).
4. **위치 비실시간** — 실시간 좌표를 서버에 저장하지 않는다. 위치는 동/지역 단위 텍스트.
5. **통신판매중개 최소 의무** — 고지·신원정보 제공·분쟁 신고 채널은 구현하되 직접거래 계약 이행은 추적하지 않는다.
