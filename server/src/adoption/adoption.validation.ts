import type { CreateAdoptionPostInput } from './adoption.types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateAdoptionPostInput(input: Partial<CreateAdoptionPostInput>): ValidationResult {
  const errors: string[] = [];

  const allowedCategories = ['HAMSTER', 'PARROT', 'GUINEA_PIG', 'RABBIT', 'OTHER'];
  if (!input.category || !allowedCategories.includes(input.category)) {
    errors.push('올바른 동물 카테고리를 선택해야 합니다 (HAMSTER, PARROT, GUINEA_PIG, RABBIT, OTHER).');
  }

  if (!input.speciesDetail || input.speciesDetail.trim().length === 0) {
    errors.push('세부 품종 정보는 필수입니다.');
  }

  const allowedGenders = ['MALE', 'FEMALE', 'UNKNOWN'];
  if (!input.gender || !allowedGenders.includes(input.gender)) {
    errors.push('성별을 선택해야 합니다 (MALE, FEMALE, UNKNOWN).');
  }

  if (!input.ageText || input.ageText.trim().length === 0) {
    errors.push('나이 또는 개월 수를 입력해야 합니다.');
  }

  const allowedDealTypes = ['FREE', 'DEPOSIT', 'PAID'];
  if (!input.dealType || !allowedDealTypes.includes(input.dealType)) {
    errors.push('분양 방식(무료분양, 책임비, 개인유료분양)을 선택해야 합니다.');
  }

  if (input.dealType === 'FREE' && input.price && input.price > 0) {
    errors.push('무료분양은 금액이 0원이어야 합니다.');
  }

  if ((input.dealType === 'DEPOSIT' || input.dealType === 'PAID') && (!input.price || input.price <= 0)) {
    errors.push('책임비 또는 분양 금액을 올바르게 입력해야 합니다.');
  }

  if (!input.story || input.story.trim().length < 5) {
    errors.push('아이의 소개 및 사연을 5자 이상 작성해야 합니다.');
  }

  if (!input.region || input.region.trim().length === 0) {
    errors.push('대면 직거래 가능 지역(동네)은 필수입니다.');
  }

  // CITES 검증: CITES 해당 종인 경우 서류 구비 여부 체크 권장/확인
  if (input.citesSpecies && input.citesDocReady === false) {
    // 경고 또는 에러 처리 (양도양수 신고 필수 품종)
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
