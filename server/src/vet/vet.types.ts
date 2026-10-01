// 특수동물 진료 병원 — 저장 레코드 + 공개 응답 형태.
//   핀 좌표는 병원 주소 기준(사용자 위치 아님, 불변식 8), 옵셔널.
//   노출은 status VERIFIED(전화 확인) 만(불변식 7).
import type { VetSource, VetStatus } from '../engine/domain.js';

export interface StoredVetClinic {
  id: string;
  name: string;
  region: string; // 시군구 텍스트
  address: string;
  phone: string;
  lat?: number;
  lng?: number;
  treats: string[]; // AnimalType id[]
  hours?: string;
  night?: boolean;
  emergency?: boolean;
  source: VetSource;
  status: VetStatus;
  verificationMethod?: string;
  verifiedAt?: string;
  verificationNote?: string; // 운영자 메모 — 공개 응답에서 제외
}

// 공개 응답 — 운영자 메모 제외.
export type VetClinic = Omit<StoredVetClinic, 'verificationNote'>;

export interface VetQuery {
  region?: string;
  q?: string;
}

export function toPublicVet(c: StoredVetClinic): VetClinic {
  const { verificationNote: _note, ...pub } = c;
  void _note;
  return pub;
}
