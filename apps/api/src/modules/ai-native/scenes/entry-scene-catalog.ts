/** 多端原场景的唯一元数据登记。复用原 scene、工具及 Action 标识；
 * 不复制商品目录、历史工具清单或执行器。风险描述办理阶段，目录读取只属 R0；
 * 发布、当前授权、真实能力与原确认链分别核验，登记本身不开放任何动作。 */
import { AI_ENTRY_AUDIENCE_MAP, AI_CUSTOMER_ENTRY_SURFACES, AI_ENTRY_ACTION_REGISTRY,
  AI_SCENE_CODES, AI_TOOL_CODES, AI_TOOL_DRAFT_VERSION, AI_TEXT_MODEL_STEP_CODE,
  AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE, AI_APPROVED_SETTINGS_TOOL_CODE,
  AI_ENTRY_SCENE_CATALOG_VERSION, AI_ENTRY_SCENE_CATALOG_SURFACES,
  AI_TASK_RULE_DRAFT_READ_PERMISSIONS, AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS,
  type AiEntryActionCode,
  type AiRisk } from '@rental-os/shared';
import { AI_RETENTION_POLICY } from '../privacy/retention-policy';
import { STAFF_RECOGNITION_SCENES } from '../inspection-assist/inspection-standard.application';
import { CATEGORY_PROPOSAL_SCENE } from '../category-assist/category-platform-gateway.composition';
import type { RuntimePublication } from '../runtime-publication.configuration';

export const ENTRY_SCENE_CATALOG_VERSION = AI_ENTRY_SCENE_CATALOG_VERSION;
export const ENTRY_SCENE_SURFACES = AI_ENTRY_SCENE_CATALOG_SURFACES;
export type EntrySceneSurface = typeof ENTRY_SCENE_SURFACES[number];
export type EntrySceneAudience = keyof typeof AI_ENTRY_AUDIENCE_MAP;
export type EntrySceneManualExit = 'original_order' | 'original_booking' | 'original_catalog'
  | 'original_opening_settings' | 'original_member_profile' | 'original_inspection' | 'original_category_governance'
  | 'original_rule_draft' | 'original_calendar_draft' | 'original_notification_settings' | 'original_business_event' | 'original_automation_review';
export type EntrySceneSourceKind = 'original_scene_host' | 'original_client_host' | 'original_inspection_host' | 'original_platform_host'
  | 'original_settings_host' | 'original_rule_host' | 'original_calendar_host' | 'original_event_host' | 'original_automation_host';
export type EntrySceneConfiguration = keyof RuntimePublication['configurations'];
export type EntrySceneTool = { code: string; version: typeof AI_TOOL_DRAFT_VERSION; riskLevel: AiRisk;
  requiredPermissions: readonly string[]; confirmation: 'read_only' | 'explicit_prepare_or_save'
    | 'review_approval_and_original_submit' | 'original_human_submit'; effect: 'read' | 'ai_draft' | 'original_business_write' };
