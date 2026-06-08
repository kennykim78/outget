---
name: knockedu-run
description: Launch the Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) app locally — the client (and server, if present) — and confirm it serves. Use when asked to run, start, serve, or smoke-test the Outget app, or to verify a change in the real running app.
---

# Running Outget (아웃겟) locally

Outget is **mobile-first**; the client carries the UX, the server owns matching/UGC/auth (no payment custody).

## Stack status: WIRED (Epic 1 — npm workspaces)

```bash
cd <repo-root>
npm install          # first run only (워크스페이스 루트, 단일 lockfile)
npm run dev:client   # vite dev → http://localhost:5173 (PWA 셸 + 네이버 지도)
npm run dev:server   # tsx watch → http://localhost:3001 (/health, /auth/*)
```
클라/서버를 **별도 백그라운드 셸**에서 실행(둘 다 blocking). `npm run dev:client`/`dev:server`는 루트 package.json 스크립트.

## Client (Vite, port 5173)
- 진입 화면: 네이버 지도 셸(S1 보드는 Epic 2). 키 없으면 'no-key' 안내(크래시 없음).
- 핵심 플로우(에픽 진행에 따라): **역경매 요청(S4) → 채택 → 매칭 채팅(S5) → 거래방식(직접/외부 안전결제)**, 할인소식(S2 미검증 라벨/현장확인가), 통신판매중개 고지.

## Server (Express, port 3001)
- `npm run dev:server` (tsx watch). `/health`→200, `/auth/register|login|refresh|me`, `/admin/ping`(운영자). `.env`에 JWT 시크릿·CORS_ORIGIN 필요.
- Build 확인만: `npm run build -w server` exit 0.

- Owns listings/requests/matching/chat, UGC·신고-블라인드, 외부 안전결제 **딥링크 브로커링(자금 미보유)**, auth. Needs its own `.env`.
- Build check (no run): the server's build/typecheck — must exit 0.

## External-API keys for a real run

The client uses **지도 SDK** (and 네이버쇼핑 API for 정가 보조). For 안전결제, integrate the external P2P provider's **deep link** — money must not pass through the platform. Put keys in env/config; never hardcode. **Do not** add any crawler to populate data for a demo — seed via manual input only. If you lack keys, smoke-test with fixtured responses and say so.

## Notes

- Run client and server in **separate background shells**; do not chain with `&&` (dev servers block).
- When the goal is just "does it build", prefer build checks (`knockedu-qa`) over launching servers.
- For mobile UI review after it serves, use `knockedu-screens`.
