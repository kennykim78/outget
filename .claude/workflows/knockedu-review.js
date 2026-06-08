export const meta = {
  name: "knockedu-review",
  description:
    "Multi-dimension review of Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) changes with FORCED adversarial verification of every finding to prevent \"hallucinated done\" failures. Dimensions: client, server, compliance, refactor.",
  phases: [
    {
      title: "Review",
      detail: "client / server / compliance / refactor reviewers in parallel",
    },
    {
      title: "Verify",
      detail: "each finding adversarially re-checked against real code/build",
    },
  ],
};

// Dimensions mirror the Outget subagent team. Each reviewer reads the diff/source
// for its domain and returns concrete findings — NO fixes here, finding only.
const DIMENSIONS = [
  {
    key: "client",
    agentType: "frontend-engineer",
    prompt:
      "Review the Outget client (지도 양면 보드·매칭 채팅·역경매/UGC 폼) for correctness bugs: crash/shape mismatches between API responses and components, missing empty/error states, 매칭 상태머신 transition bugs. Compliance-in-UI: is the 통신판매중개 고지 rendered on 거래/요청/소식/채팅? does the UGC 할인소식 attach `[기준가 미확인]` when 정가 is absent and keep 현장확인가 visually separate? is there any forbidden link 'verify/guarantee' UI (should be warning-only)? is 직접거래 fraud warning present? Return findings only — do not edit.",
  },
  {
    key: "server",
    agentType: "backend-engineer",
    prompt:
      "Review the Outget thin server: listings/requests/match/chat, UGC(DiscountPost/VerifiedPrice) with the auto `기준가 미확인` stamp, 신고→블라인드 상태머신(notice-and-takedown), auth & input validation. CRITICALLY: does any code route payment through a platform account/PG merchant or hold balance/정산/환불 (자금 미보유 violation)? is the PaymentRail adapter non-custodial (딥링크/상태만)? any auto-fetch/scrape of external sites (무크롤링 violation)? Return findings only — do not edit.",
  },
  {
    key: "compliance",
    agentType: "security-auditor",
    prompt:
      "Audit Outget for the five existential invariants — verify each against real code before listing as confirmed: (1) 무크롤링(UGC 포함) — no scraper/headless/cron fetch of external site bodies/images; 정가 only via 네이버쇼핑 API; seed via manual input only. (2) 자금 미보유 — payment never via platform account; non-custodial deep-link only. (3) 통신판매중개 최소의무 — 고지 렌더 + 신고/분쟁 채널 + 신원정보 제공. (4) 가격 = UGC + 현장확인가만 — no platform-asserted price; `기준가 미확인` enforced. (5) 외부링크 보증 금지 / 위치 비실시간 — no link verifier; no user lat/long persisted (region text only). Plus keys/secrets not committed. Return findings only.",
  },
  {
    key: "refactor",
    agentType: "refactorer",
    prompt:
      "Review Outget for structural/perf debt: an over-grown 지도 양면 보드 component, ad-hoc 매칭/신고 state flags that should be one state model, duplicated 가격 표시 logic (미검증 라벨/확인가), duplicated 외부 안전결제 딥링크 glue, duplicate deps, missing route code-splitting. Behavior must stay identical and invariants must not regress. Return findings only — do not edit.",
  },
];

const FINDINGS = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          file: { type: "string" },
          line: { type: "string" },
          severity: { type: "string", enum: ["crit", "high", "med", "low"] },
          claim: {
            type: "string",
            description: "the concrete assertion to be verified",
          },
        },
        required: ["title", "file", "severity", "claim"],
      },
    },
  },
  required: ["findings"],
};

const VERDICT = {
  type: "object",
  properties: {
    verified: { type: "boolean" },
    evidence: {
      type: "string",
      description: "command run + exit code + key output, or file:line quoted, or scan result",
    },
    note: { type: "string" },
  },
  required: ["verified", "evidence"],
};

// Pipeline: each dimension's findings get verified as soon as that review lands.
// The qa-verifier MUST reproduce each claim before confirmation.
const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(d.prompt, {
      label: `review:${d.key}`,
      phase: "Review",
      agentType: d.agentType,
      schema: FINDINGS,
    }),
  (review, d) =>
    parallel(
      (review?.findings ?? []).map(
        (f) => () =>
          agent(
            `Adversarially verify this Outget finding. Reproduce it against the real code or build — read the file:line, run the build, or run the compliance-invariant scan (knockedu-qa). Claim: "${f.claim}" (${f.file}${f.line ? ":" + f.line : ""}). Default to verified=false unless you have proof.`,
            {
              label: `verify:${d.key}:${f.file}`,
              phase: "Verify",
              agentType: "qa-verifier",
              schema: VERDICT,
            },
          ).then((v) => ({ ...f, dimension: d.key, verdict: v })),
      ),
    ),
);

const all = results.flat().filter(Boolean);
const confirmed = all.filter((f) => f.verdict?.verified === true);
const rejected = all.filter((f) => f.verdict?.verified !== true);

log(
  `Review complete: ${confirmed.length} CONFIRMED, ${rejected.length} unverified/rejected (rejected ones were NOT real or could not be reproduced).`,
);

return { confirmed, rejected };