export interface EntrySceneDefinition {
  entryId: string; sceneCode: string | null; sceneVersion: string; audience: EntrySceneAudience;
  runtimeAudience: 'operator' | 'staff' | 'client'; surfaces: readonly EntrySceneSurface[];
  title: string; goal: string; target: 'current_workspace' | 'owned_order' | 'current_quote_selection'
    | 'personal_member' | 'original_inspection' | 'platform_category' | 'original_settings_change'
    | 'original_rule_draft' | 'original_calendar_draft' | 'original_business_event' | 'original_automation_policy';
  input: { contract: string; authority: 'explicit_user_input_rechecked_by_original_entry'; maxBytes: number };
  output: { contract: string; authority: 'authorized_original_facts_and_untrusted_candidates'; maxBytes: number; maxResults: number };
  tools: readonly EntrySceneTool[]; actions: readonly AiEntryActionCode[];
  requiredPermissions: readonly string[]; permissionMode: 'all' | 'any'; authorizationChecks: readonly string[];
  riskLevel: AiRisk; confirmation: EntrySceneTool['confirmation'];
  policy: { source: 'original_task_plan' | 'original_client_host' | 'original_inspection_host' | 'original_member_host'
    | 'original_settings_host' | 'original_draft_host' | 'original_event_host' | 'original_automation_policy';
    featureCode: 'ai.native.use' | 'ai.native.platform.category' | null; modelCapability: 'text' | 'image' | 'audio' | null };
  stage: 'read_and_explain' | 'prepare_ai_proposal' | 'review_original_change' | 'save_business_draft'
    | 'review_and_original_submit' | 'read_original_event' | 'review_original_policy';
  redaction: readonly string[]; queryTiming: 'reauthorize_before_and_after_each_read_and_at_original_action';
  source: { kind: EntrySceneSourceKind; version: 'current_original_producer'; businessFacts: 'original_core_or_formal_domain';
    history: 'original_bound_version_or_unavailable'; candidates: 'not_human_choice_or_business_authority' };
  maturity: 'requires_current_original_implementation';
  manualExit: EntrySceneManualExit; failures: readonly string[];
  disable: { defaultEnabled: false; configurationSections: readonly EntrySceneConfiguration[]; configurationFlag: 'enabled' | 'saveEnabled';
    scopes: readonly ['global', 'tenant_or_platform', 'scene']; originalReceipts: 'current_read_authority_only'; unknown: 'read_original_operation_never_redispatch' };
  retention: { policyVersion: typeof AI_RETENTION_POLICY.version; ordinaryAiBodyDays: 30;
    businessRecords: 'original_business_policy'; unresolved: 'hold_only_original_related_evidence';
    cleanup: 'authorized_bounded_idempotent_original_retention'; clientState: 'clear_on_identity_scope_hide_or_dispose' };
}

const checks = ['current_auth_guard', 'tenant_workspace_location', 'role_data_scope', 'original_resource_and_field_authority',
  'current_capability_and_subscription', 'current_published_policy', 'recheck_after_await'] as const;
const clientChecks = ['current_client_auth_guard', 'current_customer_membership_and_enterprise_relation',
  'published_tenant_workspace_channel', 'own_resource_and_public_field_projection', 'current_capability_and_subscription',
  'current_client_policy', 'recheck_after_await'] as const;
const redaction = ['no_credentials_or_payment_tokens', 'minimum_authorized_fields', 'no_other_tenant_or_customer_data',
  'no_internal_model_thought', 'no_arbitrary_html_url_or_code', 'missing_facts_remain_unavailable'] as const;
