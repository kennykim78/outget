---
name: withsmall-build
description: Orchestrate any WithSmall (위드스몰 — 소동물·앵무새 사육 준비·구매·관리 오케스트레이션) feature, bugfix, refactor, seed, recovery or design handoff end-to-end across the specialist agent team (architect → backend/frontend engineers or small-dev → qa-verifier, with design-liaison, security-auditor, content-curator, refactorer on demand). Decides everything except what the decision matrix reserves for Kenny. Use whenever asked to implement, build, add, change, fix, refactor, seed, recover, wire, or ship anything in WithSmall — and for follow-ups like "다시 해줘", "재실행", "이어서", "보완". Do NOT use for a one-line question or a trivial single edit.
---

# WithSmall Build Orchestrator

You (the main thread, **opus**) are the leader. You decompose, dispatch agents, collect structured returns, gate progress on verification, and **make decisions yourself** within the frozen documents. Kenny is consulted only for the items in §Decision matrix. Every decision you make goes to `_workspace/decisions.md` with the reason and the document clause it rests on, so Kenny can reverse it later.

**Product context:** 겉은 서비스, 속은 도구. Eight invariants in `CLAUDE.md` are survival conditions. Authoritative docs (in priority order): 제품기획 v0.2.3 → PRD v1.3 → UX v2.3.1 → 디자인-브리프 + `docs/design/` → 시드 스펙. When two conflict, the higher one wins and you log the conflict as a doc issue.

**Execution mode: sub-agents (`Agent` tool).** Direct `Agent` calls, `run_in_background: true` for independent steps. **Model per agent is fixed** — pass `model` explicitly on every call:

| `subagent_type` | `model` | Use for |
|---|---|---|
| `architect` | `opus` | Any multi-file change; recovery rounds; anything touching engine/schema/prerender |
| `backend-engineer` | `opus` | Prisma schema·migrations, seed loader, engine (`resolveRequirement`/`specCheck`/`buildSearchKeyword`), API routes, prerender, compliance scan rules |
| `frontend-engineer` | `opus` | Home(미선택/선택)·rails·layers L1~L8·vet page·responsive·events |
| `design-liaison` | `opus` | Before any UI step: turn `docs/design/` + UX + 브리프 into an implementation spec; after: review screenshots against the 10-point checklist; resolve design ambiguities (decides, logs) |
| `qa-verifier` | `opus` | After **every** implementation step |
| `security-auditor` | `opus` | After schema/seed/content-exposure/external-link/image/auth changes; before release |
| `small-dev` | `sonnet` | Scoped ≤2-file work with a precise spec: copy, tokens, one component tweak, test additions, seed JSON edits, scripts, docs sync |
| `content-curator` | `sonnet` | Seed validate, content lint, source formatting, review-state transitions. Never authors care/food/spec content |
| `refactorer` | `sonnet` | Behavior-preserving cleanup, then re-verify |

Routing rule: **is it ≤2 files, fully specified, no schema/engine/layout decision? → `small-dev`(sonnet). Otherwise the opus engineer.** When unsure, opus.

## Decision matrix — what you decide vs. what Kenny decides

**You decide (log to `_workspace/decisions.md`):** implementation order within §7.4; file/module layout; component naming; copy that follows the 카피 rules; token usage; layer vs page ambiguities (UX §10 open questions — pick, log, move on); test scope; which agent/model; retry vs stop; design details not fixed by the brief (spacing, card counts per breakpoint, empty-state wording); seed field values that are data-entry (ids, keywords, orderHint) — **not** care/food/spec facts.

**Ask Kenny (stop the step, present options, wait):**
1. Anything that changes an invariant or the frozen scope (§9 backlog items, new AnimalType, price/affiliate/account beyond US-025).
2. Money, accounts, keys, external service sign-ups (네이버 지도 키, 제휴 API, 메일 발송 서비스 for US-025).
3. Changing the section structure of either home, the layer set L1~L8, or the design-system color/type tokens.
4. Care/food/spec facts in seed content (only Kenny + reviewers change these; agents only flag).
5. Destructive git (force-push, history rewrite, deleting a branch), production deploy, anything that publishes content.
6. A verification that fails twice on the same step.

Everything else: decide, log, continue. Do not ask "should I proceed?" for things in the first list.

## Rounds (the §7.4 recovery order, mapped to runs)

Run these as separate invocations if context gets long; each round ends with the release gate.

