import { AI_TASK_READ_POLICY_REQUESTS, composeTaskReadPolicyRequests } from './task-read-policy.application';
import { AI_TASK_ORIGINAL_READ_POLICY_REQUESTS, composeTaskOriginalReadPolicyRequests } from './task-original-read-policy.application';
import { AI_TASK_ORDER_HANDOFF_REQUESTS, composeRequestBoundTaskOrderHandoff } from './task-order-handoff.application';
import { AI_TASK_CALENDAR_DRAFT_REQUESTS, composeRequestBoundTaskCalendarDraft } from './task-calendar-draft.application';
import { AI_MEMBER_NAME_REQUESTS, composeMemberNameRequests } from './member-name.application';
import { AI_NATIVE_RUNTIME_PUBLICATION_PROVIDER, runtimeConfigurationProvider, readRuntimePublication } from './runtime-publication.configuration';
import { AI_CATEGORY_PROPOSAL_REQUESTS, AI_NATIVE_CATEGORY_PROPOSAL_CONFIGURATION, composeCategoryProposalRequests } from './category-assist/category-proposal-http.application';
import { createOriginalTaskStartAdmission } from './task-start-admission.composition';
import { AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, readWorkbenchDisplayConfiguration,
  readCurrentWorkbenchDisplayConfiguration } from './workbench-display-generation.service';
import { composeAiWorkbenchDisplayRequests } from './workbench-display.application';
import { AI_TASK_CENTER_RECOVERY_REQUESTS, composeTaskCenterRecoveryRequests,
  type TaskCenterRecoveryDependencies } from './task-center-recovery.application';
import { AI_WORKBENCH_MODEL_CONTROL_REQUESTS, composeWorkbenchModelControlRequests } from './workbench-model-control.application';
import { composePersistedTaskModelHost } from './task-model-gateway.composition';
import { AutomationExplanationApplication } from './automation/automation-explanation.application';
import { AI_NATIVE_GATEWAY_CAPACITY, AI_NATIVE_GATEWAY_CAPACITY_PROVIDER } from './gateway-capacity.runtime';
import { RuntimeTaskFaultAlertPolicySource } from './observability/task-fault-policy.configuration';
import type { GatewayCapacityPort } from './gateway-capacity.ports';
/**
 * 职责：将正式业务服务、当前身份和持久仓储接到 AI Native 的 Nest provider 入口。
 * 边界：装配不等于执行开放；各请求仍核验当前政策、权限与实际可用的依赖。
 * 接续时从这里追踪具体场景的消费者；不要在此补假授权、第二 Gateway 或预算账本。
 */
