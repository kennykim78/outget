// 소동물·앵무새 분양 도메인 타입 정의
export type AnimalCategory = 'HAMSTER' | 'PARROT' | 'GUINEA_PIG' | 'RABBIT' | 'OTHER';
export type Gender = 'MALE' | 'FEMALE' | 'UNKNOWN';
export type DealType = 'FREE' | 'DEPOSIT' | 'PAID';
export type AdoptionStatus = 'AVAILABLE' | 'RESERVED' | 'COMPLETED' | 'BLINDED';

export interface AdoptionPost {
  id: string;
  authorId: string;
  category: AnimalCategory;
  speciesDetail: string; // 예: "골든햄스터", "그린칙 코뉴어"
  petName?: string;
  gender: Gender;
  ageText: string; // 예: "생후 2개월"
  healthStatus: string;
  
  // 거래 유형 및 표시 금액 (플랫폼 자금 흐름 아님 — 당사자 대면 직거래 표시값)
  dealType: DealType;
  price: number; // FREE: 0, DEPOSIT/PAID: 해당 금액
  depositRefundTerms?: string; // 책임비 환급 조건
  
  // 법적 컴플라이언스
  citesSpecies: boolean; // CITES 규제 대상 여부 (앵무새 등)
  citesDocReady: boolean; // CITES 양도서류 구비 완료 여부
  
  requiredCageSpec?: string; // 희망 사육환경 조건 (예: 120L 케이지)
  story: string; // 소개/사연
  photos: string[]; // 사진 URL 배열
  region: string; // 직거래 가능 동네 (예: "마포구 서교동")
  lat?: number; // 지도 핀 좌표
  lng?: number;
  status: AdoptionStatus;
  createdAt: string;
}

export interface CreateAdoptionPostInput {
  category: AnimalCategory;
  speciesDetail: string;
  petName?: string;
  gender: Gender;
  ageText: string;
  healthStatus: string;
  dealType: DealType;
  price?: number;
  depositRefundTerms?: string;
  citesSpecies?: boolean;
  citesDocReady?: boolean;
  requiredCageSpec?: string;
  story: string;
  photos: string[];
  region: string;
  lat?: number;
  lng?: number;
}
