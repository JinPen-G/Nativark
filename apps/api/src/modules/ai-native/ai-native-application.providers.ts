/**
 * 职责：将正式业务服务、当前身份和持久仓储接到 AI Native 的 Nest provider 入口。
 * 边界：装配不等于执行开放；各请求仍核验当前政策、权限与实际可用的依赖。
 * 接续时从这里追踪具体场景的消费者；不要在此补假授权、第二 Gateway 或预算账本。
 */
import type { FactoryProvider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import { NATIVE_MODEL_PROTOCOLS } from './native-model-protocols';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { ApiAuthGuard } from '../../common/api-auth.guard';
import { SubscriptionService } from '../subscription/subscription.service';
import { RentalCoreService } from '../rental-core/rental-core.service';
import { RentalCoreController } from '../rental-core/rental-core.controller';
import { RentalOrderConfirmationService } from '../rental-core/rental-order-confirmation.service';
import { RentalBusinessFactRepository } from '../rental-core/rental-business-fact.repository';
import { RentalIdempotencyRepository } from '../rental-core/rental-idempotency.repository';
import { CategoryGovernanceController } from '../rental-core/category-governance.controller';
import { AI_CATEGORY_DRAFT_REQUESTS, composeCategoryDraftRequests } from './category-assist/category-draft.application';
import { RentalBusinessService } from '../rental-core/rental-business.service';
import { RentalWorkspaceReportRepository } from '../rental-core/rental-workspace-report.repository';
import { MembershipService } from '../platform/membership.service';
import { PaymentRuntimeService } from '../integrations/payment.runtime.service';
import { ClientApiService } from '../client/client-api.service';
import { composeStandardClientBookingEntry, standardClientModelDependencies, AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY,
  AI_NATIVE_CLIENT_MODEL_CONFIGURATION, AI_NATIVE_CLIENT_MODEL_ADAPTERS } from './scenes/standard-client-entry.application';
import { randomUUID } from 'node:crypto';
import { createClientTaskPolicyManagementApplication } from './scenes/client-task-policy-management.service';
import { AI_NATIVE_CLIENT_TASK_POLICIES, AI_NATIVE_CLIENT_POLICY_CONFIGURATION } from './scenes/client-task-policy.controller';
import { FileStorageRuntimeService } from '../integrations/file-storage.runtime.service';
import { TenantIntegrationService } from '../integrations/tenant-integration.service';
import { AiRetentionService } from './privacy/retention.service';
import { AI_RETENTION_REQUESTS, type AiRetentionRequestFactory } from './privacy/retention.controller';
import { AiTaskRepositoryError } from './ai-task.repository';
import { composeRequestBoundOriginalScenes, composeRequestBoundOriginalTaskRecoveryReaders, composeRequestBoundOriginalTaskActionPolicies,
  composeRequestBoundScenePlanPolicies, composeClarifiedQuoteSelectionRequests,
  composeRequestBoundOriginalTaskAccounting,
  composeRequestBoundPersistedOriginalOrderRead, composeRequestBoundPersistedOriginalSceneModel,
  type RequestBoundOriginalSceneDependencies } from './scenes/request-bound-scenes.application';
import { AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, originalOrderReadRequestMethods,
  type OriginalOrderReadHttpRequests } from './scenes/original-order-read.controller';
import { gatewayPricingSelectionSchema } from './budget/gateway-pricing-evidence';
import { taskInputCountingConfigurationSchema } from './task-model-gateway.composition';
import { selectOriginalOrderReadHttpRequests } from './scenes/original-order-read-http.module';
import { AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS } from './scenes/original-task-accounting-http.module';
import { AI_ORIGINAL_OPENING_MODEL_REQUESTS, type OpeningModelRequests } from './scenes/opening-model-execution.controller';
import { AI_BUDGET_MANAGEMENT, AI_GATEWAY_PRICING_HISTORY } from './budget/budget-management.module';
import { GatewayPricingRequestFactory } from './budget/gateway-pricing-request.composition';
import { composeRequestBoundBudgetManagement } from './budget/budget-management.application';
import { BudgetError } from './budget/budget.ports';
import { AI_COUNTING_REQUESTS } from './input-counting/input-counting-request.module';
import { composeStandardInputCounting, AI_NATIVE_INPUT_COUNTING_CONFIGURATION } from './input-counting/input-counting-standard.application';
import { TextCapabilityProbeRequestFactory } from './text-capability-probe-request.factory';
import { PLATFORM_CAPABILITY_PROBE_REQUESTS } from './platform-capability-probe/platform-capability-probe.controller';
import { composeStandardPlatformProbe, AI_NATIVE_PLATFORM_PROBE_CONFIGURATION, AI_NATIVE_PLATFORM_PROBE_AUDIT } from './platform-capability-probe/platform-capability-standard.application';
import type { UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import { TEXT_CAPABILITY_PROBE_REQUESTS } from './text-capability-probe.controller';
import { AI_NATIVE_MODEL_SETTINGS_REQUESTS, composeRequestBoundModelSettings } from './model-settings.application';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { AI_NATIVE_TASK_CENTER_REQUESTS, composeRequestBoundTaskCenter } from './task-center.application';
import { AI_CONVERSATION_REQUESTS, composeAiConversationRequests } from './conversation.application';
import { AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS, composeRequestBoundPlatformModelSettings } from './platform-model-settings.application';
import { HumanMemoryManagementRequestFactory } from './knowledge/human-memory-management.composition';
import { HumanKnowledgeManagementRequestFactory } from './knowledge/human-knowledge-management.composition';
import { HumanKnowledgeConsumptionRequestFactory } from './knowledge/human-knowledge-consumption.composition';
import { KNOWLEDGE_POLICY_MANAGEMENT, createKnowledgePolicyManagementFactory } from './knowledge/knowledge-policy-management.composition';
import { TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE, textProbeCommandSchema } from './text-capability-probe';
import { AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, AI_ORIGINAL_TASK_ACTION_POLICIES,
  AI_SCENE_PLAN_POLICIES, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS } from './scenes/original-scenes.controller';
import { StaffInspectionRequestFactory } from './inspection-assist/inspection-assist.composition';
import { composeStandardStaffRecognition, readStaffRecognitionConfiguration, STAFF_RECOGNITION_SCENES,
  AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, AI_NATIVE_STAFF_RECOGNITION_RUNTIME, AI_NATIVE_STAFF_RECOGNITION_ADAPTERS } from './inspection-assist/inspection-standard.application';
import { INSPECTION_RECOGNITION_TASKS } from './inspection-assist/inspection-recognition-task.controller';
import { AI_STAFF_INSPECTION_ACCOUNTING, composeStaffInspectionAccounting } from './staff-inspection-accounting.composition';
import { AI_STAFF_INSPECTION_TASK_POLICIES } from './staff-inspection-task-policy.composition';
import { INSPECTION_OBJECT_READER } from './inspection-assist/inspection-media.reader';
import { TenantInspectionObjectReader } from '../integrations/inspection-object-reader';
import type { ModelAdapter } from './model-gateway.ports';
import { HumanAutomationRequestFactory } from './automation/human-automation-request.composition';
import { HumanAutomationPolicyRequestFactory } from './automation/human-automation-policy-request.composition';
import { BUSINESS_FAILURE_OUTBOX, PrismaBusinessFailureOutbox } from './business-events/prisma-business-failure-outbox';
import { AI_APPROVED_SETTINGS_TOOL_CODE } from '@rental-os/shared';
import { AiSettingsTaskHttpModule } from './scenes/settings-task-http.module';
import { AI_SETTINGS_CHANGE_REQUESTS, AI_SETTINGS_TASK_CREATION_REQUESTS, AI_SETTINGS_TASK_CONTROL_REQUESTS,
  AI_SETTINGS_TASK_HTTP_REQUESTS, AI_SETTINGS_TASK_READ_REQUESTS } from './scenes/settings-task.controller';
import { AiHumanQuoteSelectionModule } from './task-request/human-quote-selection.module';
import { AI_HUMAN_QUOTE_SELECTION_REQUESTS, AI_HUMAN_QUOTE_ORDER_REQUESTS, AI_SELECTED_QUOTE_TASK_REQUESTS, AI_CLARIFIED_QUOTE_SELECTION_HTTP_REQUESTS } from './task-request/human-quote-selection.controller';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_ENABLED,
  AI_STAFF_INSPECTION_OPERATIONS } from './inspection-assist/staff-inspection-assist.controller';

/** Server-only capture/metadata configuration. Absent means no business outbox
 * writes and no automation input/task producer. Reads keep their current human
 * authority and original persisted grants; no worker or model is started. */
export const AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION = Symbol('AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION');
const failureConfiguration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), automation: z.object({ policyId: z.string().min(1).max(36)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict().optional() }).strict()]);
function readFailureConfiguration(value: unknown) {
  const parsed = failureConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return parsed.data;
}
export const AI_NATIVE_BUSINESS_FAILURE_PROVIDERS: FactoryProvider[] = [{
  provide: BUSINESS_FAILURE_OUTBOX, inject: [{ token: AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION, optional: true }],
  useFactory: (value?: unknown) => readFailureConfiguration(value).enabled ? new PrismaBusinessFailureOutbox() : undefined
}, {
  provide: HumanAutomationRequestFactory, inject: [PrismaService, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService,
    { token: AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, core: RentalCoreService, subscriptions: SubscriptionService, value?: unknown) => {
    const configuration = readFailureConfiguration(value);
    return new HumanAutomationRequestFactory({ db, auth, guard, core,
      ...(configuration.enabled && configuration.automation ? { automation: { policyId: configuration.automation.policyId, subscriptions } } : {}) });
  }
}, {
  provide: HumanAutomationPolicyRequestFactory, inject: [PrismaService, AuthService, ApiAuthGuard],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard) => new HumanAutomationPolicyRequestFactory({ db, auth, guard })
}];

