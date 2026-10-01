export interface VetClinic {
  id: string;
  name: string;
  targetPets: string; // 예: "햄스터, 기니피그, 앵무새, 토끼, 고슴도치"
  address: string;
  phone: string;
  lat: number;
  lng: number;
  operatingHours?: string;
}
