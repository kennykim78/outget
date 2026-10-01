export type SupplyItemType = 'CAGE' | 'FEED' | 'TOY' | 'BEDDING' | 'ETC';
export type SupplyDealType = 'FREE' | 'USED_DEAL';
export type SupplyStatus = 'AVAILABLE' | 'COMPLETED' | 'BLINDED';

export interface SupplyPost {
  id: string;
  authorId: string;
  title: string;
  itemType: SupplyItemType;
  dealType: SupplyDealType;
  price: number; // FREE: 0, USED_DEAL: 표시 가격
  description: string;
  photos: string[];
  region: string;
  lat?: number;
  lng?: number;
  status: SupplyStatus;
  createdAt: string;
}

export interface CreateSupplyInput {
  title: string;
  itemType: SupplyItemType;
  dealType: SupplyDealType;
  price?: number;
  description: string;
  photos: string[];
  region: string;
  lat?: number;
  lng?: number;
}
