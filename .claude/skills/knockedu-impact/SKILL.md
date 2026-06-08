---
name: knockedu-impact
description: Compute the blast radius of a code change in Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) — which files transitively import the changed file(s) — as a compact dependents list, so you re-test only what a change can break. Token-efficient regression-prevention. Use before/after editing a shared client module, the map/board/chat/matching service, or store, or when asked "이 변경이 뭘 깨뜨릴 수 있나 / what does this change affect".
---

# Outget Impact (regression-prevention, token-efficient)

The point is **token economy**: instead of manually tracing imports across the tree, get the reverse-dependency set for the file(s) you touched, then re-test only those.

## Stack status: skeleton mode

The project is greenfield — no committed stack yet, so there is no bundled `impact.mjs` script wired to a real source tree. Until a JS/TS frontend exists:

- Use `Grep` to find importers manually: for a changed file `X`, search for `from ['"].*X` / `import(['"].*X` / `require(['"].*X` across the source root.
- Build the dependents set transitively (importers of importers) until it stops growing.
- Report: direct importers, full transitive set, and a risk heuristic (LOW/MED/HIGH by dependent count).

## Wire the real script when a stack lands

Once the frontend stack is committed (e.g. Vite + React, source under `src/`), drop a `impact.mjs` here that walks the reverse import graph (resolving relative imports; ignoring package imports) and prints the dependents list and a `--json` mode. Then this skill becomes one command:

```bash
node .claude/skills/knockedu-impact/impact.mjs                 # targets = current git diff
node .claude/skills/knockedu-impact/impact.mjs src/board/boardView.tsx   # explicit target
```

Log the wiring in CLAUDE.md's harness change history when you do it.

## Outget-specific fragile coupling to always flag

- The **매칭 상태머신** (Request → 채택 → 매칭 → 채팅, 신고 → 블라인드 → 이의) is highly coupled — a change to any transition can silently break downstream UI/notifications. Treat it as HIGH risk regardless of import count.
- The **가격 표시 컴포넌트** (UGC 미검증 라벨 / `기준가 미확인` / 현장 확인가) and the **외부 안전결제 딥링크 모듈** carry legal invariants — flag any change touching them for a compliance re-check (`security-auditor`).

## How to use it for regression-prevention

1. Before a refactor: get the dependents of the file you're about to change → know what you might break.
2. After editing: get dependents of the diff → the exact set to re-test.
3. Feed that set to `knockedu-test` (write/run tests) or `knockedu-qa` (build/type + compliance gate).
4. Only open the files the report names — don't scan the whole tree.