/** Original notification changes only, not a generic settings executor. The
 * server selects this host; persisted plan/action grants and human approval
 * are still independently required. Reads remain available after disabling
 * new preparation/execution, and never acquire a lease or invoke a model. */
export const AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION = Symbol('AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION');
const settingsExecutionConfiguration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), host: z.object({ holderId: z.string().min(1).max(191)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), leaseMs: z.number().int().min(1).max(120000) }).strict() }).strict()]);
function readSettingsExecutionConfiguration(value: unknown) {
  const parsed = settingsExecutionConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return parsed.data;
}
const settingsEntries = [
  [AI_SETTINGS_CHANGE_REQUESTS, ['prepare']],
  [AI_SETTINGS_TASK_CREATION_REQUESTS, ['create']],
  [AI_SETTINGS_TASK_CONTROL_REQUESTS, ['configurePolicy', 'start']],
  [AI_SETTINGS_TASK_HTTP_REQUESTS, ['startSettingsTask', 'decideSettingsProposal', 'continueSettingsConfirmation', 'reconcileSettingsTask']],
  [AI_SETTINGS_TASK_READ_REQUESTS, []]
] as const;
export const AI_NATIVE_SETTINGS_LIFECYCLE_PROVIDERS: FactoryProvider[] = settingsEntries.map(([provide, executionMethods]) => ({
  provide, inject: [PrismaService, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService,
    { token: AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, core: RentalCoreService, subscriptions: SubscriptionService, value?: unknown) => {
    const configuration = readSettingsExecutionConfiguration(value);
    const host = configuration.enabled ? configuration.host : { holderId: 'ai-native-settings-observer', leaseMs: 30000 };
    const module = AiSettingsTaskHttpModule.registerOriginalLifecycle({ db, auth, guard, core, subscriptions,
      scene: { code: 'opening_diagnosis', version: '1' }, holderId: host.holderId }, {
      enabled: true, audience: 'operator', host, ttlMs: 120000,
      templates: (['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'decide_approval'] as const)
        .map(operation => ({ operation,
          requiredPermissions: ['rental-os:price:manage'] }))
    });
    const entry = module.providers?.find(item => typeof item === 'object' && 'provide' in item && item.provide === provide) as FactoryProvider | undefined;
    if (!entry || typeof entry.useFactory !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const requests = entry.useFactory() as Record<string, unknown>;
    return Object.freeze(Object.fromEntries(Object.entries(requests).map(([method, call]) =>
      [method, !configuration.enabled && (executionMethods as readonly string[]).includes(method)
        ? async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); } : call])));
  }
}));

export const AI_NATIVE_CLIENT_ENTRY_PROVIDERS: FactoryProvider[] = ([
  [AI_WEBSITE_ENTRY, 'web'], [AI_WECHAT_ENTRY, 'wechat_miniprogram'],
] as const).map(([provide, channel]) => ({
  provide, inject: [PrismaService, ApiAuthGuard, SubscriptionService, ClientApiService, SecretBox,
    { token: AI_NATIVE_CLIENT_MODEL_CONFIGURATION, optional: true }, { token: AI_NATIVE_CLIENT_MODEL_ADAPTERS, optional: true }],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, subscriptions: SubscriptionService, client: ClientApiService,
    secrets: SecretBox, value?: unknown, adapters?: readonly ModelAdapter[]) =>
    composeStandardClientBookingEntry({ db, guard, client,
      ...standardClientModelDependencies(db, secrets, value, adapters),
      tasks: { db, subscriptions, sceneCode: 'quote_clarification', sceneVersion: '1' },
      quotePreparation: client, bookingSubmission: client }, channel),
}));

export const AI_NATIVE_CLIENT_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_CLIENT_TASK_POLICIES,
  inject: [PrismaService, ApiAuthGuard, AuthService, { token: AI_NATIVE_CLIENT_POLICY_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, auth: AuthService, value?: unknown) => {
    const selected = z.object({ enabled: z.boolean() }).strict().safeParse(structuredClone(value ?? { enabled: false }));
    if (!selected.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return createClientTaskPolicyManagementApplication({ db, guard, modelPlan: { db, auth },
      scene: { sceneCode: 'quote_clarification', sceneVersion: '1' }, enabled: selected.data.enabled });
  }
};

export const AI_NATIVE_MODEL_SETTINGS_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_MODEL_SETTINGS_REQUESTS, inject: [PrismaService, AuthService, ApiAuthGuard, SecretBox],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, secrets: SecretBox) =>
    composeRequestBoundModelSettings({ db, auth, guard, secrets, discovery: createNativeModelEgressTransport(5000) })
};
export const AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION = Symbol('AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION');
export const AI_NATIVE_TASK_CENTER_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_TASK_CENTER_REQUESTS, inject: [PrismaService, AuthService, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS,
    ApiAuthGuard, SubscriptionService, RentalCoreService, RentalOrderConfirmationService, RentalBusinessFactRepository,
    { token: AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_SELECTED_QUOTE_TASK_REQUESTS, optional: true },
    { token: AI_SETTINGS_TASK_HTTP_REQUESTS, optional: true }, { token: ModuleRef, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService,
    originalResults: ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, guard: ApiAuthGuard,
    subscriptions: SubscriptionService, core: RentalCoreService, confirmation: RentalOrderConfirmationService,
    quoteFacts: RentalBusinessFactRepository, settingsValue?: unknown, orderValue?: unknown,
    selectedOrderResult?: { readResult(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown>;
      continueConfirmation(request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal): Promise<unknown> },
    settingsTask?: { continueSettingsConfirmation(request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal): Promise<unknown> },
    moduleRef?: Pick<ModuleRef, 'get'>) => {
    const settings = readSettingsExecutionConfiguration(settingsValue), order = readQuoteOrderConfiguration(orderValue);
    const clarification = () => {
      type Call = (request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal) => Promise<unknown>;
      let original: { resume?: Call; continueAnswer?: Call } | undefined;
      const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      try { original = moduleRef?.get(AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS, { strict: false }); }
      catch { throw unavailable(); }
      if (typeof original?.resume !== 'function' || typeof original.continueAnswer !== 'function') throw unavailable();
      return { resume: original.resume.bind(original), continueAnswer: original.continueAnswer.bind(original) };
    };
    return composeRequestBoundTaskCenter({ db, auth, originalDb: db, usageDb: db, originalResults, business: { db, selectedOrderResult },
      originalInputs: { readInput: originalResults.readInput.bind(originalResults),
        readAnswer: originalResults.readAnswer.bind(originalResults),
        resolveAnswerContinuation: originalResults.resolveAnswerContinuation.bind(originalResults),
        execution: clarification },
      continuation: { db, order: selectedOrderResult, settings: settingsTask },
      humanApprovals: {
        order: { db, auth, guard, subscriptions, core, confirmation, quoteFacts, scene: { code: 'quote_clarification', version: '1' } },
        settings: { db, auth, guard, subscriptions, core, holderId: 'ai-native-human-review', scene: { code: 'opening_diagnosis', version: '1' } },
        decisions: { order: order.enabled, settings: settings.enabled }
      } });
  }
};
export const AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS, inject: [PrismaService, ApiAuthGuard, SecretBox],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, secrets: SecretBox) =>
    composeRequestBoundPlatformModelSettings({ db, capabilityDb: db, guard, secrets })
};
export const AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION = Symbol('AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION');
export const AI_NATIVE_CATEGORY_DRAFT_PROVIDER: FactoryProvider = {
  provide: AI_CATEGORY_DRAFT_REQUESTS,
  inject: [ApiAuthGuard, ModuleRef, { token: AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION, optional: true }],
  useFactory: (guard: ApiAuthGuard, moduleRef: ModuleRef, value?: unknown) => {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(structuredClone(value ?? { enabled: false }));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    // Controllers are not injectable providers. Resolve the already registered
    // original instance lazily, after Nest has constructed its controller map.
    const controller = {
      detail: (...args: Parameters<CategoryGovernanceController['detail']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).detail(...args),
      create: (...args: Parameters<CategoryGovernanceController['create']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).create(...args),
      patch: (...args: Parameters<CategoryGovernanceController['patch']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).patch(...args),
      validate: (...args: Parameters<CategoryGovernanceController['validate']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).validate(...args),
      preview: (...args: Parameters<CategoryGovernanceController['preview']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).preview(...args)
    };
    return composeCategoryDraftRequests({ guard, controller }, parsed.data);
  }
};
/** Human management only. No action policy/authority is seeded by assembly;
 * absent persisted grants still refuse every memory/governance operation. */