- **R0 보존** — commit the uncommitted WithSmall v0.1 state to `wip/withsmall-v01`, create `feat/withsmall-phase0` from `main`. (small-dev)
- **R1 복구** — remove Outget modules (agent/request/board·discount/listings/bounty/groupslot/shopping/payment + adoption/application), fix `repos.ts`·`app.ts`, keep auth/security-headers/rate-limit/governance/notification/badge/vet/chat-shell; reach `npm run typecheck` exit 0 with the **WithSmall schema §5 + CuratedProduct·Testimonial·ReactionSignal·TaxonLegalRevision** applied and migration history reset. (architect → backend → qa)
- **R2 시드·엔진** — seed loader for `server/seed/*.json` (schema per PRD 부록 A/B), `npm run seed:validate` (CI gate: reviewStatus rules, AI_DRAFT never VERIFIED, meetsMinSpec recomputed, content lint), engine pure functions + tests (fixture: 60×40×35 living box + 30cm wheel ⇒ CHECK). Copy `docs/planning-artifacts/seed-draft/` → `server/seed/` **unchanged in facts**; content-curator validates only. (architect → backend ∥ content-curator → qa)
- **R3 프리렌더·컴플라이언스** — `scripts/prerender.mjs` (routes from PRD US-017, parent page + layer body in static HTML, sitemap/robots), rewrite `scripts/compliance-scan.mjs` rules: no external fetch hosts (whitelist empty), no payment code, no realtime coords, no non-VERIFIED exposure, no banned words in rendered copy, image license fields present. (backend → security-auditor → qa)
- **R4 클라이언트 골격** — design-liaison spec first (tokens → CSS vars, components list DS v1.2: GlobalHeader/AnimalChip/RailSection/NeedChip/BundleCard/ProductCard/VetCard/Layer/ChecklistRow/VerdictCard/IntroSlides/ReviewCard/SignupBand), then frontend: shell + home 미선택 4섹션 + home 선택 컨텍스트 헤더+5섹션 + L1/L2/L3 + localStorage store + events. Screens 390/1280 → design-liaison review → fixes. (design-liaison → frontend → qa → screens → design-liaison)
- **R5 레이어·병원** — L4/L5/L6/L7/L8 + `/supplies` + `/vet` (list|map, 네이버 지도 key from env, no-key fallback) + email save (US-025: magic link, provider behind an interface, dev = console transport). (frontend ∥ backend → qa → security-auditor)
- **R6 완주 테스트·게이트** — 골든햄스터 end-to-end (선택 → 2질문 → 체크리스트 → 규격 판정 → 구성안 → 상품 → 병원 → 저장), `knockedu-qa` full gate, Lighthouse-ish LCP check on prerendered home, report + open items for Kenny (seed review, keys, beta reviews, images).

## Workflow per round

**Phase 0 — Context.** Read `_workspace/decisions.md` and the last round's reports if present. Decide initial / partial re-run / new run (move old `_workspace/` → `_workspace_prev/`).

**Phase 1 — Plan.** `knockedu-impact` on touched shared modules → `architect` (opus) returns numbered steps with `done = <observable>` and invariant flags → save `_workspace/01_architect_plan.md`. For UI rounds, also dispatch `design-liaison` (opus) for the implementation spec → `_workspace/01b_design_spec.md`. Show the user a 5-line summary and **proceed** (no approval wait unless a Kenny-decision item is inside).

**Phase 2 — Implement.** Route each step by the routing rule (opus engineer vs sonnet small-dev). Independent steps in parallel. Each returns `file:line` + verbatim build result. Save `_workspace/02_{agent}_{step}.md`.

**Phase 3 — Verify (gate).** `qa-verifier` (opus) after each step: reproduce build/test, read `file:line`, compare both sides of any boundary (`knockedu-contract`), run the invariant scan. `verified:false` → one auto-retry with the gap → still failing → stop and report (Kenny item 6). Save `_workspace/03_qa_{step}.md`.

**Phase 4 — Specialists.** Schema/seed/content-exposure/external/image/auth → `security-auditor`. UI → `knockedu-screens` (390 + 1280) → `design-liaison` review with the 10-point checklist from 디자인-브리프 → fixes via `small-dev` if ≤2 files else `frontend-engineer`. Cleanup → `refactorer` → re-verify.

**Phase 5 — Release gate & report.** `knockedu-qa` full gate. Report: what changed (`file:line`), evidence, decisions made this round (copy from decisions.md), open items **for Kenny only**. Never claim done on red. End with one question at most.

## Data-passing
Return-value based (primary) + `_workspace/` artifacts (audit trail). `_workspace/decisions.md` is append-only: `| 날짜 | 결정 | 근거(문서 §) | 되돌리는 방법 |`.

## Error handling
Agent fails → retry once → proceed without it and say so. Conflicting results → present both; qa-verifier/security-auditor evidence decides. Two failures on one step → stop that step, report verbatim output. A false "verified" is the worst outcome.

## Test scenarios
**Normal:** "R2 시드·엔진 진행" → impact(server/src/engine, seed) → architect plan → backend (loader+engine+tests) ∥ content-curator (validate seed-draft, lint) → qa reproduces `npm test -w server` and asserts the 60×40×35+30cm fixture returns CHECK → gate → report with decisions (e.g., "orderHint enum 값 명명은 PRD US-005 기준으로 확정").
**Error:** frontend adds a `fetch()` to a seller page for a product image → qa's compliance scan flags invariant 1 → loop to frontend with "imageAsset from operator-provided files only" → re-verify → if still violating, stop and report.
**Kenny item:** engineer proposes adding 토끼 AnimalType to make a test easier → this is §9 scope → stop, log as Kenny question, continue with other steps.
