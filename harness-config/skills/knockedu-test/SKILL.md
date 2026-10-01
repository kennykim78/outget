---
name: knockedu-test
description: Scaffold/run WithSmall (위드스몰) tests: server Vitest (engine fixtures, seed validate rules, exposure filters, AI_DRAFT transition), client Vitest+RTL (home section order, L3-before no-count, product card contents, save nudge count, banned words), and E2E smoke (골든햄스터 완주). Use when asked to add or run tests.
---

# knockedu-test (WithSmall)

Commands: `npm test -w server`, `npm test -w client`, `npm run test:e2e` (when wired, Playwright). Required fixtures (keep in `server/test/fixtures/`): golden+60×40×35 living box+30cm wheel ⇒ CHECK; 20cm wheel ⇒ BELOW_MIN; CEDAR_PINE bedding ⇒ BELOW_MIN; determinism (same input twice); AI_DRAFT→VERIFIED rejected; non-VERIFIED absent from public query; testimonial APPROVED∧verifiedUsage filter; product meetsMinSpec recompute mismatch ⇒ validate fails. Client: cold-start renders 4 sections in order; selected renders context header + 5; pre-L3 shows no number; product card has ✓ 기준 충족 and no price; save link appears exactly 2×; no banned words in rendered text. Report pass/fail counts and exit codes only.
