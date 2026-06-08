---
name: knockedu-qa
description: Run the full Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) QA gate (lint, typecheck, build, tests, and compliance/secret scans) as ONE deterministic pass that prints a compact pass/fail summary. Token-efficient — use this instead of reading source files when asked to QA, health-check, run checks, or gate a commit/release for Outget.
---

# Outget QA Gate (token-efficient)

The point is **token economy**: a gate does the heavy lifting and returns a short summary, so you do NOT read source files or scroll full build logs to assess project health. Run the gate, read one small report.

## Stack status: skeleton mode

No committed stack yet, so the build/test commands aren't wired. Until a stack lands, run the gate **by inspection**: report which checks are not-yet-wired, and run the ones that don't need a build (the compliance/secret scans below work today via `Grep`).

## What it checks (wire each as the stack lands)

| Check | Tool (once wired) | Means |
|---|---|---|
| lint | `eslint .` / project linter | lint errors/warnings |
| typecheck | `tsc --noEmit` / equivalent | type errors |
| build | project build | builds + bundle size |
| tests | project test runner | ⚠ flags placeholder-only coverage |
| **compliance scan** | static scan (works now) | the five invariants — see below |
| **secret scan** | static scan (works now) | API keys (지도 SDK·네이버쇼핑·외부 안전결제) committed in tracked files |
| TODO/FIXME | static scan | unresolved markers |
| dup deps | manifest | duplicate libs once a manifest exists |

## The compliance scan (special to this product — runnable today)

Grep the source for any violation of the five legal invariants. **Any hit is a release blocker, regardless of build status.** Pair with the `security-auditor` agent for confirmation.

1. **무크롤링:** server/client code that auto-fetches external **site bodies/images** (scraper, `puppeteer`/headless, scheduled/cron fetch of 아울렛·브랜드·커뮤니티·SNS·쇼핑몰). 정가 조회는 네이버쇼핑 API만 허용.
2. **자금 미보유:** payment routed through a **platform account / PG 가맹점**, or server-side 정산/예치/환불 logic. Money must go 소비자→외부 안전결제→대행자 직행.
3. **통신판매중개 고지:** the "거래 당사자가 아님" notice component is rendered on 거래/요청/소식/채팅 screens (grep for the notice component usage).
4. **링크 보증 금지 / 가격 주장 금지:** any link "verify/guarantee" logic; any platform-asserted price without the `기준가 미확인` label path.
5. **위치 비실시간:** real-time GPS coordinates persisted/shared (only 동/지역 텍스트 allowed).

## Wire the real script when a stack lands

Drop a `qa-gate.mjs` that runs lint + typecheck + build + tests + the static scans and prints a ~30-line summary with non-zero exit on any FAIL (`--fast` for scans-only, `--json` for machine-readable). Log the wiring in CLAUDE.md.

## How to use in a QA pass

1. Run the scans first (cheap, runnable now). Run the full gate before declaring QA done.
2. Only the FAIL section needs file-level reading — read those, fix, re-run. Don't open files the gate cleared.
3. Escalate what a static gate can't catch: behavior → `knockedu-test` + `qa-verifier`; live app → `knockedu-run`; legality/통신판매중개/위치 → `security-auditor`; deep review → the `knockedu-review` workflow.
