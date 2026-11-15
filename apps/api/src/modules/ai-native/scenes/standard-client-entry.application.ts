import { Controller, Inject } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientOrderActionSourceSchema, aiClientOrderActionRevalidationSchema,
  AI_TASK_DRAFT_VERSION, aiClientTaskReadRequestSchema, aiClientTaskCreationReceiptSchema,
  aiClientGoalPreparationRequestSchema, aiClientGoalPreparationReadRequestSchema,
  aiClientGoalQuoteRequestSchema, aiClientQuotePreparationRequestSchema } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { createAiGuardedClientSession } from '../client-scene.composition';
import { AiClientEntryError } from './client-entry-action';
import { AiClientEntryController, clientEntryRefusalCode, type AiClientEntryApplication } from './client-entry.controller';
import { composeRequestBoundClientApplication, type AiClientApplicationRequest, type AiClientRequestDependencies } from './client-request.application';
import type { SecretBox } from '../../../common/secret-box';
import type { ModelAdapter } from '../model-gateway.ports';
import { createNativeModelAdapters } from '../native-model-adapters';
import { gatewayPricingSelectionSchema } from '../budget/gateway-pricing-evidence';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { composeClientOriginalBookingHttp } from './client-original-booking-http.composition';
import type { GatewayCapacityPort } from '../gateway-capacity.ports';
import type { ClientRequestContext } from '../../client/client-auth.service';
import { originalClientMaterialScope } from './prisma-client-scene-material.repository';
import { PrismaClientTaskInputRepository } from './prisma-client-task-input.repository';
import { recordClientEntryRefusal, withClientEntryRefusalAudit, type ClientEntryAuditOrigin } from './client-entry.audit';
import { waitForTaskApplicationDependency } from '../runner/prisma-task-application';

export const AI_WEBSITE_ENTRY = Symbol('AI_WEBSITE_ENTRY');
export const AI_WECHAT_ENTRY = Symbol('AI_WECHAT_ENTRY');
export const AI_NATIVE_CLIENT_MODEL_CONFIGURATION = Symbol('AI_NATIVE_CLIENT_MODEL_CONFIGURATION');
export const AI_NATIVE_CLIENT_MODEL_ADAPTERS = Symbol('AI_NATIVE_CLIENT_MODEL_ADAPTERS');
const modelConfiguration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), pricing: gatewayPricingSelectionSchema, systemPrompt: z.string().min(1).max(8000),
    maxOutputTokens: z.number().int().min(1).max(32768), limits: aiTaskRunnerLimitsSchema,
    clarification: z.boolean().optional().default(false),
    host: z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      leaseMs: z.number().int().min(1).max(120000) }).strict() }).strict()]);
/** The same closed server publication for execution and metadata observation.
 * Parsing neither assembles a transport nor authorizes a model invocation. */
export function readStandardClientModelConfiguration(value?: unknown) {
  try {
    const config = modelConfiguration.parse(structuredClone(value ?? { enabled: false }));
    if (config.enabled && config.limits.maxStepMs > config.limits.maxTotalMs) throw Error();
    return config;
  } catch { throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'invalid_server_model_configuration'); }
}

/** Inert standard dependency producer. Model/configuration/entitlement/price
 * records are not seeded here. Clarification needs separate server opt-in;
 * explicit booking parameter selection and approval stay in the original flow. */
