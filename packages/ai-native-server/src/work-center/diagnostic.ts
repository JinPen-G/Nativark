/** The original objective text challenge, pinned to one current encrypted
 * profile. Only this registration may run while text is still unverified. */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ModelGatewayError, capabilityProfileFingerprint, gatewayRoutingBinding, prepareGatewayTextIntent,
  type GatewayInvocationObservation, type GatewayRoutingResolution, type AiProviderProfileRecord, type AiProfileCapability,
  type TenantGatewayContext } from '@rental-os/platform-server/ai-gateway';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { PrismaProviderProfileRepository, parseAiProviderProfileRecord } from '../runtime/provider-profile.repository';
import { AiScopeRepository } from '../runtime/ai-scope.repository';
import { createPublicTenantTaskGateway } from '../public-tenant-gateway';
import { PrismaTextCapabilityEvidenceReader, type TextProbeEvidenceDatabase } from '../configuration/text-capability-evidence.reader';
import { textProbeConfiguration, textProbeIntent, textProbeCommandSchema, textProbeDescriptorSchema,
  textProbeObservationSchema, textProbeEvidenceHash, probeUsageSchema, TEXT_PROBE_TTL_MS, TEXT_PROBE_METHOD, textDigest,
  type TextProbeDescriptor } from '../runtime/text-capability-probe';
import { checkedAccountingCall } from '../runtime/budget/prisma-gateway-accounting-facts';
import { readStoredTenantModelConfiguration } from '../runtime/tenant-model-config.repository';
import { tenantModelMode, tenantModelServiceEnabled } from '../runtime/model-config-compatibility';
import { listCapabilityEvidence } from '../configuration/provider-capability-evidence';
import { denied, unavailable, tenant, type BoundAuthority, type SceneInput, type Tx } from './scene';

type Db = TextProbeEvidenceDatabase & Pick<PrismaClient, 'aiProviderProfile' | 'aiProviderCapabilityEvidence' | 'aiScope'
  | 'aiTenantModelConfiguration' | 'aiTextCapabilityReceipt'>;
type Hooks = NonNullable<Parameters<typeof createPublicTenantTaskGateway>[0]['diagnostic']>;
type Selection = Parameters<typeof createPublicTenantTaskGateway>[0]['selection'];
const checked = (profile: AiProviderProfileRecord, owner: string) => {
  if (!profile.enabled || profile.disabledAt || profile.scopeId !== owner || !profile.allowedCapabilities.includes('text'))
    throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  return profile;
};

export class WorkCenterDiagnostic extends PrismaTextCapabilityEvidenceReader {
  constructor(private readonly store: Db, private readonly authority: BoundAuthority, private readonly selection: Selection,
    private readonly transport: 'node_https' | 'mock', clock: () => Date) { super(store, clock); }

  async choose(operationId: string): Promise<{ phase: Awaited<ReturnType<AiScopeRepository['resolveRoutingScopes']>>;
    profile: AiProviderProfileRecord; command: SceneInput['command']; configuration: SceneInput['configuration'];
    selection: Awaited<ReturnType<Selection['selectionForInvocation']>> }> {
    const context = await this.authority.identities.resolve(), { tenantId, ownerId: actorId } = tenant(context);
    const selection = await this.selection.selectionForInvocation({ tenantId, actorId });
    // Platform-priced calls require an independently reviewed price and a bound
    // for this invocation. The public host currently publishes only BYOK calls.
    if (selection.mode !== 'tenant_managed') throw unavailable();
    const scopes = await new AiScopeRepository(this.store, this.authority.identities, this.clock).resolveRoutingScopes(selection.mode);
    if (scopes.consumerScope.kind !== 'TENANT' || scopes.consumerScope.tenantId !== tenantId) throw denied();
    const profile = await new PrismaProviderProfileRepository(this.store).get(scopes.configurationScope, 'default');
    if (!profile || profile.serviceMode !== selection.mode || profile.configRevision !== selection.revision)
      throw unavailable();
    checked(profile, scopes.configurationScope.id);
    const command = { ...textProbeCommandSchema.parse({ operationId, profileKey: profile.profileKey,
      profileFingerprint: capabilityProfileFingerprint(profile), capability: 'text' }), capability: 'text' as const };
    const configuration = textProbeConfiguration(profile, { kind: 'tenant', tenantId });
    if (configuration.serviceMode !== 'tenant_managed') throw unavailable();
    return { phase: scopes, profile, command, configuration, selection };
  }

