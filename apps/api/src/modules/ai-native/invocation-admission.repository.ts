import { PrismaService } from '../database/prisma.service';
import type { AiProfileScope } from './provider-profile.ports';
import type { AdmissionRepository, AiAdmissionStatus, AiInvocationAdmissionRecord, CreateAiInvocationAdmission } from './invocation-admission.ports';

type Delegate = { findFirst(args: unknown): Promise<unknown | null>; create(args: unknown): Promise<unknown>; updateMany(args: unknown): Promise<{ count: number }> };
const where = (scope: AiProfileScope, callId: string) => ({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, callId });
function record(value: unknown): AiInvocationAdmissionRecord {
  const row = value as Record<string, unknown>;
  if (!row || typeof row.id !== 'string' || typeof row.tenantId !== 'string' || typeof row.workspaceId !== 'string' || typeof row.actorId !== 'string' || typeof row.callId !== 'string' || typeof row.requestHash !== 'string' || typeof row.status !== 'string' || !(row.expiresAt instanceof Date) || !(row.admittedAt instanceof Date) || !(row.updatedAt instanceof Date)) throw new Error('AI_ADMISSION_INVALID_ROW');
  return { id: row.id, scope: { id: `${row.tenantId}:${row.workspaceId}`, kind: 'WORKSPACE', tenantId: row.tenantId, workspaceId: row.workspaceId }, actorId: row.actorId, callId: row.callId, requestHash: row.requestHash, profileId: typeof row.profileId === 'string' ? row.profileId : null, status: row.status as AiAdmissionStatus, dispatchId: typeof row.dispatchId === 'string' ? row.dispatchId : null, unknownReason: typeof row.unknownReason === 'string' ? row.unknownReason : null, expiresAt: row.expiresAt, admittedAt: row.admittedAt, updatedAt: row.updatedAt, revokedAt: row.revokedAt instanceof Date ? row.revokedAt : null, completedAt: row.completedAt instanceof Date ? row.completedAt : null };
}
export class PrismaAdmissionRepository implements AdmissionRepository {
  private readonly delegate: Delegate;
  constructor(prisma: PrismaService) { this.delegate = (prisma as unknown as { aiInvocationAdmission?: Delegate }).aiInvocationAdmission!; if (!this.delegate) throw new Error('AI_ADMISSION_PRISMA_UNAVAILABLE'); }
  async get(scope: AiProfileScope, callId: string) { const row = await this.delegate.findFirst({ where: where(scope, callId) }); return row === null ? null : record(row); }
  async create(input: CreateAiInvocationAdmission) { const row = await this.delegate.create({ data: { id: crypto.randomUUID(), tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, actorId: input.actorId, callId: input.callId, requestHash: input.requestHash, profileId: input.profileId ?? null, status: 'admitted', expiresAt: input.expiresAt } }); return record(row); }
  async transition(scope: AiProfileScope, callId: string, from: AiAdmissionStatus, to: AiAdmissionStatus, patch = {}) { const result = await this.delegate.updateMany({ where: { ...where(scope, callId), status: from }, data: { status: to, ...patch, ...(to === 'revoked' || to === 'cancelled' ? { revokedAt: new Date() } : {}), ...(to === 'completed' ? { completedAt: new Date() } : {}) } }); if (result.count !== 1) return null; return this.get(scope, callId); }
}
