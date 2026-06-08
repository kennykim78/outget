---
name: knockedu-build
description: Orchestrate any Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) feature, bugfix, or refactor end-to-end across the specialist agent team (architect → frontend / backend engineers → qa-verifier, with security-auditor & refactorer on demand). Plans, implements, and ADVERSARIALLY verifies every "done" claim against real build/test output and the legal invariants. Use whenever asked to implement, build, add, change, fix, refactor, or ship anything in Outget — and for follow-ups like "다시 해줘", "재실행", "업데이트", "수정", "보완", "이전 결과 개선", "이번엔 결제 부분만 다시". Do NOT use for a one-line question, a single trivial edit you can make directly, or a pure read-only lookup.
---

# Outget Build Orchestrator

Coordinates the Outget specialist agents and tool-skills into a **generate → verify** pipeline so that nothing is reported "done" without real evidence. You (the main thread) are the orchestrator/leader: you decompose, dispatch agents, collect structured returns, and gate progress on verification.

**Product context (why the rules are strict):** Outget is a **two-sided matching board (당근형)** — 정보·매칭만 제공, 결제·계약 당사자 아님. Five legal invariants are the product's survival condition: **무크롤링(UGC 포함) · 자금 미보유(외부 안전결제) · 통신판매중개자(최소 의무 유지) · 가격은 UGC+현장확인가만 · 외부 링크 보증 금지/위치 비실시간.** Full text in `CLAUDE.md`; spec in `docs/planning-artifacts/PRD.md`+`UX-기획.md`. Plan and verify with these in mind.

**Execution mode: sub-agents (`Agent` tool).** The Outget agents return raw structured output to their caller, so direct `Agent` calls (with `run_in_background` for parallel independent work) fit better than a comms-heavy team. Escalate to a team only if a step genuinely needs live back-and-forth between two agents. **Every `Agent` call uses `model: "opus"`.**

## The team (who)

| Agent (`subagent_type`) | Role | When |
|---|---|---|
| `architect` | Plan, decompose, blast-radius, guard invariants | First, for any multi-file change |
| `frontend-engineer` | Client: 지도 양면 보드, 채팅, 리스트/요청/UGC 폼, PWA | Client steps (the heaviest layer) |
| `backend-engineer` | Server: 리스트/요청/매칭/채팅, UGC·신고-블라인드, 외부 안전결제 브로커링, auth | Server steps |
| `qa-verifier` | Adversarial verification of every claim (build/test + invariant scan) | After **every** implementation step |
| `security-auditor` | Read-only audit: 통신판매중개·무크롤링·자금미보유·UGC·위치·keys | After any data/payment-rail/UGC/location/auth change, before release |
| `refactorer` | Cleanup/dedup/code-split, no behavior change | Quality passes only |

> No `ml-engineer` — Outget MVP has no ML pipeline (광고필터·자동정제는 Phase 2+ Out of scope).

## The tool-skills (how — deterministic, token-cheap)

| Skill | Use for |
|---|---|
| `knockedu-impact` | Blast radius of a change — run **before** editing a shared module/store/service |
| `knockedu-contract` | Client↔server + external-API(지도 SDK·네이버쇼핑·외부 안전결제) contract check |
| `knockedu-qa` | Full QA gate (lint, typecheck, build, tests, **compliance/secret scans**) — the release gate |
| `knockedu-test` | Scaffold/run unit/integration/E2E tests |
| `knockedu-run` | Launch the app locally and confirm it serves |
| `knockedu-screens` | Capture mobile-viewport screenshots for UI review |

> **Stack is greenfield.** Until a stack is committed, the build/test/run/contract/impact skills run in "skeleton mode" — they tell you what to wire and verify by inspection. Wire the real commands the moment a stack lands, and log it to CLAUDE.md. The **compliance scan in `knockedu-qa` runs today** (grep-based) — use it every pass.

## Workflow

### Phase 0 — Context check (always first)
Decide the run mode from `_workspace/` and the request:
- `_workspace/` **absent** → **initial run**.
- `_workspace/` **present** + user asks to redo/improve/extend a part → **partial re-run**: re-dispatch only the affected agent(s), feed them their prior `_workspace/` artifact.
- `_workspace/` **present** + genuinely new task → **new run**: move old `_workspace/` to `_workspace_prev/`.

