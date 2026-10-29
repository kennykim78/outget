export const meta = {
  name: "knockedu-feature-audit",
  description:
    "Audit Outget (아웃겟 — 지도 기반 아울렛 구매대행 당근형 양면 매칭 보드) core features end-to-end (위치/지역, 양면 보드·리스트, 매칭·채팅, UGC 할인소식/현장확인가, 결제 방식, 신고/거버넌스, 지도 렌더). Each area traced through its real stack; every finding adversarially verified against real code. Read-only — produces a confirmed bug list, does not edit.",
  phases: [
    { title: "Check", detail: "feature areas traced full-stack in parallel" },
    { title: "Verify", detail: "each finding reproduced against real code" },
  ],
};

// Each area is traced through its WHOLE stack. The agent follows imports/api calls
// itself. Goal = concrete, reproducible bugs and compliance violations, not vibes.
const AREAS = [
  {
    key: "location-region",
    title: "위치 · 네이버 지오코딩 · 지역 단위",
    focus:
      "현위치/지역 입력 → 네이버 지오코딩 → 지역 기반 표시·거리. Check: 좌표 파싱(필드/순서) 정확? 권한 거부/빈/오류 응답 처리? CRITICAL: 사용자 실시간 위경도를 서버에 저장/공유하는가 (위치 비실시간 invariant 위반)? 위치는 동/지역 텍스트여야 함.",
  },
  {
    key: "board-listings",
    title: "지도 양면 보드 (대행자/요청/할인 토글)",
    focus:
      "대행자 광고/일정 리스트 + 구매자 역경매 요청 리스트 + 할인소식을 네이버 지도에 토글·클러스터. Check: 컴포넌트가 API가 실제로 주는 데이터 shape를 받는가(undefined 필드 크래시)? 지위(개인/전문) 표시? 빈/로딩 상태? 모바일 fit?",
  },
  {
    key: "matching-chat",
    title: "역경매 매칭 · 채팅 상태머신",
    focus:
      "역경매 요청 → 대행자 채택 → 매칭 → 인앱 채팅. Check: 상태 전이(대기·채택·매칭·진행·종료) 누락/역행? 채팅 메시지 shape vs 서버 라우트? 알림 트리거? 통신판매중개 고지가 요청/채팅에 렌더되는가?",
  },
  {
    key: "price-ugc",
    title: "UGC 할인소식 · 현장 확인가",
    focus:
      "할인소식(미검증) + 대행자 현장 확인가. Check: 정가 미입력 시 `기준가 미확인` 라벨이 실제로 강제되는가? 할인소식과 현장확인가가 시각·문구로 분리되는가? CRITICAL: 플랫폼이 자체 산정 가격을 단정 표기하는가 (가격 주장 금지 위반)? 사진이 직접 촬영분으로 유도되는가(불펌)? 외부 사이트 자동수집이 있는가(무크롤링 위반)?",
  },
  {
    key: "payment",
    title: "거래방식 (직접 / 외부 안전결제)",
    focus:
      "매칭 후 거래방식 선택: 직접거래 vs 외부 P2P 안전결제(딥링크). Check CRITICAL: 결제대금이 플랫폼 계좌/PG 가맹점을 경유하거나 서버가 잔액·정산·환불을 보유하는가 (자금 미보유 위반)? PaymentRail 어댑터가 비수탁(딥링크/상태만)인가? 직접거래에 선입금 사기 경고가 있는가? 외부 링크를 '검증·보증'하는 로직이 있는가 (보증 금지 위반)?",
  },
  {
    key: "governance",
    title: "신고→블라인드 · 분쟁 · 대행자 지위",
    focus:
      "모든 UGC 신고 버튼 → 즉시 블라인드(임시조치) → 이의/재게시. 분쟁 채널. 대행자 지위(개인 비사업자/전문 사업자 인증) + 개인 사업자등록 의무 고지 + 전문 상호/사업자번호. Check: takedown 상태머신이 실제 동작? 신원정보 제공 엔드포인트? 공동대행 사입·세무 경고?",
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
              "other",
            ],
          },
          claim: {
            type: "string",
            description:
              "a single concrete, reproducible assertion a verifier can check against the code",
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
      description: "file:line quoted, or command/scan + result that proves/disproves the claim",
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
      `You are auditing the Outget (아웃겟 — 당근형 양면 매칭 보드) feature area: "${a.title}".\n\nTrace it end-to-end through the real stack — follow the actual imports and API calls yourself. Outget invariants: 무크롤링(외부 사이트 자동수집 금지) · 자금 미보유(결제 플랫폼 미경유, 외부 안전결제 딥링크만) · 통신판매중개 최소의무(고지/신원/분쟁) · 가격은 UGC+현장확인가만(`기준가 미확인` 강제) · 외부링크 보증 금지/위치 비실시간. A violation of any is a compliance-violation finding (crit).\n\nFOCUS: ${a.focus}\n\nReport ONLY concrete, reproducible findings (each with file:line where it exists and a single checkable claim). Do NOT edit anything. If the area mostly works, say so in notes and return few/zero findings. If the code for this area does not exist yet, audit the plan/architecture (docs/planning-artifacts/) for the same risks and say so.`,
      { label: `check:${a.key}`, phase: "Check", schema: FINDINGS }
    ),
  (review, a) =>
    parallel(
      (review?.findings ?? []).map((f) => () =>
        agent(
          `Adversarially verify this Outget finding from the "${a.title}" area. Reproduce it against the REAL code — read the cited file:line; if it's a compliance-violation claim, grep for the offending pattern (server-side payment/잔액, scraper/auto-fetch, missing 고지, missing `기준가 미확인`, link verifier, persisted lat/long) via knockedu-qa's compliance scan. Default to verified=false unless you have proof. Claim: "${f.claim}" (${f.file}${f.line ? ":" + f.line : ""}, kind=${f.kind}, sev=${f.severity}).`,
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