import type { FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import { NATIVE_MODEL_PROTOCOLS } from './native-model-protocols';
import { SecretBox } from '../../common/secret-box';
import { PrismaService } from '../database/prisma.service';
import { createAiBodyStorageDatabase } from './privacy/prisma-ai-body-storage';

/** AI私有正文仓储视图。业务域保留原PrismaService，正文解密不授权限，
 * 原事务和收据不变；缺密钥时新正文写入／密文读取保持不可用。 */
export const AI_NATIVE_BODY_DATABASE = Symbol('AI_NATIVE_BODY_DATABASE');
export const AI_NATIVE_BODY_DATABASE_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_BODY_DATABASE, inject: [PrismaService, SecretBox],
  useFactory: (db: PrismaService, secrets: SecretBox) => createAiBodyStorageDatabase(db, secrets),
};
import { AuthService } from '../auth/auth.service';
import { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity } from '../../common/request-identity';
import { OperationLogService } from '../../common/operation-log.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { ClientDeliveryAddressService } from '../client/client-delivery-address.service';
import { RentalCoreService } from '../rental-core/rental-core.service';
import { WorkspaceCapabilityService } from '../rental-core/workspace-capability.service';
import { RentalCoreController } from '../rental-core/rental-core.controller';
import { RentalOrderConfirmationService } from '../rental-core/rental-order-confirmation.service';
import { RentalBusinessFactRepository } from '../rental-core/rental-business-fact.repository';
import { RentalCoreFactRepository } from '../rental-core/rental-core-fact.repository';
import { RentalAllocationService } from '../rental-core/rental-allocation.service';
import { RentalCoreConfigRepository } from '../rental-core/rental-core-config.repository';
import { RentalBusinessConfigRepository } from '../rental-core/rental-business-config.repository';
import { RentalIdempotencyRepository, requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { CategoryGovernanceController } from '../rental-core/category-governance.controller';
import { AI_CATEGORY_DRAFT_REQUESTS, composeCategoryDraftRequests } from './category-assist/category-draft.application';
import { RentalBusinessService } from '../rental-core/rental-business.service';
import { RentalFundingService } from '../rental-core/rental-funding.service';
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
  composeRequestBoundScenePlanPolicies, composeClarifiedQuoteSelectionRequests, composeRequestBoundClarifiedQuoteSelectionPreparation,
  composeRequestBoundOriginalTaskAccounting,
  composeRequestBoundPersistedOriginalOrderRead, composeRequestBoundPersistedOriginalSceneModel, composeRequestBoundOriginalOrderAnswerReader,
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
import { TextCapabilityProbeRequestFactory, type TextCapabilityRequest } from './text-capability-probe-request.factory';
import { ModelGatewayError } from './model-gateway.ports';
import { PLATFORM_CAPABILITY_PROBE_REQUESTS } from './platform-capability-probe/platform-capability-probe.controller';
import { composeStandardPlatformProbe, AI_NATIVE_PLATFORM_PROBE_CONFIGURATION, AI_NATIVE_PLATFORM_PROBE_AUDIT } from './platform-capability-probe/platform-capability-standard.application';
import type { UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import { TEXT_CAPABILITY_PROBE_REQUESTS } from './text-capability-probe.controller';
import { AI_NATIVE_MODEL_SETTINGS_REQUESTS, composeRequestBoundModelSettings } from './model-settings.application';
import { createNativeModelEgressTransport } from './model-egress.transport';
import { AI_TASK_RULE_DRAFT_REQUESTS, composeRequestBoundTaskRuleDraft } from './task-rule-draft.application';
import { AI_NATIVE_TASK_CENTER_REQUESTS, composeRequestBoundTaskCenter } from './task-center.application';
import { composePublishedOrderTaskContinuation } from './runner/published-order-task-continuation.composition';
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
import { RuntimeAutomationReviewGrantPolicySource } from './automation/runtime-automation-review-grant.source';
import { TaskOpeningProposalApplication } from './task-opening-proposal.application';
import { HumanAutomationPolicyRequestFactory } from './automation/human-automation-policy-request.composition';
import { AiClientPublicApplication } from './scenes/client-public.application';
import { AiClientPublicSessionCredential } from './scenes/client-public-session.credential';
import { AI_WEBSITE_PUBLIC_ENTRY, AI_WECHAT_PUBLIC_ENTRY } from './scenes/client-public.controller';
import { BUSINESS_FAILURE_OUTBOX, PrismaBusinessFailureOutbox,
  type BusinessFailureResourcePorts } from './business-events/prisma-business-failure-outbox';
import { CoreBusinessFailureResourceSource } from './business-events/core-business-failure-resource.source';
import { readFailureConfiguration, RuntimeBusinessFailureConfigurationSource } from './business-events/business-failure-configuration';
import { AI_APPROVED_SETTINGS_TOOL_CODE, AI_CAPABILITY_PROBE_KINDS_DRAFT } from '@rental-os/shared';
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
export const AI_NATIVE_BUSINESS_FAILURE_RESOURCES = Symbol('AI_NATIVE_BUSINESS_FAILURE_RESOURCES');
export const AI_NATIVE_TASK_OPENING_PROPOSAL_CONFIGURATION = Symbol('AI_NATIVE_TASK_OPENING_PROPOSAL_CONFIGURATION');
export const AI_NATIVE_AUTOMATION_EXPLANATION_CONFIGURATION = Symbol('AI_NATIVE_AUTOMATION_EXPLANATION_CONFIGURATION');
/** Default-closed model use; historical reads keep independent current human
 * access. A missing policy or budget is never initialized by this provider. */
export const AI_NATIVE_AUTOMATION_EXPLANATION_PROVIDER: FactoryProvider = {
  provide: AutomationExplanationApplication,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService, SecretBox,
    AI_NATIVE_BUSINESS_FAILURE_RESOURCES, ConfigService, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, core: RentalCoreService,
    subscriptions: SubscriptionService, secrets: SecretBox, resources: BusinessFailureResourcePorts, configuration: ConfigService, capacity: GatewayCapacityPort) =>
    new AutomationExplanationApplication({ db, auth, guard, core, subscriptions, secrets, resources, capacity,
      currentConfiguration: () => readRuntimePublication(configuration).configurations.automationExplanation }),
};
export const AI_NATIVE_BUSINESS_FAILURE_PROVIDERS: FactoryProvider[] = [{
  provide: AI_NATIVE_BUSINESS_FAILURE_RESOURCES, inject: [AI_NATIVE_BODY_DATABASE, ConfigService, ModuleRef],
  useFactory: (db: PrismaService, configurationSource: ConfigService, moduleRef: Pick<ModuleRef, 'get'>): BusinessFailureResourcePorts => {
    const current = new RuntimeBusinessFailureConfigurationSource(configurationSource);
    // Core repositories and services themselves consume the Outbox. Resolve
    // those original instances only during a read, after Nest finishes wiring.
    const source = new CoreBusinessFailureResourceSource({ db, nearPolicy: current,
      allocation: { readRecordedFulfillmentIssue: (...args) => moduleRef.get<RentalAllocationService>(RentalAllocationService, { strict: false }).readRecordedFulfillmentIssue(...args) },
      facts: { findOrder: (...args) => moduleRef.get<RentalCoreFactRepository>(RentalCoreFactRepository, { strict: false }).findOrder(...args) },
      business: { readTenantReadinessSource: (...args) => moduleRef.get<RentalBusinessService>(RentalBusinessService, { strict: false }).readTenantReadinessSource(...args) },
      coreConfiguration: { readReadinessCoreFacts: (...args) => moduleRef.get<RentalCoreConfigRepository>(RentalCoreConfigRepository, { strict: false }).readReadinessCoreFacts(...args) },
      businessConfiguration: { readReadinessBusinessFacts: (...args) => moduleRef.get<RentalBusinessConfigRepository>(RentalBusinessConfigRepository, { strict: false }).readReadinessBusinessFacts(...args) },
      memberships: { countPlans: (...args) => moduleRef.get<MembershipService>(MembershipService, { strict: false }).countPlans(...args) }
    });
    const observe = async <T>(read: () => Promise<T>) => {
      if (!current.current().enabled) return undefined;
      const result = await read();
      return current.current().enabled ? result : undefined;
    };
    return {
      readFulfillment: (...args) => observe(() => source.readFulfillment(...args)),
      readOpening: (...args) => observe(() => source.readOpening(...args)),
      // Original immutable references remain readable after capture stops.
      readBinding: (...args) => source.readBinding(...args),
      assertStorage: (...args) => source.assertStorage(...args),
      append: (...args) => source.append(...args)
    };
  }
}, {
  provide: BUSINESS_FAILURE_OUTBOX, inject: [AI_NATIVE_BUSINESS_FAILURE_RESOURCES, ConfigService,
    { token: AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION, optional: true }],
  useFactory: (resources: BusinessFailureResourcePorts, configurationSource: ConfigService, value?: unknown) => {
    if (!readFailureConfiguration(value).enabled) return undefined;
    const current = new RuntimeBusinessFailureConfigurationSource(configurationSource), original = new PrismaBusinessFailureOutbox(undefined, resources);
    const eligibleResourceObservation = (scope: { tenantId: string; workspaceId: string }) => {
      const identity = getRequestIdentity();
      // Tenant initialization can have only a target scope. It is not an
      // authorized event reader; skip capture without inventing a principal.
      return current.current().enabled && identity?.tenantId === scope.tenantId && identity.workspaceId === scope.workspaceId
        && typeof identity.userId === 'string' && Boolean(identity.userId) && identity.isSaasAdmin !== true;
    };
    return {
      notification: async (...args: Parameters<PrismaBusinessFailureOutbox['notification']>) => { if (current.current().enabled) await original.notification(...args); },
      refund: async (...args: Parameters<PrismaBusinessFailureOutbox['refund']>) => { if (current.current().enabled) await original.refund(...args); },
      inspection: async (...args: Parameters<PrismaBusinessFailureOutbox['inspection']>) => { if (current.current().enabled) await original.inspection(...args); },
      fulfillment: (...args: Parameters<PrismaBusinessFailureOutbox['fulfillment']>) => eligibleResourceObservation(args[1]) ? original.fulfillment(...args)
        : Promise.resolve({ state: 'not_captured' as const, reason: 'source_unavailable' as const }),
      opening: (...args: Parameters<PrismaBusinessFailureOutbox['opening']>) => eligibleResourceObservation(args[1]) ? original.opening(...args)
        : Promise.resolve({ state: 'not_captured' as const, reason: 'source_unavailable' as const }),
      openingConfiguration: (...args: Parameters<PrismaBusinessFailureOutbox['openingConfiguration']>) => eligibleResourceObservation(args[1]) ? original.openingConfiguration(...args)
        : Promise.resolve([{ state: 'not_captured' as const, reason: 'source_unavailable' as const }])
    };
  }
}, {
  provide: HumanAutomationRequestFactory, inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService, ConfigService,
    AI_NATIVE_BUSINESS_FAILURE_RESOURCES,
    { token: AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, core: RentalCoreService, subscriptions: SubscriptionService,
    configurationSource: ConfigService, resources: BusinessFailureResourcePorts, value?: unknown) => {
    const configuration = readFailureConfiguration(value);
    return new HumanAutomationRequestFactory({ db, auth, guard, core, resources, reviewGrantPolicy: new RuntimeAutomationReviewGrantPolicySource(configurationSource),
      outboxObservationPolicy: new RuntimeTaskFaultAlertPolicySource(configurationSource),
      ...(configuration.enabled && configuration.automation ? { automation: { ...configuration.automation, subscriptions,
        assertCurrent: () => {
          if (requestFingerprint(configuration) !== requestFingerprint(readFailureConfiguration(readRuntimePublication(configurationSource).configurations.businessFailure))) {
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          }
        } } } : {}) });
  }
}, {
  provide: HumanAutomationPolicyRequestFactory, inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard],
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
  [AI_SETTINGS_CHANGE_REQUESTS, ['prepare', 'prepareReconfirmedChange']],
  [AI_SETTINGS_TASK_CREATION_REQUESTS, ['create']],
  [AI_SETTINGS_TASK_CONTROL_REQUESTS, ['configurePolicy', 'start']],
  [AI_SETTINGS_TASK_HTTP_REQUESTS, ['startSettingsTask', 'decideSettingsProposal', 'continueSettingsConfirmation', 'reconcileSettingsTask', 'prepareTaskCenterApproval']],
  [AI_SETTINGS_TASK_READ_REQUESTS, []]
] as const;
export const AI_NATIVE_SETTINGS_LIFECYCLE_PROVIDERS: FactoryProvider[] = settingsEntries.map(([provide, executionMethods]) => ({
  provide, inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService,
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
    }, configuration.enabled ? { db, currentRuntimeEnabled: async (sceneCode, sceneVersion) =>
      configuration.enabled && sceneCode === 'opening_diagnosis' && sceneVersion === '1' } : undefined);
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
  provide, inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, SubscriptionService, ClientApiService, SecretBox, ClientDeliveryAddressService,
    { token: AI_NATIVE_CLIENT_MODEL_CONFIGURATION, optional: true }, { token: AI_NATIVE_CLIENT_MODEL_ADAPTERS, optional: true }, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, subscriptions: SubscriptionService, client: ClientApiService,
    secrets: SecretBox, addresses: ClientDeliveryAddressService, value?: unknown, adapters?: readonly ModelAdapter[], capacity?: GatewayCapacityPort) =>
    composeStandardClientBookingEntry({ db, guard, client, addresses,
      ...standardClientModelDependencies(db, secrets, value, adapters, capacity),
      tasks: { db, subscriptions, sceneCode: 'quote_clarification', sceneVersion: '1' },
      quotePreparation: client, bookingSubmission: client }, channel),
}));

export const AI_NATIVE_CLIENT_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_CLIENT_TASK_POLICIES,
  inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, AuthService, { token: AI_NATIVE_CLIENT_POLICY_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, auth: AuthService, value?: unknown) => {
    const selected = z.object({ enabled: z.boolean() }).strict().safeParse(structuredClone(value ?? { enabled: false }));
    if (!selected.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return createClientTaskPolicyManagementApplication({ db, guard, modelPlan: { db, auth },
      scene: { sceneCode: 'quote_clarification', sceneVersion: '1' }, enabled: selected.data.enabled });
  }
};

export const AI_NATIVE_CLIENT_PUBLIC_PROVIDERS: FactoryProvider[] = ([
  [AI_WEBSITE_PUBLIC_ENTRY, 'web'], [AI_WECHAT_PUBLIC_ENTRY, 'wechat_miniprogram'],
] as const).map(([provide, channel]) => ({
  provide, inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, ClientApiService, ConfigService],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, client: ClientApiService, configuration: ConfigService) =>
    new AiClientPublicApplication({ db, guard, client, ownership: new AiClientPublicSessionCredential(configuration),
      currentConfiguration: () => readRuntimePublication(configuration).configurations.clientPublic }, channel),
}));

