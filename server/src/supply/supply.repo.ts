import type { SupplyPost, CreateSupplyInput, SupplyStatus } from './supply.types.js';

export interface SupplyPostFilter {
  itemType?: string;
  dealType?: string;
  region?: string;
  status?: SupplyStatus;
}

export interface SupplyRepository {
  create(authorId: string, input: CreateSupplyInput): Promise<SupplyPost>;
  findById(id: string): Promise<SupplyPost | null>;
  list(filter?: SupplyPostFilter): Promise<SupplyPost[]>;
  updateStatus(id: string, status: SupplyStatus): Promise<SupplyPost | null>;
  blind(id: string): Promise<boolean>;
}

export class InMemorySupplyRepository implements SupplyRepository {
  private posts: Map<string, SupplyPost> = new Map();
  private seq = 1;

  async create(authorId: string, input: CreateSupplyInput): Promise<SupplyPost> {
    const id = `sup_${this.seq++}`;
    const price = input.dealType === 'FREE' ? 0 : (input.price ?? 0);
    const post: SupplyPost = {
      id,
      authorId,
      title: input.title,
      itemType: input.itemType,
      dealType: input.dealType,
      price,
      description: input.description,
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

  async findById(id: string): Promise<SupplyPost | null> {
    return this.posts.get(id) ?? null;
  }

  async list(filter?: SupplyPostFilter): Promise<SupplyPost[]> {
    let result = Array.from(this.posts.values());
    if (filter?.itemType) {
      result = result.filter(p => p.itemType === filter.itemType);
    }
    if (filter?.dealType) {
      result = result.filter(p => p.dealType === filter.dealType);
    }
    if (filter?.status) {
      result = result.filter(p => p.status === filter.status);
    } else {
      result = result.filter(p => p.status !== 'BLINDED');
    }
    if (filter?.region) {
      result = result.filter(p => p.region.includes(filter.region!));
    }
    return result;
  }

  async updateStatus(id: string, status: SupplyStatus): Promise<SupplyPost | null> {
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