export const AI_NATIVE_MEMORY_MANAGEMENT_PROVIDER: FactoryProvider = {
  provide: HumanMemoryManagementRequestFactory, inject: [PrismaService, AuthService],
  useFactory: (db: PrismaService, auth: AuthService) => new HumanMemoryManagementRequestFactory({ db, auth, clock: { now: () => Date.now() } })
};
export const AI_NATIVE_KNOWLEDGE_MANAGEMENT_PROVIDER: FactoryProvider = {
  provide: HumanKnowledgeManagementRequestFactory, inject: [PrismaService, AuthService, TenantIntegrationService],
  useFactory: (db: PrismaService, auth: AuthService, integrations: TenantIntegrationService) =>
    new HumanKnowledgeManagementRequestFactory({ db, auth, integrations, clock: { now: () => Date.now() } })
};
/** Current human reads only. No policy seed, task creation or model dispatch;
 * file and memory access use their original request-bound authority sources. */
export const AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER: FactoryProvider = {
  provide: HumanKnowledgeConsumptionRequestFactory, inject: [PrismaService, AuthService, TenantIntegrationService],
  useFactory: (db: PrismaService, auth: AuthService, integrations: TenantIntegrationService) =>
    new HumanKnowledgeConsumptionRequestFactory({ db, auth, integrations, memory: { db }, clock: { now: () => Date.now() } })
};
export const AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER: FactoryProvider = {
  provide: KNOWLEDGE_POLICY_MANAGEMENT, inject: [PrismaService, AuthService, ApiAuthGuard],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard) =>
    createKnowledgePolicyManagementFactory({ db, auth, guard, enabled: true, clock: () => new Date() })
};