export const AI_NATIVE_MODEL_SETTINGS_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_MODEL_SETTINGS_REQUESTS, inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SecretBox],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, secrets: SecretBox) =>
    composeRequestBoundModelSettings({ db, auth, guard, secrets, discovery: createNativeModelEgressTransport(5000) })
};
export const AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION = Symbol('AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION');
export const AI_NATIVE_TASK_CENTER_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_TASK_CENTER_REQUESTS, inject: [AI_NATIVE_BODY_DATABASE, AuthService, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS,
    ApiAuthGuard, SubscriptionService, RentalCoreService, RentalOrderConfirmationService, RentalBusinessFactRepository,
    { token: AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_SELECTED_QUOTE_TASK_REQUESTS, optional: true },
    { token: AI_SETTINGS_TASK_HTTP_REQUESTS, optional: true }, { token: ModuleRef, optional: true },
    { token: AI_HUMAN_QUOTE_ORDER_REQUESTS, optional: true }, ConfigService],
  useFactory: (db: PrismaService, auth: AuthService,
    originalResults: ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, guard: ApiAuthGuard,
    subscriptions: SubscriptionService, core: RentalCoreService, confirmation: RentalOrderConfirmationService,
    quoteFacts: RentalBusinessFactRepository, settingsValue?: unknown, orderValue?: unknown,
    selectedOrderResult?: { readResult(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown>;
      continueConfirmation(request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal): Promise<unknown> },
    settingsTask?: { continueSettingsConfirmation(request: { headers: { authorization?: unknown } }, value: unknown, signal?: AbortSignal): Promise<unknown>;
      prepareTaskCenterApproval?(request: { headers: { authorization?: unknown } }, value: unknown,
        intent: 'explicit_decide' | 'explicit_continue', signal?: AbortSignal): Promise<void> },
    moduleRef?: Pick<ModuleRef, 'get'>,
    selectedOrderDecision?: { decideSelectedProposal(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown>;
      prepareTaskCenterApproval?(request: { headers: { authorization?: unknown } }, value: unknown,
        intent: 'explicit_decide' | 'explicit_continue', signal?: AbortSignal): Promise<void> },
    configurationSource?: Pick<ConfigService, 'get'>) => {
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
    return composeRequestBoundTaskCenter({ db, auth, originalDb: db, usageDb: db, performanceDb: db, visibleDb: db,
      ...(configurationSource ? { faultOptions: { alertPolicy: new RuntimeTaskFaultAlertPolicySource(configurationSource) } } : {}),
      originalResults: { ...originalResults, async readOrderAnswer(request, reference) {
        const order = moduleRef?.get<OriginalOrderReadHttpRequests>(AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, { strict: false });
        if (!order) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return order.readAnswer(request, reference);
      } },
      originalModelControls: { async readResult(request, value, signal) {
        const controls = moduleRef?.get<ReturnType<typeof composeWorkbenchModelControlRequests>>(AI_WORKBENCH_MODEL_CONTROL_REQUESTS, { strict: false });
        if (!controls) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return controls.readResult(request, value, signal);
      }, async readOperation(request, value, signal) {
        let controls: ReturnType<typeof composeWorkbenchModelControlRequests> | undefined;
        try { controls = moduleRef?.get(AI_WORKBENCH_MODEL_CONTROL_REQUESTS, { strict: false }); }
        catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
        if (typeof controls?.consume !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        // Resolve the standard original-operation reader lazily. Recording a
        // browser observation must never build or resume a model host.
        return controls.consume(request, 'model-control-read', value, signal);
      } },
      business: { db, selectedOrderResult, originalOrder: { db, auth, guard, subscriptions, core } },
      originalInputs: { readInput: originalResults.readInput.bind(originalResults),
        readAnswer: originalResults.readAnswer.bind(originalResults),
        resolveAnswerContinuation: originalResults.resolveAnswerContinuation.bind(originalResults),
        execution: clarification },
      continuation: { db, order: selectedOrderResult, settings: settingsTask,
        originalOrder: order.enabled ? { continueConfirmation: (credentials, value, signal) =>
          composePublishedOrderTaskContinuation({ db, auth, guard, subscriptions, core, confirmation, quoteFacts, credentials,
            scene: { code: 'quote_clarification', version: '1' } }, { host: order.host, limits: order.limits })
            .continueConfirmation(value, signal) } : undefined },
      humanApprovals: {
        order: { db, auth, guard, subscriptions, core, confirmation, quoteFacts, scene: { code: 'quote_clarification', version: '1' } },
        settings: { db, auth, guard, subscriptions, core, holderId: 'ai-native-human-review', scene: { code: 'opening_diagnosis', version: '1' } },
        decisions: { order: order.enabled, settings: settings.enabled }, selectedOrderDecision, settingsAdmission: settingsTask
      } });
  }
};
export const AI_NATIVE_PLATFORM_MODEL_SETTINGS_PROVIDER: FactoryProvider = {
  provide: AI_NATIVE_PLATFORM_MODEL_SETTINGS_REQUESTS, inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, SecretBox],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, secrets: SecretBox) =>
    composeRequestBoundPlatformModelSettings({ db, capabilityDb: db, guard, secrets })
};
export const AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION = Symbol('AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION');
export const AI_NATIVE_CATEGORY_PROPOSAL_PROVIDER: FactoryProvider = {
  provide: AI_CATEGORY_PROPOSAL_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, SecretBox, ModuleRef, ConfigService, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, secrets: SecretBox, moduleRef: ModuleRef,
    config: ConfigService, capacity: GatewayCapacityPort) => {
    // Resolve the existing controller lazily; construction reads no business
    // data and does not activate a model or create any policy.
    const controller = new Proxy({} as CategoryGovernanceController, { get: (_target, method) => (...args: unknown[]) => {
      const original = moduleRef.get(CategoryGovernanceController, { strict: false });
      const work = Reflect.get(original, method); if (typeof work !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return work.apply(original, args);
    } });
    return composeCategoryProposalRequests({ db, guard, secrets, controller, capacity,
      // Removing a deployment section cannot revive the startup snapshot.
      configuration: () => readRuntimePublication(config).configurations.categoryProposal });
  }
};
export const AI_NATIVE_CATEGORY_DRAFT_PROVIDER: FactoryProvider = {
  provide: AI_CATEGORY_DRAFT_REQUESTS,
  inject: [ApiAuthGuard, ModuleRef, { token: AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION, optional: true }],
  useFactory: (guard: ApiAuthGuard, moduleRef: ModuleRef, value?: unknown) => {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(structuredClone(value ?? { enabled: false }));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    // Controllers are not injectable providers. Resolve the already registered
    // original instance lazily, after Nest has constructed its controller map.
    const controller = {
      catalog: (...args: Parameters<CategoryGovernanceController['catalog']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).catalog(...args),
      previewCreation: (...args: Parameters<CategoryGovernanceController['previewCreation']>) => moduleRef.get(CategoryGovernanceController, { strict: false }).previewCreation(...args),
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
  provide: HumanMemoryManagementRequestFactory, inject: [AI_NATIVE_BODY_DATABASE, AuthService, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, operationLogs: OperationLogService) =>
    new HumanMemoryManagementRequestFactory({ db, auth, operationLogs, clock: { now: () => Date.now() } })
};
export const AI_NATIVE_KNOWLEDGE_MANAGEMENT_PROVIDER: FactoryProvider = {
  provide: HumanKnowledgeManagementRequestFactory, inject: [AI_NATIVE_BODY_DATABASE, AuthService, TenantIntegrationService, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, integrations: TenantIntegrationService, operationLogs: OperationLogService) =>
    new HumanKnowledgeManagementRequestFactory({ db, auth, integrations, operationLogs, clock: { now: () => Date.now() } })
};
/** Current human reads only. No policy seed, task creation or model dispatch;
 * file and memory access use their original request-bound authority sources. */
export const AI_NATIVE_KNOWLEDGE_CONSUMPTION_PROVIDER: FactoryProvider = {
  provide: HumanKnowledgeConsumptionRequestFactory, inject: [AI_NATIVE_BODY_DATABASE, AuthService, TenantIntegrationService, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, integrations: TenantIntegrationService, operationLogs: OperationLogService) =>
    new HumanKnowledgeConsumptionRequestFactory({ db, auth, integrations, operationLogs,
      memory: { db }, clock: { now: () => Date.now() } })
};
export const AI_NATIVE_KNOWLEDGE_POLICY_PROVIDER: FactoryProvider = {
  provide: KNOWLEDGE_POLICY_MANAGEMENT, inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard) =>
    createKnowledgePolicyManagementFactory({ db, auth, guard, enabled: true, clock: () => new Date() })
};

export const AI_NATIVE_RETENTION_PROVIDER: FactoryProvider = {
  provide: AI_RETENTION_REQUESTS, inject: [AI_NATIVE_BODY_DATABASE, AuthService, FileStorageRuntimeService],
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
      receipts: value => service.receipts(value), protectStoredBodies: value => service.protectStoredBodies(value),
      close: () => { authorization = undefined; } };
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
  'draft-operation', 'submission-preparation', 'submission-read', 'result-read', 'fulfillment-receipt-read'] as const;