export function standardClientModelDependencies(db: PrismaClient, secrets: SecretBox, value?: unknown,
  suppliedAdapters?: readonly ModelAdapter[], capacity?: GatewayCapacityPort): Pick<AiClientRequestDependencies, 'taskModel' | 'taskInputs' | 'taskResults' | 'taskAccounting'> {
  const config = readStandardClientModelConfiguration(value);
  // Original result observation needs neither an enabled model nor a Provider.
  if (!config.enabled) return {
    taskResults: { db }, taskAccounting: { db },
    // Observe only a question already persisted by the original runner. The
    // widest parser ceiling is not a model/cost grant; exact original limits,
    // current client read/answer policy and question expiry remain mandatory.
    taskInputs: { db, inputSource: 'original_client_clarification', gatewayScene: {
      sceneCode: 'quote_clarification', routeScene: 'chat', maxOutputTokens: 32768 } }
  };
  if (config.limits.maxStepMs > config.limits.maxTotalMs || !secrets
    || suppliedAdapters !== undefined && (!Array.isArray(suppliedAdapters) || !suppliedAdapters.length))
    throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'invalid_server_model_dependencies');
  const gatewayScene = { sceneCode: 'quote_clarification', routeScene: 'chat' as const, maxOutputTokens: config.maxOutputTokens };
  const adapters = suppliedAdapters ? [...suppliedAdapters] : createNativeModelAdapters();
  const inputSource = config.clarification ? 'original_client_clarification' as const : 'original_client' as const;
  return { taskModel: { db, host: config.host, systemPrompt: config.systemPrompt, limits: config.limits,
    inputSource, gatewayScene,
    gateway: { db, secrets, routeScene: 'chat', pricing: config.pricing, adapters,
      ...(capacity ? { capacity } : {}) } },
    // Turning off NEW questions must not hide an original persisted wait.
    // This reader/submission surface cannot publish questions or invoke a model.
    taskInputs: { db, inputSource: 'original_client_clarification', gatewayScene },
    taskResults: { db }, taskAccounting: { db } };
}
type Dependencies = AiClientRequestDependencies & {
  db: PrismaClient;
};

/** Correlate with one original read before the write/control can lose its reply.
 * Reader failure removes the association. It never retries or invokes a model,
 * and submitted IDs supply no facts until that original reader accepts them. */
