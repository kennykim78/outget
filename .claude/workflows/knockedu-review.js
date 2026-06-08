export const meta = {
  name: "knockedu-review",
  description:
    "Multi-dimension review of knockedu (LECV) changes with FORCED adversarial verification of every finding to prevent \"hallucinated done\" failures. Dimensions: client, server, ML filter, compliance/security, refactor.",
  phases: [
    {
      title: "Review",
      detail: "client / server / ml / compliance / refactor reviewers in parallel",
    },
    {
      title: "Verify",
      detail: "each finding adversarially re-checked against real code/build/eval",
    },
  ],
};

// Dimensions mirror the knockedu subagent team. Each reviewer reads the diff/source
// for its domain and returns concrete findings — NO fixes here, finding only.
const DIMENSIONS = [
  {
    key: "client",
    agentType: "frontend-engineer",
    prompt:
      "Review the knockedu (LECV) client for correctness bugs in the location→geocoding→client-portal-search→filter→map pipeline: coordinate-order mistakes in 카카오 지오코딩 parsing, missing empty/error handling that would blank out the base academy layer, edge-ML inference glue errors, and any client portal call that got refactored into a shared server proxy. Return findings only — do not edit.",
  },
  {
    key: "server",
    agentType: "backend-engineer",
    prompt:
      "Review the knockedu (LECV) thin server: 공공데이터 학원 ingestion → base DB mapping correctness, Claim/UGC auth & validation, and CRITICALLY any code that fetches or persists 네이버/다음 portal data server-side (forbidden). Return findings only — do not edit.",
  },
  {
    key: "ml",
    agentType: "ml-engineer",
    prompt:
      "Review the knockedu (LECV) ad-filter pipeline: regex 대가성 사전 coverage gaps, tokenization/형태소 handling of 은닉 광고 (띄어쓰기/자모 변형), train/holdout leakage, and whether the reported Recall is actually measured on a held-out set (target ≥95%). Return findings only — do not edit.",
  },
  {
    key: "compliance",
    agentType: "security-auditor",
    prompt:
      "Audit knockedu (LECV) for the existential compliance invariants: (A) NO server-side fetch/cache/DB/redistribution of 네이버/다음 portal results, (B) training data not sourced from 무단 대량 크롤링, (C) 위치정보 not persisted server-side beyond the LBS 면제 전제, (D) 카카오/네이버/다음 keys not concentrated on one shared server key and not committed in tracked files. Verify each against real code before listing as confirmed. Return findings only.",
  },
  {
    key: "refactor",
    agentType: "refactorer",
    prompt:
      "Review knockedu (LECV) for structural/perf debt: an over-grown client meta-search function, scattered regex/stopword dictionaries, duplicated ML inference glue, duplicate deps, and missing route code-splitting. Return findings only — do not edit.",
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
      description: "command run + exit code + key output, or file:line quoted, or eval numbers",
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
            `Adversarially verify this knockedu (LECV) finding. Reproduce it against the real code, build, or eval — read the file:line, run the build, or run knockedu-filter-eval. Claim: "${f.claim}" (${f.file}${f.line ? ":" + f.line : ""}). Default to verified=false unless you have proof.`,
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
