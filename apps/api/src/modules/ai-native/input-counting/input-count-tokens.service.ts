/** The counting operation: same frozen input, current authorization, admitted
 * external count call, immutable receipt. Order is fixed — admission reserve
 * and dispatch happen BEFORE the provider request, so an interrupted count
 * leaves an unknown, never an unaccounted call. There is exactly one attempt
 * per original call id: a replay re-reads the receipt and the reservation by
 * their original keys, and a dispatched-but-unanswered operation stays unknown
 * instead of being re-sent. Nothing here starts the text dispatch, publishes a
 * bound or refunds admission. */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiGatewayIntentDraft, AiUsageAssociationDraft } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { ChatProtocolPolicy, type ChatProtocolOptions, type ModelJsonTransport } from '../chat-completions.adapter';
import { ModelAdapterError, ModelGatewayError } from '../model-gateway.ports';
import { MODEL_RESPONSE_BYTES } from '../model-response-limits';
import { GatewayDeadline } from '../gateway-deadline';
import type { GatewayConnection, GatewayConnectionResolver } from '../routed-model-transport';
import type { AiProviderProfileRecord } from '../provider-profile.ports';
import { capabilityProfileFingerprint } from '../capability-verification';
import { BudgetError, type BudgetAuthorizationSource, type BudgetServiceLike } from './input-count-tokens.ports';
import { PrismaGatewayPricingRecords, GatewayInputBoundNotFoundError, type GatewayPricingRecordDb } from '../budget/prisma-gateway-pricing-records';
import { countTokensSupport, prepareCountTokensMaterial, countTokensMaterialHash, anthropicCountTokensRequest,
  parseCountTokensResponse, postCountTokens, type CountTokensMaterial } from './count-tokens.protocol';
import { countTokensCallId, countTokensSceneCode } from './input-count-tokens.admission';
import { PrismaCountTokensReceipts, countTokensOperationId, countTokensReference,
  CountTokensReceiptNotFoundError,
  type CountTokensReceipt, type CountTokensReceiptDb } from './input-count-tokens.receipt';

const callIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export interface CountTokensFrozenInvocation {
  scopeId: string; actorId: string; context: AiExecutionContext;
  invocation: { id: string; taskId: string; runId: string; stepId: string; actionId: string; callId: string;
    registrationHash: string; intentHash: string; configurationHash: string; priceVersion: string;
    maxOutputTokens: number; sceneCode: string; expiresAt: Date };
  intent: AiGatewayIntentDraft;
  configuration: AiGatewayConfigReferenceDraft;
}
/** Implemented by TaskModelGatewayInputSource: revalidates the persisted frozen
 * input against the invocation's registered hashes without publishing,
 * registering a new call or requiring a worker lease. */
export interface CountTokensFrozenInputSource {
  readFrozenCountingInput(command: Readonly<{ callId?: string; invocationId?: string; scopeId: string; actorId: string }>): Promise<CountTokensFrozenInvocation>;
}
export type CountTokensServiceDb = CountTokensReceiptDb & GatewayPricingRecordDb & Pick<PrismaClient, 'aiScope' | 'aiProviderProfile'>
  & Partial<Pick<PrismaClient, 'aiBudgetReservation'>>;
export interface InputCountTokensDependencies {
  db: CountTokensServiceDb;
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  authorization: BudgetAuthorizationSource & { authorizeObservation?(taskId: string): Promise<AiExecutionContext> };
  budget: BudgetServiceLike;
  frozen: CountTokensFrozenInputSource;
  resolvers: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver };
  transport: ModelJsonTransport;
  policyOptions: ChatProtocolOptions;
  /** Management entries only. Undefined keeps them unavailable while the
   * task-internal entry stays usable for hosts composed without a fixed
   * management scene. */
  sceneCode?: string;
  countingPriceVersion: string;
  /** The formal task-internal permission for the in-task entry: the same
   * transition_task action policy the dispatch of the original call requires.
   * Server-composed; never a caller grant or settings whitelist. */
  taskExecution?: { authorize(taskId: string): Promise<AiExecutionContext> };
  timeoutMs?: number;
  clock?: () => Date;
}
export interface CountTokensAdmissionState {
  reservationId: string; sceneCode: string; unit: 'calls';
  status: 'settled' | 'reserved' | 'released' | 'pending_reconciliation';
}
export type CountTokensResult = {
  state: CountTokensReceipt['state'];
  callId: string; countCallId: string; reference: string; receiptId: string;
  inputTokens?: number; failureCode?: CountTokensReceipt['failureCode'];
  method: 'provider_count_tokens_receipt'; protocol: string; sceneCode: string;
  admission: CountTokensAdmissionState;
  observedAt: string; expiresAt: string; executionPermission: false; textDispatch: 'not_attested';
};
/** Read-path lifecycle evidence: which durable stage the ORIGINAL count key
 * has actually reached. 'claimed_dispatched' means the unique INSERT-won
 * dispatch claim exists; it never proves the provider received the call. */
