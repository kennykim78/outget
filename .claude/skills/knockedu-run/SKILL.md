---
name: knockedu-run
description: Launch WithSmall (위드스몰) locally — client and server — and confirm it serves (health, prerendered home, API). Use when asked to run, start, serve, smoke-test, or verify a change in the real running app.
---

# Running WithSmall locally

```bash
npm install                    # first run (workspace root)
npm run dev:server             # tsx watch → http://localhost:3001  (/health, /api/*)
npm run dev:client             # vite → http://localhost:5173
# after R3: npm run prerender && npm run preview   # static + hydration check
```
Run client and server in **separate background shells** (both block). Server needs `server/.env` (JWT secret, CORS_ORIGIN, SQLite path). Client needs `client/.env` `VITE_NAVER_MAP_KEY` only for `/vet` map — **no key = list view + "지도 키 없음" notice, never a crash**. Email save (US-025) uses the `console` transport in dev: the magic link is printed to the server log.

Smoke checklist: `/` (미선택 홈 4섹션) → 친구 선택 → `/hamster/golden` (컨텍스트 헤더 + 5섹션) → 지금 필요한 것 → L2 → L4 → L5 (60×40×35 + 30cm ⇒ △ CHECK) → `/vet`. No external network calls in the browser network tab except the map SDK (when keyed).

Prefer `knockedu-qa` when the question is "does it build"; use `knockedu-screens` for visuals after it serves.