export const AI_NATIVE_RETENTION_PROVIDER: FactoryProvider = {
  provide: AI_RETENTION_REQUESTS, inject: [PrismaService, AuthService, FileStorageRuntimeService],
  useFactory: (db: PrismaService, auth: AuthService, files: FileStorageRuntimeService): AiRetentionRequestFactory => request => {
    const header = request?.headers?.authorization, requestId = randomUUID();
    if (typeof header !== 'string' || header.length > 8192 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(header))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let authorization: string | undefined = header;
    const current = async () => {
      if (!authorization) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization, requestId, audience: 'operator' as const };
    };
    const requestAuth: Pick<AuthService, 'resolveAccessContext'> = { resolveAccessContext: async (...args) => {
      await current();
      const result = await auth.resolveAccessContext(...args);
      await current();
      return result;
    } };
    const service = new AiRetentionService(db, requestAuth, { current }, files);
    return { cleanup: value => service.cleanup(value), receipt: value => service.receipt(value),
      receipts: value => service.receipts(value), close: () => { authorization = undefined; } };
  },
};

/** Server opt-in to the original HUMAN inspection flow. No recognition/task
 * host is supplied here. Closing new work keeps original submission/draft
 * receipts readable under their existing current action authorization. */
export const AI_NATIVE_STAFF_MANUAL_CONFIGURATION = Symbol('AI_NATIVE_STAFF_MANUAL_CONFIGURATION');
const staffManualConfiguration = z.object({ enabled: z.boolean() }).strict();
function readStaffManualConfiguration(value: unknown) {
  const parsed = staffManualConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return parsed.data;
}
const staffReceiptOperations = ['history-read', 'receipt-host-read', 'result-save-receipt',
  'draft-operation', 'submission-preparation', 'submission-read', 'result-read'] as const;
const staffManualOperations = ['host-read', 'template-read', 'draft-create', 'draft-read', 'draft-edit',
  'evidence-bind', 'evidence-fingerprint', 'evidence-replace',
  'submission-review', 'submission-prepare', 'submission-submit'] as const;
