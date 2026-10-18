/**
 * 职责：将正式业务服务、当前身份和持久仓储接到 AI Native 的 Nest provider 入口。
 * 边界：装配不等于执行开放；各请求仍核验当前政策、权限与实际可用的依赖。
 * 接续时从这里追踪具体场景的消费者；不要在此补假授权、第二 Gateway 或预算账本。
 */
import type { FactoryProvider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ApiAuthGuard } from '../../common/api-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { RentalCoreService } from '../rental-core/rental-core.service';
import { RentalCoreController } from '../rental-core/rental-core.controller';
import { RentalBusinessService } from '../rental-core/rental-business.service';
import { RentalWorkspaceReportRepository } from '../rental-core/rental-workspace-report.repository';
import { MembershipService } from '../platform/membership.service';
import { PaymentRuntimeService } from '../integrations/payment.runtime.service';
import { ClientApiService } from '../client/client-api.service';
import { composeStandardClientBookingEntry, AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY } from './scenes/standard-client-entry.application';
import { randomUUID } from 'node:crypto';
import { FileStorageRuntimeService } from '../integrations/file-storage.runtime.service';
import { AiRetentionService } from './privacy/retention.service';
import { AI_RETENTION_REQUESTS, type AiRetentionRequestFactory } from './privacy/retention.controller';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composeRequestBoundOriginalScenes, composeRequestBoundOriginalTaskRecoveryReaders, composeRequestBoundOriginalTaskActionPolicies,
  composeRequestBoundScenePlanPolicies,
  composeRequestBoundOriginalTaskAccounting,
  composeRequestBoundPersistedOriginalOrderRead, type RequestBoundOriginalSceneDependencies } from './scenes/request-bound-scenes.application';
import { AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, originalOrderReadRequestMethods,
  type OriginalOrderReadHttpRequests } from './scenes/original-order-read.controller';
import { gatewayPricingSelectionSchema } from './budget/gateway-pricing-evidence';
import { selectOriginalOrderReadHttpRequests } from './scenes/original-order-read-http.module';
import { AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS } from './scenes/original-task-accounting-http.module';
import { AI_BUDGET_MANAGEMENT } from './budget/budget-management.module';
import { composeRequestBoundBudgetManagement } from './budget/budget-management.application';
import { BudgetError } from './budget/budget.ports';
import { TextCapabilityProbeRequestFactory } from './text-capability-probe-request.factory';
import { TEXT_CAPABILITY_PROBE_REQUESTS } from './text-capability-probe.controller';
import { AI_NATIVE_MODEL_SETTINGS_REQUESTS, composeRequestBoundModelSettings } from './model-settings.application';
import { AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS, composeRequestBoundPlatformModelSettings } from './platform-model-settings.application';
import { TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE, textProbeCommandSchema } from './text-capability-probe';
import { AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, AI_ORIGINAL_TASK_ACTION_POLICIES,
  AI_SCENE_PLAN_POLICIES } from './scenes/original-scenes.controller';
import { StaffInspectionRequestFactory } from './inspection-assist/inspection-assist.composition';
import { AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_ENABLED,
  AI_STAFF_INSPECTION_OPERATIONS } from './inspection-assist/staff-inspection-assist.controller';

export const AI_NATIVE_CLIENT_ENTRY_PROVIDERS: FactoryProvider[] = ([
  [AI_WEBSITE_ENTRY, 'web'], [AI_WECHAT_ENTRY, 'wechat_miniprogram'],
] as const).map(([provide, channel]) => ({
  provide, inject: [PrismaService, ApiAuthGuard, SubscriptionService, ClientApiService],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, subscriptions: SubscriptionService, client: ClientApiService) =>
    composeStandardClientBookingEntry({ db, guard, client,
      tasks: { db, subscriptions, sceneCode: 'quote_clarification', sceneVersion: '1' },
      quotePreparation: client, bookingSubmission: client }, channel),
}));

export const AI_NATIVE_MODEL_SETTINGS_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_MODEL_SETTINGS_REQUESTS, inject: [PrismaService, AuthService, ApiAuthGuard, SecretBox],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, secrets: SecretBox) =>
    composeRequestBoundModelSettings({ db, auth, guard, secrets })
};
export const AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS, inject: [PrismaService, ApiAuthGuard, SecretBox],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, secrets: SecretBox) =>
    composeRequestBoundPlatformModelSettings({ db, guard, secrets })
};

