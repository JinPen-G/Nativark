import type { AiProfileScope } from './provider-profile.ports';

export type AiAdmissionStatus = 'admitted' | 'revoked' | 'cancelled' | 'completed' | 'unknown';
export interface AiInvocationAdmissionRecord {
  id: string; scope: AiProfileScope; actorId: string; callId: string; requestHash: string;
  profileId: string | null; status: AiAdmissionStatus; dispatchId: string | null;
  unknownReason: string | null; expiresAt: Date; admittedAt: Date; updatedAt: Date;
  revokedAt: Date | null; completedAt: Date | null;
}
export interface CreateAiInvocationAdmission {
  scope: AiProfileScope; actorId: string; callId: string; requestHash: string;
  profileId?: string | null; expiresAt: Date;
}
export interface AdmissionRepository {
  get(scope: AiProfileScope, callId: string): Promise<AiInvocationAdmissionRecord | null>;
  create(input: CreateAiInvocationAdmission): Promise<AiInvocationAdmissionRecord>;
  transition(scope: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch?: { dispatchId?: string | null; unknownReason?: string | null }): Promise<AiInvocationAdmissionRecord | null>;
}
