/** Platform settings use the same bounded directory and evidence reads on either host. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_USAGE_DRAFT_SCHEMAS, type AiPlatformModelDirectoryDraft, type AiPlatformModelCapabilityObservationDraft } from '@rental-os/platform-contracts/ai-usage';
import { ModelGatewayError, ProviderCapabilityReader, capabilityNameSchema, capabilityVerificationSchema, capabilityProfileFingerprint } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiScopeRepository, type AiCurrentScopeAuthority } from '../runtime/ai-scope.repository';
import { parseAiProviderProfileRecord } from '../runtime/provider-profile.repository';
import { listCapabilityEvidence } from './provider-capability-evidence';
import { PrismaTextCapabilityEvidenceReader, type TextProbeEvidenceDatabase } from './text-capability-evidence.reader';
import type { platformModelDirectoryQuery } from './platform-model-settings-transport';

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validDirectory = ajv.compile<AiPlatformModelDirectoryDraft>(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelDirectoryDraft);
const validCapabilities = ajv.compile<AiPlatformModelCapabilityObservationDraft>(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelCapabilityObservationDraft);
const identityHash = ({ requestId: _requestId, authorizedAt: _authorizedAt, ...identity }: Awaited<ReturnType<AiCurrentScopeAuthority['resolve']>>) => requestFingerprint(identity);
type DirectoryDatabase = Pick<PrismaClient, 'aiScope' | 'aiProviderProfile'>;
export type PlatformSettingsEvidenceDatabase = DirectoryDatabase & TextProbeEvidenceDatabase & Pick<PrismaClient, 'aiProviderCapabilityEvidence'>;
const directorySelect = { id: true, scopeId: true, scopeKind: true, serviceMode: true, profileKey: true, role: true,
  protocol: true, provider: true, model: true, configRevision: true, enabled: true, disabledAt: true } satisfies Prisma.AiProviderProfileSelect;

export async function readPlatformModelDirectory(db: DirectoryDatabase, authority: AiCurrentScopeAuthority,
  command: z.output<typeof platformModelDirectoryQuery>, signal?: AbortSignal): Promise<AiPlatformModelDirectoryDraft> {
  const scopes = new AiScopeRepository(db, authority);
  const before = await scopes.resolveCurrent();
  if (before.scope.kind !== 'PLATFORM' || before.context.actor.kind !== 'saas_admin') throw new ModelGatewayError('FORBIDDEN');
  const rows = structuredClone(await db.aiProviderProfile.findMany({ where: {
    scopeId: before.scope.id, scopeKind: 'PLATFORM', serviceMode: 'platform_managed',
    ...(command.after ? { id: { gt: command.after } } : {}) }, select: directorySelect, orderBy: { id: 'asc' }, take: command.limit + 1 }));
  if (rows.length > command.limit + 1 || new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => row.scopeId !== before.scope.id || row.scopeKind !== 'PLATFORM' || row.serviceMode !== 'platform_managed'
      || typeof row.enabled !== 'boolean' || row.disabledAt !== null && !(row.disabledAt instanceof Date)))
    throw new ModelGatewayError('INVALID_RESPONSE');
  const result = { items: rows.slice(0, command.limit).map(row => ({ profileId: row.id, profileKey: row.profileKey, role: row.role,
    protocol: row.protocol, provider: row.provider, model: row.model, revision: row.configRevision,
    enabled: row.enabled && row.disabledAt === null })), nextCursor: rows.length > command.limit ? rows[command.limit - 1].id : null,
    observation: 'configuration_catalog_not_capability_evidence' as const };
  const after = await scopes.resolveCurrent();
  if (signal?.aborted || before.scope.id !== after.scope.id || identityHash(before.context) !== identityHash(after.context))
    throw new ModelGatewayError('FORBIDDEN');
  if (!validDirectory(result)) throw new ModelGatewayError('INVALID_RESPONSE');
  return structuredClone(result);
}

export async function readPlatformCapabilityEvidence(db: PlatformSettingsEvidenceDatabase, authority: AiCurrentScopeAuthority,
  profileId: string, signal?: AbortSignal): Promise<AiPlatformModelCapabilityObservationDraft> {
  const scopes = new AiScopeRepository(db, authority);
  const current = async () => {
    const owner = await scopes.resolveCurrent();
    if (owner.scope.kind !== 'PLATFORM' || owner.context.actor.kind !== 'saas_admin') throw new ModelGatewayError('FORBIDDEN');
    const row = await db.aiProviderProfile.findFirst({ where: { id: profileId, scopeId: owner.scope.id,
      scopeKind: 'PLATFORM', serviceMode: 'platform_managed' } });
    if (!row) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    const profile = parseAiProviderProfileRecord(row);
    if (profile.id !== profileId || profile.scopeId !== owner.scope.id || profile.scopeKind !== 'PLATFORM'
      || profile.serviceMode !== 'platform_managed') throw new ModelGatewayError('FORBIDDEN');
    return { profile, identity: identityHash(owner.context) };
  };
  const before = await current();
  const repository = { list: listCapabilityEvidence.bind(null, db) };
  const rows = await repository.list(before.profile);
  if (rows.some(row => row.observedRevision > before.profile.configRevision)) throw new ModelGatewayError('INVALID_RESPONSE');
  const verifier = new ProviderCapabilityReader(repository, { liveEvidenceVerifier: new PrismaTextCapabilityEvidenceReader(db) });
  const enabled = before.profile.enabled && before.profile.disabledAt === null;
  const preflight = enabled ? await verifier.preflight(before.profile, capabilityNameSchema.options) : null;
  const items: AiPlatformModelCapabilityObservationDraft['items'] = [];
  for (const capability of capabilityNameSchema.options) {
    const recorded = rows.find(row => row.capability === capability);
    const readiness = enabled && before.profile.allowedCapabilities.includes(capability)
      && preflight !== null && !preflight.missing.includes(capability);
    const proof = capabilityVerificationSchema.safeParse(recorded?.details?.verification);
    items.push({ capability, allowed: before.profile.allowedCapabilities.includes(capability),
      readiness: !enabled ? 'configuration_disabled' : readiness ? 'verified_supported' : 'unverified',
      recorded: recorded ? { status: recorded.status, source: recorded.source, observedRevision: recorded.observedRevision,
        checkedAt: recorded.checkedAt.toISOString(), expiresAt: recorded.expiresAt?.toISOString() ?? null,
        mode: proof.success ? proof.data.evidence : 'not_attested',
        applicability: recorded.observedRevision === before.profile.configRevision ? 'current_configuration' : 'historical_configuration' } : null });
  }
  const afterRows = await repository.list(before.profile), after = await current();
  if (signal?.aborted || after.identity !== before.identity || capabilityProfileFingerprint(after.profile) !== capabilityProfileFingerprint(before.profile)
    || after.profile.enabled !== before.profile.enabled || requestFingerprint(after.profile.disabledAt) !== requestFingerprint(before.profile.disabledAt)
    || requestFingerprint(rows) !== requestFingerprint(afterRows)) throw new ModelGatewayError('FORBIDDEN');
  const now = new Date();
  for (const item of items) if (item.readiness === 'verified_supported' && (!item.recorded?.expiresAt
    || Date.parse(item.recorded.expiresAt) <= now.getTime() || Date.parse(item.recorded.checkedAt) > now.getTime())) item.readiness = 'unverified';
  const result: AiPlatformModelCapabilityObservationDraft = { profileId: profileId, configurationRevision: after.profile.configRevision,
    enabled, observedAt: now.toISOString(), items, execution: 'read_only_no_probe_or_dispatch', admission: 'not_granted' };
  if (!validCapabilities(result)) throw new ModelGatewayError('INVALID_RESPONSE');
  return structuredClone(result);
}
