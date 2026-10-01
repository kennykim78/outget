---
name: knockedu-qa
description: Run the full WithSmall (위드스몰) QA gate — compliance/secret scan, seed validate, lint, typecheck, build, tests — as ONE deterministic pass with a compact pass/fail summary. Use instead of reading source when asked to QA, health-check, gate a commit/release, or confirm a round is green.
---

# WithSmall QA Gate (token-efficient)

Run from repo root, in this order; any non-zero = FAIL. Read only the FAIL section afterwards.
```bash
node scripts/compliance-scan.mjs     # 불변식 8 + 시크릿 + 노출 규칙 — 가장 먼저 (R3에서 규칙 교체)
npm run seed:validate                # 시드 게이트 (R2에서 배선) — AI_DRAFT≠VERIFIED, meetsMinSpec 재계산, 린트, 참조 무결성
npm run lint
npm run typecheck                    # client+server
npm run build                        # client PWA + server + prerender(R3 이후 `npm run prerender` 포함)
npm test -w server && npm test -w client
```
CI (`.github/workflows/ci.yml`) enforces the same order, compliance and seed:validate fail-fast first. Until R2/R3 wire `seed:validate`/new scan rules, report those lines as **NOT WIRED** (not pass).

## What the compliance scan must enforce (R3 rewrites `scripts/compliance-scan.mjs`; re-verify both directions: injected violation → exit 1, clean tree → exit 0)
1. **무크롤링** — no `fetch/axios/undici/puppeteer/playwright/node-cron` to non-local hosts; allowlist empty; image URLs in seed only under `/assets/` or operator asset ids.
2. **분양·매칭·결제 코드 0** — no models/routes named adoption/application/match/payment/escrow/settle/refund.
3. **노출 규칙** — public queries filter `reviewStatus='VERIFIED'`; products `status='VERIFIED' AND meetsMinSpec`; testimonials `APPROVED AND verifiedUsage`; a test asserts `AI_DRAFT` cannot transition to VERIFIED.
4. **금지어** in rendered copy/seed: 괜찮다·안전하다·최저가·판매순·베스트·정확도·전문가 N명·회원가입·구매(상품 표면).
5. **위치 비실시간** — no geolocation persistence; only VetClinic/optional post pins.
6. **이미지 라이선스** — every asset record has source/license/author/sourceUrl/downloadedAt; CC BY entries listed for `/credits`.
7. **시크릿** — keys only via env; `.env` untracked.

## Escalation
Behavior → `knockedu-test` + `qa-verifier`; live app → `knockedu-run`; visuals → `knockedu-screens` + `design-liaison`; legality/exposure → `security-auditor`.