async function readClientEntryAuditOrigin(application: ReturnType<typeof composeRequestBoundClientApplication> & ReturnType<typeof composeClientOriginalBookingHttp>, request: AiClientApplicationRequest,
  identity: ClientRequestContext, channel: 'web' | 'wechat_miniprogram', name: string, value: unknown): Promise<ClientEntryAuditOrigin | undefined> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const command = value as Record<string, unknown>;
  const ownerHash = requestFingerprint(originalClientMaterialScope(identity, channel));
  const origin = (kind: ClientEntryAuditOrigin['kind'], locator: string, state: ClientEntryAuditOrigin['state'],
    references: Omit<ClientEntryAuditOrigin, 'ownerHash' | 'kind' | 'locatorHash' | 'state'> = {}): ClientEntryAuditOrigin => Object.freeze({
      ownerHash, kind, locatorHash: requestFingerprint({ version: 'client-entry-original-locator-1', ownerHash, kind, locator }), state, ...references
    });
  try {
    if (name === 'prepareGoal' || name === 'readGoalPreparation') {
      const query = name === 'prepareGoal' ? (() => {
        const goal = aiClientGoalPreparationRequestSchema.parse(value);
        return { operationKey: goal.operationKey, goalHash: requestFingerprint({ version: 'client-goal-1', goalText: goal.goalText }) };
      })() : aiClientGoalPreparationReadRequestSchema.parse(value);
      const receipt = await application.readGoalPreparation(request, query);
      return origin('material', receipt.operationKey, receipt.state,
        receipt.state === 'observed' ? { materialRef: receipt.materialRef } : {});
    }
    if (name === 'prepareGoalQuote' || name === 'readGoalQuotePreparation') {
      const quote = aiClientGoalQuoteRequestSchema.parse(value);
      const receipt = await application.readGoalQuotePreparation(request, value);
      return origin('material', quote.operationKey, receipt.state,
        receipt.state === 'observed' ? { materialRef: receipt.materialRef } : {});
    }
    if (name === 'prepare') {
      const receipt = await application.readOperation(request, value);
      return origin('material', receipt.operationKey, receipt.state === 'saved' ? 'observed' : 'unknown',
        receipt.state === 'saved' ? { materialRef: receipt.materialRef } : {});
    }
    if (name === 'readOrderMaterialReceipt') {
      const receipt = await application.readOrderMaterialReceipt(request, value);
      return origin('material', receipt.operationKey, receipt.state,
        receipt.state === 'observed' ? { materialRef: receipt.materialRef! } : {});
    }
    if (name === 'prepareQuoteParameters' || name === 'readQuotePreparationOperation') {
      const quote = aiClientQuotePreparationRequestSchema.parse(value);
      const receipt = await application.readQuotePreparationOperation(request, value);
      return origin('material', quote.operationKey, receipt.state,
        receipt.state === 'observed' ? { materialRef: receipt.materialRef } : {});
    }
    if (name === 'confirmQuoteParameters' || name === 'readPreparedQuoteOriginal') {
      const receipt = await application.readPreparedQuoteOriginal(request, value);
      return origin('material', receipt.source.materialRef, receipt.state,
        receipt.state === 'observed' ? { materialRef: receipt.source.materialRef } : {});
    }
    if (name === 'prepareOriginalQuoteBooking' || name === 'readOriginalQuoteBookingOperation') {
      const receipt = await application.readOriginalQuoteBookingOperation(request, value);
      return origin('material', receipt.operationKey, receipt.state,
        receipt.state === 'observed' ? { materialRef: receipt.material.materialRef } : {});
    }
    if (name === 'issueBookingTransfer' || name === 'readBookingTransferIssue') {
      const receipt = await application.readBookingTransferIssue(request, value);
      return origin('transfer', receipt.operationKey, receipt.state === 'issued' ? 'observed' : 'unknown',
        receipt.state === 'issued' ? { handoffRef: receipt.handoffRef, transferRef: receipt.transferRef } : {});
    }
    if (name === 'consumeBookingTransfer' || name === 'readBookingTransferReceipt') {
      const receipt = await application.readBookingTransferReceipt(request, value);
      return origin('transfer', receipt.operationKey, receipt.state === 'consumed' ? 'observed' : 'unknown',
        receipt.state === 'consumed' ? { handoffRef: receipt.handoffRef, transferRef: receipt.transferRef, draftId: receipt.bookingDraftId } : {});
    }
    if (name === 'acceptBookingSubmission' || name === 'readBookingAcceptance') {
      const receipt = await application.readBookingAcceptance(request, { handoffRef: command.handoffRef,
        ...(command.contactPhone === undefined ? {} : { contactPhone: command.contactPhone }) });
      return origin('submission', receipt.operationKey, receipt.state,
        receipt.acceptance ? { draftId: receipt.acceptance.bookingDraftId, handoffRef: receipt.acceptance.handoffRef,
          acceptanceRef: receipt.acceptance.acceptanceRef } : {});
    }
    if (name === 'submitAcceptedBooking' || name === 'readBookingSubmission') {
      const receipt = await application.readBookingSubmission(request, { acceptanceRef: command.acceptanceRef });
      return origin('submission', receipt.operationKey, receipt.state === 'observed' ? 'observed' : 'unknown');
    }
    if (name === 'createBookingDraft' || name === 'chooseBookingDraft' || name === 'handoffBookingDraft' || name === 'readBookingOperation') {
      const operation = await application.readBookingOperation(request, { operationKey: command.operationKey });
      return origin('booking', operation.operationKey, operation.state,
        operation.state === 'observed' ? { draftId: operation.bookingDraftId,
          ...(operation.handoffRef ? { handoffRef: operation.handoffRef } : {}) } : {});
    }
    const task = aiClientTaskReadRequestSchema.safeParse({ creationKey: command.creationKey, materialRef: command.materialRef });
    if (task.success) {
      const result = await application.readTaskCreation(request, task.data);
      if (!('state' in result) || !('task' in result)) return;
      const receipt = aiClientTaskCreationReceiptSchema.parse({ contractVersion: AI_TASK_DRAFT_VERSION, ...task.data,
        state: result.state, task: result.task, inputRef: 'inputRef' in result ? result.inputRef : null,
        inputHash: 'inputHash' in result ? result.inputHash : null, execution: 'not_attested', retryable: false,
        nextAction: 'read_original_task_creation' });
      return origin('task_creation', receipt.creationKey, receipt.state, { materialRef: receipt.materialRef,
        ...(receipt.inputRef ? { inputRef: receipt.inputRef } : {}),
        ...(receipt.task ? { taskId: receipt.task.taskId, originRunId: receipt.task.runId } : {}) });
    }
  } catch { /* Missing or withdrawn original authority cannot identify a resource. */ }
}