export const AI_NATIVE_RETENTION_PROVIDER: FactoryProvider = {
  provide: AI_RETENTION_REQUESTS, inject: [PrismaService, AuthService, FileStorageRuntimeService],
  useFactory: (db: PrismaService, auth: AuthService, files: FileStorageRuntimeService): AiRetentionRequestFactory => request => {
    const authorization = request.headers.authorization, requestId = randomUUID();
    if (typeof authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return new AiRetentionService(db, auth, { current: async () => ({ authorization, requestId, audience: 'operator' }) }, files);
  },
};

/** Historical observations only. No storage reader, recognition driver or Core
 * submission port is supplied; normal staff pages can reopen owned history,
 * but cannot use this registration to create drafts or execute inspections. */
export const AI_NATIVE_STAFF_RECEIPT_PROVIDERS: FactoryProvider[] = [{
  provide: AI_STAFF_INSPECTION_REQUESTS,
  inject: [PrismaService, ApiAuthGuard, RentalCoreService],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, core: RentalCoreService) =>
    new StaffInspectionRequestFactory({ db, guard, core })
}, {
  provide: AI_STAFF_INSPECTION_ENABLED, useFactory: () => true
}, {
  provide: AI_STAFF_INSPECTION_OPERATIONS,
  useFactory: () => Object.freeze(['history-read', 'receipt-host-read', 'result-save-receipt'])
}];

/** Standard application wiring, not an execution enable switch. No startup
 * reads, policies, credentials, worker, model adapter or financial ledger are
 * created here. Every request uses its own current Guard/Auth/ALS context.
 * Missing/disabled persisted scene policy or AI entitlement refuses creation.
 * Only the existing order-fact preparation is selected for this first host;
 * this preparation provider never constructs model execution or business writes.
 */
const originalSceneInjection = [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, RentalCoreService,
  RentalBusinessService, RentalWorkspaceReportRepository, MembershipService, PaymentRuntimeService];
function originalSceneDependencies(db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService): RequestBoundOriginalSceneDependencies {
  return { db, auth, guard, subscriptions, core, business, reports, memberships, payments,
      creationRules: [{ sceneCode: 'order_explanation', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:view'], maxInputAgeMs: 300000 }] };
}
export const AI_NATIVE_ORIGINAL_REQUEST_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_SCENE_REQUESTS, inject: [...originalSceneInjection, ModuleRef],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, moduleRef?: Pick<ModuleRef, 'get'>) =>
    composeRequestBoundOriginalScenes({ ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      // Resolve the EXISTING controller lazily after startup, not a duplicate
      // Core instance. Only its non-persistent preview is exposed to this host.
      ...(moduleRef ? { extensionPreview: { previewExtension: (...args: Parameters<RentalCoreController['previewExtension']>) =>
        moduleRef.get(RentalCoreController, { strict: false }).previewExtension(...args) } } : {})
    }, { enabled: true, audience: 'operator' })
};

/** Original AI ledger recovery only. Keep this independent of the server's
 * new-execution configuration: current owner/resource/action authorization and
 * persisted same-call evidence, not an active model or old input TTL, decide
 * access. This cannot reserve, dispatch, infer non-consumption or move funds. */
export const AI_NATIVE_ORIGINAL_ACCOUNTING_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS, inject: originalSceneInjection,
  useFactory: (...args: Parameters<typeof originalSceneDependencies>) =>
    composeRequestBoundOriginalTaskAccounting(originalSceneDependencies(...args), { enabled: true, audience: 'operator' })
};

/** Existing current-task policies gate each read. Decode only the supported
 * original order/text result (including its fixed read-tool candidates), never
 * grant those candidates execution. This schema ceiling is not a model route,
 * new-call entitlement, runner driver, capability claim or pricing producer.
 * Knowledge snapshots reuse current persisted ACL and human-consent checks;
 * this host neither collects new context nor parses/uploads or confirms data. */
