import type { AdoptionApplication, CreateApplicationInput, ApplicationStatus } from './application.types.js';

export interface ApplicationRepository {
  create(applicantId: string, input: CreateApplicationInput): Promise<AdoptionApplication>;
  findById(id: string): Promise<AdoptionApplication | null>;
  listByPostId(postId: string): Promise<AdoptionApplication[]>;
  listByApplicantId(applicantId: string): Promise<AdoptionApplication[]>;
  updateStatus(id: string, status: ApplicationStatus, chatThreadId?: string): Promise<AdoptionApplication | null>;
}

export class InMemoryApplicationRepository implements ApplicationRepository {
  private apps: Map<string, AdoptionApplication> = new Map();
  private seq = 1;

  async create(applicantId: string, input: CreateApplicationInput): Promise<AdoptionApplication> {
    const id = `app_${this.seq++}`;
    const app: AdoptionApplication = {
      id,
      postId: input.postId,
      applicantId,
      cagePhotoUrl: input.cagePhotoUrl,
      experience: input.experience,
      familyAgreed: input.familyAgreed,
      commitment: input.commitment,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    this.apps.set(id, app);
    return app;
  }

  async findById(id: string): Promise<AdoptionApplication | null> {
    return this.apps.get(id) ?? null;
  }

  async listByPostId(postId: string): Promise<AdoptionApplication[]> {
    return Array.from(this.apps.values()).filter(a => a.postId === postId);
  }

  async listByApplicantId(applicantId: string): Promise<AdoptionApplication[]> {
    return Array.from(this.apps.values()).filter(a => a.applicantId === applicantId);
  }

  async updateStatus(id: string, status: ApplicationStatus, chatThreadId?: string): Promise<AdoptionApplication | null> {
    const app = this.apps.get(id);
    if (!app) return null;
    app.status = status;
    if (chatThreadId) {
      app.chatThreadId = chatThreadId;
    }
    return app;
  }
}
