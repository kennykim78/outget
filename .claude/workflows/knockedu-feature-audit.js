export const meta = {
  name: "knockedu-feature-audit",
  description:
    "Audit knockedu (LECV) core features end-to-end (location/geocoding, base academy layer, client meta-search, ad-filter, map render, UGC/Claim). Each area traced through its real stack; every finding adversarially verified against real code/eval. Read-only — produces a confirmed bug list, does not edit.",
  phases: [
    { title: "Check", detail: "feature areas traced full-stack in parallel" },
    { title: "Verify", detail: "each finding reproduced against real code/eval" },
  ],
};

// Each area is traced through its WHOLE stack. Entry files are hints (fill in as
// the codebase grows); the agent follows imports/api calls itself. Goal = concrete,
// reproducible bugs and compliance violations, not vibes.
const AREAS = [
  {
    key: "location-geocoding",
    title: "위치 입력 · 카카오 지오코딩 · 반경 필터",
    focus:
      "GPS grant + 동/구 텍스트 입력 → 카카오 로컬 API 지오코딩 → 위경도 → Haversine 반경 필터. Check: coordinate order (x=경도/y=위도) parsed correctly? empty/denied-permission and malformed-geocode responses handled? Is any 위치정보 persisted server-side (LBS violation)?",
  },
  {
    key: "base-academy",
    title: "베이스 학원 레이어 (공공데이터)",
    focus:
      "공공데이터포털 학원 인허가 API ingestion → base DB → render. Check: field mapping (학원명/주소/전화/좌표) matches the API response shape; the base layer ALWAYS renders even when reviews are empty (the hybrid-UI promise); paging/throttle handling.",
  },
  {
    key: "meta-search",
    title: "클라이언트 메타서치 (네이버/다음 검색)",
    focus:
      "Per-academy portal search fired FROM THE CLIENT, async, individually. Check: are calls actually client-side (NOT proxied through one server key)? rate-limit / empty / error responses handled without blanking the base layer? are portal results ever cached/persisted (compliance violation)? are results ephemerally cleared on exit/region-change?",
  },
  {
    key: "ad-filter",
    title: "광고 필터 파이프라인 (regex + ML)",
    focus:
      "정규식 대가성 사전 1차 필터 → 형태소/토큰화 → NB/AdaBoost ML 2차 필터 → WASM/JS edge 추론. Check: rule layer coverage; is the reported accuracy an actual measured holdout Recall (≥95%) or a vibe? does inference glue mishandle the model output shape? Use knockedu-filter-eval as the source of truth.",
  },
  {
    key: "map-render",
    title: "지도 렌더 · 하이브리드 UI",
    focus:
      "정제 리뷰 + base academy layer rendered on the map. Check: do components receive the data SHAPE the search/filter stage actually produces (crash on undefined fields)? are filtered-out (ad) items truly excluded from render? empty/loading states; mobile fit.",
  },
  {
    key: "ugc-claim",
    title: "Claim · UGC 리뷰 · 크라우드 라벨링",
    focus:
      "학원 원장 Claim 등록, 유저 리뷰 작성/인센티브, '광고 의심' 라벨링 피드백 → 재학습 데이터. Check: auth & input validation (XSS), do the feedback labels actually flow into the ML retraining data path, request/response shape vs server routes.",
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
          kind: {
            type: "string",
            enum: [
              "broken-api",
              "crash-risk",
              "shape-mismatch",
              "dead-feature",
              "missing-state",
              "compliance-violation",
              "filter-quality",
              "other",
            ],
          },
          claim: {
            type: "string",
            description:
              "a single concrete, reproducible assertion a verifier can check against the code or eval",
          },
        },
        required: ["title", "file", "severity", "kind", "claim"],
      },
    },
    notes: { type: "string", description: "short summary incl. what works fine" },
  },
  required: ["findings"],
};

const VERDICT = {
  type: "object",
  properties: {
    verified: { type: "boolean" },
    evidence: {
      type: "string",
      description: "file:line quoted, or command/eval + result that proves/disproves the claim",
    },
    severityAdjust: { type: "string", enum: ["keep", "raise", "lower"] },
    fixHint: { type: "string" },
  },
  required: ["verified", "evidence"],
};

const results = await pipeline(
  AREAS,
  (a) =>
    agent(
      `You are auditing the knockedu (LECV) feature area: "${a.title}".\n\nTrace it end-to-end through the real stack — follow the actual imports and API calls yourself. LECV is edge-first: portal (네이버/다음) calls must be client-side and ephemeral; the server only owns the 공공데이터 base academy layer + Claim/UGC. A server-side portal fetch/cache is a compliance-violation finding (crit). The base academy layer must render even with zero reviews.\n\nFOCUS: ${a.focus}\n\nReport ONLY concrete, reproducible findings (each with file:line where it exists and a single checkable claim). Do NOT edit anything. If the area mostly works, say so in notes and return few/zero findings. If the code for this area does not exist yet, audit the plan/architecture for the same risks and say so.`,
      { label: `check:${a.key}`, phase: "Check", schema: FINDINGS }
    ),
  (review, a) =>
    parallel(
      (review?.findings ?? []).map((f) => () =>
        agent(
          `Adversarially verify this knockedu (LECV) finding from the "${a.title}" area. Reproduce it against the REAL code or eval — read the cited file:line; if it's a filter-quality claim run knockedu-filter-eval; if it's a compliance-violation claim grep for the server-side portal fetch/persistence. Default to verified=false unless you have proof. Claim: "${f.claim}" (${f.file}${f.line ? ":" + f.line : ""}, kind=${f.kind}, sev=${f.severity}).`,
          {
            label: `verify:${a.key}:${f.file}`,
            phase: "Verify",
            agentType: "qa-verifier",
            schema: VERDICT,
          }
        ).then((v) => ({ ...f, area: a.key, areaTitle: a.title, verdict: v }))
      )
    )
);

const all = results.flat().filter(Boolean);
const confirmed = all.filter((f) => f.verdict?.verified === true);
const rejected = all.filter((f) => f.verdict?.verified !== true);

const sevRank = { crit: 0, high: 1, med: 2, low: 3 };
confirmed.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));

log(
  `Feature audit done: ${confirmed.length} CONFIRMED, ${rejected.length} rejected/unverified across ${AREAS.length} areas.`
);

return { confirmed, rejected };