const staffManualOperations = ['host-read', 'template-read', 'draft-create', 'draft-read', 'draft-edit',
  'evidence-bind', 'evidence-fingerprint', 'evidence-replace',
  'submission-review', 'submission-prepare', 'submission-submit'] as const;
export const AI_NATIVE_STAFF_RECOGNITION_PROVIDERS: FactoryProvider[] = [{
  provide: AI_STAFF_INSPECTION_ACCOUNTING, inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService) =>
    composeStaffInspectionAccounting({ db, auth, guard, subscriptions }, [
      { code: STAFF_RECOGNITION_SCENES.image, version: '1' }, { code: STAFF_RECOGNITION_SCENES.audio, version: '1' }])
}, {
  provide: INSPECTION_OBJECT_READER,
  inject: [AI_NATIVE_BODY_DATABASE, TenantIntegrationService, { token: AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, integrations: TenantIntegrationService, value?: unknown) =>
    readStaffRecognitionConfiguration(value).enabled ? new TenantInspectionObjectReader(db, integrations) : undefined
}, {
  provide: AI_NATIVE_STAFF_RECOGNITION_RUNTIME,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, RentalCoreService, SubscriptionService, SecretBox, FileStorageRuntimeService, ModuleRef,
    { token: AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, optional: true }, { token: AI_NATIVE_STAFF_RECOGNITION_ADAPTERS, optional: true }, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, core: RentalCoreService, subscriptions: SubscriptionService,
    secrets: SecretBox, files: FileStorageRuntimeService, moduleRef: ModuleRef, value?: unknown, adapters?: readonly ModelAdapter[], capacity?: GatewayCapacityPort) =>
    composeStandardStaffRecognition({ db, auth, guard, core, subscriptions, secrets, files, moduleRef, adapters, capacity }, value)
}, ...([['application', INSPECTION_RECOGNITION_TASKS], ['policies', AI_STAFF_INSPECTION_TASK_POLICIES]] as const).map(([key, provide]) => ({
  provide, inject: [AI_NATIVE_STAFF_RECOGNITION_RUNTIME],
  useFactory: (runtime: ReturnType<typeof composeStandardStaffRecognition>) => runtime[key]
}))];
export const AI_NATIVE_STAFF_RECEIPT_PROVIDERS: FactoryProvider[] = [{
  provide: AI_STAFF_INSPECTION_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, RentalCoreService, ModuleRef,
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
const originalSceneInjection = [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService, RentalCoreService,
  RentalBusinessService, RentalWorkspaceReportRepository, MembershipService, PaymentRuntimeService, RentalFundingService];
function originalSceneDependencies(db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService,
    integrations?: Pick<TenantIntegrationService, 'observeOpeningConfiguration'>,
    historySelection?: RequestBoundOriginalSceneDependencies['historySelection'],
    capabilities?: Pick<WorkspaceCapabilityService, 'overview'>): RequestBoundOriginalSceneDependencies {
  return { db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding,
      ...(integrations ? { integrations } : {}),
      ...(historySelection ? { historySelection } : {}),
      ...(capabilities ? { capabilities } : {}),
      creationRules: [{ sceneCode: 'order_explanation', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:view'], maxInputAgeMs: 300000 },
      { sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 300000 },
      { sceneCode: 'opening_diagnosis', sceneVersion: '1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['rental-os:order:view'], maxInputAgeMs: 300000 }] };
}
export const AI_NATIVE_ORIGINAL_ORDER_ANSWER_REQUESTS = Symbol('AI_NATIVE_ORIGINAL_ORDER_ANSWER_REQUESTS');
/** The existing final-answer contract remains readable after execution is
 * disabled. This provider has no SecretBox, Gateway, publication or worker. */
export const AI_NATIVE_ORIGINAL_ORDER_ANSWER_PROVIDER: FactoryProvider<ReturnType<typeof composeRequestBoundOriginalOrderAnswerReader>> = {
  provide: AI_NATIVE_ORIGINAL_ORDER_ANSWER_REQUESTS,
  inject: [...originalSceneInjection, RentalOrderConfirmationService, RentalBusinessFactRepository],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService,
    confirmation: RentalOrderConfirmationService, quoteFacts: RentalBusinessFactRepository) =>
    composeRequestBoundOriginalOrderAnswerReader(originalSceneDependencies(db, auth, guard, subscriptions, core,
      business, reports, memberships, payments, funding, undefined, { confirmation, quoteFacts, core }),
      { enabled: true, audience: 'operator' })
};
/** Explicit human rule draft save; original reads remain independently guarded. */
export const AI_NATIVE_TASK_RULE_DRAFT_CONFIGURATION = Symbol('AI_NATIVE_TASK_RULE_DRAFT_CONFIGURATION');
export const AI_NATIVE_TASK_RULE_DRAFT_PROVIDER: FactoryProvider = {
  provide: AI_TASK_RULE_DRAFT_REQUESTS, inject: [...originalSceneInjection, { token: AI_NATIVE_TASK_RULE_DRAFT_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, configuration?: unknown) => {
    const parsed = z.object({ saveEnabled: z.boolean() }).strict().safeParse(configuration ?? { saveEnabled: false });
    if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const original = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding), db, business };
    return composeRequestBoundTaskRuleDraft({ original,
      saveEnabled: parsed.data.saveEnabled, host: { holderId: 'ai-native-rule-draft-human', leaseMs: 100000 },
      preparationAdmission: createOriginalTaskStartAdmission(original, 'opening_diagnosis') });
  }
};

export const AI_NATIVE_TASK_CALENDAR_DRAFT_CONFIGURATION = Symbol('AI_NATIVE_TASK_CALENDAR_DRAFT_CONFIGURATION');
export const AI_NATIVE_TASK_CALENDAR_DRAFT_PROVIDER: FactoryProvider = {
  provide: AI_TASK_CALENDAR_DRAFT_REQUESTS, inject: [...originalSceneInjection, { token: AI_NATIVE_TASK_CALENDAR_DRAFT_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, configuration?: unknown) => {
    const parsed = z.object({ saveEnabled: z.boolean() }).strict().safeParse(configuration ?? { saveEnabled: false });
    if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return composeRequestBoundTaskCalendarDraft({ original: { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding), business },
      saveEnabled: parsed.data.saveEnabled, host: { holderId: 'ai-native-calendar-draft-human', leaseMs: 100000 } });
  }
};

export const AI_NATIVE_TASK_ORDER_HANDOFF_PROVIDER: FactoryProvider = {
  provide: AI_TASK_ORDER_HANDOFF_REQUESTS, inject: originalSceneInjection,
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService) =>
    composeRequestBoundTaskOrderHandoff(originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding))
};

/** Default closed until the conversation migration and host are explicitly
 * configured. This grants metadata/admission only, never model execution. */
export const AI_NATIVE_CONVERSATION_CONFIGURATION = Symbol('AI_NATIVE_CONVERSATION_CONFIGURATION');
export const AI_NATIVE_CONVERSATION_PROVIDER: FactoryProvider = {
  provide: AI_CONVERSATION_REQUESTS, inject: [...originalSceneInjection, { token: AI_NATIVE_CONVERSATION_CONFIGURATION, optional: true },
    { token: AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, optional: true }, { token: AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, optional: true },
    { token: AI_WORKBENCH_MODEL_CONTROL_REQUESTS, optional: true }, { token: ModuleRef, optional: true },
    RentalOrderConfirmationService, RentalBusinessFactRepository],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, value?: unknown,
    observations?: Pick<ReturnType<typeof composeRequestBoundOriginalTaskRecoveryReaders>, 'readModelResult' | 'reopenModelSource'>,
    displayValue?: unknown, modelControls?: ReturnType<typeof composeWorkbenchModelControlRequests>, moduleRef?: Pick<ModuleRef, 'get'>,
    confirmation?: RentalOrderConfirmationService, quoteFacts?: RentalBusinessFactRepository) => {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(structuredClone(value ?? { enabled: false }));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const original = originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding,
      undefined, confirmation && quoteFacts ? { confirmation, quoteFacts, core } : undefined);
    const display = readWorkbenchDisplayConfiguration(displayValue);
    const reads = display.enabled && observations ? composeAiWorkbenchDisplayRequests(original,
      { currentConfiguration: () => displayValue }, { ...observations, async readOrderAnswer(request, reference) {
        const order = moduleRef?.get<OriginalOrderReadHttpRequests>(AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, { strict: false });
        if (!order) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return order.readAnswer(request, reference);
      } }, { async review(request, query, signal) {
        // Resolve the existing request-bound reader lazily to keep the model
        // control/conversation/TaskCenter provider graph acyclic.
        const center = moduleRef?.get<ReturnType<typeof composeRequestBoundTaskCenter>>(AI_NATIVE_TASK_CENTER_REQUESTS, { strict: false });
        if (!center) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return center.review(request, query, signal);
      } }) : undefined;
    return composeAiConversationRequests(original, parsed.data.enabled, observations, reads, modelControls, {
      async read(request, query, signal) {
        const center = moduleRef?.get<ReturnType<typeof composeRequestBoundTaskCenter>>(AI_NATIVE_TASK_CENTER_REQUESTS, { strict: false });
        if (!center) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return center.result(request, query, signal);
      }
    });
  }
};
export const AI_NATIVE_ORIGINAL_REQUEST_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_SCENE_REQUESTS, inject: [...originalSceneInjection, ModuleRef, TenantIntegrationService, WorkspaceCapabilityService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, moduleRef?: Pick<ModuleRef, 'get'>,
    integrations?: TenantIntegrationService, capabilities?: WorkspaceCapabilityService) =>
    composeRequestBoundOriginalScenes({ ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding, integrations,
      undefined, capabilities),
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
    { token: AI_SELECTED_QUOTE_TASK_REQUESTS, optional: true }, { token: AI_SETTINGS_TASK_HTTP_REQUESTS, optional: true }, TenantIntegrationService,
    RentalOrderConfirmationService, RentalBusinessFactRepository, WorkspaceCapabilityService, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, files?: FileStorageRuntimeService,
    quotes?: { readScene(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown> },
    settings?: { readTaskScene(request: { headers: { authorization?: unknown } }, value: unknown): Promise<unknown> },
    integrations?: TenantIntegrationService, confirmation?: RentalOrderConfirmationService, quoteFacts?: RentalBusinessFactRepository,
    capabilities?: WorkspaceCapabilityService, operationLogs?: OperationLogService) => {
    const original = composeRequestBoundOriginalTaskRecoveryReaders(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding, integrations,
        confirmation && quoteFacts ? { confirmation, quoteFacts, core } : undefined, capabilities),
      { enabled: true, audience: 'operator' }, {
        policy: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: 32768, orderExplainTool: true },
        // Direct text-only compositions may omit files. A frozen snapshot with
        // knowledge then remains unavailable, never stripped to expose its text.
        ...(files ? { knowledge: { db, policyDb: db, fileRuntime: files, operationLogs, memory: { db }, includePreferences: false } } : {})
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

export const AI_NATIVE_TASK_CENTER_RECOVERY_PROVIDER: FactoryProvider = {
  provide: AI_TASK_CENTER_RECOVERY_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, AI_ORIGINAL_SCENE_RECOVERY_REQUESTS, ModuleRef,
    { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, original: TaskCenterRecoveryDependencies['original'], moduleRef: Pick<ModuleRef, 'get'>,
    orderValue?: unknown, openingValue?: unknown, quoteValue?: unknown) =>
    composeTaskCenterRecoveryRequests({ db, auth, original, host(kind) {
      const value = kind === 'order_read' ? orderValue : kind === 'opening_model' ? openingValue : quoteValue;
      if (kind === 'opening_read' || !readOrderExecutionConfiguration(value).enabled) return undefined;
      const token = kind === 'order_read' ? AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS
        : kind === 'opening_model' ? AI_ORIGINAL_OPENING_MODEL_REQUESTS : AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS;
      try {
        const host = moduleRef.get<ReturnType<TaskCenterRecoveryDependencies['host']>>(token, { strict: false });
        return typeof host?.recover === 'function' && typeof host.takeover === 'function' ? host : undefined;
      } catch { return undefined; }
    } })
};

const quoteModelRequestMethods = ['start', 'refreshInput', 'submitAnswer', 'resume', 'continueAnswer', 'reconcile', 'recover',
  'takeover', 'requestCancel', 'readQuotePreparation', 'confirmClarifiedQuote', 'readClarifiedQuoteReceipt', 'readExecution'] as const;
type QuoteModelRequests = Pick<ReturnType<typeof composeRequestBoundPersistedOriginalSceneModel>, typeof quoteModelRequestMethods[number]>;

/** Quote clarification uses the original input runner and one persisted Gateway.
 * Separate from order creation: model output/answered questions never approve an
 * order. Omitted server configuration creates no host, policy or paid call. */
export const AI_NATIVE_QUOTE_MODEL_EXECUTION_PROVIDER: FactoryProvider<QuoteModelRequests> = {
  provide: AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true }, { token: AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, optional: true },
    RentalOrderConfirmationService, RentalBusinessFactRepository, AI_NATIVE_GATEWAY_CAPACITY, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, secrets: SecretBox,
    files: FileStorageRuntimeService, serverValue?: unknown, displayValue?: unknown,
    confirmation?: RentalOrderConfirmationService, quoteFacts?: RentalBusinessFactRepository, capacity?: GatewayCapacityPort,
    operationLogs?: OperationLogService) => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) {
      const unavailable = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
      return Object.freeze({ start: unavailable, refreshInput: unavailable, submitAnswer: unavailable, resume: unavailable, continueAnswer: unavailable,
        reconcile: unavailable, recover: unavailable, takeover: unavailable, requestCancel: unavailable,
        readQuotePreparation: unavailable, confirmClarifiedQuote: unavailable,
        readClarifiedQuoteReceipt: composeRequestBoundOriginalTaskRecoveryReaders(
          originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding),
          { enabled: true, audience: 'operator' },
          { policy: { sceneCode: 'quote_clarification', routeScene: 'chat', maxOutputTokens: 32768 } }).readClarifiedQuoteReceipt,
        readExecution: unavailable });
    }
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function'
      || configuration.includeKnowledge && !files) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const original = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding,
      undefined, confirmation && quoteFacts ? { confirmation, quoteFacts, core } : undefined), db };
    const admission = createOriginalTaskStartAdmission(original, 'quote_clarification');
    const display = readWorkbenchDisplayConfiguration(displayValue);
    const requests = composeRequestBoundPersistedOriginalSceneModel({
      ...original,
      ...(display.enabled ? { displayPublication: { currentConfiguration: () => displayValue } } : {}),
      scene: { code: 'quote_clarification', version: '1' },
      gatewayScene: { sceneCode: 'quote_clarification', routeScene: 'chat', maxOutputTokens: configuration.maxOutputTokens },
      gateway: { secrets, platformProfileId: configuration.platformProfileId, routeScene: 'chat', capacity,
        pricing: configuration.pricing, nativeProtocol: NATIVE_MODEL_PROTOCOLS,
        ...(configuration.inputCounting ? { inputCounting: configuration.inputCounting } : {}) },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, operationLogs, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host,
      inputContinuation: { db, currentRuntimeEnabled: async (sceneCode, sceneVersion) =>
        configuration.enabled && sceneCode === 'quote_clarification' && sceneVersion === '1' } });
    const start: typeof requests.start = async (request, value, signal) => {
      await admission(request, value, undefined, signal);
      return requests.start(request, value, signal);
    };
    return Object.freeze({ ...requests, start });
  }
};