export type CountTokensLifecycle = 'not_started' | 'reserved' | 'claimed_dispatched'
  | { receiptRecorded: CountTokensReceipt['state'] };
/** Read-path only diagnostics: applicability of the recorded basis for a new
 * publication, and the already-published bound from the original store. */
export type CountTokensDiagnostics = { applicable: boolean;
  bound: { published: boolean; id?: string; maxInputTokens?: number } };

const identity = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};
/** The gate both counting entries must satisfy before any admission exists. */
type CountingGate = { scopeId: string; actorId: string; tenantId: string; workspaceId: string;
  recheck(): Promise<void> };

export class InputCountTokensService {
  private readonly receipts;
  private readonly records;
  private readonly policy;
  private readonly clock;
  private readonly timeoutMs;
  constructor(private readonly dependencies: InputCountTokensDependencies) {
    const input = dependencies;
    if (!input?.db || typeof input.scopes?.resolveCurrent !== 'function' || typeof input.authorization?.authorize !== 'function'
      || !input.budget || ['reserve', 'read', 'dispatch', 'settle', 'markUnknown'].some(name =>
        typeof input.budget[name as keyof BudgetServiceLike] !== 'function')
      || typeof input.frozen?.readFrozenCountingInput !== 'function'
      || !input.resolvers?.platform || typeof input.resolvers.platform.resolve !== 'function'
      || !input.resolvers.tenant || typeof input.resolvers.tenant.resolve !== 'function'
      || !input.transport || typeof input.transport.post !== 'function'
      || !input.policyOptions || typeof input.policyOptions !== 'object' || Array.isArray(input.policyOptions)
      || input.sceneCode !== undefined && !callIdSchema.max(64).safeParse(input.sceneCode).success
      || !callIdSchema.max(64).safeParse(input.countingPriceVersion).success
      || input.taskExecution !== undefined && typeof input.taskExecution.authorize !== 'function'
      || input.clock !== undefined && typeof input.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    this.receipts = new PrismaCountTokensReceipts(input.db);
    this.records = new PrismaGatewayPricingRecords(input.db);
    this.policy = new ChatProtocolPolicy(input.policyOptions);
    this.clock = input.clock ?? (() => new Date());
    this.timeoutMs = input.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) throw new BudgetError('UNAVAILABLE');
  }
  private async current() {
    const current = structuredClone(await this.dependencies.scopes.resolveCurrent());
    const context = current.context;
    if (context.actor.kind !== 'user' || context.audience === 'client' || !['operator', 'staff'].includes(context.audience)
      || context.scope.kind !== 'workspace' || current.scope.kind !== 'WORKSPACE'
      || current.scope.tenantId !== context.scope.tenantId || current.scope.workspaceId !== context.scope.workspaceId)
      throw new BudgetError('FORBIDDEN');
    return { context, scopeId: current.scope.id, tenantId: current.scope.tenantId,
      workspaceId: current.scope.workspaceId, actorId: context.actor.userId };
  }
  /** Command gate: the same settings-manage authority that publishes prices and
   * input bounds, over the original scene policy. */
  private async commandGate() {
    const before = await this.current();
    const columns = aiPersistenceScopeColumns({ kind: 'workspace', tenantId: before.tenantId, workspaceId: before.workspaceId });
    const scope = structuredClone(await this.dependencies.db.aiScope.findFirst({ where: columns }));
    if (!scope || Object.entries(columns).some(([key, item]) => scope[key as keyof typeof scope] !== item)) throw new BudgetError('FORBIDDEN');
    const resource = { policy: { scopeId: scope.id, scopeKind: 'WORKSPACE', sceneCode: this.dependencies.sceneCode } };
    const authorize = async (context: AiExecutionContext) => {
      const grant = structuredClone(await this.dependencies.authorization.authorize('settings_write', structuredClone(context), resource));
      const now = this.clock().getTime();
      if (!grant || typeof grant.authorizationKey !== 'string'
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(grant.authorizationKey)
        || !Number.isFinite(now) || !(grant.expiresAt instanceof Date)
        || !Number.isFinite(grant.expiresAt.getTime()) || grant.expiresAt.getTime() <= now) throw new BudgetError('FORBIDDEN');
      return grant;
    };
    const grant = await authorize(before.context);
    const recheck = async () => {
      const after = await this.current();
      if (after.scopeId !== before.scopeId || identity(after.context) !== identity(before.context)
        || (await authorize(after.context)).authorizationKey !== grant.authorizationKey) throw new BudgetError('FORBIDDEN');
    };
    await recheck();
    return { ...before, scopeId: scope.id, recheck };
  }
  /** The in-task gate: the ORIGINAL invocation row (persisted at registration,
   * before any reserve) plus the same transition_task permission that may
   * dispatch that call, re-checked after the frozen-input read and again
   * before the provider request. No settings authority is consulted or
   * required, and no other task's invocation can pass. */
  private async taskGate(command: { callId?: string; invocationId?: string }): Promise<CountingGate> {
    const current = await this.current();
    const taskExecution = this.dependencies.taskExecution;
    if (!taskExecution) throw new BudgetError('UNAVAILABLE');
    const invocation = command.invocationId !== undefined
      ? await this.dependencies.db.aiGatewayInvocation.findUnique({ where: { id: command.invocationId } })
      : await this.dependencies.db.aiGatewayInvocation.findUnique({
        where: { scopeId_callId: { scopeId: current.scopeId, callId: command.callId! } } });
    if (!invocation || invocation.scopeId !== current.scopeId || invocation.actorId !== current.actorId
      || command.callId !== undefined && invocation.callId !== command.callId
      || command.invocationId !== undefined && invocation.id !== command.invocationId
      || !isGatewayConfig(invocation.configuration)
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
    const before = structuredClone(await taskExecution.authorize(invocation.taskId));
    if (identity(before) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const after = structuredClone(await taskExecution.authorize(invocation.taskId));
    if (identity(after) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    return { scopeId: current.scopeId, actorId: current.actorId, tenantId: current.tenantId,
      workspaceId: current.workspaceId, recheck: async () => {
        const latest = await this.current();
        if (latest.scopeId !== current.scopeId || identity(latest.context) !== identity(current.context)
          || identity(await taskExecution.authorize(invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
      } };
  }
  private association(frozen: CountTokensFrozenInvocation, countCallId: string): AiUsageAssociationDraft {
    return { requestId: countCallId, runId: frozen.invocation.runId, stepId: frozen.invocation.stepId,
      actionId: frozen.invocation.actionId, idempotencyKey: countCallId,
      scope: structuredClone(frozen.context.scope), config: structuredClone(frozen.configuration),
      priceVersion: this.dependencies.countingPriceVersion };
  }
  private async profile(configuration: AiGatewayConfigReferenceDraft, tenantId: string): Promise<AiProviderProfileRecord> {
    if (!('tenantId' in configuration) || configuration.tenantId !== tenantId) throw new BudgetError('FORBIDDEN');
    const ownerColumns = aiPersistenceScopeColumns(configuration.configurationScope);
    const owner = structuredClone(await this.dependencies.db.aiScope.findFirst({ where: ownerColumns }));
    const row = structuredClone(await this.dependencies.db.aiProviderProfile.findFirst({ where: { id: configuration.configId } }));
    if (!owner || Object.entries(ownerColumns).some(([key, item]) => owner[key as keyof typeof owner] !== item)
      || !row || row.id !== configuration.configId || row.scopeId !== owner.id || row.scopeKind !== owner.kind
      || row.configRevision !== configuration.configRevision || row.provider !== configuration.provider
      || row.protocol !== configuration.protocol || row.model !== configuration.model
      || row.credentialRef !== configuration.credentialRef || row.serviceMode !== configuration.serviceMode
      || !row.enabled || row.disabledAt) throw new BudgetError('FORBIDDEN');
    return { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind, profileKey: row.profileKey, role: row.role,
      serviceMode: row.serviceMode, protocol: row.protocol, provider: row.provider, model: row.model,
      credentialRef: row.credentialRef, configRevision: row.configRevision, enabled: row.enabled,
      allowedCapabilities: row.allowedCapabilities as AiProviderProfileRecord['allowedCapabilities'], disabledAt: row.disabledAt };
  }
  private summary(receipt: CountTokensReceipt, admission: CountTokensAdmissionState): CountTokensResult {
    const receiptId = countTokensOperationId(receipt);
    return { state: receipt.state, callId: receipt.callId, countCallId: receipt.countCallId,
      reference: countTokensReference(receiptId), receiptId,
      ...(receipt.inputTokens !== undefined ? { inputTokens: receipt.inputTokens } : {}),
      ...(receipt.failureCode !== undefined ? { failureCode: receipt.failureCode } : {}),
      method: receipt.method, protocol: receipt.protocol, sceneCode: receipt.sceneCode,
      admission, observedAt: receipt.observedAt, expiresAt: receipt.expiresAt,
      // Counting attests only its own operation, including on historical reads.
      // It cannot prove that the original generation has never been dispatched.
      executionPermission: false as const, textDispatch: 'not_attested' as const };
  }
  /** Settle (or mark unknown) the admission by original keys; a failed
   * accounting write keeps the receipt and reports a pending admission instead
   * of pretending the operation never happened. A replay first observes the
   * terminal state, so re-running count() returns a stable summary. */
  private async accountAdmission(receipt: CountTokensReceipt, association: AiUsageAssociationDraft,
    life: GatewayDeadline): Promise<CountTokensAdmissionState> {
    const admission = (status: CountTokensAdmissionState['status']): CountTokensAdmissionState =>
      ({ reservationId: receipt.admission.reservationId, sceneCode: receipt.admission.sceneCode, unit: 'calls', status });
    // This read also proves current task policy. An unavailable authority is
    // not permission to return an old receipt; all read failures propagate.
    const current = await life.wait(() => this.dependencies.budget.read(receipt.admission.reservationId, association));
    if (!current) return admission('pending_reconciliation');
    if (receipt.state === 'unknown') {
      if (current.status !== 'pending_reconciliation') {
        try {
          await life.wait(() => this.dependencies.budget.markUnknown(receipt.admission.reservationId, association,
            requestFingerprint({ association, phase: 'unknown:count_result_unknown' }), 'count_result_unknown'));
        } catch (error) {
          if (!(error instanceof BudgetError && ['UNAVAILABLE', 'PENDING_RECONCILIATION', 'REVISION_CONFLICT'].includes(error.code))) throw error;
        }
      }
      return admission('pending_reconciliation');
    }
    if (current.status === 'settled' || current.status === 'released') return admission(current.status);
    // Both observed and definite-failure receipts settle the one real call the
    // admission reserved: the external request was made in either case.
    try {
      await life.wait(() => this.dependencies.budget.settle(receipt.admission.reservationId, association,
        requestFingerprint({ association, phase: 'settle:count-tokens' }), countTokensOperationId(receipt)));
    } catch (error) {
      if (!(error instanceof BudgetError && ['UNAVAILABLE', 'PENDING_RECONCILIATION', 'REVISION_CONFLICT'].includes(error.code))) throw error;
      return admission('pending_reconciliation');
    }
    const settled = await life.wait(() => this.dependencies.budget.read(receipt.admission.reservationId, association));
    return admission(settled?.status ?? 'pending_reconciliation');
  }
  async count(value: unknown, signal?: AbortSignal): Promise<CountTokensResult> {
    const parsed = z.object({ callId: callIdSchema }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    if (this.dependencies.sceneCode === undefined) throw new BudgetError('UNAVAILABLE');
    return this.runCounting({ callId: parsed.data.callId }, signal, () => this.commandGate(), true);
  }

  /** The in-task counting entry: the frozen input of ONE registered original
   * call, counted under the same transition_task permission that may dispatch
   * that call. Scene, configuration, input fingerprint and plan basis come
   * from the server-persisted invocation — never a module constant, caller
   * field or model choice. It cannot read other tasks, publish arbitrary
   * bounds or rates, or substitute for the management counting entry. */
  async taskCount(value: unknown, signal?: AbortSignal): Promise<CountTokensResult> {
    const parsed = z.object({ callId: callIdSchema.optional(), invocationId: z.string().min(1).max(36)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional() }).strict()
      .refine(item => (item.callId !== undefined) !== (item.invocationId !== undefined))
      .safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    return this.runCounting(parsed.data, signal, () => this.taskGate(parsed.data), false);
  }

  private async runCounting(command: { callId?: string; invocationId?: string }, signal: AbortSignal | undefined,
    gate: () => Promise<CountingGate>, requireManagementScene: boolean): Promise<CountTokensResult> {
    const life = new GatewayDeadline(this.timeoutMs, signal);
    let originalMayExist = false;
    try {
      const opened = await life.wait(gate);
      const frozen = await life.wait(() => this.dependencies.frozen.readFrozenCountingInput(
        { ...command, scopeId: opened.scopeId, actorId: opened.actorId }));
      if (frozen.scopeId !== opened.scopeId || frozen.actorId !== opened.actorId
        || requireManagementScene && frozen.invocation.sceneCode !== this.dependencies.sceneCode
        || frozen.context.actor.kind !== 'user' || frozen.context.actor.userId !== opened.actorId
        || frozen.context.scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
      const support = countTokensSupport(frozen.configuration.protocol);
      if (!support.supported) throw new BudgetError('UNAVAILABLE');
      const price = await life.wait(() => this.records.price(frozen.scopeId, frozen.invocation.configurationHash, frozen.invocation.priceVersion));
      const now = this.clock().getTime();
      if (Date.parse(price.evidence.validFrom) > now || Date.parse(price.evidence.expiresAt) <= now) throw new BudgetError('UNAVAILABLE');
      const replay = await this.readReplay(frozen, life, () => { originalMayExist = true; });
      if (replay) {
        await life.wait(() => opened.recheck());
        return this.summary(replay.receipt, replay.admission);
      }
      const countCallId = countTokensCallId(frozen.invocation.callId);
      const association = this.association(frozen, countCallId);
      const admissionScene = countTokensSceneCode(frozen.invocation.sceneCode);
      // Serialize the count material BEFORE reserving/dispatching admission:
      // a locally unsupported combination (media part, unregistered structured
      // schema) must never mark the ledger dispatched for an unsent request.
      const material = this.countMaterial(frozen);
      const reservation = await life.wait(() => {
        // The write may commit before its reply is lost. Mark uncertainty at
        // invocation, never only after an acknowledgement has arrived.
        originalMayExist = true;
        return this.dependencies.budget.reserve({ association, callId: countCallId, sceneCode: admissionScene,
          expiresAt: new Date(Math.min(this.clock().getTime() + this.timeoutMs, frozen.invocation.expiresAt.getTime())) });
      });
      const reserved = await life.wait(() => this.dependencies.budget.read(reservation.id, association));
      if (!reserved) throw new BudgetError('PENDING_RECONCILIATION');
      if (reserved.dispatched) {
        // Another attempt may still be producing its immutable receipt. An
        // observer must not insert an 'unknown' receipt ahead of the owner.
        throw new BudgetError('PENDING_RECONCILIATION');
      }
      const scope = frozen.context.scope as { tenantId: string; workspaceId: string };
      await life.wait(() => this.receipts.claimDispatch({ tenantId: scope.tenantId, workspaceId: scope.workspaceId,
        actorId: frozen.actorId, callId: frozen.invocation.callId, reservationId: reservation.id,
        registrationHash: frozen.invocation.registrationHash, intentHash: frozen.invocation.intentHash,
        configurationHash: frozen.invocation.configurationHash, countRequestHash: countTokensMaterialHash(material) }));
      const outcome = await this.performCount(frozen, opened, life, material,
        () => this.dependencies.budget.dispatch(reservation.id, association,
          requestFingerprint({ association, phase: 'dispatch' })));
      const receipt = await life.wait(() => this.persistReceipt(frozen, association, reservation.id, outcome.state,
        outcome.state === 'observed' ? { inputTokens: outcome.inputTokens }
          : outcome.state === 'failed' ? { failureCode: outcome.failureCode } : {}, outcome.requestHash));
      const admission = await this.accountAdmission(receipt, association, life);
      await life.wait(() => opened.recheck());
      return this.summary(receipt, admission);
    } catch (error) {
      // Once an original admission exists (or its receipt is being converged),
      // a later denial/storage failure cannot attest that no effect occurred.
      // Return no old sensitive data and direct the caller to original-key observation.
      if (originalMayExist) throw new BudgetError('PENDING_RECONCILIATION');
      throw error;
    } finally { life.close(); }
  }
  /** Historical observation of one counting receipt under current read
   * authority: the original bound inputs only, never a fresh count, a text
   * dispatch, an admission refund or any ledger mutation. Missing receipts
   * report unavailable; execution shutdown does not erase a legitimately
   * recorded fact. Accepts either the original call id or the original
   * invocation id. */
  async readCountReceipt(value: unknown): Promise<CountTokensResult & { diagnostics: CountTokensDiagnostics;
    lifecycle: CountTokensLifecycle }> {
    const parsed = z.object({ callId: callIdSchema.optional(), invocationId: z.string().min(1).max(36)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional() }).strict().refine(item =>
      (item.callId !== undefined) !== (item.invocationId !== undefined)).safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const current = await this.current();
    const columns = aiPersistenceScopeColumns({ kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId });
    const scope = structuredClone(await this.dependencies.db.aiScope.findFirst({ where: columns }));
    if (!scope || Object.entries(columns).some(([key, item]) => scope[key as keyof typeof scope] !== item)) throw new BudgetError('FORBIDDEN');
    // Receipt first: absence is "no counting record" (unavailable), while a
    // receipt whose invocation is missing or owned by someone else is refused.
    const referenced = parsed.data.invocationId !== undefined
      ? await this.dependencies.db.aiGatewayInvocation.findUnique({ where: { id: parsed.data.invocationId } }) : null;
    if (parsed.data.invocationId !== undefined && (!referenced || referenced.id !== parsed.data.invocationId))
      throw new BudgetError('FORBIDDEN');
    const receipt = await this.receipts.read(countTokensOperationId({ tenantId: current.tenantId,
      workspaceId: current.workspaceId, actorId: current.actorId,
      callId: referenced !== null ? referenced.callId : parsed.data.callId as string }));
    const invocation = referenced ?? (parsed.data.callId !== undefined
      ? await this.dependencies.db.aiGatewayInvocation.findUnique({ where: {
        scopeId_callId: { scopeId: scope.id, callId: parsed.data.callId } } })
      : null);
    if (!invocation || invocation.scopeId !== scope.id || invocation.actorId !== current.actorId
      || parsed.data.callId !== undefined && invocation.callId !== parsed.data.callId) throw new BudgetError('FORBIDDEN');
    if (receipt.invocationId !== invocation.id || receipt.registrationHash !== invocation.registrationHash
      || receipt.intentHash !== invocation.intentHash || receipt.configurationHash !== invocation.configurationHash
      || receipt.priceVersion !== invocation.priceVersion || receipt.sceneCode !== invocation.sceneCode
      || receipt.maxOutputTokens !== invocation.maxOutputTokens
      || receipt.countCallId !== countTokensCallId(invocation.callId)
      || !isGatewayConfig(invocation.configuration)
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
    if (typeof this.dependencies.db.aiBudgetReservation?.findUnique !== 'function') throw new BudgetError('UNAVAILABLE');
    const originalReservation = structuredClone(await this.dependencies.db.aiBudgetReservation.findUnique({
      where: { id: receipt.admission.reservationId }, select: { id: true, scopeId: true, scopeKind: true,
        tenantId: true, workspaceId: true, actorId: true, callId: true, requestId: true, idempotencyKey: true,
        runId: true, stepId: true, actionId: true, sceneCode: true, priceVersion: true, unitKind: true,
        configurationHash: true, configRevision: true } }));
    if (!originalReservation || originalReservation.id !== receipt.admission.reservationId
      || originalReservation.scopeId !== scope.id || originalReservation.scopeKind !== 'WORKSPACE'
      || originalReservation.tenantId !== current.tenantId || originalReservation.workspaceId !== current.workspaceId
      || originalReservation.actorId !== current.actorId || originalReservation.callId !== receipt.countCallId
      || originalReservation.requestId !== receipt.countCallId || originalReservation.idempotencyKey !== receipt.countCallId
      || originalReservation.runId !== invocation.runId || originalReservation.stepId !== invocation.stepId
      || originalReservation.actionId !== invocation.actionId || originalReservation.unitKind !== 'calls'
      || originalReservation.sceneCode !== countTokensSceneCode(invocation.sceneCode)
      || receipt.admission.sceneCode !== originalReservation.sceneCode
      || originalReservation.configurationHash !== invocation.configurationHash
      || originalReservation.configRevision !== invocation.configuration.configRevision
      || typeof originalReservation.priceVersion !== 'string'
      || !callIdSchema.max(64).safeParse(originalReservation.priceVersion).success) throw new BudgetError('FORBIDDEN');
    const association: AiUsageAssociationDraft = { requestId: receipt.countCallId, runId: invocation.runId,
      stepId: invocation.stepId, actionId: invocation.actionId, idempotencyKey: receipt.countCallId,
      scope: { kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId },
      config: invocation.configuration, priceVersion: originalReservation.priceVersion };
    // Read-only admission observation: this entry never settles, marks unknown
    // or releases. Convergence of a lost acknowledgement stays with count()'s
    // original-key replay; here the ledger state is reported exactly as-is.
    const observedAdmission = await this.dependencies.budget.read(receipt.admission.reservationId, association);
    const admission: CountTokensAdmissionState = { reservationId: receipt.admission.reservationId,
      sceneCode: receipt.admission.sceneCode, unit: 'calls',
      status: observedAdmission?.status ?? 'pending_reconciliation' };
    // Lifecycle evidence for the original key: a receipt row is terminal
    // truth for the observation entry; the claim check is only relevant on
    // the receipt-free observe entry (observeCountKey).
    const lifecycle: CountTokensLifecycle = { receiptRecorded: receipt.state };
    // Applicability is advisory: the recorded basis can still ground a new
    // bound publication only while observed and unexpired. The published-bound
    // state is read from the original bound store, never asserted from memory.
    let bound: { published: boolean; id?: string; maxInputTokens?: number } = { published: false };
    try {
      const published = await this.records.bound(scope.id, invocation.id);
      bound = { published: true, id: published.id, maxInputTokens: published.evidence.maxInputTokens };
    } catch (error) {
      if (!(error instanceof GatewayInputBoundNotFoundError)) throw error;
    }
    const diagnostics: CountTokensDiagnostics = { applicable: receipt.state === 'observed'
      && Date.parse(receipt.expiresAt) > this.clock().getTime(), bound };
    // Policy revocation during the bound read must not be hidden by an
    // unchanged identity fingerprint. This remains strictly read-only.
    await this.dependencies.budget.read(receipt.admission.reservationId, association);
    const after = await this.current();
    if (after.scopeId !== current.scopeId || identity(after.context) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    return { ...this.summary(receipt, admission), diagnostics, lifecycle };
  }

  /** Receipt-free original-key observation: which durable stage the count key
   * has reached — not started, admission reserved, dispatch claimed (the
   * unique INSERT winner may have sent), or a terminal receipt state. Strictly
   * read-only; it never claims, sends, settles or releases anything, and a
   * missing receipt is reported as its true stage, never as zero or failure. */
  async observeCountKey(value: unknown): Promise<{ callId: string; countCallId: string; lifecycle: CountTokensLifecycle;
    admission: CountTokensAdmissionState | null; receipt: CountTokensResult | null }> {
    const parsed = z.object({ callId: callIdSchema }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const current = await this.current();
    const columns = aiPersistenceScopeColumns({ kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId });
    const scope = structuredClone(await this.dependencies.db.aiScope.findFirst({ where: columns }));
    if (!scope || Object.entries(columns).some(([key, item]) => scope[key as keyof typeof scope] !== item)) throw new BudgetError('FORBIDDEN');
    const invocation = await this.dependencies.db.aiGatewayInvocation.findUnique({ where: {
      scopeId_callId: { scopeId: scope.id, callId: parsed.data.callId } } });
    if (!invocation || invocation.scopeId !== scope.id || invocation.actorId !== current.actorId
      || invocation.callId !== parsed.data.callId || !isGatewayConfig(invocation.configuration)
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
    const authorizeObservation = this.dependencies.authorization.authorizeObservation?.bind(this.dependencies.authorization);
    if (!authorizeObservation) throw new BudgetError('UNAVAILABLE');
    if (identity(await authorizeObservation(invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const scopeFields = current.context.scope as { tenantId: string; workspaceId: string };
    const receiptId = countTokensOperationId({ tenantId: scopeFields.tenantId, workspaceId: scopeFields.workspaceId,
      actorId: current.actorId, callId: invocation.callId });
    let receipt: CountTokensReceipt | null = null;
    try { receipt = await this.receipts.read(receiptId); } catch (error) {
      if (!(error instanceof CountTokensReceiptNotFoundError)) throw error; }
    if (receipt && (receipt.invocationId !== invocation.id || receipt.registrationHash !== invocation.registrationHash
      || receipt.countCallId !== countTokensCallId(invocation.callId))) throw new BudgetError('FORBIDDEN');
    if (receipt) {
      const { diagnostics: _diagnostics, lifecycle: _lifecycle, ...result } = await this.readCountReceipt({ callId: invocation.callId });
      return { callId: invocation.callId, countCallId: receipt.countCallId,
        lifecycle: { receiptRecorded: receipt.state }, admission: result.admission, receipt: result };
    }
    const claimed = await this.receipts.hasDispatchClaim({ tenantId: scopeFields.tenantId,
      workspaceId: scopeFields.workspaceId, actorId: current.actorId, callId: invocation.callId });
    const countCallId = countTokensCallId(invocation.callId);
    // The admission row is located by its own original key (workspace scope +
    // derived count call id); its current status is reported exactly as stored.
    const admissionRow = typeof this.dependencies.db.aiBudgetReservation?.findUnique === 'function'
      ? structuredClone(await this.dependencies.db.aiBudgetReservation.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: scope.id, scopeKind: 'WORKSPACE', callId: countCallId } },
        select: { id: true, scopeId: true, scopeKind: true, actorId: true, callId: true, sceneCode: true, status: true } }))
      : null;
    if (admissionRow && (admissionRow.scopeId !== scope.id || admissionRow.scopeKind !== 'WORKSPACE'
      || admissionRow.actorId !== current.actorId || admissionRow.callId !== countCallId))
      throw new BudgetError('FORBIDDEN');
    let admission: CountTokensAdmissionState | null = null;
    if (admissionRow) {
      const status: CountTokensAdmissionState['status'] | null = admissionRow.status === 'reserved'
        ? 'reserved' : admissionRow.status === 'settled' ? 'settled'
        : admissionRow.status === 'released' ? 'released'
        : admissionRow.status === 'pending_reconciliation' ? 'pending_reconciliation' : null;
      if (status === null) throw new BudgetError('UNAVAILABLE');
      admission = { reservationId: admissionRow.id, sceneCode: admissionRow.sceneCode, unit: 'calls', status };
    }
    const lifecycle: CountTokensLifecycle = claimed ? 'claimed_dispatched'
      : admissionRow ? 'reserved' : 'not_started';
    if (identity(await authorizeObservation(invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const after = await this.current();
    if (after.scopeId !== current.scopeId || identity(after.context) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    return { callId: invocation.callId, countCallId, lifecycle, admission, receipt: null };
  }

  private async readReplay(frozen: CountTokensFrozenInvocation, life: GatewayDeadline, beforeAccounting: () => void = () => {}) {
    const scope = frozen.context.scope as { tenantId: string; workspaceId: string };
    const receiptId = countTokensOperationId({ tenantId: scope.tenantId, workspaceId: scope.workspaceId,
      actorId: frozen.actorId, callId: frozen.invocation.callId });
    let receipt: CountTokensReceipt;
    try { receipt = await life.wait(() => this.receipts.read(receiptId)); } catch (error) {
      if (error instanceof CountTokensReceiptNotFoundError) return null;
      throw error;
    }
    if (receipt.tenantId !== scope.tenantId || receipt.workspaceId !== scope.workspaceId
      || receipt.actorId !== frozen.actorId || receipt.invocationId !== frozen.invocation.id
      || receipt.registrationHash !== frozen.invocation.registrationHash || receipt.intentHash !== frozen.invocation.intentHash
      || receipt.configurationHash !== frozen.invocation.configurationHash || receipt.priceVersion !== frozen.invocation.priceVersion
      || receipt.maxOutputTokens !== frozen.invocation.maxOutputTokens
      || receipt.countCallId !== countTokensCallId(frozen.invocation.callId)) throw new BudgetError('IDEMPOTENCY_CONFLICT');
    const association = this.association(frozen, receipt.countCallId);
    beforeAccounting();
    const admission = await this.accountAdmission(receipt, association, life);
    return { receipt, admission };
  }
  /** Connection-independent serialization of the frozen input: the exact
   * body the provider will receive. Rejects unsupported combinations before
   * any admission is reserved. */
  private countMaterial(frozen: CountTokensFrozenInvocation): CountTokensMaterial {
    const features = [...new Set(frozen.intent.requiredFeatures.flatMap(feature =>
      feature === 'tools' ? ['tools' as const] : feature === 'structured_output' ? ['structuredOutput' as const] : []))];
    return prepareCountTokensMaterial({ callId: frozen.invocation.callId, model: frozen.configuration.model,
      // Identical text-only conversion to prepareGatewayTextIntent: join a
      // message's text parts into one string; non-text parts refuse outright.
      messages: frozen.intent.messages.map(message => ({ role: message.role,
        content: message.content.map(part => {
          if (part.kind !== 'text') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
          return part.text;
        }).join('') })),
      maxOutputTokens: frozen.invocation.maxOutputTokens, features }, this.policy);
  }

  private async performCount(frozen: CountTokensFrozenInvocation, gate: CountingGate,
    life: GatewayDeadline, material: Readonly<CountTokensMaterial>, dispatch: () => PromiseLike<unknown>): Promise<{ state: 'observed'; inputTokens: number; requestHash: string } | { state: 'failed'; failureCode: 'AUTHENTICATION_FAILED' | 'PROVIDER_REJECTED'; requestHash: string } | { state: 'unknown'; requestHash: string }> {
    const configuration = frozen.configuration;
    const profile = await life.wait(() => this.profile(configuration, gate.tenantId));
    const resolver = configuration.serviceMode === 'platform_managed'
      ? this.dependencies.resolvers.platform : this.dependencies.resolvers.tenant;
    const context = { actorId: gate.actorId, tenantId: gate.tenantId, workspaceId: gate.workspaceId };
    const connection: GatewayConnection = structuredClone(await life.wait(() => resolver.resolve(context, profile)));
    if (connection.profileFingerprint !== capabilityProfileFingerprint(profile)) throw new BudgetError('FORBIDDEN');
    const assertCurrent = resolver.assertCurrent?.bind(resolver);
    if (assertCurrent) await life.wait(() => assertCurrent(context, profile));
    const request = anthropicCountTokensRequest(material, connection.baseUrl);
    // Resolve the connection first; then re-authorize the original task/run/
    // step and lease through the existing dispatch boundary immediately before
    // POST. A cancellation while credentials resolve cannot inherit an old grant.
    await life.wait(() => gate.recheck());
    await life.wait(dispatch);
    try {
      const response = await life.wait(() => postCountTokens(this.dependencies.transport, request,
        connection.credential, life.controller.signal, MODEL_RESPONSE_BYTES));
      if (response.status === 401 || response.status === 403) return { state: 'failed', failureCode: 'AUTHENTICATION_FAILED', requestHash: request.requestHash };
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429)
        return { state: 'failed', failureCode: 'PROVIDER_REJECTED', requestHash: request.requestHash };
      if (response.status !== 200) return { state: 'unknown', requestHash: request.requestHash };
      return { state: 'observed', inputTokens: parseCountTokensResponse(response.body, connection.credential), requestHash: request.requestHash };
    } catch (error) {
      if (error instanceof ModelGatewayError && ['TIMEOUT', 'CANCELLED', 'PROVIDER_FAILED', 'INVALID_RESPONSE'].includes(error.code))
        return { state: 'unknown', requestHash: request.requestHash };
      if (error instanceof ModelAdapterError) return error.code === 'AUTHENTICATION_FAILED'
        ? { state: 'failed', failureCode: 'AUTHENTICATION_FAILED', requestHash: request.requestHash }
        : { state: 'unknown', requestHash: request.requestHash };
      throw error;
    } finally {
      if (assertCurrent) await life.wait(() => assertCurrent(context, profile));
      await life.wait(() => gate.recheck());
    }
  }
  private async persistReceipt(frozen: CountTokensFrozenInvocation, association: AiUsageAssociationDraft,
    reservationId: string, state: CountTokensReceipt['state'],
    outcome: { inputTokens?: number; failureCode?: CountTokensReceipt['failureCode'] },
    requestHash: string): Promise<CountTokensReceipt> {
    const scope = frozen.context.scope as { tenantId: string; workspaceId: string };
    const receipt: CountTokensReceipt = {
      version: 'ai-count-tokens-receipt-1', state,
      tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: frozen.actorId,
      callId: frozen.invocation.callId, countCallId: association.requestId,
      invocationId: frozen.invocation.id, scopeId: frozen.scopeId, sceneCode: frozen.invocation.sceneCode,
      protocol: frozen.configuration.protocol, model: frozen.configuration.model,
      registrationHash: frozen.invocation.registrationHash, intentHash: frozen.invocation.intentHash,
      configurationHash: frozen.invocation.configurationHash, priceVersion: frozen.invocation.priceVersion,
      maxOutputTokens: frozen.invocation.maxOutputTokens, method: 'provider_count_tokens_receipt',
      // The serialized count material actually sent: endpoint path plus body
      // (model, system, messages, tools, tool_choice). A different frozen input
      // or tool schema can never reuse this receipt.
      countRequestHash: requestHash,
      admission: { reservationId, sceneCode: countTokensSceneCode(frozen.invocation.sceneCode), unit: 'calls' },
      observedAt: this.clock().toISOString(),
      expiresAt: new Date(Math.min(frozen.invocation.expiresAt.getTime(), this.clock().getTime() + 900000)).toISOString(),
      ...(outcome.inputTokens !== undefined ? { inputTokens: outcome.inputTokens } : {}),
      ...(outcome.failureCode !== undefined ? { failureCode: outcome.failureCode } : {})
    };
    return this.receipts.append(receipt);
  }
}
