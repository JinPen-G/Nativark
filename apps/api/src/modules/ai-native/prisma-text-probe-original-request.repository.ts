import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { TenantModelConfigurationAuthority } from './tenant-model-config.authority';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import type { AuthService } from '../auth/auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { TextCapabilityProbeApplication } from './text-capability-probe.application';
import type { TextCapabilityProbeOriginalInputSource } from './text-capability-probe-task-producer.composition';
import { composeTextCapabilityProbeTaskProducer } from './text-capability-probe-task-producer.composition';
import { PrismaTaskPlanPolicyRepository } from './runner/prisma-task-plan-policy.repository';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { textProbeCommandSchema, textProbeCapability, TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } from './text-capability-probe';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';

const version = 'text-probe-original-1';
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const request = z.object({ requestKey: id.max(128), command: textProbeCommandSchema }).strict();
const payload = z.object({ command: textProbeCommandSchema, registrationRef: id.max(191), priceVersion: id.max(64),
  limits: aiTaskRunnerLimitsSchema, preparationHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
type Row = Prisma.AiTaskOriginalRequestGetPayload<{}>;
type Db = Pick<PrismaClient, '$transaction' | 'aiTaskOriginalRequest' | 'aiScope' | 'aiTask' | 'aiTaskPlanPolicy'>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const identity = (value: Record<string, unknown>) => {
  const { requestId: _id, authorizedAt: _at, ...rest } = value;
  return requestFingerprint(rest);
};

/** A failed commit acknowledgement is not evidence that nothing was stored.
 * Re-read the SAME request key; never generate a replacement operation ID. */
export class TextProbeOriginalRequestUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/** Dedicated internal contract in the existing original-request table. No
 * credentials, arbitrary prompt, financial ledger, policy seed or new task
 * state machine. Current real configuration/Guard and persisted plan policy
 * are required on publication AND every read. */
export class PrismaTextProbeOriginalRequestRepository implements TextCapabilityProbeOriginalInputSource {
  private readonly sceneVersion: string;
  private readonly priceVersion: string;
  constructor(private readonly db: Db, private readonly input: {
    scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
    policy: Pick<PrismaTaskPlanPolicyRepository, 'read'>;
    probe: Pick<TextCapabilityProbeApplication, 'prepareCurrent'>;
    /** Only historical reads use this real current management authority. A
     * missing port keeps history closed, never substitutes old authorization. */
    management?: Pick<TenantModelConfigurationAuthority, 'authorize'>;
    /** Trusted server composition, not fields accepted from an HTTP body.
     * The existing Gateway pricing port must validate this version at execution. */
    sceneVersion: string; priceVersion: string;
  }, private readonly clock: () => Date = () => new Date()) {
    this.sceneVersion = id.max(64).parse(input.sceneVersion);
    this.priceVersion = id.max(64).parse(input.priceVersion);
    if ([db?.$transaction, db?.aiTaskOriginalRequest?.findFirst, input.scopes?.resolveCurrent,
      input.policy?.read, input.probe?.prepareCurrent].some(method => typeof method !== 'function')) throw unavailable();
  }
  private async access() {
    const current = structuredClone(await this.input.scopes.resolveCurrent());
    const access = aiTaskAccessFromContext(current.context, 'text-probe-original', this.clock());
    // Configuration plan-policy management is operator-only; no staff or
    // platform identity is invented to bypass its existing Guard.
    if (access.actorKind !== 'USER' || access.audience !== 'OPERATOR' || access.scope.kind !== 'WORKSPACE'
      || current.scope.kind !== 'WORKSPACE' || access.scope.tenantId !== current.scope.tenantId
      || access.scope.workspaceId !== current.scope.workspaceId) throw denied();
    return { context: current.context, owner: { scopeId: current.scope.id, audience: access.audience,
      ownerKind: access.actorKind, ownerId: access.actorId }, binding: identity(current.context as unknown as Record<string, unknown>) };
  }
  private async authorized(command: z.infer<typeof textProbeCommandSchema>) {
    const before = await this.access();
    const preparation = structuredClone(await this.input.probe.prepareCurrent(structuredClone(command)));
    const policy = structuredClone(await this.input.policy.read());
    if (policy.state !== 'configured' || !policy.enabled || !Number.isFinite(Date.parse(policy.expiresAt))
      || Date.parse(policy.expiresAt) <= this.clock().getTime()) throw unavailable();
    const row = await this.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: before.owner.scopeId,
      sceneCode: TEXT_PROBE_SCENE, sceneVersion: this.sceneVersion } });
    if (!row || row.scopeId !== before.owner.scopeId || row.sceneCode !== TEXT_PROBE_SCENE || row.sceneVersion !== this.sceneVersion
      || !row.enabled || row.revision !== policy.revision || row.expiresAt.toISOString() !== policy.expiresAt
      || requestFingerprint(row.limits) !== requestFingerprint(policy.limits)
      || requestFingerprint(row.allowedTools) !== requestFingerprint([{ code: TEXT_CAPABILITY_PROBE_TOOL, version: AI_TOOL_DRAFT_VERSION }])) throw conflict();
    const after = await this.access();
    if (before.binding !== after.binding || requestFingerprint(before.owner) !== requestFingerprint(after.owner)) throw denied();
    return { ...after, policy, preparationHash: requestFingerprint(preparation), policyHash: requestFingerprint(policy) };
  }
  private hash(row: Pick<Row, 'scopeId' | 'audience' | 'ownerKind' | 'ownerId' | 'sceneVersion' | 'requestKey' | 'revision' | 'policyRevision' | 'policyHash' | 'authorizationBindingHash'> & { payload: unknown }) {
    return requestFingerprint({ version, sceneCode: TEXT_PROBE_SCENE, ...row });
  }
  private async checked(row: Row) {
    const value = payload.parse(structuredClone(row.payload));
    const access = await this.authorized(value.command);
    if (Object.entries(access.owner).some(([key, expected]) => row[key as keyof Row] !== expected)
      || row.contractVersion !== version || row.sceneCode !== TEXT_PROBE_SCENE || row.sceneVersion !== this.sceneVersion
      || row.status !== 'STORED' || row.previousRequestId !== null || row.revision !== 1
      || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt.getTime() <= this.clock().getTime()
      || row.authorizationBindingHash !== access.binding) throw denied();
    if (row.policyRevision !== access.policy.revision || row.policyHash !== access.policyHash
      || value.priceVersion !== this.priceVersion || value.preparationHash !== access.preparationHash
      || requestFingerprint(value.limits) !== requestFingerprint(access.policy.limits)) throw conflict();
    const binding = { ...access.owner, sceneVersion: row.sceneVersion, requestKey: row.requestKey, revision: row.revision,
      policyRevision: row.policyRevision, policyHash: row.policyHash, authorizationBindingHash: row.authorizationBindingHash, payload: value };
    if (row.contentHash !== this.hash(binding)) throw unavailable();
    return { context: access.context, sceneCode: TEXT_PROBE_SCENE as 'ai.capability.text', sceneVersion: row.sceneVersion,
      inputRef: row.id, inputRevision: row.revision, inputHash: row.contentHash, command: structuredClone(value.command),
      registrationRef: value.registrationRef, priceVersion: value.priceVersion, limits: structuredClone(value.limits) };
  }
  async read(inputRef: string) {
    if (!id.max(36).safeParse(inputRef).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await this.access();
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...before.owner, id: inputRef, contractVersion: version, sceneCode: TEXT_PROBE_SCENE } });
    if (!row || row.id !== inputRef) throw unavailable();
    return this.checked(row);
  }
  private async historicalAccess() {
    if (typeof this.input.management?.authorize !== 'function') throw unavailable();
    const before = await this.access(), context = before.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw denied();
    await this.input.management.authorize({ actorId: context.actor.userId, tenantId: context.scope.tenantId,
      workspaceId: context.scope.workspaceId }, 'manage');
    const after = await this.access();
    if (after.binding !== before.binding || requestFingerprint(after.owner) !== requestFingerprint(before.owner)) throw denied();
    return after;
  }
  /** Immutable original locator only, not permission to create or execute. Past
   * policy/config hashes are integrity evidence, never today's authorization. */
  async readHistoricalOriginal(requestKey: string) {
    if (!id.max(128).safeParse(requestKey).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await this.historicalAccess();
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...before.owner, requestKey,
      contractVersion: version, sceneCode: TEXT_PROBE_SCENE } });
    const after = await this.historicalAccess();
    if (after.binding !== before.binding || requestFingerprint(after.owner) !== requestFingerprint(before.owner)) throw denied();
    if (!row) return null;
    const value = payload.parse(structuredClone(row.payload));
    if (Object.entries(after.owner).some(([key, expected]) => row[key as keyof Row] !== expected)
      || row.requestKey !== requestKey || row.contractVersion !== version || row.sceneCode !== TEXT_PROBE_SCENE
      || !id.max(64).safeParse(row.sceneVersion).success || row.status !== 'STORED' || row.revision !== 1
      || row.previousRequestId !== null || !Number.isFinite(row.expiresAt.getTime())) throw unavailable();
    const binding = { ...after.owner, sceneVersion: row.sceneVersion, requestKey: row.requestKey, revision: row.revision,
      policyRevision: row.policyRevision, policyHash: row.policyHash, authorizationBindingHash: row.authorizationBindingHash, payload: value };
    if (row.contentHash !== this.hash(binding)) throw unavailable();
    return { context: after.context, owner: after.owner, sceneVersion: row.sceneVersion,
      inputRef: row.id, inputRevision: row.revision, inputHash: row.contentHash, expiresAt: row.expiresAt.toISOString(),
      command: structuredClone(value.command), preparationHash: value.preparationHash };
  }
  async readOriginal(requestKey: string) {
    if (!id.max(128).safeParse(requestKey).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const access = await this.access();
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...access.owner, requestKey, contractVersion: version, sceneCode: TEXT_PROBE_SCENE } });
    if (!row) return { state: 'not_found' as const };
    if (row.requestKey !== requestKey) throw conflict();
    const original = await this.checked(row);
    return { state: 'stored' as const, inputRef: original.inputRef, inputHash: original.inputHash };
  }
  async readOriginalCapability(requestKey: string) {
    if (!id.max(128).safeParse(requestKey).success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const access = await this.access();
    const row = await this.db.aiTaskOriginalRequest.findFirst({ where: { ...access.owner, requestKey,
      contractVersion: version, sceneCode: TEXT_PROBE_SCENE } });
    if (!row || row.requestKey !== requestKey) throw unavailable();
    const original = await this.checked(row);
    if ((await this.access()).binding !== access.binding) throw denied();
    return textProbeCapability(original.command);
  }
  async publish(value: unknown) {
    const parsed = request.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, access = await this.authorized(command.command);
    const storedPayload = payload.parse({ command: command.command, registrationRef: `text-probe:${command.command.operationId}`,
      priceVersion: this.priceVersion, limits: access.policy.limits, preparationHash: access.preparationHash });
    const binding = { ...access.owner, sceneVersion: this.sceneVersion, requestKey: command.requestKey, revision: 1,
      policyRevision: access.policy.revision, policyHash: access.policyHash, authorizationBindingHash: access.binding, payload: storedPayload };
    const contentHash = this.hash(binding);
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${access.owner.scopeId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${access.owner.scopeId} AND sceneCode = ${TEXT_PROBE_SCENE} AND sceneVersion = ${this.sceneVersion} FOR UPDATE`);
        const locked = await tx.aiTaskPlanPolicy.findFirst({ where: { scopeId: access.owner.scopeId, sceneCode: TEXT_PROBE_SCENE, sceneVersion: this.sceneVersion } });
        if (!locked || !locked.enabled || locked.revision !== access.policy.revision || locked.expiresAt.toISOString() !== access.policy.expiresAt
          || locked.scopeId !== access.owner.scopeId || locked.sceneCode !== TEXT_PROBE_SCENE || locked.sceneVersion !== this.sceneVersion
          || requestFingerprint(locked.limits) !== requestFingerprint(access.policy.limits)
          || requestFingerprint(locked.allowedTools) !== requestFingerprint([{ code: TEXT_CAPABILITY_PROBE_TOOL, version: AI_TOOL_DRAFT_VERSION }])) throw conflict();
        const again = await this.authorized(command.command);
        if (again.binding !== access.binding || requestFingerprint(again.owner) !== requestFingerprint(access.owner)) throw denied();
        if (again.policyHash !== access.policyHash || again.preparationHash !== access.preparationHash) throw conflict();
        const existing = await tx.aiTaskOriginalRequest.findFirst({ where: { ...access.owner, requestKey: command.requestKey } });
        if (existing) {
          if (existing.contentHash !== contentHash || existing.contractVersion !== version || existing.status !== 'STORED'
            || existing.sceneCode !== TEXT_PROBE_SCENE || existing.sceneVersion !== this.sceneVersion
            || existing.requestKey !== command.requestKey || existing.revision !== 1 || existing.previousRequestId !== null
            || existing.policyRevision !== binding.policyRevision || existing.policyHash !== binding.policyHash
            || existing.authorizationBindingHash !== binding.authorizationBindingHash
            || requestFingerprint(existing.payload) !== requestFingerprint(storedPayload)
            || Object.entries(access.owner).some(([key, expected]) => existing[key as keyof Row] !== expected)
            || existing.expiresAt.getTime() <= this.clock().getTime()) throw conflict();
          return { state: 'stored' as const, inputRef: existing.id, inputHash: contentHash, replayed: true };
        }
        const row = await tx.aiTaskOriginalRequest.create({ data: { id: randomUUID(), ...binding,
          payload: storedPayload as Prisma.InputJsonValue, contractVersion: version, sceneCode: TEXT_PROBE_SCENE,
          contentHash, previousRequestId: null, status: 'STORED', expiresAt: new Date(access.policy.expiresAt) } });
        return { state: 'stored' as const, inputRef: row.id, inputHash: contentHash, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new TextProbeOriginalRequestUnknownError();
    }
  }
}

/** Explicit server assembly only: persistence -> original input -> the existing
 * atomic task/run producer. Mounting it does not execute, poll or dispatch. */
export function composePersistedTextProbeTaskProducer(db: Db,
  input: ConstructorParameters<typeof PrismaTextProbeOriginalRequestRepository>[1], clock?: () => Date) {
  const originals = new PrismaTextProbeOriginalRequestRepository(db, input, clock);
  const producer = composeTextCapabilityProbeTaskProducer({ db, source: originals, clock });
  return Object.freeze({ originals, ...producer });
}

/** Production dependency assembly using the original Auth/current credential,
 * Scope repository and configuration Guard. No permissive authority fallback. */
export function composeAuthorizedTextProbeTaskProducer(db: Db, input: {
  auth: Pick<AuthService, 'resolveAccessContext'>; credentials: AiTaskCredentialSource;
  guard: Pick<ApiAuthGuard, 'canActivate'>; probe: Pick<TextCapabilityProbeApplication, 'prepareCurrent'>;
  sceneVersion: string; priceVersion: string; clock?: () => Date;
}) {
  const current = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, input.clock);
  const scopes = new AiScopeRepository(db, current, input.clock);
  const management = new TenantModelConfigurationAuthority(input.guard, input.credentials, current);
  const policy = new PrismaTaskPlanPolicyRepository(db, { auth: input.auth, credentials: input.credentials, guard: input.guard,
    scene: { code: TEXT_PROBE_SCENE, version: input.sceneVersion }, tool: TEXT_CAPABILITY_PROBE_TOOL }, input.clock);
  return composePersistedTextProbeTaskProducer(db, { scopes, policy, probe: input.probe, management,
    sceneVersion: input.sceneVersion, priceVersion: input.priceVersion }, input.clock);
}