  async verifyNative(tx: Tx, tenantId: string, value: SceneInput) {
    const { configuration, command } = value;
    const row = await tx.aiProviderProfile.findFirst({ where: { id: configuration.configId } });
    const selection = await readStoredTenantModelConfiguration(tx, tenantId);
    if (!row || row.id !== configuration.configId || !selection || selection.tenantId !== tenantId || !tenantModelServiceEnabled(selection)
      || tenantModelMode(selection) !== 'tenant_managed' || selection.revision !== configuration.configRevision) throw unavailable();
    const scope = await tx.aiScope.findFirst({ where: { id: row.scopeId } }), profile = parseAiProviderProfileRecord(row);
    if (!scope || scope.kind !== profile.scopeKind || scope.workspaceId !== null
      || scope.kind !== 'TENANT' || scope.tenantId !== tenantId || profile.role !== 'DEFAULT'
      || hash(textProbeConfiguration(checked(profile, scope.id), { kind: 'tenant', tenantId })) !== hash(configuration)
      || profile.profileKey !== command.profileKey || capabilityProfileFingerprint(profile) !== command.profileFingerprint) throw unavailable();
  }

  routing(input: SceneInput) {
    return async (caller: TenantGatewayContext, required: readonly AiProfileCapability[]): Promise<GatewayRoutingResolution> => {
      const current = await this.choose(input.command.operationId), who = tenant(current.phase.context);
      if (caller.scopeKind !== 'TENANT' || who.tenantId !== caller.tenantId || who.ownerId !== caller.actorId
        || required.length !== 1 || required[0] !== 'text' || hash(current.configuration) !== hash(input.configuration)
        || hash(current.command) !== hash(input.command)) throw denied();
      const challenge = textProbeIntent(input.command.operationId, current.phase.consumerScope.id, 'text');
      return { context: current.phase.context, consumerScope: current.phase.consumerScope, route: {
        profile: current.profile, scope: current.phase.configurationScope, role: current.profile.role,
        preflight: { allowed: false, required: ['text'], missing: ['text'], stale: [] },
        probe: { purpose: 'capability_text_probe', operationId: input.command.operationId,
          profileFingerprint: input.command.profileFingerprint, intentHash: challenge.intentHash }
      }, selection: current.selection, scene: 'chat', requiredCapabilities: ['text'] };
    };
  }

  hooks(input: SceneInput): Hooks {
    const resolve = this.routing(input);
    return { resolve, async authorizeDispatch(context, request, route, mode, signal) {
      if (!('scopeKind' in context) || context.scopeKind !== 'TENANT' || mode !== 'invoke' || signal?.aborted) throw denied();
      const selected = await resolve(context, ['text']);
      const challenge = textProbeIntent(input.command.operationId, selected.consumerScope.id, 'text');
      const prepared = prepareGatewayTextIntent(challenge.intent, { sceneCode: challenge.intent.sceneCode, maxOutputTokens: 32 }, 'invoke');
      if (hash(selected.route) !== hash(route) || hash(request) !== hash({ ...prepared.request, model: selected.route.profile.model })
        || gatewayRoutingBinding(await resolve(context, ['text'])) !== gatewayRoutingBinding(selected)) throw denied();
    }, recordPreparation: async (tx, invocation, context) => {
      const challenge = textProbeIntent(input.command.operationId, invocation.scopeId, 'text');
      if (invocation.callId !== challenge.intent.requestId || invocation.intentHash !== challenge.intentHash
        || invocation.configurationHash !== hash(input.configuration) || invocation.actorId !== context.actorId
        || invocation.priceVersion !== input.priceVersion) throw denied();
      await this.verifyNative(tx, context.tenantId, input);
      await this.begin(tx, { command: input.command, context, scopeId: invocation.scopeId, profileId: input.configuration.configId,
        methodVersion: TEXT_PROBE_METHOD, callId: invocation.callId, intentHash: challenge.intentHash, challengeHash: challenge.challengeHash,
        configuration: { ...input.configuration }, configurationHash: invocation.configurationHash,
        profileFingerprint: input.command.profileFingerprint, stepId: invocation.stepId, runId: invocation.runId });
    }, observation: { record: observation => this.observeOriginal(input, observation) } };
  }

  async terminalEvidence(db: Omit<TextProbeEvidenceDatabase, '$transaction'>, source: {
    receiptId: string; callId: string; stepId: string; runId: string; scopeId: string; tenantId: string; ownerId: string;
    check: 'verified' | 'mismatch' | 'unverified';
  }) {
    const { receiptId, callId, stepId, runId, scopeId, tenantId, ownerId, check } = source;
    const row = await this.readFrom(db, receiptId);
    if (!row?.observation || row.descriptor.callId !== callId || row.descriptor.stepId !== stepId || row.descriptor.runId !== runId
      || row.descriptor.scopeId !== scopeId || hash(row.descriptor.context) !== hash({ scopeKind: 'TENANT', tenantId, actorId: ownerId })
      || !await this.original(db, row, row.observation, true)) throw unavailable();
    const observation = row.observation;
    if (check === 'verified' && (observation.transport !== 'node_https' || !observation.matched
      || observation.responseHash !== textDigest(textProbeIntent(row.descriptor.command.operationId, scopeId, 'text').expected))
      || check === 'mismatch' && observation.matched || check === 'unverified' && observation.transport !== 'mock') throw unavailable();
    return textProbeEvidenceHash(row);
  }

