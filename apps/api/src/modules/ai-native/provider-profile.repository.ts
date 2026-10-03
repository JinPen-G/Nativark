import { PrismaService } from '../database/prisma.service';
import type { AiProfileScope, AiProviderProfileRecord, CreateAiProviderProfile, ProviderProfileRepository, UpdateAiProviderProfile } from './provider-profile.ports';

type Delegate = {
  findMany(args: unknown): Promise<unknown[]>;
  findFirst(args: unknown): Promise<unknown | null>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
const keyWhere = (scope: AiProfileScope, profileKey?: string) => ({
  scopeId: scope.id, scopeKind: scope.kind, ...(profileKey === undefined ? {} : { profileKey })
});
function record(value: unknown): AiProviderProfileRecord {
  const row = value as Record<string, unknown>;
  if (!row || typeof row.id !== 'string' || typeof row.scopeId !== 'string' || typeof row.scopeKind !== 'string' || typeof row.profileKey !== 'string' || typeof row.configRevision !== 'number') throw new Error('AI_PROFILE_INVALID_ROW');
  return { ...row, allowedCapabilities: row.allowedCapabilities as AiProviderProfileRecord['allowedCapabilities'], disabledAt: (row.disabledAt as Date | null) ?? null } as AiProviderProfileRecord;
}
/** Real Prisma delegate adapter. Scope and revision predicates are always server-built. */
export class PrismaProviderProfileRepository implements ProviderProfileRepository {
  private readonly delegate: Delegate;
  constructor(prisma: PrismaService) {
    this.delegate = (prisma as unknown as { aiProviderProfile?: Delegate }).aiProviderProfile!;
    if (!this.delegate || typeof this.delegate.findMany !== 'function') throw new Error('AI_PROFILE_PRISMA_UNAVAILABLE');
  }
  async list(scope: AiProfileScope) {
    const rows = await this.delegate.findMany({ where: keyWhere(scope), orderBy: [{ role: 'asc' }, { profileKey: 'asc' }] });
    return rows.map(record);
  }
  async get(scope: AiProfileScope, profileKey: string) {
    const row = await this.delegate.findFirst({ where: keyWhere(scope, profileKey) });
    return row === null ? null : record(row);
  }
  async create(input: CreateAiProviderProfile) {
    const row = await this.delegate.create({ data: { scopeId: input.scope.id, scopeKind: input.scope.kind, profileKey: input.profileKey, role: input.role, serviceMode: input.serviceMode, protocol: input.protocol, provider: input.provider, model: input.model, credentialRef: input.credentialRef, allowedCapabilities: [...input.allowedCapabilities] }, });
    return record(row);
  }
  async update(scope: AiProfileScope, profileKey: string, input: UpdateAiProviderProfile) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error('AI_PROFILE_INVALID_REVISION');
    const data = { ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.model === undefined ? {} : { model: input.model }), ...(input.credentialRef === undefined ? {} : { credentialRef: input.credentialRef }), ...(input.allowedCapabilities === undefined ? {} : { allowedCapabilities: [...input.allowedCapabilities] }), ...(input.disabledAt === undefined ? {} : { disabledAt: input.disabledAt }), configRevision: { increment: 1 } };
    const result = await this.delegate.updateMany({ where: { ...keyWhere(scope, profileKey), configRevision: input.expectedRevision }, data });
    if (result.count !== 1) return null;
    return this.get(scope, profileKey);
  }
}