export const AI_NATIVE_STAFF_RECOGNITION_PROVIDERS: FactoryProvider[] = [{
  provide: AI_STAFF_INSPECTION_ACCOUNTING, inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService) =>
    composeStaffInspectionAccounting({ db, auth, guard, subscriptions }, [
      { code: STAFF_RECOGNITION_SCENES.image, version: '1' }, { code: STAFF_RECOGNITION_SCENES.audio, version: '1' }])
}, {
  provide: INSPECTION_OBJECT_READER,
  inject: [PrismaService, TenantIntegrationService, { token: AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, integrations: TenantIntegrationService, value?: unknown) =>
    readStaffRecognitionConfiguration(value).enabled ? new TenantInspectionObjectReader(db, integrations) : undefined
}, {
  provide: AI_NATIVE_STAFF_RECOGNITION_RUNTIME,
  inject: [PrismaService, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService, SecretBox, FileStorageRuntimeService, ModuleRef,
    { token: AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, optional: true }, { token: AI_NATIVE_STAFF_RECOGNITION_ADAPTERS, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, core: RentalCoreService, subscriptions: SubscriptionService,
    secrets: SecretBox, files: FileStorageRuntimeService, moduleRef: ModuleRef, value?: unknown, adapters?: readonly ModelAdapter[]) =>
    composeStandardStaffRecognition({ db, auth, guard, core, subscriptions, secrets, files, moduleRef, adapters }, value)
}, ...([['application', INSPECTION_RECOGNITION_TASKS], ['policies', AI_STAFF_INSPECTION_TASK_POLICIES]] as const).map(([key, provide]) => ({
  provide, inject: [AI_NATIVE_STAFF_RECOGNITION_RUNTIME],
  useFactory: (runtime: ReturnType<typeof composeStandardStaffRecognition>) => runtime[key]
}))];
export const AI_NATIVE_STAFF_RECEIPT_PROVIDERS: FactoryProvider[] = [{
  provide: AI_STAFF_INSPECTION_REQUESTS,
  inject: [PrismaService, ApiAuthGuard, RentalCoreService, ModuleRef,
    { token: AI_NATIVE_STAFF_MANUAL_CONFIGURATION, optional: true }, { token: AI_NATIVE_STAFF_RECOGNITION_RUNTIME, optional: true }],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, core: RentalCoreService, moduleRef: ModuleRef, value?: unknown,
    runtime?: ReturnType<typeof composeStandardStaffRecognition>) => {
    readStaffManualConfiguration(value);
    if (runtime?.enabled) return runtime.staffRequests;
    return new StaffInspectionRequestFactory({ db, guard, core,
      originalInspection: { controller: { createInspection: (...args: Parameters<RentalCoreController['createInspection']>) =>
        moduleRef.get(RentalCoreController, { strict: false }).createInspection(...args) }, receipts: new RentalIdempotencyRepository(db) } });
  }
}, {
  provide: AI_STAFF_INSPECTION_ENABLED, useFactory: () => true
}, {
  provide: AI_STAFF_INSPECTION_OPERATIONS,
  inject: [{ token: AI_NATIVE_STAFF_MANUAL_CONFIGURATION, optional: true }, { token: AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, optional: true }],
  useFactory: (value?: unknown, recognition?: unknown) => Object.freeze([...staffReceiptOperations,
    ...(readStaffManualConfiguration(value).enabled ? staffManualOperations : []),
    ...(readStaffRecognitionConfiguration(recognition).enabled ? ['input-prepare', 'input-receipt', 'result-save'] : [])])
}];

/** Standard application wiring, not an execution enable switch. No startup
 * reads, policies, credentials, worker, model adapter or financial ledger are
 * created here. Every request uses its own current Guard/Auth/ALS context.
 * Missing/disabled persisted scene policy or AI entitlement refuses creation.
 * Registers the existing order/opening/quote preparation consumers. Persisted
 * scene policies remain absent/disabled until a current manager changes them.
 * It never constructs a model host; quote persistence requires its separate
 * explicit human-confirm endpoint and original Core permission.
 */
const originalSceneInjection = [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, RentalCoreService,
  RentalBusinessService, RentalWorkspaceReportRepository, MembershipService, PaymentRuntimeService];
function originalSceneDependencies(db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService): RequestBoundOriginalSceneDependencies {
  return { db, auth, guard, subscriptions, core, business, reports, memberships, payments,
      creationRules: [{ sceneCode: 'order_explanation', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:view'], maxInputAgeMs: 300000 },
      { sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 300000 },
      { sceneCode: 'opening_diagnosis', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:view'], maxInputAgeMs: 300000 }] };
}
/** Default closed until the conversation migration and host are explicitly
 * configured. This grants metadata/admission only, never model execution. */
export const AI_NATIVE_CONVERSATION_CONFIGURATION = Symbol('AI_NATIVE_CONVERSATION_CONFIGURATION');
export const AI_NATIVE_CONVERSATION_PROVIDER: FactoryProvider = {
  provide: AI_CONVERSATION_REQUESTS, inject: [...originalSceneInjection, { token: AI_NATIVE_CONVERSATION_CONFIGURATION, optional: true },
    { token: AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, value?: unknown,
    observations?: Pick<ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, 'readModelResult'>) => {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(structuredClone(value ?? { enabled: false }));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return composeAiConversationRequests(originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments), parsed.data.enabled, observations);
  }
};
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
  provide: AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, inject: [...originalSceneInjection, FileStorageRuntimeService,
    { token: AI_SELECTED_QUOTE_TASK_REQUESTS, optional: true }, { token: AI_SETTINGS_TASK_HTTP_REQUESTS, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, files?: FileStorageRuntimeService,
    quotes?: { readScene(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown> },
    settings?: { readTaskScene(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown> }) => {
    const original = composeRequestBoundOriginalTaskRecoveryReaders(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      { enabled: true, audience: 'operator' }, {
        policy: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: 32768, orderExplainTool: true },
        // Direct text-only compositions may omit files. A frozen snapshot with
        // knowledge then remains unavailable, never stripped to expose its text.
        ...(files ? { knowledge: { db, policyDb: db, fileRuntime: files, memory: { db }, includePreferences: false } } : {})
      });
    return Object.freeze({ ...original,
      readTaskScene(request: { headers: { authorization?: unknown } }, value: unknown) {
        // Dispatch ONLY a fixed read operation, never a caller component/tool
        // name, URL or runner action. Target readers rebind owner/scope and the
        // original selection, preparation, approval and business receipt.
        const command = structuredClone(value), currentRequest = { headers: { authorization: request?.headers?.authorization } };
        if (command && typeof command === 'object' && 'kind' in command) {
          if (command.kind === 'settings') {
            if (!settings) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
            return settings.readTaskScene(currentRequest, command);
          }
          if (command.kind === 'original' && !('resultId' in command)
            && ['review', 'decision', 'order'].some(field => Object.prototype.hasOwnProperty.call(command, field))) {
            if (!quotes) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
            return quotes.readScene(currentRequest, command);
          }
        }
        return original.readTaskScene(currentRequest, command);
      }
    });
  }
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
    inputCounting: taskInputCountingConfigurationSchema.optional(),
    host: z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      leaseMs: z.number().int().min(1).max(120000) }).strict(), includeKnowledge: z.boolean() }).strict()
]);
function readOrderExecutionConfiguration(value: unknown) {
  try {
    const parsed = orderExecutionConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
    if (parsed.success && !(parsed.data.enabled && parsed.data.inputCounting && parsed.data.pricing.kind !== 'recorded')) return parsed.data;
  } catch { /* Non-data DI values cannot become configuration. */ }
  throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
}
/** Quote model execution is independent of order creation and capability probes. */
export const AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION = Symbol('AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION');
export const AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION = Symbol('AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION');

