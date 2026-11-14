/** The counting operation: same frozen input, current authorization, admitted
 * external count call, immutable receipt. Order is fixed — admission reserve
 * and dispatch happen BEFORE the provider request, so an interrupted count
 * leaves an unknown, never an unaccounted call. There is exactly one attempt
 * per original call id: a replay re-reads the receipt and the reservation by
 * their original keys, and a dispatched-but-unanswered operation stays unknown
 * instead of being re-sent. Nothing here starts the text dispatch, publishes a
 * bound or refunds admission. Optional process capacity is acquired only by
 * the acknowledged original claim winner; it never releases that account. */
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiGatewayIntentDraft, AiUsageAssociationDraft } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import { ChatProtocolPolicy, type ChatProtocolOptions, type ModelJsonTransport } from '../chat-completions.adapter';
import { ModelAdapterError, ModelGatewayError } from '../model-gateway.ports';
import { MODEL_RESPONSE_BYTES } from '../model-response-limits';
import { GatewayDeadline } from '../gateway-deadline';
import { gatewayCapacityRequest, type GatewayCapacityLease, type GatewayCapacityPort } from '../gateway-capacity.ports';
import { retainGatewayCapacityPromise } from '../gateway-capacity.service';
import type { GatewayConnection, GatewayConnectionResolver } from '../routed-model-transport';
import type { AiProviderProfileRecord } from '../provider-profile.ports';
import { capabilityProfileFingerprint } from '../capability-verification';
import { BudgetError, type BudgetAuthorizationSource, type BudgetServiceLike } from './input-count-tokens.ports';
import { PrismaGatewayPricingRecords, GatewayInputBoundNotFoundError, type GatewayPricingRecordDb } from '../budget/prisma-gateway-pricing-records';
import { countTokensSupport, prepareCountTokensMaterial, prepareNativeCountTokensMaterial, countTokensMaterialHash, anthropicCountTokensRequest,
  parseCountTokensResponse, postCountTokens, type CountTokensMaterial } from './count-tokens.protocol';
import { countTokensCallId, countTokensSceneCode } from './input-count-tokens.admission';
import { PrismaCountTokensReceipts, countTokensOperationId, countTokensReference,
  CountTokensReceiptNotFoundError,
  type CountTokensReceipt, type CountTokensReceiptDb } from './input-count-tokens.receipt';

import { nativeToolResultIntentFingerprint, resolvedNativeToolResultSchema, type NativeToolResultResolver } from '../model-input/native-tool-result.ports';

const callIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const countReservationSelect = { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true,
  actorId: true, callId: true, requestId: true, idempotencyKey: true, runId: true, stepId: true, actionId: true,
  sceneCode: true, priceVersion: true, unitKind: true, configurationHash: true, configRevision: true,
  reservedCalls: true, reservedTokens: true, reservedMoney: true, moneyCurrency: true,
  status: true, dispatchState: true } satisfies Prisma.AiBudgetReservationSelect;
type CountReservation = Prisma.AiBudgetReservationGetPayload<{ select: typeof countReservationSelect }>;
const observationInvocationSelect = { id: true, scopeId: true, actorId: true, taskId: true, runId: true,
  stepId: true, actionId: true, callId: true, registrationHash: true, intentHash: true,
  configurationHash: true, configuration: true, priceVersion: true, sceneCode: true,
  maxOutputTokens: true } satisfies Prisma.AiGatewayInvocationSelect;
