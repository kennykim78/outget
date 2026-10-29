# _archive INDEX — 위드스몰 2층 보관

정책: `C:\kenny_work\000_orchestra\CLEANUP_POLICY.md` · 계획: `000_orchestra/projects/withsmall/ARCHIVE_PLAN.md` · 총괄 확인: ORDERS §12(안 A).
지우지 않고 옮긴다. git 추적 문서 → 루트 `_archive/<YYYYMM>/`(git mv), git 무시 작업 로그 → `_workspace/_archive/<YYYYMM>/`(일반 이동, 이력 없음 → 백업 zip).

## 202610 (2026-10-30 실행)

백업 zip: `C:\kenny_work\_backup\withsmall-workspace-backup-20261030.zip` (108 항목, 409,002B — reports 92 · workspace_prev 14 · claude-workflows 2). 보관: 2026-11-30 또는 Kenny 확인 뒤 중 늦은 쪽, 삭제는 Kenny 수동.

| 원래 위치 | 새 위치 | 추적 | 이유 |
|---|---|---|---|
| `.claude/workflows/knockedu-review.js`, `knockedu-feature-audit.js` | `_archive/202610/claude-workflows/` | git mv | Outget 시절 워크플로, 참조 0 |
| `_workspace_prev/` (14파일, 103,644B) | `_workspace/_archive/202610/workspace_prev/` | 무시 | 6/9 Outget 산출물, 참조 0 |
| `_workspace/` 보고서 92개 (686,441B) | `_workspace/_archive/202610/reports/` (원본) + 합본 3개 | 무시 | 001~152 중 현재 참조 없는 것 |

### 합본 (번호 → 합본 매핑)
- `_workspace/_archive/202610/reports-A-00_032-R0-R4.md` — 25파일, 원본 합 229,217B: 00_r0_gate.md, 02_backend_r1.md, 02_frontend_r1.md, 03_qa_r1.md, 03_security_r1.md, 06_curator_r2-1.md, 07_backend_r2_laneA.md, 08_backend_r2_laneB.md, 11_qa_r2.md, 13_curator_r3_copy.md, 14_security_r3.md, 15_qa_r3.md, 15b_qa_r3_retry.md, 16_backend_r3_laneA.md, 17_backend_r3_laneC.md, 18_backend_r3_laneE.md, 20_backend_r3_laneG1.md, 21_backend_r3_laneF2.md, 22_design_r4_spec.md, 23b_impact_r4.md, 24_qa_r4_gate.md, 27_be1_r4.md, 28_be2_r4.md, 30_fe2_r4.md, 32_curator_r4_copy.md
- `_workspace/_archive/202610/reports-B-33_052-R5.md` — 13파일, 원본 합 137,143B: 34b_impact_r5.md, 35_curator_r5_copy.md, 40_be1_r5.md, 41_be2_r5.md, 42_be3_r5.md, 43_fe_w0_r5.md, 44_sd_c1_r5.md, 45_fe1_r5.md, 46_fe2_r5.md, 47_fe3_r5.md, 48_fe3b_r5.md, 50_security_r5_final.md, 52_security_r5_sec5.md
- `_workspace/_archive/202610/reports-C-53_152-R6-R10.md` — 54파일, 원본 합 320,081B: 100_design_recheck.md, 101_security_privacy.md, 103_be_searchcheck.md, 106_research_affiliate.md, 107_architect_guineapig_plan.md, 108_research_ali.md, 109_architect_affiliate_plan.md, 110_design_guineapig.md, 111_design_affiliate_disclosure.md, 112_research_api_display.md, 119_architect_deploy_plan.md, 121_backend_gp_prereq.md, 123_research_oracle_contact.md, 124_backend_deploy_fix.md, 126_architect_gerbil_plan.md, 128_backend_deploy_fix2.md, 129_security_gp.md, 130_backend_gerbil.md, 132_backend_deploy_fix3.md, 134_backend_deploy_fix4.md, 135_curator_gerbil.md, 136_backend_gerbil_fix.md, 139_security_deploy.md, 140_backend_ci_linux.md, 142_smalldev_ci_tests.md, 145_be_infra_hardening.md, 146_be_server_hardening.md, 149_smalldev_privacy_admin_log.md, 150_security_infra.md, 53_architect_r6_plan.md, 54_architect_multitype_audit.md, 56_design_g3_spec.md, 57_security_r6_sec6.md, 61_design_r7_perf_review.md, 64_qa_fallback_font.md, 66_be_k4_revert.md, 71_security_k4.md, 73_architect_wsdata_plan.md, 74_design_glyph.md, 75_be_wire.md, 76_be_guard.md, 77_fe_wire.md, 78_qa_s6.md, 79_security_r7b.md, 86_architect_privacy_plan.md, 87_be_privacy.md, 88_be_privacy_page.md, 89_design_privacy_spec.md, 90_be_food.md, 93_be_tomb.md, 94_fe_privacy.md, 96_design_privacy_review.md, 97_quote_audit.md, 98_be_privacy2.md

### 남겨 둔 것 (이동 안 함)
- 참조 있음(decisions tail·scripts/review-packets·check-perf-shape·deploy.md 등) 번호: 33 60 62 68 70 72 80~83 85 91 104 105 120 122 125 127 131 133 137 138 141 143 147 148 152
- 약한 참조(코드 주석·비권위 docs) — 다음 정리 때 주석 경로를 이 INDEX 로 바꾼 뒤 이동: 04 19 25 25a 29 51 55 58 58a 59 65a 65b 67 69 84, 모호 31, decisions 언급 36 36b 37 38
- 파일명 직접 참조(실행 직전 확인): 01_architect_plan(withsmall-build SKILL), 05·09·10·12·12b·23·34(decisions), 26_design_r4_review(app.css), 63_fe_fallback_font(fonts-fallback.css)
- 153 이후 보고서 전부, `docs/legacy/outget/`, `harness-config/`, `.claude/skills/knockedu-build`(별칭)

### 보류 (Kenny 확인 — [KENNY-아침])
- `_workspace/decisions.md` 분할 초안: 10-01~10-12 = 5~207줄(203줄) → `_workspace/_archive/202610/decisions-1001-1012.md`, 10-13~ 남김. (2026-10-30 기준 512줄 이후 추가분은 남는 쪽)
- 루트 `README.md`·`docs/README.md` 교체(Outget → WithSmall) + `docs/Outget-개요.md`·`docs/MVP_모델.md` → `_archive/202610/` git mv. 새 README 초안은 `_workspace/scratch/` 에.