export const AI_NATIVE_ORIGINAL_OBSERVATION_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, inject: [...originalSceneInjection, FileStorageRuntimeService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, files?: FileStorageRuntimeService) =>
    composeRequestBoundOriginalTaskRecoveryReaders(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      { enabled: true, audience: 'operator' }, {
        policy: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: 32768, orderExplainTool: true },
        // Direct text-only compositions may omit files. A frozen snapshot with
        // knowledge then remains unavailable, never stripped to expose its text.
        ...(files ? { knowledge: { db, policyDb: db, fileRuntime: files, memory: { db }, includePreferences: false } } : {})
      })
};

/** Server DI only. No environment/model/request setting can publish this token.
 * Omitted by the standard root, so registration alone grants no execution.
 * Operators still need real current task/action/plan policies and all Gateway
 * capability, connection, entitlement and financial evidence dependencies. */
export const AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION = Symbol('AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION');
const orderExecutionConfiguration = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), platformProfileId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    maxOutputTokens: z.number().int().min(1).max(32768), pricing: gatewayPricingSelectionSchema,
    host: z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      leaseMs: z.number().int().min(1).max(120000) }).strict(), includeKnowledge: z.boolean() }).strict()
]);
function readOrderExecutionConfiguration(value: unknown) {
  try {
    const parsed = orderExecutionConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
    if (parsed.success) return parsed.data;
  } catch { /* Non-data DI values cannot become configuration. */ }
  throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
}
/** Separate server-owned probe configuration: enabling an order workflow must
 * not implicitly permit billable capability challenges (or vice versa). The
 * root installs neither token and never seeds policies or runs a probe. */
export const AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION = Symbol('AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION');
const probeConfiguration = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), platformProfileId: orderExecutionConfiguration.options[1].shape.platformProfileId,
    priceVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
    sceneVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
    host: orderExecutionConfiguration.options[1].shape.host,
    capabilities: z.array(textProbeCommandSchema.shape.capability.unwrap()).min(1).max(6)
      .refine(values => values.includes('text') && new Set(values).size === values.length),
    taskActionPolicyTtlMs: z.number().int().min(1).max(120000) }).strict()
]);
function readProbeConfiguration(value: unknown) {
  try {
    const parsed = probeConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
    if (parsed.success) return parsed.data;
  } catch { /* Do not accept live adapters/functions as server data. */ }
  throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
}
const probeOperations = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run',
  'claim_recovery_run', 'release_run', 'transition_task', 'request_input'] as const;
/** The existing immutable request -> persistent task -> measured runner ->
 * unique Gateway/dispatch/ledger -> evidence workflow. This factory performs
 * no reads on assembly. Calls quotas are not supplier money/token pricing;
 * current Guard, scene/action policy, entitlement and budget gates still apply.
 * No transport or authority can be provided in a request/configuration body. */
export const AI_NATIVE_CAPABILITY_PROBE_PROVIDER: FactoryProvider<Pick<TextCapabilityProbeRequestFactory, 'open'>> = {
  provide: TEXT_CAPABILITY_PROBE_REQUESTS,
  inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
    { token: AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    secrets: SecretBox, serverValue?: unknown) => {
    const configuration = readProbeConfiguration(serverValue);
    if (!configuration.enabled) return Object.freeze({ open(): never {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    } });
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function') {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    return new TextCapabilityProbeRequestFactory({ db, auth, guard, subscriptions, secrets,
      platformProfileId: configuration.platformProfileId, sceneVersion: configuration.sceneVersion,
      priceVersion: configuration.priceVersion, pricing: { mode: 'persisted_calls', priceVersion: configuration.priceVersion },
      host: configuration.host, probeCapabilities: configuration.capabilities,
      taskActionPolicyTtlMs: configuration.taskActionPolicyTtlMs,
      taskActionPolicies: probeOperations.map(operation => ({ operation, requiredPermissions: ['system:params:manage'] })) });
  }
};
/** Explicit current-manager budget configuration, never budget initialization
 * at application startup. Missing trusted profile/configuration stays closed;
 * models, credentials and whitelist changes are not accepted from tenant bodies.
 * Platform writes retain their distinct platform Guard and authority. */