const quoteModelRequestMethods = ['start', 'refreshInput', 'submitAnswer', 'resume', 'continueAnswer', 'reconcile', 'recover',
  'takeover', 'requestCancel', 'readQuotePreparation', 'confirmClarifiedQuote', 'readClarifiedQuoteReceipt', 'readExecution'] as const;
type QuoteModelRequests = Pick<ReturnType<typeof composeRequestBoundPersistedOriginalSceneModel>, typeof quoteModelRequestMethods[number]>;

/** Quote clarification uses the original input runner and one persisted Gateway.
 * Separate from order creation: model output/answered questions never approve an
 * order. Omitted server configuration creates no host, policy or paid call. */
export const AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER: FactoryProvider<QuoteModelRequests> = {
  provide: AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, secrets: SecretBox,
    files: FileStorageRuntimeService, serverValue?: unknown) => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) {
      const unavailable = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
      return Object.freeze({ start: unavailable, refreshInput: unavailable, submitAnswer: unavailable, resume: unavailable, continueAnswer: unavailable,
        reconcile: unavailable, recover: unavailable, takeover: unavailable, requestCancel: unavailable,
        readQuotePreparation: unavailable, confirmClarifiedQuote: unavailable, readClarifiedQuoteReceipt: unavailable, readExecution: unavailable });
    }
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function'
      || configuration.includeKnowledge && !files) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return composeRequestBoundPersistedOriginalSceneModel({
      ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      scene: { code: 'quote_clarification', version: '1' },
      gatewayScene: { sceneCode: 'quote_clarification', routeScene: 'chat', maxOutputTokens: configuration.maxOutputTokens },
      gateway: { secrets, platformProfileId: configuration.platformProfileId, routeScene: 'chat',
        pricing: configuration.pricing, nativeProtocol: NATIVE_MODEL_PROTOCOLS,
        ...(configuration.inputCounting ? { inputCounting: configuration.inputCounting } : {}) },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host });
  }
};

/** Same persistent model/runner as quote clarification, with a closed opening
 * scene and an independent server gate. Diagnosis never approves settings. */
export const AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER: FactoryProvider<OpeningModelRequests> = {
  provide: AI_ORIGINAL_OPENING_MODEL_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, secrets: SecretBox,
    files: FileStorageRuntimeService, serverValue?: unknown) => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) {
      const unavailable = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
      return Object.freeze({ start: unavailable, recover: unavailable, reconcile: unavailable,
        takeover: unavailable, requestCancel: unavailable, readExecution: unavailable });
    }
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function'
      || configuration.includeKnowledge && !files) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const requests = composeRequestBoundPersistedOriginalSceneModel({
      ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      scene: { code: 'opening_diagnosis', version: '1' },
      gatewayScene: { sceneCode: 'opening_diagnosis', routeScene: 'chat', maxOutputTokens: configuration.maxOutputTokens },
      gateway: { secrets, platformProfileId: configuration.platformProfileId, routeScene: 'chat',
        pricing: configuration.pricing, nativeProtocol: NATIVE_MODEL_PROTOCOLS,
        ...(configuration.inputCounting ? { inputCounting: configuration.inputCounting } : {}) },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host });
    return Object.freeze({ start: requests.start, recover: requests.recover, reconcile: requests.reconcile,
      takeover: requests.takeover, requestCancel: requests.requestCancel, readExecution: requests.readExecution });
  }
};

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
/** Management has its own server gate. Opening it does not open any model,
 * order workflow, capability probe, financial admission or task policy. An
 * explicitly disabled gate wins over the legacy order-root configuration. */
export const AI_NATIVE_BUDGET_MANAGEMENT_CONFIGURATION = Symbol('AI_NATIVE_BUDGET_MANAGEMENT_CONFIGURATION');
const budgetManagementConfiguration = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), platformProfileId: orderExecutionConfiguration.options[1].shape.platformProfileId,
    priceVersion: gatewayPricingSelectionSchema.shape.priceVersion }).strict()
]);
function readBudgetManagementConfiguration(value: unknown, legacy: unknown) {
  if (value === undefined) {
    const previous = readOrderExecutionConfiguration(legacy);
    return previous.enabled ? { enabled: true as const, platformProfileId: previous.platformProfileId,
      priceVersion: previous.pricing.priceVersion } : { enabled: false as const };
  }
  try {
    const parsed = budgetManagementConfiguration.safeParse(structuredClone(value));
    if (parsed.success) return parsed.data;
  } catch { /* Invalid DI is not a fallback to a more permissive gate. */ }
  throw new BudgetError('UNAVAILABLE');
}

/** Explicit current-manager budget configuration, never budget initialization
 * at application startup. Missing trusted profile/configuration stays closed;
 * models, credentials and whitelist changes are not accepted from tenant bodies.
 * Platform writes retain their distinct platform Guard and authority. */