/** Same persistent model/runner as quote clarification, with a closed opening
 * scene and an independent server gate. Diagnosis never approves settings. */
export const AI_NATIVE_OPENING_MODEL_EXECUTION_PROVIDER: FactoryProvider<OpeningModelRequests> = {
  provide: AI_ORIGINAL_OPENING_MODEL_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true }, { token: AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, optional: true }, TenantIntegrationService,
    RentalOrderConfirmationService, RentalBusinessFactRepository, WorkspaceCapabilityService, AI_NATIVE_GATEWAY_CAPACITY, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, secrets: SecretBox,
    files: FileStorageRuntimeService, serverValue?: unknown, displayValue?: unknown, integrations?: TenantIntegrationService,
    confirmation?: RentalOrderConfirmationService, quoteFacts?: RentalBusinessFactRepository, capabilities?: WorkspaceCapabilityService,
    capacity?: GatewayCapacityPort, operationLogs?: OperationLogService) => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) {
      const unavailable = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
      return Object.freeze({ start: unavailable, recover: unavailable, reconcile: unavailable,
        takeover: unavailable, requestCancel: unavailable, readExecution: unavailable });
    }
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function'
      || configuration.includeKnowledge && !files) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const original = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding, integrations,
      confirmation && quoteFacts ? { confirmation, quoteFacts, core } : undefined, capabilities), db };
    const admission = createOriginalTaskStartAdmission(original, 'opening_diagnosis');
    const display = readWorkbenchDisplayConfiguration(displayValue);
    const requests = composeRequestBoundPersistedOriginalSceneModel({
      ...original,
      ...(display.enabled ? { displayPublication: { currentConfiguration: () => displayValue } } : {}),
      scene: { code: 'opening_diagnosis', version: '1' },
      gatewayScene: { sceneCode: 'opening_diagnosis', routeScene: 'chat', maxOutputTokens: configuration.maxOutputTokens },
      gateway: { secrets, platformProfileId: configuration.platformProfileId, routeScene: 'chat', capacity,
        pricing: configuration.pricing, nativeProtocol: NATIVE_MODEL_PROTOCOLS,
        ...(configuration.inputCounting ? { inputCounting: configuration.inputCounting } : {}) },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, operationLogs, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host });
    const start: typeof requests.start = async (request, value, signal) => {
      await admission(request, value, undefined, signal);
      return requests.start(request, value, signal);
    };
    return Object.freeze({ start, recover: requests.recover, reconcile: requests.reconcile,
      takeover: requests.takeover, requestCancel: requests.requestCancel, readExecution: requests.readExecution });
  }
};

