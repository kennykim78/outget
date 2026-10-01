export type ApplicationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface AdoptionApplication {
  id: string;
  postId: string;
  applicantId: string;
  cagePhotoUrl: string; // 사육 환경 인증 사진 (필수)
  experience: string; // 사육 경험
  familyAgreed: boolean; // 동거인 동의 여부
  commitment: string; // 평생 책임 각오
  status: ApplicationStatus;
  chatThreadId?: string; // 승인 시 개설되는 채팅방
  createdAt: string;
}

export interface CreateApplicationInput {
  postId: string;
  cagePhotoUrl: string;
  experience: string;
  familyAgreed: boolean;
  commitment: string;
}
