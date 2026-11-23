// 생성 이미지(AI_GENERATED) 사진 기록 규칙 — Kenny 2026-11-23 「빈 이미지 칸 0」 예외(_workspace/decisions.md, 351 R13).
//   불변식 1 은 「운영자가 사용권을 확인한 것」으로 읽고(decisions.md), 대신 기록을 엄격히 요구한다:
//   생성 도구(CODEX|AGY) · 생성일 · 프롬프트 파일 · 배포 파일 경로 · 사람의 종 확인 서명. 원본 URL·CC 증서는 두지 않는다.
//   특정 판매 상품 카드에는 쓰지 않는다 — 상품 imageLicense(domain.ts IMAGE_LICENSES)에는 AI_GENERATED 가 없고,
//   compliance C6-IMG-AI-PRODUCT 가 따로 막는다. 후기 사진은 생성하지 않는다(불변식 7).
//   세 독립 구현이 같은 판정이어야 한다: 여기(isPhotoUsable 이 사용) · seed/validate-people.ts(I04) · scripts/lib/seed-exposure.mjs.
import { isoDayNumber } from './domain.js';
import { isAiDraftMarker } from './tips.js';

export const PHOTO_AI_LICENSE = 'AI_GENERATED' as const;
/** 생성 도구 코드(이미지-소싱 기록 필드 source). Codex image_gen · Antigravity(agy). */
export const PHOTO_AI_SOURCES = ['CODEX', 'AGY'] as const;

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** 배포 파일: 장면·종 그림 /assets/photos/<slot>.webp, 품목 그림 /assets/items/<supplyItemId>[--<careProfileId>].webp. */
export const PHOTO_ASSET_RE = new RegExp(`^/assets/(?:photos|items)/${KEBAB}(?:--${KEBAB})?\\.webp$`);
/** 프롬프트 파일(저장소 상대): docs/assets/prompts/<slot>.md. */
export const PHOTO_PROMPT_PATH_RE = new RegExp(`^docs/assets/prompts/${KEBAB}(?:--${KEBAB})?\\.md$`);

/**
 * 종 확인 서명자가 사람이 아닌 표지인가(불변식 7 — AI 는 검수자가 될 수 없다). isAiDraftMarker(AI_DRAFT 변형) +
 *   생성 도구·모델 이름. NFKC → 영문 대문자만 남겨 비교(공백·하이픈·전각 변형 무시).
 */
export function isMachineSignerMarker(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (isAiDraftMarker(v)) return true;
  const letters = v.normalize('NFKC').toUpperCase().replace(/[^A-Z]/g, '');
  if (letters === 'AI' || letters === 'AGY' || letters === 'GPT') return true;
  return ['AIGENERATED', 'CODEX', 'ANTIGRAVITY', 'CHATGPT', 'OPENAI', 'GEMINI', 'CLAUDE', 'GPTIMAGE', 'IMAGEGEN'].some((m) => letters.includes(m));
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** AI_GENERATED 사진 기록 문제 목록(빈 배열 = 기록 완전). status·license 자체는 호출자가 본다. 메시지는 validate I04 가 그대로 쓴다. */
export function aiPhotoRecordProblems(p: Record<string, unknown>): Array<{ field: string; message: string }> {
  const out: Array<{ field: string; message: string }> = [];
  const add = (field: string, message: string): void => {
    out.push({ field, message });
  };
  if (typeof p.source !== 'string' || !(PHOTO_AI_SOURCES as readonly string[]).includes(p.source)) {
    add('source', `AI_GENERATED 의 source 는 ${PHOTO_AI_SOURCES.join('|')} (현재 ${JSON.stringify(p.source)})`);
  }
  // 생성물에는 외부 원본이 없다 — 원본 URL·CC 증서가 있으면 출처를 섞은 것(불변식 1, fail-closed).
  if (p.sourceUrl !== null && p.sourceUrl !== undefined) add('sourceUrl', 'AI_GENERATED 는 원본 URL 을 두지 않는다(null)');
  if (p.licenseUrl !== null && p.licenseUrl !== undefined) add('licenseUrl', 'AI_GENERATED 는 licenseUrl 을 두지 않는다(null)');
  const gen = isoDayNumber(p.generatedAt);
  if (gen === null) add('generatedAt', '생성일 필요(달력상 YYYY-MM-DD)');
  if (typeof p.promptPath !== 'string' || !PHOTO_PROMPT_PATH_RE.test(p.promptPath)) {
    add('promptPath', `프롬프트 파일 경로는 docs/assets/prompts/<kebab>.md (현재 ${JSON.stringify(p.promptPath)})`);
  }
  if (typeof p.asset !== 'string' || !PHOTO_ASSET_RE.test(p.asset)) {
    add('asset', `배포 파일은 /assets/(photos|items)/<kebab>[--<kebab>].webp (현재 ${JSON.stringify(p.asset)})`);
  }
  const sc = p.speciesCheck;
  if (!isObj(sc)) {
    add('speciesCheck', '종 확인 서명 { checkedBy, checkedAt } 필요');
    return out;
  }
  const keys = Object.keys(sc);
  if (keys.length !== 2 || !keys.includes('checkedBy') || !keys.includes('checkedAt')) {
    add('speciesCheck', 'speciesCheck 키는 checkedBy·checkedAt 둘뿐');
  }
  if (!nonEmpty(sc.checkedBy)) add('speciesCheck.checkedBy', '종 확인자(사람) 필요');
  else if (isMachineSignerMarker(sc.checkedBy)) add('speciesCheck.checkedBy', 'AI_DRAFT·생성 도구는 종 확인자가 될 수 없다(불변식 7 — 사람 서명만)');
  const chk = isoDayNumber(sc.checkedAt);
  if (chk === null) add('speciesCheck.checkedAt', '종 확인일 필요(달력상 YYYY-MM-DD)');
  else if (gen !== null && chk < gen) add('speciesCheck.checkedAt', '종 확인일이 생성일보다 이르다');
  return out;
}

/** AI_GENERATED 기록이 완전한가(isPhotoUsable 의 AI 분기). */
export function isAiPhotoRecordOk(p: Record<string, unknown>): boolean {
  return aiPhotoRecordProblems(p).length === 0;
}

/** 생성 이미지인가 — 화면에 「생성 이미지 · 임시」 표기(K1 권장 유지)를 붙일지 판정. 사용 가능 판정은 isPhotoUsable 이 따로 한다. */
export function isAiGeneratedPhoto(p: { license?: unknown } | null | undefined): boolean {
  return !!p && p.license === PHOTO_AI_LICENSE;
}