/** Explicit model controls reuse the selected scene's original Gateway and
 * Task budget. Observing their original operations remains available when a
 * new-generation switch is off; reads never build a model host. */
export const AI_NATIVE_WORKBENCH_MODEL_CONTROL_PROVIDER: FactoryProvider = {
  provide: AI_WORKBENCH_MODEL_CONTROL_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, optional: true }, TenantIntegrationService,
    RentalOrderConfirmationService, RentalBusinessFactRepository, ModuleRef, WorkspaceCapabilityService, AI_NATIVE_GATEWAY_CAPACITY, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, secrets: SecretBox,
    files: FileStorageRuntimeService, orderValue?: unknown, quoteValue?: unknown, openingValue?: unknown,
    displayValue?: unknown, integrations?: TenantIntegrationService,
    confirmation?: RentalOrderConfirmationService, quoteFacts?: RentalBusinessFactRepository, moduleRef?: Pick<ModuleRef, 'get'>,
    capabilities?: WorkspaceCapabilityService, capacity?: GatewayCapacityPort, operationLogs?: OperationLogService) => {
    const original = originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding, integrations,
      confirmation && quoteFacts ? { confirmation, quoteFacts, core } : undefined, capabilities);
    const configuration = (scene: string) => {
      if (!['order_explanation', 'quote_clarification', 'opening_diagnosis'].includes(scene)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return readOrderExecutionConfiguration(scene === 'order_explanation' ? orderValue : scene === 'quote_clarification' ? quoteValue : openingValue);
    };
    const currentPublication = () => readCurrentWorkbenchDisplayConfiguration(displayValue, original.clock);
    return composeWorkbenchModelControlRequests(original, {
      available: scene => { currentPublication(); return configuration(scene).enabled; },
      async readOrderAnswer(request, reference) {
        const order = moduleRef?.get<OriginalOrderReadHttpRequests>(AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, { strict: false });
        if (!order) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return order.readAnswer(request, reference);
      },
      ...(files ? { knowledge: { db, policyDb: db, fileRuntime: files, operationLogs, memory: { db }, includePreferences: false } } : {}),
      async build(input, control) {
        const selected = configuration(control.receipt.sceneCode);
        currentPublication();
        if (!selected.enabled) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const receipt = control.receipt;
        const resource = await control.readPreparationOrigin({ scopeId: receipt.scopeId, taskId: receipt.command.taskId,
          runId: receipt.runId, resourceOriginRunId: receipt.resourceOriginRunId });
        currentPublication();
        return composePersistedTaskModelHost({ ...input,
          scene: { code: receipt.sceneCode, version: receipt.sceneVersion },
          gatewayScene: { sceneCode: receipt.sceneCode, routeScene: 'chat', maxOutputTokens: selected.maxOutputTokens },
          gateway: { secrets, platformProfileId: selected.platformProfileId, routeScene: 'chat', pricing: selected.pricing, capacity,
            nativeProtocol: NATIVE_MODEL_PROTOCOLS, ...(selected.inputCounting ? { inputCounting: selected.inputCounting } : {}) },
          host: selected.host,
          task: { taskId: receipt.command.taskId, runId: receipt.runId, registrationRef: receipt.registrationRef,
            material: control.material, limits: aiTaskRunnerLimitsSchema.parse(resource.limits) },
          // An explicit pure text control accepts no new human-answer lineage.
          inputSource: { resolve: async () => ({ kind: 'not_required' as const }),
            validateAnswers: async () => { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); } },
          readRunOrigin: control.readOrigin, controlResourceOrigin: control.readPreparationOrigin,
          revalidateMaterial: async (key, material) => {
            currentPublication();
            if (key.taskId !== receipt.command.taskId || key.runId !== receipt.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            const current = await control.revalidate();
            // Source/authorization reads can yield while publication expires or
            // is withdrawn. The Gateway calls this again before dispatch.
            currentPublication();
            if (requestFingerprint(material) !== requestFingerprint(current)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          },
        });
      },
    });
  },
};

/** Separate server-owned probe configuration: enabling an order workflow must
 * not implicitly permit billable capability challenges (or vice versa). The
 * publication supplies its independent gate; construction never seeds policies
 * or runs a probe. A complete disabled configuration retains only authorized
 * original reads; absence of configuration cannot invent a history host. */