Create `_workspace/` for intermediate artifacts. Naming: `{step}_{agent}_{artifact}.md`.

### Phase 1 — Plan (architect)
1. If the change touches a shared module/store/service, run `knockedu-impact` first and pass the dependents list to the architect.
2. Dispatch `architect` with the request + impact data. It returns a numbered plan: each step names file(s), the change, a `done = <observable>`, and flags any invariant risk (무크롤링/자금미보유/중개고지/가격주장/링크보증/위치).
3. Save to `_workspace/01_architect_plan.md`. Show the user the plan summary. For a large/ambiguous change, confirm before implementing; for a clear scoped change, proceed.

### Phase 2 — Implement (frontend / backend engineers)
For each plan step:
- Route to `frontend-engineer`, `backend-engineer`, or both. **Independent steps run in parallel** via `run_in_background: true`; dependent steps in order.
- Each engineer runs its build and reports `file:line` changes + verbatim result. A red build is never "done".
- Save each report to `_workspace/02_{agent}_{step}.md`.

### Phase 3 — Verify (qa-verifier) — the gate
**Non-negotiable and incremental:** run after *each* implementation step.
1. Dispatch `qa-verifier` with the engineer's specific claim. It reproduces (build/test), reads actual `file:line`, compares both sides of any boundary, **and runs the compliance-invariant scan**. Returns `{ claim, verified, evidence, gaps }`.
2. If `verified: false` → loop back to Phase 2 with the gap (max 1 auto-retry; if it fails again, report the blocker, do not silently proceed).
3. If the step touched a server route / client API / external integration → also run `knockedu-contract`.
4. If the step touched payment/UGC/location/data → require an invariant check (no platform funds, no crawl, no real-time location), not a vibe.
5. Save verdicts to `_workspace/03_qa_{step}.md`.

### Phase 4 — Specialists (conditional)
- **Payment-rail / UGC / location / data-ingestion / auth change** → dispatch `security-auditor` (read-only). Surface CRIT/HIGH (esp. the five invariants) before shippable.
- **Cleanup requested or debt touched** → dispatch `refactorer` (one concern/pass), then re-verify with `qa-verifier` (build green + invariants intact).

### Phase 5 — Release gate & report
1. Run `knockedu-qa` for the full deterministic gate (incl. compliance/secret scans).
2. For UI changes, offer `knockedu-run` + `knockedu-screens` for a visual check.
3. Report: what changed (`file:line`), QA evidence, any unresolved gaps/findings. Never claim done on red.
4. **Ask for feedback** ("결과나 워크플로우에서 개선할 점 있나요?"). Route feedback per harness evolution rules and log harness changes to CLAUDE.md.

## Data-passing protocol
- **Return-value based** (primary): collect each agent's structured return.
- **File based** (artifacts): everything intermediate to `_workspace/{step}_{agent}_{artifact}.md`; only final deliverables land in source. Keep `_workspace/` for audit trail.

## Error handling
- Agent fails / returns nothing → retry once; if it fails again, proceed without it and **explicitly note the omission**.
- Conflicting results → do not delete either; present both with source and let evidence (qa-verifier / security-auditor) decide.
- Verification fails twice on the same step → stop that step, report the blocker with failing command output. A false "verified" is the worst outcome.

## Test scenarios

**Normal flow** — "역경매 요청을 지도 보드에 띄우고 대행자가 채택→채팅까지":
Phase 0 (initial) → `knockedu-impact` on the request/match module → `architect` plan (flags: 자금 미보유·중개 고지) → `backend-engineer` (Request/Match/채팅 routes) ∥ `frontend-engineer` (요청 폼 S4 + 보드 S1 + 채팅 S5) → `qa-verifier` verifies build + contract + invariant scan (고지 렌더·결제 플랫폼 미경유) → `security-auditor` (통신판매중개·결제) → `knockedu-qa` gate → report.

**Error flow** — engineer adds an external-price fetch that scrapes a brand site:
qa-verifier's compliance scan flags a crawler (`verified: false`) → orchestrator loops back to the engineer to replace with 네이버쇼핑 API or manual seed → re-verify → if still violating after one retry, report the blocker verbatim and stop (no "done").
