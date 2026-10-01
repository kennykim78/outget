import type { AdoptionPost, CreateAdoptionPostInput, AdoptionStatus } from './adoption.types.js';

export interface AdoptionPostFilter {
  category?: string;
  dealType?: string;
  status?: AdoptionStatus;
  region?: string;
}

export interface AdoptionRepository {
  create(authorId: string, input: CreateAdoptionPostInput): Promise<AdoptionPost>;
  findById(id: string): Promise<AdoptionPost | null>;
  list(filter?: AdoptionPostFilter): Promise<AdoptionPost[]>;
  updateStatus(id: string, status: AdoptionStatus): Promise<AdoptionPost | null>;
  blind(id: string): Promise<boolean>;
}

export class InMemoryAdoptionRepository implements AdoptionRepository {
  private posts: Map<string, AdoptionPost> = new Map();
  private seq = 1;

  async create(authorId: string, input: CreateAdoptionPostInput): Promise<AdoptionPost> {
    const id = `adopt_${this.seq++}`;
    const price = input.dealType === 'FREE' ? 0 : (input.price ?? 0);
    const post: AdoptionPost = {
      id,
      authorId,
      category: input.category,
      speciesDetail: input.speciesDetail,
      petName: input.petName,
      gender: input.gender,
      ageText: input.ageText,
      healthStatus: input.healthStatus,
      dealType: input.dealType,
      price,
      depositRefundTerms: input.depositRefundTerms,
      citesSpecies: input.citesSpecies ?? false,
      citesDocReady: input.citesDocReady ?? false,
      requiredCageSpec: input.requiredCageSpec,
      story: input.story,
      photos: input.photos,
      region: input.region,
      lat: input.lat,
      lng: input.lng,
      status: 'AVAILABLE',
      createdAt: new Date().toISOString(),
    };
    this.posts.set(id, post);
    return post;
  }

  async findById(id: string): Promise<AdoptionPost | null> {
    return this.posts.get(id) ?? null;
  }

  async list(filter?: AdoptionPostFilter): Promise<AdoptionPost[]> {
    let result = Array.from(this.posts.values());
    if (filter?.category) {
      result = result.filter(p => p.category === filter.category);
    }
    if (filter?.dealType) {
      result = result.filter(p => p.dealType === filter.dealType);
    }
    if (filter?.status) {
      result = result.filter(p => p.status === filter.status);
    } else {
      // 기본적으로 블라인드된 글은 제외
      result = result.filter(p => p.status !== 'BLINDED');
    }
    if (filter?.region) {
      result = result.filter(p => p.region.includes(filter.region!));
    }
    return result;
  }

  async updateStatus(id: string, status: AdoptionStatus): Promise<AdoptionPost | null> {
    const post = this.posts.get(id);
    if (!post) return null;
    post.status = status;
    return post;
  }

  async blind(id: string): Promise<boolean> {
    const post = this.posts.get(id);
    if (!post) return false;
    post.status = 'BLINDED';
    return true;
  }
}
