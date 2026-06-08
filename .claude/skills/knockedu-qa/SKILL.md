---
name: knockedu-qa
description: Run the full Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) QA gate (lint, typecheck, build, tests, and compliance/secret scans) as ONE deterministic pass that prints a compact pass/fail summary. Token-efficient — use this instead of reading source files when asked to QA, health-check, run checks, or gate a commit/release for Outget.
---

# Outget QA Gate (token-efficient)

The point is **token economy**: a gate does the heavy lifting and returns a short summary, so you do NOT read source files or scroll full build logs to assess project health. Run the gate, read one small report.

## Stack status: WIRED (Epic 1 — npm workspaces: client Vite+React+TS PWA / server Express)

The gate runs from repo root. **One-shot gate** (run all; any non-zero = FAIL):
```bash
node scripts/compliance-scan.mjs   # 컴플라이언스+시크릿(R1~R5) — 가장 먼저
npm run lint                        # client+server eslint
npm run typecheck                   # client+server tsc --noEmit
npm run build                       # client(PWA)+server tsc
npm test -w server                  # vitest (client/E2E 테스트는 미배선)
```
CI(`.github/workflows/ci.yml`)가 동일 순서(compliance fail-fast 선두)로 PR마다 강제.

## What it checks

| Check | Command | Means |
|---|---|---|
| lint | `npm run lint` | lint errors/warnings |
| typecheck | `npm run typecheck` | type errors (client+server) |
| build | `npm run build` | client PWA(sw 산출)+server 빌드 |
| tests | `npm test -w server` | vitest. ⚠ client 단위/E2E는 아직 미배선 |
| **compliance scan** | static scan (works now) | the five invariants — see below |
| **secret scan** | static scan (works now) | API keys (지도 SDK·네이버쇼핑·외부 안전결제) committed in tracked files |
| TODO/FIXME | static scan | unresolved markers |
| dup deps | manifest | duplicate libs once a manifest exists |

## The compliance scan (special to this product — IMPLEMENTED: `scripts/compliance-scan.mjs`)

`node scripts/compliance-scan.mjs` (R1~R5 + 시크릿, `--json` 지원) enforces the five invariants below; **any hit is a release blocker regardless of build status.** Pair with the `security-auditor` agent for confirmation. 규칙을 바꾸면 음성(위반 주입→exit1)·양성(깨끗 트리→exit0) 양방향으로 재검증할 것.

1. **무크롤링:** server/client code that auto-fetches external **site bodies/images** (scraper, `puppeteer`/headless, scheduled/cron fetch of 아울렛·브랜드·커뮤니티·SNS·쇼핑몰). 정가 조회는 네이버쇼핑 API만 허용.
2. **자금 미보유:** payment routed through a **platform account / PG 가맹점**, or server-side 정산/예치/환불 logic. Money must go 소비자→외부 안전결제→대행자 직행.
3. **통신판매중개 고지:** the "거래 당사자가 아님" notice component is rendered on 거래/요청/소식/채팅 screens (grep for the notice component usage).
4. **링크 보증 금지 / 가격 주장 금지:** any link "verify/guarantee" logic; any platform-asserted price without the `기준가 미확인` label path.
5. **위치 비실시간:** real-time GPS coordinates persisted/shared (only 동/지역 텍스트 allowed).

## Optional: one-shot qa-gate.mjs

`scripts/compliance-scan.mjs`는 구현됨. 편의를 위해 lint+typecheck+build+test+scan을 묶어 ~30줄 요약/`--json`/`--fast`로 출력하는 `scripts/qa-gate.mjs`를 추가할 수 있음(아직 미작성 — 현재는 위 5개 명령을 순차 실행). 추가 시 CLAUDE.md에 기록.

## How to use in a QA pass

1. Run the scans first (cheap, runnable now). Run the full gate before declaring QA done.
2. Only the FAIL section needs file-level reading — read those, fix, re-run. Don't open files the gate cleared.
3. Escalate what a static gate can't catch: behavior → `knockedu-test` + `qa-verifier`; live app → `knockedu-run`; legality/통신판매중개/위치 → `security-auditor`; deep review → the `knockedu-review` workflow.
