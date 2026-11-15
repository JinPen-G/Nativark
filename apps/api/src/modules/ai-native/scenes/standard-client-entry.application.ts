import { Controller, Inject } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CLIENT_ENTRY_HTTP_DRAFT, aiClientOrderActionSourceSchema, aiClientOrderActionRevalidationSchema } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { createAiGuardedClientSession } from '../client-scene.composition';
import { AiClientEntryError } from './client-entry-action';
import { AiClientEntryController, type AiClientEntryApplication } from './client-entry.controller';
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
  const bind = <K extends keyof AiClientEntryApplication>(name: K,
    originalScene?: 'order_explanation'): AiClientEntryApplication[K] => {
    const method = async (request: AiClientApplicationRequest, ...args: unknown[]) => {
      // Snapshot JSON commands before current-identity/storage awaits. A signal
      // is deliberately the original cancellation channel, not serialized data.
      args = args.map(value => value instanceof AbortSignal ? value : structuredClone(value));
      const signal = args.find((value): value is AbortSignal => value instanceof AbortSignal);
      const check = () => { if (signal?.aborted) throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_request_interrupted'); };
      check();
      const authorization = request?.headers?.authorization;
      if (typeof authorization !== 'string') return unavailable();
      const ip = request.ip;
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
      const application = composeRequestBoundClientApplication({ ...input,
        tasks: { db: input.db, subscriptions: input.tasks!.subscriptions, sceneCode, sceneVersion },
        bookingTransfer: { db: input.db, publication: (identity, originalChannel, create) =>
          readStandardClientEntryPublication(input.db, identity, originalChannel,
            { sceneCode: input.tasks!.sceneCode, sceneVersion: input.tasks!.sceneVersion }, clock(), create) },
        // Explicit server dependencies, when installed, remain subject to the
        // original persistent Gateway/ledger checks. Never accept them in HTTP.
      }, { enabled: true, tenantCode: before.identity.tenantCode, serviceCode: before.identity.workspaceCode, channel,
        entry: { enabled: true, releaseRevision: before.releaseRevision } });
      const consumer = { ...application, ...composeClientOriginalBookingHttp(application) };
      const result = await Reflect.apply(consumer[name], consumer, [boundRequest, ...args]);
      let after;
      try { after = await select(); } catch { throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'original_operation_requires_recheck'); }
      if (after.releaseRevision !== before.releaseRevision || requestFingerprint(after.identity) !== requestFingerprint(before.identity)) {
        throw new AiClientEntryError('AI_RESULT_UNKNOWN', 'client_publication_changed');
      }
      check(); return result;
    };
    return method as AiClientEntryApplication[K];
  };
  if (!input.tasks?.subscriptions || !input.tasks.sceneCode || !input.tasks.sceneVersion || !input.db
    || !['web', 'wechat_miniprogram'].includes(channel)) return unavailable();
  return {
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