const failures = ['unavailable', 'access_denied', 'scope_changed', 'expired_or_stale', 'partial', 'unknown_read_original'] as const;
const tool = (code: string, riskLevel: AiRisk, requiredPermissions: string[] = [],
  confirmation: EntrySceneTool['confirmation'] = 'read_only', effect: EntrySceneTool['effect'] = 'read'): EntrySceneTool => {
  if (![...AI_TOOL_CODES, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE].includes(code as never)) {
    throw new TypeError('Unregistered original scene tool');
  }
  return { code, version: AI_TOOL_DRAFT_VERSION, riskLevel, requiredPermissions, confirmation, effect };
};
type DefinitionInput = Pick<EntrySceneDefinition, 'entryId' | 'sceneCode' | 'audience' | 'title' | 'goal' | 'target' |
  'tools' | 'requiredPermissions' | 'riskLevel' | 'confirmation' | 'manualExit'> & {
  inputContract: string; outputContract: string; maxResults: number; maxInputBytes?: number; maxOutputBytes?: number;
  configuration: EntrySceneConfiguration[]; modelCapability: EntrySceneDefinition['policy']['modelCapability'];
  actions?: AiEntryActionCode[];
  permissionMode?: EntrySceneDefinition['permissionMode']; policySource?: EntrySceneDefinition['policy']['source'];
  sourceKind?: EntrySceneSourceKind; stage?: EntrySceneDefinition['stage'];
  featureCode?: EntrySceneDefinition['policy']['featureCode']; configurationFlag?: 'enabled' | 'saveEnabled';
};
function define(input: DefinitionInput): EntrySceneDefinition {
  const client = input.audience === 'customer', staff = input.audience === 'staff', platform = input.audience === 'platform';
  const actions = input.actions ?? [];
  if (actions.some(code => !(AI_ENTRY_ACTION_REGISTRY[code].audiences as readonly string[]).includes(input.audience)))
    throw new TypeError('Action audience is not registered in scene metadata');
  return { entryId: input.entryId, sceneCode: input.sceneCode, sceneVersion: '1', audience: input.audience,
    runtimeAudience: platform ? 'operator' : AI_ENTRY_AUDIENCE_MAP[input.audience] as 'operator' | 'staff' | 'client',
    surfaces: client ? AI_CUSTOMER_ENTRY_SURFACES : staff ? ['staff_miniprogram'] : ['tenant_admin'],
    title: input.title, goal: input.goal, target: input.target,
    input: { contract: input.inputContract, authority: 'explicit_user_input_rechecked_by_original_entry', maxBytes: input.maxInputBytes ?? 32768 },
    output: { contract: input.outputContract, authority: 'authorized_original_facts_and_untrusted_candidates',
      maxBytes: input.maxOutputBytes ?? 262144, maxResults: input.maxResults }, tools: input.tools, actions,
    requiredPermissions: input.requiredPermissions, permissionMode: input.permissionMode ?? 'all', authorizationChecks: client ? clientChecks : checks,
    riskLevel: input.riskLevel, confirmation: input.confirmation,
    policy: { source: input.policySource ?? (client ? 'original_client_host' : input.target === 'personal_member' ? 'original_member_host'
      : staff && input.modelCapability === null ? 'original_inspection_host' : 'original_task_plan'),
      featureCode: input.featureCode !== undefined ? input.featureCode : input.modelCapability || input.target === 'personal_member' || client
        ? platform ? 'ai.native.platform.category' : 'ai.native.use' : null, modelCapability: input.modelCapability },
    stage: input.stage ?? (input.riskLevel === 'R2' ? 'review_and_original_submit' : input.riskLevel === 'R1' ? 'prepare_ai_proposal' : 'read_and_explain'),
    redaction, queryTiming: 'reauthorize_before_and_after_each_read_and_at_original_action',
    source: { kind: input.sourceKind ?? (client ? 'original_client_host' : staff ? 'original_inspection_host' : platform ? 'original_platform_host' : 'original_scene_host'),
      version: 'current_original_producer', businessFacts: 'original_core_or_formal_domain', history: 'original_bound_version_or_unavailable',
      candidates: 'not_human_choice_or_business_authority' }, maturity: 'requires_current_original_implementation',
    manualExit: input.manualExit, failures,
    disable: { defaultEnabled: false, configurationSections: input.configuration, configurationFlag: input.configurationFlag ?? 'enabled', scopes: ['global', 'tenant_or_platform', 'scene'],
      originalReceipts: 'current_read_authority_only', unknown: 'read_original_operation_never_redispatch' },
    retention: { policyVersion: AI_RETENTION_POLICY.version, ordinaryAiBodyDays: AI_RETENTION_POLICY.conversationDays,
      businessRecords: 'original_business_policy', unresolved: 'hold_only_original_related_evidence',
      cleanup: 'authorized_bounded_idempotent_original_retention', clientState: 'clear_on_identity_scope_hide_or_dispose' } };
}

