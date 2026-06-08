---
name: knockedu-run
description: Launch the Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) app locally — the client (and server, if present) — and confirm it serves. Use when asked to run, start, serve, or smoke-test the Outget app, or to verify a change in the real running app.
---

# Running Outget (아웃겟) locally

Outget is **mobile-first**; the client carries the UX, the server owns matching/UGC/auth (no payment custody).

## Stack status: skeleton mode

No committed stack yet, so there are no wired dev commands. Once chosen, fill this in and keep it in sync with `knockedu-test`/`knockedu-qa`.

## Client (once a stack lands — likely Vite, port 5173)

```bash
npm install        # first run only
npm run dev        # vite --host (LAN-accessible)
```

- Open the served URL → expect the 지도 양면 보드(S1) 진입 화면.
- To verify a change, walk the core flow: **역경매 요청 등록(S4) → 대행자 채택 → 매칭 채팅(S5) → 거래방식 선택(직접/외부 안전결제)**. Also check 할인소식(S2) 표시(미검증 라벨/현장확인가) and 통신판매중개 고지.

## Server (if/when present — pick a port, e.g. 3001)

```bash
npm install
npm run start:dev   # or the framework's dev command
```

- Owns listings/requests/matching/chat, UGC·신고-블라인드, 외부 안전결제 **딥링크 브로커링(자금 미보유)**, auth. Needs its own `.env`.
- Build check (no run): the server's build/typecheck — must exit 0.

## External-API keys for a real run

The client uses **지도 SDK** (and 네이버쇼핑 API for 정가 보조). For 안전결제, integrate the external P2P provider's **deep link** — money must not pass through the platform. Put keys in env/config; never hardcode. **Do not** add any crawler to populate data for a demo — seed via manual input only. If you lack keys, smoke-test with fixtured responses and say so.

## Notes

- Run client and server in **separate background shells**; do not chain with `&&` (dev servers block).
- When the goal is just "does it build", prefer build checks (`knockedu-qa`) over launching servers.
- For mobile UI review after it serves, use `knockedu-screens`.