export const AI_NATIVE_BUDGET_MANAGEMENT_PROVIDER: FactoryProvider<ReturnType<typeof composeRequestBoundBudgetManagement>> = {
  provide: AI_BUDGET_MANAGEMENT,
  inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
    { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_BUDGET_MANAGEMENT_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    secrets: SecretBox, serverValue?: unknown, managementValue?: unknown) => {
    const configuration = readBudgetManagementConfiguration(managementValue, serverValue);
    if (!configuration.enabled) {
      const unavailable = async (): Promise<never> => { throw new BudgetError('UNAVAILABLE'); };
      return Object.freeze({ read: unavailable, readOperation: unavailable, change: unavailable, initialize: unavailable,
        refreshConfiguration: unavailable, readPriceConfiguration: unavailable, reviewPrice: unavailable, readPriceReview: unavailable,
        platformReadOperation: unavailable,
        platformReviewPrice: unavailable, platformPriceReviewReceipt: unavailable,
        previewPlatformPrice: unavailable, adoptPlatformPrice: unavailable, readPlatformPriceAdoption: unavailable,
        platformRead: unavailable, platformSave: unavailable });
    }
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function') throw new BudgetError('UNAVAILABLE');
    return composeRequestBoundBudgetManagement({
      // The existing settings-only root exposes no pricing/reserve method;
      // this version never substitutes a calls price for token/money usage.
      tenant: { db, auth, guard, subscriptions, callPriceVersion: configuration.priceVersion,
        initialConfiguration: { db, secrets, platformProfileId: configuration.platformProfileId } },
      platform: { db, guard, profileId: configuration.platformProfileId }
    }, { enabled: true });
  }
};
/** Immutable pricing observations remain usable after execution shutdown.
 * Only current management permission and original scope/owner are consumed;
 * this provider has no publication source, connection resolver or model driver. */
export const AI_NATIVE_GATEWAY_PRICING_HISTORY_PROVIDER: FactoryProvider<Pick<GatewayPricingRequestFactory, 'call'>> = {
  provide: AI_GATEWAY_PRICING_HISTORY,
  inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService) => {
    const history = GatewayPricingRequestFactory.history({ db, auth, guard, subscriptions });
    return Object.freeze({ call: history.call.bind(history) });
  }
};
export const AI_NATIVE_PLATFORM_PROBE_PROVIDER: FactoryProvider<ReturnType<typeof composeStandardPlatformProbe>> = {
  provide: PLATFORM_CAPABILITY_PROBE_REQUESTS,
  inject: [PrismaService, ApiAuthGuard, SecretBox, { token: AI_NATIVE_PLATFORM_PROBE_CONFIGURATION, optional: true },
    { token: AI_NATIVE_PLATFORM_PROBE_AUDIT, optional: true }],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, secrets: SecretBox, configuration?: unknown, audit?: UnifiedGatewayAudit) =>
    composeStandardPlatformProbe({ db, guard, secrets, audit }, configuration)
};
export const AI_NATIVE_INPUT_COUNTING_PROVIDER: FactoryProvider<ReturnType<typeof composeStandardInputCounting>> = {
  provide: AI_COUNTING_REQUESTS,
  inject: [PrismaService, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
    { token: AI_NATIVE_INPUT_COUNTING_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    secrets: SecretBox, configuration?: unknown) => composeStandardInputCounting({ db, auth, guard, subscriptions, secrets }, configuration)
};
const originalReadOperations = ['read_metadata', 'read_events', 'read_step_terminal'] as const;
const originalOrderExecutionOperations = ['claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'takeover_run'] as const;

/** One existing quote-selection/approval/Core runner, never a second order
 * execution path. No configuration grants a task policy or business approval. */
const quoteOrderConfiguration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), host: z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    leaseMs: z.number().int().min(1).max(120000) }).strict(), limits: aiTaskRunnerLimitsSchema }).strict()]);
function readQuoteOrderConfiguration(value: unknown) {
  const parsed = quoteOrderConfiguration.safeParse(structuredClone(value ?? { enabled: false }));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return parsed.data;
}
export const AI_NATIVE_QUOTE_ORDER_PROVIDERS: FactoryProvider[] = [AI_HUMAN_QUOTE_SELECTION_REQUESTS, AI_HUMAN_QUOTE_ORDER_REQUESTS,
  AI_SELECTED_QUOTE_TASK_REQUESTS].map(provide => ({ provide,
  inject: [...originalSceneInjection, RentalOrderConfirmationService, RentalBusinessFactRepository,
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, confirmation: RentalOrderConfirmationService,
    quoteFacts: RentalBusinessFactRepository, value?: unknown) => {
    const configuration = readQuoteOrderConfiguration(value);
    const dependencies = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments),
      core, confirmation, quoteFacts, holderId: configuration.enabled ? configuration.host.holderId : 'ai-native-quote-observer',
      scene: { code: 'quote_clarification', version: '1' } };
    dependencies.creationRules = dependencies.creationRules.filter(rule => rule.sceneCode === 'quote_clarification');
    const options = { enabled: true, audience: 'operator' } as const;
    const reprepare = { holderId: dependencies.holderId, creationRules: dependencies.creationRules, memberships };
    // Deny-only observer ceilings are NOT the stored plan/budget and never
    // authorize execution. Historical readers resolve the exact persisted
    // selection/plan/approval themselves; all methods that can run are closed.
    const task = configuration.enabled ? configuration : { host: { holderId: dependencies.holderId, leaseMs: 1 },
      limits: { maxSteps: 1, maxCalls: 1, maxTotalMs: 1, maxStepMs: 1, maxOutputBytes: 1, maxConcurrent: 1 as const } };
    const module = AiHumanQuoteSelectionModule.registerHttpTask(dependencies, options, task, reprepare);
    const entry = module.providers?.find(item => typeof item === 'object' && 'provide' in item && item.provide === provide) as FactoryProvider | undefined;
    if (!entry || typeof entry.useFactory !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const requests = entry.useFactory() as Record<string, unknown>;
    const closedMethods = provide === AI_SELECTED_QUOTE_TASK_REQUESTS ? ['start', 'continueConfirmation', 'reconcile']
      : provide === AI_HUMAN_QUOTE_SELECTION_REQUESTS ? ['select'] : ['decideSelectedProposal', 'reprepareSelectedProposal'];
    return Object.freeze(Object.fromEntries(Object.entries(requests).map(([method, call]) => [method,
      !configuration.enabled && closedMethods.includes(method)
        ? async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); } : call])));
  }
}));