const [orderScene, openingScene, quoteScene] = AI_SCENE_CODES;
const definitions: EntrySceneDefinition[] = [
  define({ entryId: 'operations.order_explanation', sceneCode: orderScene, audience: 'operations', title: '订单解释',
    goal: '读取原订单、历史金额和办理依据，提供原订单人工入口', target: 'owned_order',
    inputContract: 'AiSceneRequestCreateDraft', outputContract: 'AiOrderExplanationMaterialV2', maxResults: 200,
    tools: [tool('rental.order.explain', 'R0', ['rental-os:order:view']), tool(AI_TEXT_MODEL_STEP_CODE, 'R0')],
    requiredPermissions: ['rental-os:order:view'], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_order',
    configuration: ['orderModel'], modelCapability: 'text' }),
  define({ entryId: 'operations.opening_diagnosis', sceneCode: openingScene, audience: 'operations', title: '开业诊断',
    goal: '核原空间开业条件并准备可复核的配置提案', target: 'current_workspace',
    inputContract: 'AiSceneRequestCreateDraft', outputContract: 'AiOpeningBusinessMaterialDraft', maxResults: 50,
    tools: [tool('tenant.opening.diagnose', 'R0', ['rental-os:order:view']),
      tool('tenant.config.propose', 'R1', ['rental-os:price:manage'], 'explicit_prepare_or_save', 'ai_draft'), tool(AI_TEXT_MODEL_STEP_CODE, 'R0')],
    requiredPermissions: ['rental-os:order:view'], riskLevel: 'R1', confirmation: 'explicit_prepare_or_save', manualExit: 'original_opening_settings',
    configuration: ['openingModel'], modelCapability: 'text' }),
  define({ entryId: 'operations.quote_clarification', sceneCode: quoteScene, audience: 'operations', title: '报价与建单准备',
    goal: '澄清原租赁条件，明确选择后沿原报价、批准和建单流程办理', target: 'current_quote_selection',
    inputContract: 'AiSceneRequestCreateDraft', outputContract: 'AiQuoteGoalBusinessMaterialDraft', maxResults: 50,
    tools: [tool('rental.catalog.search', 'R0'), tool('rental.availability.check', 'R0'),
      tool('rental.quote.preview', 'R1', ['rental-os:order:create'], 'explicit_prepare_or_save', 'ai_draft'),
      tool('rental.order.commit', 'R2', ['rental-os:order:create'], 'review_approval_and_original_submit', 'original_business_write'), tool(AI_TEXT_MODEL_STEP_CODE, 'R0')],
    requiredPermissions: ['rental-os:order:create'], riskLevel: 'R2', confirmation: 'review_approval_and_original_submit', manualExit: 'original_order',
    configuration: ['quoteModel'], modelCapability: 'text' }),
  define({ entryId: 'operations.member_profile', sceneCode: 'ordinary_profile_change', audience: 'operations', title: '普通会员姓名修改',
    goal: '以当前会员主档、明确方案和原批准收据修改姓名', target: 'personal_member',
    inputContract: 'AiMemberNamePrepareInput', outputContract: 'AiMemberNameResponse', maxResults: 50,
    tools: [tool('membership.profile.propose', 'R1', ['rental-os:member:manage'], 'explicit_prepare_or_save', 'ai_draft'),
      tool('membership.profile.commit', 'R2', ['rental-os:member:manage'], 'review_approval_and_original_submit', 'original_business_write')],
    requiredPermissions: ['rental-os:member:manage'], riskLevel: 'R2', confirmation: 'review_approval_and_original_submit', manualExit: 'original_member_profile',
    configuration: ['memberName'], modelCapability: null }),
  define({ entryId: 'operations.opening_proposals', sceneCode: openingScene, audience: 'operations', title: '原开业配置提案',
    goal: '从原诊断和当前配置差异准备独立 AI 提案，明确保存阶段和原收据', target: 'current_workspace',
    inputContract: 'AiTaskOpeningProposalPrepareRequestDraft', outputContract: 'AiTaskOpeningProposalOperationDraft', maxResults: 20,
    tools: [tool('tenant.config.propose', 'R1', ['rental-os:price:manage'], 'explicit_prepare_or_save', 'ai_draft')],
    requiredPermissions: ['rental-os:price:manage'], riskLevel: 'R1', confirmation: 'explicit_prepare_or_save', manualExit: 'original_opening_settings',
    configuration: ['openingProposals'], modelCapability: null, stage: 'prepare_ai_proposal' }),
  define({ entryId: 'operations.notification_settings', sceneCode: openingScene, audience: 'operations', title: '通知设置变更',
    goal: '从原通知配置准备变更，取得新批准后经原 Core 提交；不发送通知', target: 'original_settings_change',
    inputContract: 'AiApprovedSettingsChangePrepareDraft', outputContract: 'AiApprovedSettingsChangePreparationResultDraft', maxResults: 100,
    tools: [tool(AI_APPROVED_SETTINGS_TOOL_CODE, 'R2', ['rental-os:rules:manage', 'rental-os:price:manage'], 'review_approval_and_original_submit', 'original_business_write')],
    requiredPermissions: ['rental-os:rules:manage', 'rental-os:price:manage'], permissionMode: 'any', riskLevel: 'R2',
    confirmation: 'review_approval_and_original_submit', manualExit: 'original_notification_settings', configuration: ['settingsExecution'],
    modelCapability: null, sourceKind: 'original_settings_host', policySource: 'original_settings_host', featureCode: 'ai.native.use', stage: 'review_original_change' }),
  define({ entryId: 'operations.rule_draft', sceneCode: openingScene, audience: 'operations', title: '原业务规则草稿',
    goal: '从原诊断及规则版本准备提案，明确原因后保存原业务草稿；发布保持独立', target: 'original_rule_draft',
    inputContract: 'AiTaskRuleDraftSaveInput', outputContract: 'AiTaskRuleDraftOperationResponse', maxResults: 20,
    tools: [tool('tenant.config.propose', 'R1', ['rental-os:rules:manage'], 'explicit_prepare_or_save', 'ai_draft')],
    requiredPermissions: [...AI_TASK_RULE_DRAFT_READ_PERMISSIONS], permissionMode: 'any', riskLevel: 'R1', confirmation: 'explicit_prepare_or_save',
    manualExit: 'original_rule_draft', configuration: ['businessRuleDraft'], configurationFlag: 'saveEnabled', modelCapability: null,
    sourceKind: 'original_rule_host', policySource: 'original_draft_host', featureCode: 'ai.native.use', stage: 'save_business_draft' }),
  define({ entryId: 'operations.calendar_draft', sceneCode: openingScene, audience: 'operations', title: '原营业日历草稿',
    goal: '从原日历版本和日期准备提案，复核覆盖原因并保存草稿；不发布日历', target: 'original_calendar_draft',
    inputContract: 'AiTaskCalendarDraftSaveInput', outputContract: 'AiTaskCalendarDraftOperationResponse', maxResults: 20,
    tools: [tool('tenant.config.propose', 'R1', ['rental-os:calendar:edit', 'rental-os:price:manage'], 'explicit_prepare_or_save', 'ai_draft')],
    requiredPermissions: [...AI_TASK_CALENDAR_DRAFT_READ_PERMISSIONS], permissionMode: 'any', riskLevel: 'R1', confirmation: 'explicit_prepare_or_save',
    manualExit: 'original_calendar_draft', configuration: ['calendarDraft'], configurationFlag: 'saveEnabled', modelCapability: null,
    sourceKind: 'original_calendar_host', policySource: 'original_draft_host', featureCode: 'ai.native.use', stage: 'save_business_draft' }),
  define({ entryId: 'operations.business_events', sceneCode: null, audience: 'operations', title: '原业务异常待办',
    goal: '读取原 Outbox 的有限事件和原资源依据，不重派通知、退款或业务动作', target: 'original_business_event',
    inputContract: 'AiBusinessOutboxObservationRequestDraft', outputContract: 'AiBusinessOutboxObservationDraft', maxResults: 20,
    tools: [], requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_business_event',
    configuration: ['businessFailure'], modelCapability: null, policySource: 'original_event_host', sourceKind: 'original_event_host', stage: 'read_original_event' }),
  define({ entryId: 'operations.automation_review', sceneCode: null, audience: 'operations', title: '主动经营原任务复核',
    goal: '读取限定原事件的人工复核队列、关联任务及处理收据；影子模式不执行业务', target: 'original_business_event',
    inputContract: 'AiAutomationReviewQueueRequestDraft', outputContract: 'AiAutomationReviewQueueResponseDraft', maxResults: 10,
    tools: [], requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_automation_review',
    configuration: ['businessFailure'], modelCapability: null, policySource: 'original_event_host', sourceKind: 'original_automation_host', stage: 'read_original_event' }),
  define({ entryId: 'operations.automation_explanation', sceneCode: null, audience: 'operations', title: '原经营事件模型说明',
    goal: '按已批准的原自动化政策解释原事件，只给人工建议，不处理原业务', target: 'original_business_event',
    inputContract: 'AiAutomationExplanationReadDraft', outputContract: 'AiAutomationExplanationObservationDraft', maxResults: 1,
    tools: [tool(AI_TEXT_MODEL_STEP_CODE, 'R0')], requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_business_event',
    configuration: ['automationExplanation'], modelCapability: 'text', policySource: 'original_automation_policy', sourceKind: 'original_automation_host', stage: 'read_and_explain' }),
  define({ entryId: 'operations.automation_policy', sceneCode: null, audience: 'operations', title: '主动经营政策复核',
    goal: '读取原主体、场景工具白名单及限定影子／人工确认政策，不授自动执行权', target: 'original_automation_policy',
    inputContract: 'AiAutomationPolicyDiscoverDraft', outputContract: 'AiAutomationPolicyDiscoveryDraft', maxResults: 20,
    tools: [], requiredPermissions: ['system:params:manage'], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_automation_review',
    configuration: [], modelCapability: null, policySource: 'original_event_host', sourceKind: 'original_automation_host', stage: 'review_original_policy' }),
  define({ entryId: 'staff.inspection_manual', sceneCode: null, audience: 'staff', title: '人工检查草稿',
    goal: '保存人工值并核原模板、附件及原检查提交收据', target: 'original_inspection',
    inputContract: 'AiInspectionDraftReadRequest', outputContract: 'AiInspectionDraftReadResponse', maxResults: 100, maxOutputBytes: 524288,
    tools: [], requiredPermissions: ['rental-os:order:view'], riskLevel: 'R2', confirmation: 'original_human_submit',
    manualExit: 'original_inspection', configuration: ['staffManual'], modelCapability: null }),
  define({ entryId: 'staff.business_events', sceneCode: null, audience: 'staff', title: '员工原业务异常',
    goal: '读取本人当前履约范围内的原事件和原资源引用；不重派或执行原业务', target: 'original_business_event',
    inputContract: 'AiBusinessOutboxObservationRequestDraft', outputContract: 'AiBusinessOutboxObservationDraft', maxResults: 20,
    tools: [], requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_business_event',
    configuration: ['businessFailure'], modelCapability: null, policySource: 'original_event_host', sourceKind: 'original_event_host', stage: 'read_original_event' }),
  define({ entryId: 'staff.automation_review', sceneCode: null, audience: 'staff', title: '员工原待办复核',
    goal: '读取当前员工受权原事件的人工复核队列与原办理收据', target: 'original_business_event',
    inputContract: 'AiAutomationReviewQueueRequestDraft', outputContract: 'AiAutomationReviewQueueResponseDraft', maxResults: 10,
    tools: [], requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_automation_review',
    configuration: ['businessFailure'], modelCapability: null, policySource: 'original_event_host', sourceKind: 'original_automation_host', stage: 'read_original_event' }),
  ...(['image', 'audio'] as const).map(kind => define({ entryId: `staff.inspection_${kind}`, sceneCode: STAFF_RECOGNITION_SCENES[kind],
    audience: 'staff', title: kind === 'image' ? '检查照片识别' : '检查语音识别',
    goal: '从原受权媒体准备识别候选，人工逐项确认后沿原检查提交', target: 'original_inspection',
    inputContract: 'AiInspectionRecognitionTaskReference', outputContract: 'AiInspectionResultReadResponse', maxResults: 100,
    tools: [tool(kind === 'image' ? AI_IMAGE_MODEL_STEP_CODE : AI_AUDIO_MODEL_STEP_CODE, 'R0'),
      tool('inspection.draft.extract', 'R1', [], 'explicit_prepare_or_save', 'ai_draft')],
    requiredPermissions: ['rental-os:order:view'], riskLevel: 'R1', confirmation: 'explicit_prepare_or_save', manualExit: 'original_inspection',
    configuration: ['staffRecognition'], modelCapability: kind })),
  define({ entryId: 'customer.order_explanation', sceneCode: orderScene, audience: 'customer', title: '本人订单说明',
    goal: '读取本人受权订单事实及原办理入口', target: 'owned_order', inputContract: 'AiClientOrderExplanationReadRequest',
    outputContract: 'AiClientOrderExplanationReadResponse', maxResults: 50, tools: [tool('rental.order.explain', 'R0')],
    actions: ['OPEN_ORDER'], requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_order',
    configuration: [], modelCapability: null }),
  define({ entryId: 'customer.order_model', sceneCode: quoteScene, audience: 'customer', title: '本人原订单模型说明',
    goal: '解释同本人原订单 Task 的冻结材料，模型文本不是订单、付款或退款事实', target: 'owned_order',
    inputContract: 'AiClientTaskReadRequest', outputContract: 'AiClientTaskModelResultReadResponse', maxResults: 1,
    tools: [tool('rental.order.explain', 'R0'), tool(AI_TEXT_MODEL_STEP_CODE, 'R0')], actions: ['OPEN_ORDER'],
    requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_order',
    configuration: ['clientModel'], modelCapability: 'text' }),
  define({ entryId: 'customer.quote_clarification', sceneCode: quoteScene, audience: 'customer', title: '租赁需求澄清',
    goal: '从公开且受权的商品、地点和本人条件形成待确认选择', target: 'current_quote_selection',
    inputContract: 'AiClientGoalPreparationRequest', outputContract: 'AiClientGoalPreparationResponse', maxResults: 50,
    tools: [tool('rental.catalog.search', 'R0'), tool('rental.availability.check', 'R0'), tool(AI_TEXT_MODEL_STEP_CODE, 'R0')],
    requiredPermissions: [], riskLevel: 'R0', confirmation: 'read_only', manualExit: 'original_catalog',
    configuration: ['clientModel'], modelCapability: 'text' }),
  define({ entryId: 'customer.booking_draft', sceneCode: quoteScene, audience: 'customer', title: '报价与预约草稿',
    goal: '明确选择并保存原报价及 Booking Draft，原预约页面复核后正式提交', target: 'current_quote_selection',
    inputContract: 'AiClientQuoteBookingRequest', outputContract: 'AiBookingDraft', maxResults: 20, maxOutputBytes: 240000,
    tools: [tool('rental.quote.preview', 'R1', [], 'explicit_prepare_or_save', 'ai_draft')],
    actions: ['CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'], requiredPermissions: [], riskLevel: 'R1', confirmation: 'explicit_prepare_or_save',
    manualExit: 'original_booking', configuration: [], modelCapability: null }),
  define({ entryId: 'platform.category_propose', sceneCode: CATEGORY_PROPOSAL_SCENE, audience: 'platform', title: '平台品类提案',
    goal: '在专用平台授权和工具白名单内生成原品类草稿候选', target: 'platform_category',
    inputContract: 'AiCategoryProposalPrepareRequest', outputContract: 'AiCategoryProposalRead', maxResults: 20,
    tools: [tool('platform.category.propose', 'R1', ['system:rental-category:edit'], 'explicit_prepare_or_save', 'ai_draft'), tool(AI_TEXT_MODEL_STEP_CODE, 'R0')],
    requiredPermissions: ['system:rental-category:edit'], riskLevel: 'R1', confirmation: 'explicit_prepare_or_save',
    manualExit: 'original_category_governance', configuration: ['categoryProposal'], modelCapability: 'text' }),
];
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
if (new Set(definitions.map(row => row.entryId)).size !== definitions.length) throw new TypeError('Duplicate scene metadata');
export const ENTRY_SCENE_CATALOG: readonly EntrySceneDefinition[] = immutable(definitions);