function clientEntryResultUnknown(result: unknown) {
  if (!result || typeof result !== 'object') return false;
  if ('state' in result && (result.state === 'unknown' || result.state === 'not_observed')) return true;
  if ('task' in result && result.task && typeof result.task === 'object'
    && 'status' in result.task && result.task.status === 'unknown') return true;
  if ('run' in result && result.run && typeof result.run === 'object'
    && 'status' in result.run && result.run.status === 'unknown') return true;
  if ('operation' in result && result.operation && typeof result.operation === 'object'
    && 'state' in result.operation && result.operation.state === 'unknown') return true;
  if ('execution' in result && result.execution && typeof result.execution === 'object'
    && 'kind' in result.execution && result.execution.kind === 'run_outcome'
    && 'outcome' in result.execution && result.execution.outcome && typeof result.execution.outcome === 'object'
    && 'status' in result.execution.outcome) return result.execution.outcome.status === 'unknown';
  return false;
}

/** Same publication witness used by the request-bound entry and by an
 * independently authenticated target viewing one original Booking reference.
 * The supplied identity is an internal Auth result, never a wire customer ID. */
export async function readStandardClientEntryPublication(db: PrismaClient, identity: ClientRequestContext,
  channel: 'web' | 'wechat_miniprogram', scene: { sceneCode: string; sceneVersion: string }, now: Date,
  create = false) {
  const unavailable = (): never => { throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_entry_not_published'); };
  if (!Number.isFinite(now.getTime()) || identity.customerType !== 'personal' || identity.membershipStatus !== 'active') return unavailable();
  const key = { tenantId: identity.tenantId, workspaceId: identity.workspaceId, channel,
    customerType: identity.customerType, ...scene };
  const policy = structuredClone(await db.aiClientTaskPolicy.findUnique({ where: {
    tenantId_workspaceId_channel_customerType_sceneCode_sceneVersion: key } }));
  const profile = structuredClone(await db.clientChannelProfile.findUnique({ where: { tenantId: identity.tenantId },
    select: { id: true, tenantId: true, revision: true } }));
  const published = structuredClone(await db.clientChannelWorkspace.findFirst({ where: {
    tenantId: identity.tenantId, workspaceId: identity.workspaceId, enabled: true },
    select: { id: true, tenantId: true, workspaceId: true, profileId: true, enabled: true } }));
  const website = channel === 'web' ? structuredClone(await db.websiteChannelProfile.findUnique({
    where: { tenantId: identity.tenantId }, select: { tenantId: true, revision: true, enabled: true } })) : null;
  if (!policy || Object.entries(key).some(([k, v]) => policy[k as keyof typeof policy] !== v)
    || !policy.enabled || !policy.allowRead || create && !policy.allowCreate
    || !(policy.expiresAt instanceof Date) || !Number.isFinite(policy.expiresAt.getTime())
    || policy.expiresAt <= now || !Number.isSafeInteger(policy.revision) || policy.revision < 1
    || !profile || profile.tenantId !== identity.tenantId || !Number.isSafeInteger(profile.revision) || profile.revision < 1
    || !published || published.tenantId !== identity.tenantId || published.workspaceId !== identity.workspaceId
    || published.profileId !== profile.id || published.enabled !== true
    || channel === 'web' && (!website || website.tenantId !== identity.tenantId || !website.enabled
      || !Number.isSafeInteger(website.revision) || website.revision < 1)) return unavailable();
  return { policy, releaseRevision: requestFingerprint({ profile, published, website,
    policy: { ...policy, expiresAt: policy.expiresAt.toISOString() } }) };
}

/** Fixed server-selected surface; model execution requires separate server opt-in.
 * The authenticated surface, published workspace and managed customer policy
 * are read from real services/storage, never from URL/body scope or a local flag.
 */
export function composeStandardClientBookingEntry(input: Dependencies, channel: 'web' | 'wechat_miniprogram'): AiClientEntryApplication & {
  /** Server-only metadata for the independent owned-order publication. */
  readOrderHostCapabilities: AiClientEntryApplication['readHostCapabilities'];
} {
  const clock = input.clock ?? (() => new Date());
  const unavailable = (): never => { throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_entry_not_published'); };
  const observeEntryRefusal = async (request: AiClientApplicationRequest, error: unknown,
    observation: { durationMs: number; operation?: string; origin?: ClientEntryAuditOrigin }, originalIdentity?: ClientRequestContext) => {
    let identity = originalIdentity;
    if (!identity) {
      const authorization = request?.headers?.authorization, ip = request?.ip;
      if (typeof authorization !== 'string') return;
      const session = createAiGuardedClientSession(input.guard, { current: async () => ({ authorization, ip }) });
      try { identity = structuredClone(await session.current()); }
      catch { return; }
    }
    await recordClientEntryRefusal(input.db, identity, { channel,
      operation: observation.operation ?? 'admission', code: clientEntryRefusalCode(error), durationMs: observation.durationMs,
      ...(observation.origin ? { origin: observation.origin } : {}) });
  };
  const bind = <K extends Exclude<keyof AiClientEntryApplication, 'observeEntryRefusal'>>(name: K,
    originalScene?: 'order_explanation'): AiClientEntryApplication[K] => {
    const method = async (request: AiClientApplicationRequest, ...args: unknown[]) => withClientEntryRefusalAudit(async () => {
      const started = Date.now(), auditRequest = { headers: { authorization: request?.headers?.authorization }, ip: request?.ip };
      let originalIdentity: ClientRequestContext | undefined;
      let original: ClientEntryAuditOrigin | undefined;
      try {
        // Snapshot JSON commands before current-identity/storage awaits. A signal
        // is deliberately the original cancellation channel, not serialized data.
        args = args.map(value => value instanceof AbortSignal ? value : structuredClone(value));
        const signal = args.find((value): value is AbortSignal => value instanceof AbortSignal);
        const check = () => { if (signal?.aborted) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_request_interrupted'); };
        check();
         const authorization = auditRequest.headers.authorization;
        if (typeof authorization !== 'string') return unavailable();
         const ip = auditRequest.ip;
        const boundRequest = { headers: { authorization }, ip };
        const session = createAiGuardedClientSession(input.guard, { current: async () => { check(); return { authorization, ip }; } });
        // An order explanation must not borrow a quote-scene publication. Task
        // controls remain bound to the explicitly assembled original scene.
        const orderScene = name === 'readOrderExplanation' || originalScene === 'order_explanation';
        const navigation = name === 'readOrderTaskHostCapabilities' || name === 'readOrderAction' || name === 'revalidateOrderAction';
        const navigationCommand = !navigation ? undefined : name === 'revalidateOrderAction'
          ? aiClientOrderActionRevalidationSchema.parse(args[0]) : aiClientOrderActionSourceSchema.parse(args[0]);
        const navigationSource = navigationCommand && { material: navigationCommand.material, task: navigationCommand.task };
        let navigationOrigin: { hash: string; sceneCode: string; sceneVersion: string } | undefined;
        let sceneCode = orderScene ? 'order_explanation' : input.tasks!.sceneCode;
        let sceneVersion = orderScene ? '1' : input.tasks!.sceneVersion;
        const select = async () => {
          const identity = structuredClone(await session.current());
          originalIdentity ??= identity;
          if (navigationSource) {
            const original = await new PrismaClientTaskInputRepository(input.tasks!.db)
              .readOrderNavigationSource(originalClientMaterialScope(identity, channel), navigationSource);
            check();
            const current = { hash: requestFingerprint(original), sceneCode: original.sceneCode, sceneVersion: original.sceneVersion };
            if (navigationOrigin && requestFingerprint(current) !== requestFingerprint(navigationOrigin))
              throw new AiClientEntryError('AI_ACCESS_DENIED', 'order_navigation_original_changed');
            navigationOrigin = current; sceneCode = current.sceneCode; sceneVersion = current.sceneVersion;
          }
          const selected = await readStandardClientEntryPublication(input.db, identity, channel, { sceneCode, sceneVersion }, clock(),
            name === 'prepare' || name === 'createTask' || name === 'prepareGoal');
          return { identity, ...selected };
        };
        const before = await select();
        check();
        const revalidateQuotePublication = async () => {
          check();
          const current = await select();
          check();
          // Bootstrap's public service summary is narrower than the standard
          // channel/profile/website publication. Carry this exact request's full
          // revision to the original quote INSERT, after Core preparation waits.
          if (current.releaseRevision !== before.releaseRevision
            || requestFingerprint(current.identity) !== requestFingerprint(before.identity)) {
            throw new AiClientEntryError('AI_ACCESS_DENIED', 'client_publication_changed');
          }
        };
        const application = composeRequestBoundClientApplication({ ...input,
          revalidateQuotePublication,
          tasks: { db: input.db, subscriptions: input.tasks!.subscriptions, sceneCode, sceneVersion },
          bookingTransfer: { db: input.db, publication: (identity, originalChannel, create) =>
            readStandardClientEntryPublication(input.db, identity, originalChannel,
              { sceneCode: input.tasks!.sceneCode, sceneVersion: input.tasks!.sceneVersion }, clock(), create) },
          // Explicit server dependencies, when installed, remain subject to the
          // original persistent Gateway/ledger checks. Never accept them in HTTP.
        }, { enabled: true, tenantCode: before.identity.tenantCode, serviceCode: before.identity.workspaceCode, channel,
          entry: { enabled: true, releaseRevision: before.releaseRevision } });
        const consumer = { ...application, ...composeClientOriginalBookingHttp(application) };
        try {
          original = await waitForTaskApplicationDependency(() => readClientEntryAuditOrigin(consumer, boundRequest,
            before.identity, channel, name, args[0]), false, signal);
        } catch { /* This bounded read cannot authorize a write or an audit association. */ }
        check();
        const result = await Reflect.apply(consumer[name], consumer, [boundRequest, ...args]);
        const revalidateDelivery = async () => {
          let after;
          try { after = await select(); } catch { throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'original_operation_requires_recheck'); }
          if (after.releaseRevision !== before.releaseRevision || requestFingerprint(after.identity) !== requestFingerprint(before.identity))
            throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_publication_changed');
          check();
        };
        await revalidateDelivery();
        if (clientEntryResultUnknown(result)) {
          const unknown = new AiClientEntryError('AI_RESULT_UNKNOWN', 'original_result_unknown');
          try { await observeEntryRefusal(auditRequest, unknown,
            { operation: name, durationMs: Math.max(0, Date.now() - started), origin: original }, originalIdentity); }
          catch { throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_entry_refusal_audit_unavailable'); }
          await revalidateDelivery();
        }
        check(); return result;
      } catch (error) {
        const failure = error !== null && typeof error === 'object' ? error
          : new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'client_entry_refused');
        try { await observeEntryRefusal(auditRequest, failure, { operation: name, durationMs: Math.max(0, Date.now() - started), origin: original }, originalIdentity); }
        catch {
          const unavailableAudit = new AiClientEntryError(clientEntryRefusalCode(failure) === 'AI_RESULT_UNKNOWN'
            ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE', 'client_entry_refusal_audit_unavailable');
          throw unavailableAudit;
        }
        throw failure;
      }
    });
    return method as AiClientEntryApplication[K];
  };
  if (!input.tasks?.subscriptions || !input.tasks.sceneCode || !input.tasks.sceneVersion || !input.db
    || !['web', 'wechat_miniprogram'].includes(channel)) return unavailable();
  return {
    observeEntryRefusal,
    readOrderHostCapabilities: bind('readHostCapabilities', 'order_explanation'),
    readOrderTaskHostCapabilities: bind('readOrderTaskHostCapabilities'),
    readOrderAction: bind('readOrderAction'), revalidateOrderAction: bind('revalidateOrderAction'),
    readHostCapabilities: bind('readHostCapabilities'), issueAction: bind('issueAction'),
    prepare: bind('prepare'), readOrderMaterialReceipt: bind('readOrderMaterialReceipt'),
    prepareGoal: bind('prepareGoal'), readGoalPreparation: bind('readGoalPreparation'), readGoalCandidates: bind('readGoalCandidates'),
    prepareGoalQuote: bind('prepareGoalQuote'), readGoalQuotePreparation: bind('readGoalQuotePreparation'),
    createTask: bind('createTask'), readTaskCreation: bind('readTaskCreation'),
    readOriginalTaskAccounting: bind('readOriginalTaskAccounting'), reconcileOriginalTaskAccounting: bind('reconcileOriginalTaskAccounting'),
    createBookingDraft: bind('createBookingDraft'), chooseBookingDraft: bind('chooseBookingDraft'), readBookingDraft: bind('readBookingDraft'),
    handoffBookingDraft: bind('handoffBookingDraft'), readBookingHandoff: bind('readBookingHandoff'), readBookingOperation: bind('readBookingOperation'),
    issueBookingTransfer: bind('issueBookingTransfer'), readBookingTransferIssue: bind('readBookingTransferIssue'),
    consumeBookingTransfer: bind('consumeBookingTransfer'), readBookingTransferReceipt: bind('readBookingTransferReceipt'),
    acceptBookingSubmission: bind('acceptBookingSubmission'), readBookingAcceptance: bind('readBookingAcceptance'),
    submitAcceptedBooking: bind('submitAcceptedBooking'), readBookingSubmission: bind('readBookingSubmission'),
    prepareQuoteParameters: bind('prepareQuoteParameters'), confirmQuoteParameters: bind('confirmQuoteParameters'),
    readQuotePreparationOperation: bind('readQuotePreparationOperation'), readPreparedQuoteOriginal: bind('readPreparedQuoteOriginal'),
    prepareOriginalQuoteBooking: bind('prepareOriginalQuoteBooking'), readOriginalQuoteBookingOperation: bind('readOriginalQuoteBookingOperation'),
    readTaskSnapshot: bind('readTaskSnapshot'), readTaskEvents: bind('readTaskEvents'), readOrderExplanation: bind('readOrderExplanation'), readSource: bind('readSource'),
    requestOriginalTaskCancellation: bind('requestOriginalTaskCancellation'), reconcileOriginalTaskInputCancellation: bind('reconcileOriginalTaskInputCancellation'),
    readOriginalTaskCancellationReceipt: bind('readOriginalTaskCancellationReceipt'),
    readOriginalTaskCancellationSettlementReceipt: bind('readOriginalTaskCancellationSettlementReceipt'),
    settleOriginalTaskUnstartedCancellation: bind('settleOriginalTaskUnstartedCancellation'),
    readOriginalTaskModelInput: bind('readOriginalTaskModelInput'), submitOriginalTaskModelInput: bind('submitOriginalTaskModelInput'),
    readOriginalTaskModelInputReceipt: bind('readOriginalTaskModelInputReceipt'), startOriginalTaskModel: bind('startOriginalTaskModel'),
    recoverOriginalTaskModel: bind('recoverOriginalTaskModel'), reconcileOriginalTaskModel: bind('reconcileOriginalTaskModel'),
    continueOriginalTaskModelInput: bind('continueOriginalTaskModelInput'), readOriginalTaskModelResult: bind('readOriginalTaskModelResult'),
  };
}

@Controller(AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath)
export class WebsiteClientEntryController extends AiClientEntryController {
  constructor(@Inject(AI_WEBSITE_ENTRY) application: AiClientEntryApplication) { super(application); }
}
@Controller(AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath)
export class WechatClientEntryController extends AiClientEntryController {
  constructor(@Inject(AI_WECHAT_ENTRY) application: AiClientEntryApplication) { super(application); }
}