export const AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION = Symbol('AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION');
const probeConfiguration = z.union([
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.boolean(), platformProfileId: orderExecutionConfiguration.options[1].shape.platformProfileId,
    priceVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
    sceneVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u),
    host: orderExecutionConfiguration.options[1].shape.host,
    capabilities: z.array(textProbeCommandSchema.shape.capability.unwrap()).min(1).max(AI_CAPABILITY_PROBE_KINDS_DRAFT.length)
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
const originalProbeReadMethods: readonly (keyof TextCapabilityRequest)[] = ['readOriginal', 'readTask', 'inspect',
  'readTaskAction', 'readTaskActionReceipt', 'readHistory', 'readAccounting', 'readAccountingOperation', 'close'];
/** The existing immutable request -> persistent task -> measured runner ->
 * unique Gateway/dispatch/ledger -> evidence workflow. This factory performs
 * no reads on assembly. Calls quotas are not supplier money/token pricing;
 * current Guard, scene/action policy, entitlement and budget gates still apply.
 * No transport or authority can be provided in a request/configuration body. */
export const AI_NATIVE_CAPABILITY_PROBE_PROVIDER: FactoryProvider<Pick<TextCapabilityProbeRequestFactory, 'open'>> = {
  provide: TEXT_CAPABILITY_PROBE_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
    { token: AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION, optional: true }, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    secrets: SecretBox, serverValue?: unknown, capacity?: GatewayCapacityPort) => {
    const configuration = readProbeConfiguration(serverValue);
    if (!('platformProfileId' in configuration)) return Object.freeze({ open(): never {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    } });
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function') {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const factory = new TextCapabilityProbeRequestFactory({ db, auth, guard, subscriptions, secrets, capacity,
      platformProfileId: configuration.platformProfileId, sceneVersion: configuration.sceneVersion,
      priceVersion: configuration.priceVersion, pricing: { mode: 'persisted_calls', priceVersion: configuration.priceVersion },
      host: configuration.host, probeCapabilities: configuration.capabilities,
      taskActionPolicyTtlMs: configuration.taskActionPolicyTtlMs,
      ...(!configuration.enabled ? { protocol: { post: async () => { throw new ModelGatewayError('CONFIG_INVALID'); } } } : {}),
      taskActionPolicies: probeOperations.map(operation => ({ operation, requiredPermissions: ['system:params:manage'] })) });
    if (configuration.enabled) return factory;
    return Object.freeze({ open: (request: Parameters<TextCapabilityProbeRequestFactory['open']>[0]) => {
      const current = factory.open(request);
      // Keep an allowlist: a later factory method cannot silently reopen new
      // execution or re-publish capability evidence when the gate is closed.
      return Object.freeze(Object.fromEntries(Object.entries(current).map(([method, operation]) => [method,
        originalProbeReadMethods.includes(method as keyof TextCapabilityRequest) ? operation : () => {
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        }])) as TextCapabilityRequest);
    } });
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
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
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
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService) => {
    const history = GatewayPricingRequestFactory.history({ db, auth, guard, subscriptions });
    return Object.freeze({ call: history.call.bind(history) });
  }
};
export const AI_NATIVE_PLATFORM_PROBE_PROVIDER: FactoryProvider<ReturnType<typeof composeStandardPlatformProbe>> = {
  provide: PLATFORM_CAPABILITY_PROBE_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, ApiAuthGuard, SecretBox, { token: AI_NATIVE_PLATFORM_PROBE_CONFIGURATION, optional: true },
    { token: AI_NATIVE_PLATFORM_PROBE_AUDIT, optional: true }, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, guard: ApiAuthGuard, secrets: SecretBox, configuration?: unknown, audit?: UnifiedGatewayAudit, capacity?: GatewayCapacityPort) =>
    composeStandardPlatformProbe({ db, guard, secrets, audit, capacity }, configuration)
};
export const AI_NATIVE_INPUT_COUNTING_PROVIDER: FactoryProvider<ReturnType<typeof composeStandardInputCounting>> = {
  provide: AI_COUNTING_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService, SecretBox,
    { token: AI_NATIVE_INPUT_COUNTING_CONFIGURATION, optional: true }, RentalCoreService, AI_NATIVE_GATEWAY_CAPACITY],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    secrets: SecretBox, configuration?: unknown, core?: RentalCoreService, capacity?: GatewayCapacityPort) =>
    composeStandardInputCounting({ db, auth, guard, subscriptions, secrets, core, capacity }, configuration)
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
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, confirmation: RentalOrderConfirmationService,
    quoteFacts: RentalBusinessFactRepository, value?: unknown) => {
    const configuration = readQuoteOrderConfiguration(value);
    const dependencies = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding),
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
    const admission = createOriginalTaskStartAdmission({ ...dependencies, db }, 'quote_clarification');
    const module = AiHumanQuoteSelectionModule.registerHttpTask(dependencies, options, task, reprepare,
      configuration.enabled ? { admission: (request, original, signal) => admission(request, original, undefined, signal) } : undefined,
      configuration.enabled ? { db, currentRuntimeEnabled: async (sceneCode, sceneVersion) =>
        configuration.enabled && sceneCode === 'quote_clarification' && sceneVersion === '1' } : undefined);
    const entry = module.providers?.find(item => typeof item === 'object' && 'provide' in item && item.provide === provide) as FactoryProvider | undefined;
    if (!entry || typeof entry.useFactory !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const requests = entry.useFactory() as Record<string, unknown>;
    const closedMethods = provide === AI_SELECTED_QUOTE_TASK_REQUESTS ? ['start', 'continueConfirmation', 'reconcile']
      : provide === AI_HUMAN_QUOTE_SELECTION_REQUESTS ? ['select'] : ['decideSelectedProposal', 'reprepareSelectedProposal',
        'reissueSelectedRequest', 'selectReissuedQuote', 'prepareTaskCenterApproval'];
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
    ...originalSceneInjection, RentalOrderConfirmationService, RentalBusinessFactRepository,
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (model: QuoteModelRequests, selections: Parameters<typeof composeClarifiedQuoteSelectionRequests>[1], db: PrismaService,
    auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService, core: RentalCoreService, business: RentalBusinessService,
    reports: RentalWorkspaceReportRepository, memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService,
    confirmation: RentalOrderConfirmationService, quoteFacts: RentalBusinessFactRepository, value?: unknown) => {
    const dependencies = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding),
      core, confirmation, quoteFacts, scene: { code: 'quote_clarification', version: '1' } };
    const preparation = composeRequestBoundClarifiedQuoteSelectionPreparation(model, dependencies, { enabled: true, audience: 'operator' });
    const requests = composeClarifiedQuoteSelectionRequests(model, selections, preparation);
    if (readQuoteOrderConfiguration(value).enabled) return requests;
    return Object.freeze({ ...requests, select: async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); } });
  }
};

/** Explicit same-owner manager CAS, never policy seeding during task creation.
 * Without server execution configuration, only the original read policies are
 * exposed. The closed order chain adds no approval or free-input permission. */
export const AI_NATIVE_TASK_READ_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_TASK_READ_POLICY_REQUESTS, inject: [...originalSceneInjection, AI_ORIGINAL_TASK_ACTION_POLICIES],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService,
    policies: ReturnType<typeof composeRequestBoundOriginalTaskActionPolicies>) => composeTaskReadPolicyRequests({
      ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding), policies })
};
export const AI_NATIVE_ORIGINAL_READ_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_ORIGINAL_TASK_ACTION_POLICIES,
  inject: [...originalSceneInjection, { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, serverValue?: unknown, quoteValue?: unknown, quoteModelValue?: unknown, openingModelValue?: unknown) => {
    const configuration = readOrderExecutionConfiguration(serverValue), quote = readQuoteOrderConfiguration(quoteValue);
    const quoteModel = readOrderExecutionConfiguration(quoteModelValue);
    const openingModel = readOrderExecutionConfiguration(openingModelValue);
    const operations = [...originalReadOperations, ...(configuration.enabled ? originalOrderExecutionOperations : [])];
    return composeRequestBoundOriginalTaskActionPolicies(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding), {
        enabled: true, audience: 'operator', ttlMs: 120000,
        templates: [...operations.map(operation => ({ operation, requiredPermissions: ['rental-os:order:view'],
          ...((originalReadOperations as readonly string[]).includes(operation) ? {} : { sceneCode: 'order_explanation' }) })),
          // Reading an owned historical task is independent of enabling its
          // model or execution host. These templates still require human CAS
          // configuration and the original current scene permissions.
          ...originalReadOperations.map(operation => ({ operation, sceneCode: 'quote_clarification',
            requiredPermissions: ['rental-os:order:create'] })),
          ...originalReadOperations.map(operation => ({ operation, sceneCode: 'opening_diagnosis',
            requiredPermissions: ['rental-os:price:manage'] })),
          ...(quote.enabled || quoteModel.enabled ? [...originalOrderExecutionOperations,
            ...(quoteModel.enabled ? ['request_input', 'submit_input', 'resume_input'] as const : []),
            ...(quote.enabled ? ['decide_approval'] as const : [])].map(operation => ({
            operation, sceneCode: 'quote_clarification', requiredPermissions: ['rental-os:order:create'] })) : []),
          ...(openingModel.enabled ? originalOrderExecutionOperations.map(operation => ({
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
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, serverValue?: unknown, probeValue?: unknown, settingsValue?: unknown, quoteValue?: unknown, recognitionValue?: unknown, quoteModelValue?: unknown, openingModelValue?: unknown) => {
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
        'tenant.opening.diagnose', 'tenant.config.propose', ...(settings.enabled ? [AI_APPROVED_SETTINGS_TOOL_CODE] as const : []),
        ...(openingModel.enabled ? ['ai.model.text'] as const : [])] as const },
      ...(execution.enabled ? [{ scene: { code: 'order_explanation', version: '1' },
        tools: ['ai.model.text', 'rental.order.explain'] as const }] : []),
      ...(probe.enabled ? [{ scene: { code: TEXT_PROBE_SCENE, version: probe.sceneVersion },
        tools: [TEXT_CAPABILITY_PROBE_TOOL] as const }] : []),
      ...(recognition.enabled ? [{ scene: { code: STAFF_RECOGNITION_SCENES.image, version: '1' }, tools: ['ai.model.image'] as const },
        ...(recognition.audio ? [{ scene: { code: STAFF_RECOGNITION_SCENES.audio, version: '1' }, tools: ['ai.model.audio'] as const }] : [])] : [])
    ];
    return composeRequestBoundScenePlanPolicies(
      originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding), {
        enabled: true, audience: 'operator', scenes
      });
  }
};
export const AI_NATIVE_ORIGINAL_ORDER_EXECUTION_PROVIDER: FactoryProvider<OriginalOrderReadHttpRequests> = {
  provide: AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS,
  inject: [...originalSceneInjection, SecretBox, FileStorageRuntimeService,
    { token: AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, optional: true },
    { token: AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, optional: true }, RentalOrderConfirmationService, RentalBusinessFactRepository,
    AI_NATIVE_ORIGINAL_ORDER_ANSWER_REQUESTS, AI_NATIVE_GATEWAY_CAPACITY, OperationLogService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository,
    memberships: MembershipService, payments: PaymentRuntimeService, funding: RentalFundingService, secrets: SecretBox,
    files: FileStorageRuntimeService, serverValue?: unknown, displayValue?: unknown,
    confirmation?: RentalOrderConfirmationService, quoteFacts?: RentalBusinessFactRepository,
    historical?: ReturnType<typeof composeRequestBoundOriginalOrderAnswerReader>, capacity?: GatewayCapacityPort,
    operationLogs?: OperationLogService): OriginalOrderReadHttpRequests => {
    const configuration = readOrderExecutionConfiguration(serverValue);
    if (!configuration.enabled) return Object.freeze({ ...Object.fromEntries(originalOrderReadRequestMethods.map(method =>
      [method, async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }])),
      ...(historical ? { readAnswer: historical.read.bind(historical) } : {}) }) as unknown as OriginalOrderReadHttpRequests;
    if (typeof secrets?.encrypt !== 'function' || typeof secrets?.decrypt !== 'function'
      || configuration.includeKnowledge && !files) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const original = { ...originalSceneDependencies(db, auth, guard, subscriptions, core, business, reports, memberships, payments, funding,
      undefined, confirmation && quoteFacts ? { confirmation, quoteFacts, core } : undefined), db };
    const display = readWorkbenchDisplayConfiguration(displayValue);
    const admission = createOriginalTaskStartAdmission(original, 'order_explanation');
    const requests = selectOriginalOrderReadHttpRequests(composeRequestBoundPersistedOriginalOrderRead({
      ...original,
      ...(display.enabled ? { displayPublication: { currentConfiguration: () => displayValue } } : {}),
      scene: { code: 'order_explanation', version: '1' },
      gatewayScene: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: configuration.maxOutputTokens, orderExplainTool: true },
      gateway: { secrets, platformProfileId: configuration.platformProfileId, routeScene: 'chat', capacity,
        pricing: configuration.pricing, nativeProtocol: NATIVE_MODEL_PROTOCOLS,
        ...(configuration.inputCounting ? { inputCounting: configuration.inputCounting } : {}) },
      ...(configuration.includeKnowledge ? { knowledge: { db, policyDb: db, fileRuntime: files, operationLogs, memory: { db }, includePreferences: false } } : {})
    }, { enabled: true, audience: 'operator', host: configuration.host,
      orderReadChain: { enabled: true, answerRoundTrip: true } }));
    const start: typeof requests.start = async (request, value, signal) => {
      await admission(request, value, undefined, signal);
      return requests.start(request, value, signal);
    };
    return Object.freeze({ ...requests, start, ...(historical ? { readAnswer: historical.read.bind(historical) } : {}) });
  }
};