type ObservationInvocation = Prisma.AiGatewayInvocationGetPayload<{ select: typeof observationInvocationSelect }>;
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
  /** New-call dependencies may be absent on an original-receipt host. Their
   * absence never grants dispatch; execution validates them before its gate. */
  frozen?: CountTokensFrozenInputSource;
  resolvers?: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver };
  transport?: ModelJsonTransport;
  /** Shared server network gate, after the original reservation/claim. Receipt
   * reads do not acquire it; it grants neither dispatch nor budget release. */
  capacity?: GatewayCapacityPort;
  policyOptions?: ChatProtocolOptions;
  /** Server-only original Task/Core resolver; never accepted in a count command.
   * Absent keeps native counting unavailable without affecting old receipt reads. */
  nativeToolResults?: NativeToolResultResolver;
  /** Management entries only. Undefined keeps them unavailable while the
   * task-internal entry stays usable for hosts composed without a fixed
   * management scene. */
  sceneCode?: string;
  countingPriceVersion?: string;
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
type CountTokensOutcome = { state: 'observed'; inputTokens: number; requestHash: string }
  | { state: 'failed'; failureCode: 'AUTHENTICATION_FAILED' | 'PROVIDER_REJECTED'; requestHash: string }
  | { state: 'unknown'; requestHash: string };

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
      || !input.budget || ['reserve', 'read', 'dispatch', 'settle', 'reconcile', 'markUnknown'].some(name =>
        typeof input.budget[name as keyof BudgetServiceLike] !== 'function')
      || input.frozen !== undefined && typeof input.frozen.readFrozenCountingInput !== 'function'
      || input.resolvers !== undefined && (typeof input.resolvers.platform?.resolve !== 'function'
        || typeof input.resolvers.tenant?.resolve !== 'function')
      || input.transport !== undefined && typeof input.transport.post !== 'function'
      || input.capacity !== undefined && typeof input.capacity?.acquire !== 'function'
      || input.policyOptions !== undefined && (typeof input.policyOptions !== 'object' || Array.isArray(input.policyOptions))
      || input.nativeToolResults !== undefined && (typeof input.nativeToolResults.resolve !== 'function'
        || typeof input.nativeToolResults.assertCurrent !== 'function')
      || input.sceneCode !== undefined && !callIdSchema.max(64).safeParse(input.sceneCode).success
      || input.countingPriceVersion !== undefined && !callIdSchema.max(64).safeParse(input.countingPriceVersion).success
      || input.taskExecution !== undefined && typeof input.taskExecution.authorize !== 'function'
      || input.clock !== undefined && typeof input.clock !== 'function') throw new BudgetError('UNAVAILABLE');
    this.receipts = new PrismaCountTokensReceipts(input.db);
    this.records = new PrismaGatewayPricingRecords(input.db);
    this.policy = input.policyOptions === undefined ? undefined : new ChatProtocolPolicy(input.policyOptions);
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
    if (!this.dependencies.countingPriceVersion) throw new BudgetError('UNAVAILABLE');
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
    if (current.status === 'released') throw new BudgetError('PENDING_RECONCILIATION');
    if (current.status === 'settled') return admission(current.status);
    // Both observed and definite-failure receipts settle the one real call the
    // admission reserved: the external request was made in either case.
    try {
      const account = current.status === 'pending_reconciliation'
        ? this.dependencies.budget.reconcile.bind(this.dependencies.budget) : this.dependencies.budget.settle.bind(this.dependencies.budget);
      await life.wait(() => account(receipt.admission.reservationId, association,
        requestFingerprint({ association, phase: current.status === 'pending_reconciliation' ? 'reconcile:count-tokens' : 'settle:count-tokens' }),
        countTokensOperationId(receipt)));
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
      // Original terminal evidence is independent of new execution/entitlement,
      // current producer/price validity and the original invocation's expiry.
      // Only absence of its original receipt permits entering the new-call gate.
      try {
        const original = await life.wait(() => this.originalCount(command));
        originalMayExist = true;
        const admission = await this.accountAdmission(original.receipt, original.association, life);
        const latest = await life.wait(() => this.originalCount(command));
        if (requestFingerprint(latest.receipt) !== requestFingerprint(original.receipt)
          || identity(latest.current.context) !== identity(original.current.context)) throw new BudgetError('FORBIDDEN');
        return this.summary(original.receipt, admission);
      } catch (error) { if (!(error instanceof CountTokensReceiptNotFoundError)) throw error; }
      const { frozen: frozenSource, resolvers, transport, countingPriceVersion } = this.dependencies;
      if (!frozenSource || !resolvers || !transport || !this.policy || !countingPriceVersion
        || requireManagementScene && this.dependencies.sceneCode === undefined) throw new BudgetError('UNAVAILABLE');
      const opened = await life.wait(gate);
      const frozen = structuredClone(await life.wait(() => frozenSource.readFrozenCountingInput(
        { ...command, scopeId: opened.scopeId, actorId: opened.actorId })));
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
      const prepared = await life.wait(() => this.countMaterial(frozen, life.controller.signal));
      const material = prepared.material;
      if (prepared.assertCurrent) await life.wait(prepared.assertCurrent);
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
      const recordReceipt = this.receiptRecorder(frozen, association, reservation.id);
      const outcome = await this.performCount(frozen, opened, life, material,
        () => this.dependencies.budget.dispatch(reservation.id, association,
          requestFingerprint({ association, phase: 'dispatch' })), recordReceipt, prepared.assertCurrent);
      const receipt = await life.wait(() => recordReceipt(outcome));
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
  private originalCountAssociation(current: Awaited<ReturnType<InputCountTokensService['current']>>,
    scopeId: string, invocation: ObservationInvocation, row: CountReservation): AiUsageAssociationDraft {
    if (!isGatewayConfig(invocation.configuration) || !('tenantId' in invocation.configuration)
      || invocation.configuration.tenantId !== current.tenantId
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash
      || row.scopeId !== scopeId || row.scopeKind !== 'WORKSPACE'
      || row.tenantId !== current.tenantId || row.workspaceId !== current.workspaceId
      || row.actorId !== current.actorId || row.callId !== countTokensCallId(invocation.callId)
      || row.requestId !== row.callId || row.idempotencyKey !== row.callId
      || row.runId !== invocation.runId || row.stepId !== invocation.stepId || row.actionId !== invocation.actionId
      || row.unitKind !== 'calls' || row.reservedCalls !== 1 || row.reservedTokens !== null
      || row.reservedMoney !== null || row.moneyCurrency !== null
      || row.sceneCode !== countTokensSceneCode(invocation.sceneCode)
      || row.configurationHash !== invocation.configurationHash
      || row.configRevision !== invocation.configuration.configRevision
      || typeof row.priceVersion !== 'string' || !callIdSchema.max(64).safeParse(row.priceVersion).success)
      throw new BudgetError('FORBIDDEN');
    return { requestId: row.callId, runId: invocation.runId, stepId: invocation.stepId,
      actionId: invocation.actionId, idempotencyKey: row.callId,
      scope: { kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId },
      config: invocation.configuration, priceVersion: row.priceVersion };
  }
  /** Historical observation of one counting receipt under current read
   * authority: the original bound inputs only, never a fresh count, a text
   * dispatch, an admission refund or any ledger mutation. Missing receipts
   * report unavailable; execution shutdown does not erase a legitimately
   * recorded fact. Accepts either the original call id or the original
   * invocation id. */
  private async originalCount(value: unknown) {
    const parsed = z.object({ callId: callIdSchema.optional(), invocationId: z.string().min(1).max(36)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional() }).strict().refine(item =>
      (item.callId !== undefined) !== (item.invocationId !== undefined)).safeParse(structuredClone(value));
    if (!parsed.success) throw new BudgetError('INVALID');
    const current = await this.current();
    const columns = aiPersistenceScopeColumns({ kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId });
    const scope = structuredClone(await this.dependencies.db.aiScope.findFirst({ where: columns }));
    if (!scope || Object.entries(columns).some(([key, item]) => scope[key as keyof typeof scope] !== item)) throw new BudgetError('FORBIDDEN');
    const read = async () => {
    // Receipt first: absence is "no counting record" (unavailable), while a
    // receipt whose invocation is missing or owned by someone else is refused.
    const referenced = parsed.data.invocationId !== undefined
      ? await this.dependencies.db.aiGatewayInvocation.findUnique({ where: { id: parsed.data.invocationId }, select: observationInvocationSelect }) : null;
    if (parsed.data.invocationId !== undefined && (!referenced || referenced.id !== parsed.data.invocationId))
      throw new BudgetError('FORBIDDEN');
    const receipt = await this.receipts.read(countTokensOperationId({ tenantId: current.tenantId,
      workspaceId: current.workspaceId, actorId: current.actorId,
      callId: referenced !== null ? referenced.callId : parsed.data.callId as string }));
    const invocation = referenced ?? (parsed.data.callId !== undefined
      ? await this.dependencies.db.aiGatewayInvocation.findUnique({ where: {
        scopeId_callId: { scopeId: scope.id, callId: parsed.data.callId } }, select: observationInvocationSelect })
      : null);
    if (!invocation || invocation.scopeId !== scope.id || invocation.actorId !== current.actorId
      || parsed.data.callId !== undefined && invocation.callId !== parsed.data.callId) throw new BudgetError('FORBIDDEN');
    if (receipt.scopeId !== scope.id || receipt.tenantId !== current.tenantId || receipt.workspaceId !== current.workspaceId
      || receipt.actorId !== current.actorId || receipt.callId !== invocation.callId
      || receipt.invocationId !== invocation.id || receipt.registrationHash !== invocation.registrationHash
      || receipt.intentHash !== invocation.intentHash || receipt.configurationHash !== invocation.configurationHash
      || receipt.priceVersion !== invocation.priceVersion || receipt.sceneCode !== invocation.sceneCode
      || receipt.maxOutputTokens !== invocation.maxOutputTokens
      || receipt.countCallId !== countTokensCallId(invocation.callId)
      || !isGatewayConfig(invocation.configuration)
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash
      || receipt.protocol !== invocation.configuration.protocol || receipt.model !== invocation.configuration.model) throw new BudgetError('FORBIDDEN');
    if (typeof this.dependencies.db.aiBudgetReservation?.findUnique !== 'function') throw new BudgetError('UNAVAILABLE');
    const originalReservation = structuredClone(await this.dependencies.db.aiBudgetReservation.findUnique({
      where: { id: receipt.admission.reservationId }, select: countReservationSelect }));
    if (!originalReservation || originalReservation.id !== receipt.admission.reservationId
      || receipt.admission.sceneCode !== originalReservation.sceneCode) throw new BudgetError('FORBIDDEN');
    const association = this.originalCountAssociation(current, scope.id, invocation, originalReservation);
    if (!await this.receipts.hasDispatchClaim({ tenantId: receipt.tenantId, workspaceId: receipt.workspaceId,
      actorId: receipt.actorId, callId: receipt.callId, reservationId: originalReservation.id,
      registrationHash: receipt.registrationHash, intentHash: receipt.intentHash,
      configurationHash: receipt.configurationHash, countRequestHash: receipt.countRequestHash })) throw new BudgetError('UNAVAILABLE');
    return { invocation, receipt, association, binding: requestFingerprint({
      invocation: { id: invocation.id, scopeId: invocation.scopeId, taskId: invocation.taskId, runId: invocation.runId,
        stepId: invocation.stepId, actionId: invocation.actionId, actorId: invocation.actorId, callId: invocation.callId,
        registrationHash: invocation.registrationHash, intentHash: invocation.intentHash,
        configurationHash: invocation.configurationHash, priceVersion: invocation.priceVersion,
        sceneCode: invocation.sceneCode, maxOutputTokens: invocation.maxOutputTokens }, originalReservation, receipt }) };
    };
    const before = await read();
    const authorize = this.dependencies.authorization.authorizeObservation?.bind(this.dependencies.authorization);
    if (!authorize || identity(await authorize(before.invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const after = await read(), latest = await this.current();
    if (before.binding !== after.binding || latest.scopeId !== current.scopeId
      || identity(latest.context) !== identity(current.context)
      || identity(await authorize(before.invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    return { current, scope, ...before };
  }
  async readCountReceipt(value: unknown): Promise<CountTokensResult & { diagnostics: CountTokensDiagnostics;
    lifecycle: CountTokensLifecycle }> {
    const { current, scope, invocation, receipt, association } = await this.originalCount(value);
    // Read-only admission observation: never settles, marks unknown or releases.
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
    const latestAdmission = await this.dependencies.budget.read(receipt.admission.reservationId, association);
    const after = await this.originalCount(value);
    if (after.current.scopeId !== current.scopeId || identity(after.current.context) !== identity(current.context)
      || requestFingerprint(after.receipt) !== requestFingerprint(receipt)
      || requestFingerprint(after.association) !== requestFingerprint(association)) throw new BudgetError('FORBIDDEN');
    if ((latestAdmission?.status ?? 'pending_reconciliation') !== admission.status) throw new BudgetError('PENDING_RECONCILIATION');
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
    const readInvocation = () => this.dependencies.db.aiGatewayInvocation.findUnique({ where: {
      scopeId_callId: { scopeId: scope.id, callId: parsed.data.callId } }, select: observationInvocationSelect });
    const invocation = await readInvocation();
    if (!invocation || invocation.scopeId !== scope.id || invocation.actorId !== current.actorId
      || invocation.callId !== parsed.data.callId || !isGatewayConfig(invocation.configuration)
      || !('tenantId' in invocation.configuration) || invocation.configuration.tenantId !== current.tenantId
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
    const countCallId = countTokensCallId(invocation.callId);
    if (typeof this.dependencies.db.aiBudgetReservation?.findUnique !== 'function') throw new BudgetError('UNAVAILABLE');
    const reservations = this.dependencies.db.aiBudgetReservation;
    // Bind even a receipt-free claim to the original invocation and calls-unit
    // reservation. Missing storage or a raced linkage cannot attest no count.
    const readState = async () => {
      const admissionRow = structuredClone(await reservations.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: scope.id, scopeKind: 'WORKSPACE', callId: countCallId } },
        select: countReservationSelect }));
      if (admissionRow) this.originalCountAssociation(current, scope.id, invocation, admissionRow);
      const claim = await this.receipts.readDispatchClaim({ tenantId: scopeFields.tenantId,
        workspaceId: scopeFields.workspaceId, actorId: current.actorId, callId: invocation.callId,
        registrationHash: invocation.registrationHash, intentHash: invocation.intentHash,
        configurationHash: invocation.configurationHash,
        ...(admissionRow ? { reservationId: admissionRow.id } : {}) });
      if (claim && !admissionRow) throw new BudgetError('PENDING_RECONCILIATION');
      return { admissionRow, claim };
    };
    const before = await readState(), { admissionRow } = before;
    let admission: CountTokensAdmissionState | null = null;
    if (admissionRow) {
      const status: CountTokensAdmissionState['status'] | null = admissionRow.status === 'reserved'
        ? 'reserved' : admissionRow.status === 'settled' ? 'settled'
        : admissionRow.status === 'released' ? 'released'
        : admissionRow.status === 'pending_reconciliation' ? 'pending_reconciliation' : null;
      if (status === null) throw new BudgetError('UNAVAILABLE');
      admission = { reservationId: admissionRow.id, sceneCode: admissionRow.sceneCode, unit: 'calls', status };
    }
    const lifecycle: CountTokensLifecycle = before.claim ? 'claimed_dispatched'
      : admissionRow ? 'reserved' : 'not_started';
    const latestInvocation = await readInvocation();
    if (!latestInvocation || requestFingerprint(latestInvocation) !== requestFingerprint(invocation)) throw new BudgetError('FORBIDDEN');
    const latestState = await readState();
    if (requestFingerprint(latestState) !== requestFingerprint(before)) throw new BudgetError('PENDING_RECONCILIATION');
    try {
      await this.receipts.read(receiptId);
      throw new BudgetError('PENDING_RECONCILIATION');
    } catch (error) { if (!(error instanceof CountTokensReceiptNotFoundError)) throw error; }
    if (identity(await authorizeObservation(invocation.taskId)) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    const after = await this.current();
    if (after.scopeId !== current.scopeId || identity(after.context) !== identity(current.context)) throw new BudgetError('FORBIDDEN');
    return { callId: invocation.callId, countCallId, lifecycle, admission, receipt: null };
  }

  private async readReplay(frozen: CountTokensFrozenInvocation, life: GatewayDeadline, beforeAccounting: () => void = () => {}) {
    let original: Awaited<ReturnType<InputCountTokensService['originalCount']>>;
    try { original = await life.wait(() => this.originalCount({ invocationId: frozen.invocation.id })); }
    catch (error) { if (error instanceof CountTokensReceiptNotFoundError) return null; throw error; }
    const { receipt, association } = original;
    if (receipt.invocationId !== frozen.invocation.id || receipt.registrationHash !== frozen.invocation.registrationHash
      || receipt.intentHash !== frozen.invocation.intentHash || receipt.configurationHash !== frozen.invocation.configurationHash
      || identity(original.current.context) !== identity(frozen.context)) throw new BudgetError('IDEMPOTENCY_CONFLICT');
    beforeAccounting();
    const admission = await this.accountAdmission(receipt, association, life);
    return { receipt, admission };
  }
  /** Connection-independent serialization of the frozen input: the exact
   * body the provider will receive. Rejects unsupported combinations before
   * any admission is reserved. */
  private async countMaterial(frozen: CountTokensFrozenInvocation, signal: AbortSignal): Promise<{
    material: CountTokensMaterial; assertCurrent?: () => Promise<void>;
  }> {
    if (!this.policy) throw new BudgetError('UNAVAILABLE');
    const native = frozen.intent.messages.some(message => message.content.some(part => part.kind === 'tool_result_reference'));
    if (native) {
      const resolver = this.dependencies.nativeToolResults;
      if (!resolver || !this.policy.nativeToolResults || frozen.configuration.protocol !== 'anthropic_messages')
        throw new BudgetError('UNAVAILABLE');
      const intentHash = nativeToolResultIntentFingerprint(frozen.intent, { sceneCode: frozen.invocation.sceneCode,
        maxOutputTokens: frozen.invocation.maxOutputTokens, orderExplainTool: true, nativeToolResults: true });
      const part = frozen.intent.messages[0]?.content[0];
      if (intentHash !== frozen.invocation.intentHash || frozen.intent.messages.length !== 1
        || frozen.intent.messages[0].role !== 'user' || frozen.intent.messages[0].content.length !== 1
        || part?.kind !== 'tool_result_reference' || part.reference.taskId !== frozen.invocation.taskId
        || part.reference.runId !== frozen.invocation.runId || frozen.context.scope.kind !== 'workspace')
        throw new ModelGatewayError('INVALID_REQUEST');
      const context = { tenantId: frozen.context.scope.tenantId, workspaceId: frozen.context.scope.workspaceId, actorId: frozen.actorId };
      const parsed = resolvedNativeToolResultSchema.safeParse(structuredClone(await resolver.resolve(context, structuredClone(part.reference), signal)));
      if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
      const value = parsed.data;
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (requestFingerprint(value.reference) !== requestFingerprint(part.reference)
        || value.originalIntent.sceneCode !== frozen.intent.sceneCode
        || value.sourceConfigurationHash !== frozen.invocation.configurationHash
        || value.sourceInvocationId === frozen.invocation.id) throw new ModelGatewayError('INVALID_REQUEST');
      const messages = value.originalIntent.messages.map(message => ({ role: message.role, content: message.content.map(content => {
        if (content.kind !== 'text') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        return content.text;
      }).join('') }));
      const material = prepareNativeCountTokensMaterial({ callId: frozen.invocation.callId, model: frozen.configuration.model,
        messages, maxOutputTokens: frozen.invocation.maxOutputTokens, features: ['tools'] }, this.policy, value);
      return { material, assertCurrent: () => resolver.assertCurrent(structuredClone(context), structuredClone(value), signal) };
    }
    const features = [...new Set(frozen.intent.requiredFeatures.flatMap(feature =>
      feature === 'tools' ? ['tools' as const] : feature === 'structured_output' ? ['structuredOutput' as const] : []))];
    return { material: prepareCountTokensMaterial({ callId: frozen.invocation.callId, model: frozen.configuration.model,
      // Normal text counting stays byte-for-byte compatible; media still refuses.
      messages: frozen.intent.messages.map(message => ({ role: message.role,
        content: message.content.map(part => {
          if (part.kind !== 'text') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
          return part.text;
        }).join('') })),
      maxOutputTokens: frozen.invocation.maxOutputTokens, features }, this.policy) };
  }

  /** Reopen the exact original payload, not just its saved hash columns. A
   * queue wait cannot retain authority over a replaced input or identity. */
  private async assertFrozenCurrent(frozen: CountTokensFrozenInvocation, life: GatewayDeadline) {
    const source = this.dependencies.frozen;
    if (!source) throw new BudgetError('UNAVAILABLE');
    const latest = structuredClone(await life.wait(() => source.readFrozenCountingInput({
      callId: frozen.invocation.callId, scopeId: frozen.scopeId, actorId: frozen.actorId
    })));
    const { context: beforeContext, ...before } = frozen;
    const { context: afterContext, ...after } = latest;
    const beforeExpiry = before.invocation.expiresAt, afterExpiry = after.invocation.expiresAt;
    const now = this.clock().getTime();
    if (identity(afterContext) !== identity(beforeContext)
      || requestFingerprint(after) !== requestFingerprint(before)
      // The original fingerprint helper treats Dates as objects. Compare the
      // immutable expiry explicitly instead of letting two Dates hash alike.
      || !(beforeExpiry instanceof Date) || !(afterExpiry instanceof Date)
      || !Number.isFinite(now) || !Number.isFinite(beforeExpiry.getTime())
      || afterExpiry.getTime() !== beforeExpiry.getTime() || afterExpiry.getTime() <= now) throw new BudgetError('FORBIDDEN');
  }

  private async performCount(frozen: CountTokensFrozenInvocation, gate: CountingGate,
    life: GatewayDeadline, material: Readonly<CountTokensMaterial>, dispatch: () => PromiseLike<unknown>,
    recordReceipt: (outcome: CountTokensOutcome) => Promise<CountTokensReceipt>, nativeCurrent?: () => Promise<void>): Promise<CountTokensOutcome> {
    const configuration = frozen.configuration, { resolvers, transport, capacity } = this.dependencies;
    if (!resolvers || !transport) throw new BudgetError('UNAVAILABLE');
    let capacityLease: GatewayCapacityLease | undefined, capacityTransferred = false;
    try {
      const profile = await life.wait(() => this.profile(configuration, gate.tenantId));
      const resolver = configuration.serviceMode === 'platform_managed' ? resolvers.platform : resolvers.tenant;
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
      if (nativeCurrent) await life.wait(nativeCurrent);
      if (capacity) {
        await this.assertFrozenCurrent(frozen, life);
        // Reserve and the unique persisted claim remain in their original order.
        // A lost claim ACK never reaches this wait. Its timeout buys no new call
        // id, deadline, usage receipt or permission to refund the reservation.
        await life.wait(() => capacity.acquire(gatewayCapacityRequest(context, profile,
          countTokensCallId(frozen.invocation.callId),
          new Date(Math.min(life.expiresAt.getTime(), frozen.invocation.expiresAt.getTime()))), life.controller.signal)
          .then(lease => {
            if (!lease || typeof lease.release !== 'function') throw new BudgetError('UNAVAILABLE');
            if (life.controller.signal.aborted) {
              lease.release(); throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
            }
            capacityLease = lease;
          }));
      }
      const recheckAfterWait = async () => {
        await life.wait(() => gate.recheck());
        await this.assertFrozenCurrent(frozen, life);
        const latestProfile = await life.wait(() => this.profile(configuration, gate.tenantId));
        if (requestFingerprint(latestProfile) !== requestFingerprint(profile)) throw new BudgetError('FORBIDDEN');
        // Resolve the same connection again even without an assertCurrent method.
        // A stable profile id cannot certify changed endpoint or vault contents.
        const latestConnection = structuredClone(await life.wait(() => resolver.resolve(context, profile)));
        if (requestFingerprint(latestConnection) !== requestFingerprint(connection)) throw new BudgetError('FORBIDDEN');
        if (assertCurrent) await life.wait(() => assertCurrent(context, profile));
        if (nativeCurrent) await life.wait(nativeCurrent);
        // Configuration/vault reads can themselves wait. Reopen the original
        // input and profile again before using their earlier snapshots to send.
        await this.assertFrozenCurrent(frozen, life);
        const finalProfile = await life.wait(() => this.profile(configuration, gate.tenantId));
        if (requestFingerprint(finalProfile) !== requestFingerprint(profile)) throw new BudgetError('FORBIDDEN');
        await life.wait(() => gate.recheck());
      };
      if (capacityLease) await recheckAfterWait();
      await life.wait(dispatch);
      // Accounting may itself await storage. A changed original Core result after
      // that wait cannot be sent, nor does it prove the claimed count was harmless.
      if (capacityLease) await recheckAfterWait();
      else if (nativeCurrent) await life.wait(nativeCurrent);
      try {
        return await life.wait(() => retainGatewayCapacityPromise(capacityLease, () => {
          // This checks only the current capacity publication. The original
          // task/configuration/claim/budget checks above still authorize send.
          capacityLease?.assertCurrent?.();
          capacityTransferred = true;
          return postCountTokens(transport, request,
            connection.credential, life.controller.signal, MODEL_RESPONSE_BYTES);
        }).then(async response => {
          const outcome: CountTokensOutcome = response.status === 401 || response.status === 403
            ? { state: 'failed', failureCode: 'AUTHENTICATION_FAILED', requestHash: request.requestHash }
            : response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
              ? { state: 'failed', failureCode: 'PROVIDER_REJECTED', requestHash: request.requestHash }
              : response.status !== 200 ? { state: 'unknown', requestHash: request.requestHash }
                : { state: 'observed', inputTokens: parseCountTokensResponse(response.body, connection.credential), requestHash: request.requestHash };
          // This original response can arrive after caller cancellation. Retain
          // only its count/association before current delivery checks; this does
          // not settle admission, publish a bound or authorize new generation.
          await recordReceipt(outcome);
          return outcome;
        }));
      } catch (error) {
        if (error instanceof ModelGatewayError && ['TIMEOUT', 'CANCELLED', 'PROVIDER_FAILED', 'INVALID_RESPONSE'].includes(error.code))
          return { state: 'unknown', requestHash: request.requestHash };
        if (error instanceof ModelAdapterError) return error.code === 'AUTHENTICATION_FAILED'
          ? { state: 'failed', failureCode: 'AUTHENTICATION_FAILED', requestHash: request.requestHash }
          : { state: 'unknown', requestHash: request.requestHash };
        throw error;
      } finally {
        if (assertCurrent) await life.wait(() => assertCurrent(context, profile));
        if (nativeCurrent) await life.wait(nativeCurrent);
        await life.wait(() => gate.recheck());
      }
    } finally {
      // Sent work retains its slot through the underlying POST promise, even
      // after the caller stopped waiting. Unsent network capacity is separate
      // from the original financial reservation, which stays authoritative.
      if (!capacityTransferred) capacityLease?.release();
    }
  }
  private receiptRecorder(value: CountTokensFrozenInvocation, valueAssociation: AiUsageAssociationDraft, reservationId: string) {
    const frozen = structuredClone(value), association = structuredClone(valueAssociation);
    let recording: Promise<CountTokensReceipt> | undefined, recordedHash: string | undefined;
    return (valueOutcome: CountTokensOutcome): Promise<CountTokensReceipt> => {
      const outcome = structuredClone(valueOutcome), hash = requestFingerprint(outcome);
      if (recording) return hash === recordedHash ? recording : Promise.reject(new BudgetError('IDEMPOTENCY_CONFLICT'));
      recordedHash = hash;
      // Receipt persistence has one bounded wait independent of the caller's
      // delivery deadline. An unreadable write reply stays pending; reuse the
      // same promise and original key, never retry or overwrite its payload.
      const receiptLife = new GatewayDeadline(5000);
      recording = receiptLife.wait(() => this.persistReceipt(frozen, association, reservationId, outcome.state,
        outcome.state === 'observed' ? { inputTokens: outcome.inputTokens }
          : outcome.state === 'failed' ? { failureCode: outcome.failureCode } : {}, outcome.requestHash))
        .catch(error => { throw error instanceof BudgetError ? error : new BudgetError('PENDING_RECONCILIATION'); })
        .finally(() => receiptLife.close());
      return recording;
    };
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