  async begin(tx: Tx, descriptor: TextProbeDescriptor) {
    const parsed = textProbeDescriptorSchema.parse(descriptor), descriptorHash = hash(parsed);
    const prior = await tx.aiTextCapabilityReceipt.findFirst({ where: { scopeId: parsed.scopeId, operationId: parsed.command.operationId } });
    if (prior) {
      if (prior.descriptorHash !== descriptorHash || prior.scopeId !== parsed.scopeId || prior.profileId !== parsed.profileId) throw unavailable();
      return;
    }
    const id = randomUUID();
    await tx.aiTextCapabilityReceipt.create({ data: { id, scopeId: parsed.scopeId, profileId: parsed.profileId,
      operationId: parsed.command.operationId, descriptor: JSON.parse(JSON.stringify(parsed)), descriptorHash } });
  }

  private async observeOriginal(input: SceneInput, value: GatewayInvocationObservation) {
    const call = checkedAccountingCall(value.call), row = await this.find(call.binding.scope.id, input.command.operationId);
    if (!row || call.binding.scope.kind !== 'TENANT' || hash(row.descriptor.context) !== hash(call.context)
      || row.descriptor.callId !== call.request.callId || row.descriptor.intentHash !== call.request.intentHash
      || row.descriptor.profileId !== call.binding.profileId || hash(input.configuration) !== row.descriptor.configurationHash
      || capabilityProfileFingerprint(value.route.profile) !== row.descriptor.profileFingerprint || value.delivery?.mode !== 'invoke') throw unavailable();
    const challenge = textProbeIntent(input.command.operationId, row.descriptor.scopeId, 'text'), now = this.clock();
    const usage = probeUsageSchema.safeParse(value.result.usage);
    const observation = textProbeObservationSchema.parse({ admissionId: call.binding.id, dispatchId: call.binding.dispatchId,
      requestHash: call.binding.requestHash, reservationId: value.reservationId, transport: this.transport, responseHash: textDigest(value.result.text),
      matched: value.result.text === challenge.expected, usage: usage.success ? usage.data : null,
      checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TEXT_PROBE_TTL_MS).toISOString() });
    await this.store.$transaction(async tx => {
      await this.authority.principalOn(tx);
      if (!await this.original(tx, row, observation, false)) throw unavailable();
      if ((await tx.aiTextCapabilityReceipt.updateMany({ where: { id: row.id, descriptorHash: row.descriptorHash, observationHash: null },
        data: { observation: JSON.parse(JSON.stringify(observation)), observationHash: hash(observation) } })).count !== 1) throw unavailable();
      await this.authority.principalOn(tx);
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }

  async publish(tx: Tx, scopeId: string, input: SceneInput, tenantId: string): Promise<{
    check: 'verified' | 'mismatch' | 'unverified'; receiptId: string | null;
  }> {
    const source = await tx.aiTextCapabilityReceipt.findFirst({ where: { scopeId, operationId: input.command.operationId } });
    const row = source && await this.readFrom(tx, source.id);
    const observation = row?.observation;
    if (!row || !observation?.usage || Date.parse(observation.expiresAt) <= this.clock().getTime()) return { check: 'unverified' as const, receiptId: null };
    if (!await this.original(tx, row, observation, true)) throw unavailable();
    if (!observation.matched) return { check: 'mismatch' as const, receiptId: row.id };
    if (observation.transport !== 'node_https' || this.transport !== 'node_https') return { check: 'unverified' as const, receiptId: row.id };
    const challenge = textProbeIntent(input.command.operationId, scopeId, 'text');
    if (observation.responseHash !== textDigest(challenge.expected)) throw unavailable();
    await this.verifyNative(tx, tenantId, input);
    const profile = await tx.aiProviderProfile.findFirst({ where: { id: row.descriptor.profileId } });
    if (!profile || profile.id !== input.configuration.configId) throw unavailable();
    const current = parseAiProviderProfileRecord(profile);
    const [previous] = (await listCapabilityEvidence(tx, current)).filter(value => value.capability === 'text');
    const checkedAt = new Date(observation.checkedAt);
    if (previous && previous.observedRevision > current.configRevision) throw unavailable();
    if (previous?.observedRevision === current.configRevision && previous.checkedAt >= checkedAt) return { check: 'verified' as const, receiptId: row.id };
    const key = { profileId: current.id, capability: 'text' } as const;
    const data = { ...key, scopeId: current.scopeId, scopeKind: current.scopeKind, status: 'supported', source: 'connection_test',
      observedRevision: current.configRevision, checkedAt, expiresAt: new Date(observation.expiresAt), evidenceHash: textProbeEvidenceHash(row),
      details: { receiptId: row.id, verification: { evidence: 'live', methodVersion: TEXT_PROBE_METHOD, capability: 'text',
        profileFingerprint: row.descriptor.profileFingerprint } } };
    await tx.aiProviderCapabilityEvidence.upsert({ where: { profileId_capability: key }, create: { id: randomUUID(), ...data }, update: data });
    return { check: 'verified' as const, receiptId: row.id };
  }
}