export const AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER: FactoryProvider<ReturnType<typeof composeRequestBoundBudgetManagement>> = {
  provide: AI_BUDGET_MANAGEMENT,
  inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
    { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    secrets: SecretBox, serverValue?: unknown) => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) {
      const unavailable = async (): Promise<never> => { throw new BudgetError('UNAVAILABLE'); };
      return Object.freeze({ read: unavailable, change: unavailable, initialize: unavailable,
        refreshConfiguration: unavailable, platformRead: unavailable, platformSave: unavailable });
    }
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function') throw new BudgetError('UNAVAILABLE');
    return composeRequestBoundBudgetManagement({
      // The existing settings-only root exposes no pricing/reserve method;
      // this version never substitutes a calls price for token/money usage.
      tenant: { db, auth, guard, subscriptions, callPriceVersion: configuration.pricing.priceVersion,
        initialConfiguration: { db, secrets, platformProfileId: configuration.platformProfileId } },
      platform: { db, guard, profileId: configuration.platformProfileId }
    }, { enabled: true });
  }
};
const originalReadOperations = ['read_metadata', 'read_events', 'read_step_terminal'] as const;
const originalOrderExecutionOperations = ['claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'takeover_run'] as const;

/** Explicit same-owner manager CAS, never policy seeding during task creation.
 * Without server execution configuration, only the original read policies are
 * exposed. The closed order chain adds no approval or free-input permission. */
export const AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_TASK_ACTION_POLICIES,
  inject: [...originalSceneInjection, { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, serverValue?: unknown) => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    const operations = [...originalReadOperations, ...(configuration.enabled ? originalOrderExecutionOperations : [])];
    return composeRequestBoundOriginalTaskActionPolicies(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments), {
        enabled: true, audience: 'operator', ttlMs: 120000,
        templates: operations.map(operation => ({ operation, requiredPermissions: ['rental-os:order:view'] }))
      });
  }
};

/** Human-managed limits/tool ceiling for explicitly selected order/probe scenes. These
 * writes use the existing Guard, scoped CAS and same-transaction audit; they
 * neither create per-task policies nor grant a lease, budget or dispatch. */
export const AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER: FactoryProvider<ReturnType<typeof composeRequestBoundScenePlanPolicies>> = {
  provide: AI_SCENE_PLAN_POLICIES,
  inject: [...originalSceneInjection, { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, serverValue?: unknown, probeValue?: unknown) => {
    const execution = readOrderExecutionConfiguration(serverValue), probe = readProbeConfiguration(probeValue);
    const scenes = [
      ...(execution.enabled ? [{ scene: { code: 'order_explanation', version: '1' },
        tools: ['ai.model.text', 'rental.order.explain'] as const }] : []),
      ...(probe.enabled ? [{ scene: { code: TEXT_PROBE_SCENE, version: probe.sceneVersion },
        tools: [TEXT_CAPABILITY_PROBE_TOOL] as const }] : [])
    ];
    if (!scenes.length) {
      const unavailable = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
      return Object.freeze({ read: unavailable, change: unavailable });
    }
    return composeRequestBoundScenePlanPolicies(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments), {
        enabled: true, audience: 'operator', scenes
      });
  }
};
export const AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER: FactoryProvider<OriginalOrderReadHttpRequests> = {
  provide: AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, secrets: SecretBox,
    files: FileStorageRuntimeService, serverValue?: unknown): OriginalOrderReadHttpRequests => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) return Object.freeze(Object.fromEntries(originalOrderReadRequestMethods.map(method =>
      [method, async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }]))) as unknown as OriginalOrderReadHttpRequests;
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function'
      || configuration.includeKnowledge && !files) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return selectOriginalOrderReadHttpRequests(composeRequestBoundPersistedOriginalOrderRead({
      ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      scene: { code: 'order_explanation', version: '1' },
      gatewayScene: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: configuration.maxOutputTokens, orderExplainTool: true },
      gateway: { secrets, platformProfileId: configuration.platformProfileId, routeScene: 'chat',
        pricing: configuration.pricing, nativeProtocol: 'openai_chat_completions' },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host,
      orderReadChain: { enabled: true, answerRoundTrip: true } }));
  }
};