/** Original ordinary-name human host. Trusted server configuration selects the
 * already approved scene policy; a missing policy remains unavailable. */
export const AI_NATIVE_MEMBER_NAME_CONFIGURATION = Symbol('AI_NATIVE_MEMBER_NAME_CONFIGURATION');
export const AI_NATIVE_MEMBER_NAME_PROVIDER: FactoryProvider = {
  provide: AI_MEMBER_NAME_REQUESTS,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService, MembershipService,
    { token: AI_NATIVE_MEMBER_NAME_CONFIGURATION, optional: true }],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    memberships: MembershipService, value?: unknown) => {
    const configuration = z.object({ enabled: z.boolean(), sceneCode: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      sceneVersion: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict().parse(value ?? {
        enabled: false, sceneCode: 'ordinary_profile_change', sceneVersion: '1' });
    const holderId = 'ai-native-member-name-human';
    return composeMemberNameRequests({ db, auth, guard, subscriptions, memberships, holderId,
      scene: { code: configuration.sceneCode, version: configuration.sceneVersion } },
      { enabled: configuration.enabled, host: { holderId, leaseMs: 100000 } });
  }
};

/** Independently published ordinary-section AI proposals. Original Task policy,
 * initial admission and R1 receipts remain mandatory; no Core save or publish. */
export const AI_NATIVE_TASK_OPENING_PROPOSAL_PROVIDER: FactoryProvider = {
  provide: TaskOpeningProposalApplication,
  inject: [AI_NATIVE_BODY_DATABASE, AuthService, ApiAuthGuard, SubscriptionService, RentalCoreService, RentalBusinessService,
    RentalWorkspaceReportRepository, MembershipService, PaymentRuntimeService, RentalFundingService,
    { token: AI_NATIVE_TASK_OPENING_PROPOSAL_CONFIGURATION, optional: true }, TenantIntegrationService, WorkspaceCapabilityService],
  useFactory: (db: PrismaService, auth: AuthService, guard: ApiAuthGuard, subscriptions: SubscriptionService,
    core: RentalCoreService, business: RentalBusinessService, reports: RentalWorkspaceReportRepository, memberships: MembershipService,
    payments: PaymentRuntimeService, funding: RentalFundingService, value?: unknown, integrations?: TenantIntegrationService,
    capabilities?: WorkspaceCapabilityService) => {
    const configuration = z.object({ enabled: z.boolean(), host: z.object({
      holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      leaseMs: z.number().int().min(1).max(120000),
    }).strict() }).strict().parse(value ?? { enabled: false, host: { holderId: 'ai-native-opening-proposals', leaseMs: 100000 } });
    return new TaskOpeningProposalApplication(originalSceneDependencies(db, auth, guard, subscriptions, core, business,
      reports, memberships, payments, funding, integrations, undefined, capabilities), configuration);
  },
};

/** Deployment publication supplies existing independent gates. None of these
 * bindings initializes task policy, approves an action or dispatches a model. */
export const AI_NATIVE_RUNTIME_CONFIGURATION_PROVIDERS = [
  AI_NATIVE_RUNTIME_PUBLICATION_PROVIDER,
  AI_NATIVE_GATEWAY_CAPACITY_PROVIDER,
  runtimeConfigurationProvider(AI_NATIVE_CONVERSATION_CONFIGURATION, 'conversations'),
  runtimeConfigurationProvider(AI_NATIVE_WORKBENCH_DISPLAY_CONFIGURATION, 'workbenchDisplay'),
  runtimeConfigurationProvider(AI_NATIVE_BUSINESS_FAILURE_CONFIGURATION, 'businessFailure'),
  runtimeConfigurationProvider(AI_NATIVE_AUTOMATION_EXPLANATION_CONFIGURATION, 'automationExplanation'),
  runtimeConfigurationProvider(AI_NATIVE_ORIGINAL_ORDER_EXECUTION_CONFIGURATION, 'orderModel'),
  runtimeConfigurationProvider(AI_NATIVE_QUOTE_MODEL_EXECUTION_CONFIGURATION, 'quoteModel'),
  runtimeConfigurationProvider(AI_NATIVE_OPENING_MODEL_EXECUTION_CONFIGURATION, 'openingModel'),
  runtimeConfigurationProvider(AI_NATIVE_TASK_OPENING_PROPOSAL_CONFIGURATION, 'openingProposals'),
  runtimeConfigurationProvider(AI_NATIVE_QUOTE_ORDER_EXECUTION_CONFIGURATION, 'quoteOrderExecution'),
  runtimeConfigurationProvider(AI_NATIVE_SETTINGS_EXECUTION_CONFIGURATION, 'settingsExecution'),
  runtimeConfigurationProvider(AI_NATIVE_TASK_RULE_DRAFT_CONFIGURATION, 'businessRuleDraft'),
  runtimeConfigurationProvider(AI_NATIVE_TASK_CALENDAR_DRAFT_CONFIGURATION, 'calendarDraft'),
  runtimeConfigurationProvider(AI_NATIVE_MEMBER_NAME_CONFIGURATION, 'memberName'),
  runtimeConfigurationProvider(AI_NATIVE_CAPABILITY_PROBE_CONFIGURATION, 'capabilityProbe'),
  runtimeConfigurationProvider(AI_NATIVE_PLATFORM_PROBE_CONFIGURATION, 'platformCapabilityProbe'),
  runtimeConfigurationProvider(AI_NATIVE_INPUT_COUNTING_CONFIGURATION, 'inputCounting'),
  runtimeConfigurationProvider(AI_NATIVE_BUDGET_MANAGEMENT_CONFIGURATION, 'budgetManagement'),
  runtimeConfigurationProvider(AI_NATIVE_CLIENT_MODEL_CONFIGURATION, 'clientModel'),
  runtimeConfigurationProvider(AI_NATIVE_CLIENT_POLICY_CONFIGURATION, 'clientTaskPolicy'),
  runtimeConfigurationProvider(AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION, 'staffRecognition'),
  runtimeConfigurationProvider(AI_NATIVE_STAFF_MANUAL_CONFIGURATION, 'staffManual'),
  runtimeConfigurationProvider(AI_NATIVE_CATEGORY_DRAFT_CONFIGURATION, 'categoryDraft'),
  runtimeConfigurationProvider(AI_NATIVE_CATEGORY_PROPOSAL_CONFIGURATION, 'categoryProposal'),
];

/** Current original-resource reads remain available independently of new-model
 * publication. Only an explicit enable request can renew three read policies. */
export const AI_NATIVE_TASK_ORIGINAL_READ_POLICY_PROVIDER: FactoryProvider = {
  provide: AI_TASK_ORIGINAL_READ_POLICY_REQUESTS,
  inject: originalSceneInjection,
  useFactory: (...args: Parameters<typeof originalSceneDependencies>) =>
    composeTaskOriginalReadPolicyRequests(originalSceneDependencies(...args)),
};
