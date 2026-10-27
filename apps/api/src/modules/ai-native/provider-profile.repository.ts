import type { PrismaService } from '../database/prisma.service';
import { Prisma, type AiProviderProfile } from '@prisma/client';
import { z } from 'zod';
import { capabilityNameSchema } from './capability-verification';
import type { AiProfileScope, AiProviderProfileRecord, CreateAiProviderProfile, ProviderProfileRepository, UpdateAiProviderProfile } from './provider-profile.ports';
import { MAX_AI_PROVIDER_PROFILES } from './provider-profile.ports';

const profileRowSchema = z.object({
  id: z.string().min(1).max(36), scopeId: z.string().min(1).max(36),
  scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']), profileKey: z.string().min(1).max(64),
  role: z.enum(['DEFAULT', 'REASONING', 'VISION', 'EMBEDDING']), serviceMode: z.enum(['platform_managed', 'tenant_managed']),
  protocol: z.string().min(1).max(64), provider: z.string().min(1).max(128), model: z.string().min(1).max(256),
  credentialRef: z.string().min(1).max(191), configRevision: z.number().int().min(1).max(4294967295),
  enabled: z.boolean(), disabledAt: z.date().nullable(),
  allowedCapabilities: z.array(capabilityNameSchema).max(8).refine(values => new Set(values).size === values.length)
});
const keyWhere = (scope: AiProfileScope, profileKey?: string) => ({
  scopeId: scope.id, scopeKind: scope.kind, ...(profileKey === undefined ? {} : { profileKey })
});
export function parseAiProviderProfileRecord(value: AiProviderProfile): AiProviderProfileRecord {
  const parsed = profileRowSchema.safeParse(value);
  if (!parsed.success) throw new Error('AI_PROFILE_INVALID_ROW');
  return parsed.data;
}
/** Real Prisma delegate adapter. Scope and revision predicates are always server-built. */
export class PrismaProviderProfileRepository implements ProviderProfileRepository {
  private readonly delegate: PrismaService['aiProviderProfile'];
  constructor(prisma: Pick<PrismaService, 'aiProviderProfile'>) {
    this.delegate = prisma.aiProviderProfile;
    if (!this.delegate || typeof this.delegate.findMany !== 'function') throw new Error('AI_PROFILE_PRISMA_UNAVAILABLE');
  }
  async list(scope: AiProfileScope) {
    const owner = structuredClone(scope);
    const rows = await this.delegate.findMany({ where: keyWhere(owner),
      orderBy: [{ role: 'asc' }, { profileKey: 'asc' }, { id: 'asc' }], take: MAX_AI_PROVIDER_PROFILES + 1 });
    if (rows.length > MAX_AI_PROVIDER_PROFILES) throw new Error('AI_PROFILE_LIMIT_EXCEEDED');
    const profiles = rows.map(parseAiProviderProfileRecord);
    if (new Set(profiles.map(profile => profile.id)).size !== profiles.length
      || profiles.some(profile => profile.scopeId !== owner.id || profile.scopeKind !== owner.kind))
      throw new Error('AI_PROFILE_INVALID_ROW');
    return profiles;
  }
  async get(scope: AiProfileScope, profileKey: string) {
    const owner = structuredClone(scope);
    const row = await this.delegate.findFirst({ where: keyWhere(owner, profileKey) });
    if (row === null) return null;
    const profile = parseAiProviderProfileRecord(row);
    if (profile.scopeId !== owner.id || profile.scopeKind !== owner.kind || profile.profileKey !== profileKey)
      throw new Error('AI_PROFILE_INVALID_ROW');
    return profile;
  }
  async create(input: CreateAiProviderProfile) {
    const row = await this.delegate.create({ data: { scopeId: input.scope.id, scopeKind: input.scope.kind, profileKey: input.profileKey, role: input.role, serviceMode: input.serviceMode, protocol: input.protocol, provider: input.provider, model: input.model, credentialRef: input.credentialRef, allowedCapabilities: [...input.allowedCapabilities] }, });
    return parseAiProviderProfileRecord(row);
  }
  async update(scope: AiProfileScope, profileKey: string, input: UpdateAiProviderProfile) {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision >= 4294967295) throw new Error('AI_PROFILE_INVALID_REVISION');
    if (input.credentialRef && /^(?:tenant|platform)-model:/u.test(input.credentialRef)) throw new Error('AI_PROFILE_CONFIG_OWNED');
    const data = { ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.model === undefined ? {} : { model: input.model }), ...(input.credentialRef === undefined ? {} : { credentialRef: input.credentialRef }), ...(input.allowedCapabilities === undefined ? {} : { allowedCapabilities: [...input.allowedCapabilities] }), ...(input.disabledAt === undefined ? {} : { disabledAt: input.disabledAt }), configRevision: { increment: 1 } };
    try {
      // Extended unique predicate performs CAS and returns this exact write in one
      // statement. A separate get could return a later writer's revision/config.
      return parseAiProviderProfileRecord(await this.delegate.update({ where: {
        scopeId_scopeKind_profileKey: { scopeId: scope.id, scopeKind: scope.kind, profileKey },
        configRevision: input.expectedRevision,
        // Config-owned profiles must use their encrypted config transaction,
        // not this generic CAS (including whitelist-only policy changes).
        NOT: [{ credentialRef: { startsWith: 'tenant-model:' } }, { credentialRef: { startsWith: 'platform-model:' } }]
      }, data }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return null;
      // Uncertain commit, validation or transport failure is not a CAS conflict.
      throw error;
    }
  }
}