/** Handoff consumes the single configured model and selection request hosts;
 * no factory here opens a second execution path or grants approval. */
export const AI_NATIVE_CLARIFIED_QUOTE_SELECTION_PROVIDER: FactoryProvider<ReturnType<typeof composeClarifiedQuoteSelectionRequests>> = {
  provide: AI_CLARIFIED_QUOTE_SELECTION_HTTP_REQUESTS,
  inject: [AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS, AI_HUMAN_QUOTE_SELECTION_REQUESTS,
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (model: QuoteModelRequests, selections: Parameters<typeof composeClarifiedQuoteSelectionRequests>[1], value?: unknown) => {
    const requests = composeClarifiedQuoteSelectionRequests(model, selections);
    if (readQuoteOrderConfiguration(value).enabled) return requests;
    return Object.freeze({ ...requests, select: async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); } });
  }
};

/** Explicit same-owner manager CAS, never policy seeding during task creation.
 * Without server execution configuration, only the original read policies are
 * exposed. The closed order chain adds no approval or free-input permission. */
export const AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_TASK_ACTION_POLICIES,
  inject: [...originalSceneInjection, { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, serverValue?: unknown, quoteValue?: unknown, quoteModelValue?: unknown, openingModelValue?: unknown) => {
    const configuration = readOrderExecutionConfiguration(serverValue), quote = readQuoteOrderConfiguration(quoteValue);
    const quoteModel = readOrderExecutionConfiguration(quoteModelValue);
    const openingModel = readOrderExecutionConfiguration(openingModelValue);
    const operations = [...originalReadOperations, ...(configuration.enabled ? originalOrderExecutionOperations : [])];
    return composeRequestBoundOriginalTaskActionPolicies(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments), {
        enabled: true, audience: 'operator', ttlMs: 120000,
        templates: [...operations.map(operation => ({ operation, requiredPermissions: ['rental-os:order:view'],
          ...((originalReadOperations as readonly string[]).includes(operation) ? {} : { sceneCode: 'order_explanation' }) })),
          ...(quote.enabled || quoteModel.enabled ? [...originalOrderExecutionOperations,
            ...(quoteModel.enabled ? ['request_input', 'submit_input', 'resume_input'] as const : []),
            ...(quote.enabled ? ['decide_approval'] as const : [])].map(operation => ({
            operation, sceneCode: 'quote_clarification', requiredPermissions: ['rental-os:order:create'] })) : []),
          ...(openingModel.enabled ? [...originalReadOperations, ...originalOrderExecutionOperations].map(operation => ({
            operation, sceneCode: 'opening_diagnosis', requiredPermissions: ['rental-os:price:manage'] })) : [])]
      });
  }
};

/** Human-managed limits/tool ceilings for preparation and opted-in execution. These
 * writes use the existing Guard, scoped CAS and same-transaction audit; they
 * neither create per-task policies nor grant a lease, budget or dispatch. */
export const AI_NATIVE_ORIGINAL_PLAN_POLICY_PROVIDER: FactoryProvider<ReturnType<typeof composeRequestBoundScenePlanPolicies>> = {
  provide: AI_SCENE_PLAN_POLICIES,
  inject: [...originalSceneInjection, { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION, optional: true }, { token: AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true }, { token: AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, serverValue?: unknown, probeValue?: unknown, settingsValue?: unknown, quoteValue?: unknown, recognitionValue?: unknown, quoteModelValue?: unknown, openingModelValue?: unknown) => {
    const execution = readOrderExecutionConfiguration(serverValue), probe = readProbeConfiguration(probeValue), settings = readSettingsExecutionConfiguration(settingsValue);
    const quote = readQuoteOrderConfiguration(quoteValue), quoteModel = readOrderExecutionConfiguration(quoteModelValue);
    const recognition = readStaffRecognitionConfiguration(recognitionValue);
    const openingModel = readOrderExecutionConfiguration(openingModelValue);
    const scenes = [
      // A server option only makes its original tool eligible for a human
      // CAS policy. It grants no task action, approval, lease or dispatch.
      { scene: { code: 'quote_clarification', version: '1' }, tools: [
        'rental.catalog.search', 'rental.availability.check', 'membership.customer.resolve',
        ...(quote.enabled ? ['rental.order.commit'] as const : []),
        ...(quoteModel.enabled ? ['ai.model.text'] as const : [])] as const },
      { scene: { code: 'opening_diagnosis', version: '1' }, tools: [
        'tenant.opening.diagnose', ...(settings.enabled ? [AI_APPROVED_SETTINGS_TOOL_CODE] as const : []),
        ...(openingModel.enabled ? ['ai.model.text'] as const : [])] as const },
      ...(execution.enabled ? [{ scene: { code: 'order_explanation', version: '1' },
        tools: ['ai.model.text', 'rental.order.explain'] as const }] : []),
      ...(probe.enabled ? [{ scene: { code: TEXT_PROBE_SCENE, version: probe.sceneVersion },
        tools: [TEXT_CAPABILITY_PROBE_TOOL] as const }] : []),
      ...(recognition.enabled ? [{ scene: { code: STAFF_RECOGNITION_SCENES.image, version: '1' }, tools: ['ai.model.image'] as const },
        ...(recognition.audio ? [{ scene: { code: STAFF_RECOGNITION_SCENES.audio, version: '1' }, tools: ['ai.model.audio'] as const }] : [])] : [])
    ];
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
        pricing: configuration.pricing, nativeProtocol: NATIVE_MODEL_PROTOCOLS,
        ...(configuration.inputCounting ? { inputCounting: configuration.inputCounting } : {}) },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host,
      orderReadChain: { enabled: true, answerRoundTrip: true } }));
  }
};
