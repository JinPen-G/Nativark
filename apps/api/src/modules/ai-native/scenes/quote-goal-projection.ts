/** Read-only candidates from an original, already saved Gateway result. The
 * original request/Task/Run and frozen goal must agree; current guarded Core
 * sources provide choices. Even one match remains an explicit human choice.
 * This module cannot start a model, save a quote, reserve stock or approve. */
import { z } from 'zod';
import { AI_QUOTE_GOAL_DRAFT_VERSION, AI_QUOTE_GOAL_LIMITS, AI_TOOL_DRAFT_VERSION,
  RENTAL_CATEGORY_DEFINITIONS, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES,
  validateAiQuoteGoalProjectionDraft, type AiExecutionContext, type AiQuoteGoalProjectionDraft,
  type AiQuoteGoalModelOutputDraft, type AiQuoteGoalChoiceGroupDraft, type AiQuoteGoalSourceDraft } from '@rental-os/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import { parseTaskModelInput, taskModelFingerprint, taskModelPolicy, TASK_TEXT_MODEL_TOOL,
  type TaskModelPolicy } from '../model-input/task-model-input';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';
import { aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { isGatewayResult } from '../gateway-contract-validation';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { freezeOriginalInput, originalRequestReferenceSchema } from '../task-request/original-request.validation';
import type { AiQuotePreparationContextSource } from '../tools/quote-candidate-preparation.service';
import { assertAiReadContextBinding } from '../tools/read-context-binding';
import type { AiOriginalSceneResultService } from './original-scene-result.service';
import { bindQuoteGoalOriginal, parseQuoteGoalModelOutput, readQuoteGoalFromModelInput, readQuoteGoalHumanIntent } from './quote-goal-input';
import { originalQuoteGoalHints } from './original-quote-goal-parameters';

type Original = Awaited<ReturnType<PrismaOriginalRequestRepository['readHistorical']>>;
type OriginalModelObservation = Awaited<ReturnType<AiOriginalSceneResultService['read']>>;
const identifier = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commandSchema = z.object({ original: originalRequestReferenceSchema, resultId: identifier }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);

export type AiQuoteGoalModelReadRequest = z.infer<typeof commandSchema>;
/** Server-only observation. candidateText is the exact checked Gateway artifact,
 * not the public deterministic summary. Missing/unknown results contain no text.
 * This port retains the original reader's current authorization and evidence
 * checks; providing it grants no model invocation or new business action. */
export type AiQuoteGoalModelReadResult = Pick<OriginalModelObservation,
  'original' | 'sceneCode' | 'taskId' | 'runId' | 'resultId' | 'observedAt' | 'status' | 'materialHash' | 'callId'>
  & { candidateText: string | null };
export interface AiQuoteGoalModelReadPort {
  readQuoteGoalCandidates(command: Readonly<AiQuoteGoalModelReadRequest>): Promise<AiQuoteGoalModelReadResult>;
}
type Model = AiQuoteGoalModelReadResult;

export interface AiQuoteGoalProjectionDependencies {
  db: Pick<PrismaClient, '$transaction'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  requests: Pick<PrismaOriginalRequestRepository, 'readHistorical'>;
  results: AiQuoteGoalModelReadPort;
  authority: AiBusinessReadAuthority;
  catalog: Pick<AiCatalogReadFactsService, 'read'>;
  members: Pick<AiMembershipCandidateReadFactsService, 'read'>;
  contexts: AiQuotePreparationContextSource;
  modelPolicy: TaskModelPolicy;
  clock?: () => Date;
}

export class AiQuoteGoalProjectionService {
  private readonly policy: TaskModelPolicy;
  private readonly clock: () => Date;
  constructor(private readonly dependencies: AiQuoteGoalProjectionDependencies) {
    if (typeof dependencies?.db?.$transaction !== 'function' || typeof dependencies.tasks?.resolveAccess !== 'function'
      || typeof dependencies.requests?.readHistorical !== 'function' || typeof dependencies.results?.readQuoteGoalCandidates !== 'function'
      || typeof dependencies.authority?.withRead !== 'function' || typeof dependencies.catalog?.read !== 'function'
      || typeof dependencies.members?.read !== 'function' || typeof dependencies.contexts?.current !== 'function') throw unavailable();
    this.policy = taskModelPolicy(dependencies.modelPolicy);
    if (this.policy.sceneCode !== 'quote_clarification' || this.policy.kind || this.policy.orderExplainTool || this.policy.nativeToolResults) throw unavailable();
    this.clock = dependencies.clock ?? (() => new Date());
  }

  private modelIdentity(model: Model) {
    return { original: { inputRef: model.original.inputRef, revision: model.original.revision, contentHash: model.original.contentHash },
      sceneCode: model.sceneCode, taskId: model.taskId, runId: model.runId, resultId: model.resultId,
      status: model.status, candidateText: model.candidateText, materialHash: model.materialHash ?? null, callId: model.callId ?? null };
  }

  private async readModel(command: Readonly<AiQuoteGoalModelReadRequest>, source: AiQuoteGoalSourceDraft) {
    const model = freezeOriginalInput(structuredClone(await this.dependencies.results.readQuoteGoalCandidates(command)));
    if (!model?.original || model.sceneCode !== 'quote_clarification' || model.resultId !== command.resultId
      || !identifier.safeParse(model.taskId).success || !identifier.safeParse(model.runId).success
      || !z.string().datetime({ offset: true }).safeParse(model.observedAt).success
      || !['available', 'stale', 'unknown', 'failed'].includes(model.status)
      || !same({ inputRef: model.original.inputRef, revision: model.original.revision,
        contentHash: model.original.contentHash }, source.original)) throw denied();
    if (model.status === 'available') {
      if (typeof model.candidateText !== 'string' || Buffer.byteLength(model.candidateText, 'utf8') > AI_QUOTE_GOAL_LIMITS.modelBytes
        || !identifier.safeParse(model.callId).success || !/^[a-f0-9]{64}$/u.test(model.materialHash ?? '')) throw unavailable();
    } else if (model.candidateText !== null) throw denied();
    return model;
  }

  /** This read supplements the real result reader's invocation/receipt checks;
   * it proves the new goal was actually in the frozen original model input. */
  private async savedGoal(model: Model, source: AiQuoteGoalSourceDraft) {
    const access = await this.dependencies.tasks.resolveAccess(model.taskId, 'read_step_terminal');
    const proof = await this.dependencies.db.$transaction(async tx => {
      const task = await tx.aiTask.findFirst({ where: access.where });
      if (!task || task.inputRef !== source.original.inputRef || task.inputHash !== source.original.contentHash
        || task.inputRevision !== source.original.revision || task.sceneCode !== 'quote_clarification'
        || task.id !== model.taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
        || task.audience !== access.audience || task.scopeKind !== 'WORKSPACE') throw denied();
      const roots = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id, sequence: 1 }, take: 2 });
      const root = roots[0];
      if (roots.length !== 1 || !root || root.scopeId !== task.scopeId || root.taskId !== task.id || root.sequence !== 1
        || root.actorKind !== access.actorKind || root.actorId !== access.actorId) throw denied();
      const rootPlan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
        scopeId: task.scopeId, taskId: task.id, runId: root.id } } });
      if (!rootPlan || rootPlan.scopeId !== task.scopeId || rootPlan.taskId !== task.id || rootPlan.runId !== root.id) throw denied();
      const initialPlan = aiTaskRunPlanSchema.parse(rootPlan.payload), initialStep = initialPlan.steps[0];
      if (initialPlan.taskId !== task.id || initialPlan.runId !== root.id || initialPlan.steps.length !== 1
        || requestFingerprint(initialPlan) !== rootPlan.planHash || initialStep.toolCode !== TASK_TEXT_MODEL_TOOL
        || initialStep.toolVersion !== AI_TOOL_DRAFT_VERSION || initialStep.operation !== 'external_unknown') throw denied();
      // The root plan supplies the registration. The original reader resolves
      // each human successor and validates its consumed question/answer receipt.
      const lineage = await readTaskModelRunOrigin(tx, access, { scopeId: task.scopeId, taskId: task.id,
        runId: model.runId, originRunId: root.id, registrationRef: initialStep.registrationRef, includeHistory: true });
      const steps = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id,
        runId: model.runId, resultRef: model.resultId }, take: 2 });
      const step = steps[0];
      if (steps.length !== 1 || !step.inputRef || step.scopeId !== task.scopeId || step.taskId !== task.id
        || step.runId !== model.runId || step.resultRef !== model.resultId || step.status !== 'SUCCEEDED' || step.effect !== 'NONE'
        || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
      const stored = await tx.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId, taskId: task.id,
        runId: model.runId, id: step.inputRef, registrationRef: lineage.registrationRef } });
      if (!stored || stored.scopeId !== task.scopeId || stored.taskId !== task.id || stored.runId !== model.runId
        || stored.id !== step.inputRef || stored.registrationRef !== lineage.registrationRef
        || stored.toolCode !== step.toolCode || stored.toolVersion !== step.toolVersion) throw denied();
      const input = parseTaskModelInput(stored.payload, this.policy), fingerprint = taskModelFingerprint(input, this.policy);
      if (fingerprint !== stored.fingerprint || fingerprint !== step.requestFingerprint || input.intent.requestId !== model.callId) throw denied();
      readQuoteGoalFromModelInput(input, source);
      for (const round of lineage.history) {
        const previous = parseTaskModelInput(round.input, this.policy);
        if (taskModelFingerprint(previous, this.policy) !== round.inputHash) throw denied();
        readQuoteGoalFromModelInput(previous, source);
      }
      const intent = readQuoteGoalHumanIntent(input, source, lineage.history);
      if (intent.materialHash !== model.materialHash) throw denied();
      let selectedCustomerType: 'personal' | 'corporate' | null = null;
      for (const round of lineage.history) {
        if (round.contract.code !== 'original_quote_goal_parameters') continue;
        const answer = round.answers.find(row => row.fieldId === 'customer_type_selection');
        if (!answer) continue;
        const field = round.contract.fields.find(row => row.fieldId === answer.fieldId);
        if (field?.kind !== 'choice' || answer.value !== 'personal' && answer.value !== 'corporate') throw denied();
        selectedCustomerType = answer.value;
      }
      const artifact = await tx.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_id: {
        scopeId: task.scopeId, taskId: task.id, id: model.resultId } } });
      if (!artifact || artifact.id !== model.resultId || artifact.scopeId !== task.scopeId || artifact.taskId !== task.id
        || artifact.runId !== step.runId || artifact.stepId !== step.id || artifact.actionId !== step.actionId
        || artifact.stepFingerprint !== fingerprint || artifact.outcome !== 'SUCCEEDED' || !artifact.completeMeasurement
        || artifact.contentHash !== requestFingerprint(artifact.payload)
        || artifact.outputBytes !== BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8'))) throw denied();
      const gateway = artifact.payload;
      if (!isGatewayResult(gateway) || gateway.status !== 'completed' || gateway.usage.kind !== 'reported'
        || gateway.requestId !== model.callId || gateway.text !== model.candidateText || gateway.toolRequests.length
        || requestFingerprint(gateway.actual) !== requestFingerprint(input.configuration)) throw denied();
      return { intent: { ...intent, selectedCustomerType }, history: lineage.history,
        proof: requestFingerprint({ taskId: task.id, scopeId: task.scopeId, revision: task.revision,
        inputRef: task.inputRef, inputRevision: task.inputRevision, inputHash: task.inputHash,
        runId: step.runId, stepId: step.id, actionId: step.actionId, resultId: step.resultRef, fingerprint,
        lineage, artifactHash: artifact.contentHash }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    if ((await this.dependencies.tasks.resolveAccess(model.taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
    return { ...proof, bindingKey: access.bindingKey };
  }

  private async sources(candidates: AiQuoteGoalModelOutputDraft, parent: AiExecutionContext,
    selectedCustomerType: 'personal' | 'corporate' | null) {
    if (parent.scope.kind !== 'workspace' || parent.actor.kind !== 'user'
      || parent.audience !== 'operator' && parent.audience !== 'staff') throw denied();
    const context = await this.dependencies.contexts.current(parent.scope, parent);
    if (context.profile.tenantId !== parent.scope.tenantId || context.settings.tenantId !== parent.scope.tenantId
      || context.category.code !== context.profile.categoryCode
      || !RENTAL_CATEGORY_DEFINITIONS.some(row => row.code === context.category.code)) throw denied();
    const pricingUnits = RENTAL_PRICING_UNIT_CODES.filter(unit => context.category.businessModel.pricingUnits.includes(unit)
      && context.settings.pricing.enabledUnits.includes(unit));
    const fulfillmentModes = RENTAL_FULFILLMENT_MODES.filter(mode => context.category.businessModel.fulfillmentModes.includes(mode)
      && context.settings.fulfillment.enabledModes.includes(mode));
    const timeZone = context.settings.calendar.timeZone;
    if (!pricingUnits.length || !fulfillmentModes.length || !timeZone) throw unavailable();
    try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw unavailable(); }
    // Match the original clarification reader's enabled/capability projection.
    // Operator admission and Core's submission checks remain in their own port.
    const locations = context.locations.filter(row => row.status === 'enabled')
      .map(row => ({ id: row.id, name: row.name, capabilities: [...row.capabilities] }));
    const stable = { categoryVersionId: context.categoryVersionId ?? null, categoryAdoptionRevision: context.categoryAdoptionRevision ?? null,
      categoryCode: context.category.code, timeZone, pricingUnits, fulfillmentModes, locations,
      deliveryDestination: context.category.businessModel.deliveryDestination, operators: context.operators };
    const observed = this.clock();
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw unavailable();
    const configuration = { scope: { kind: 'workspace' as const, tenantId: parent.scope.tenantId, workspaceId: parent.scope.workspaceId },
      audience: parent.audience, version: requestFingerprint(stable), categoryCode: context.category.code, timeZone,
      pricingUnits, fulfillmentModes, rates: 'not_observed_not_price_authority' as const };
    // Missing words do not justify an unfiltered customer/product scan. Keep the
    // exact bounded query; do not chase another page or search for alternatives.
    const conditions = candidates.conditions;
    // A later extraction may omit or contradict a type the human already chose.
    // Only the verified original choice supplies it; the raw model stays intact.
    const customerType = selectedCustomerType ?? conditions.customerType;
    const members = customerType === 'personal' && conditions.customerName
      ? await this.dependencies.members.read({ name: conditions.customerName, limit: 50 }, parent) : null;
    if (members && (!same(members.scope, parent.scope) || members.audience !== parent.audience)) throw denied();
    const catalogs = [];
    const names = [...new Set((conditions.items ?? []).flatMap(item => item.productName ? [item.productName] : []))];
    for (const name of names) {
      const page = await this.dependencies.catalog.read({ name, limit: 100 }, parent);
      if (!same(page.scope, parent.scope) || page.audience !== parent.audience) throw denied();
      catalogs.push({ name, page });
    }
    return { configuration, customerType, selectedCustomerType, locations, deliveryDestination: context.category.businessModel.deliveryDestination,
      observedAt: observed.toISOString(), members, catalogs,
      fingerprint: requestFingerprint({ stable, customerType: customerType ?? null, members: members ? { scope: members.scope, audience: members.audience,
        candidates: members.candidates, truncated: members.truncated, nextCursor: members.nextCursor ?? null } : null,
        catalogs: catalogs.map(({ name, page }) => ({ name, scope: page.scope, audience: page.audience,
          configurationVersion: page.configurationVersion, items: page.items, truncated: page.truncated, nextCursor: page.nextCursor ?? null })) }) };
  }

  private project(source: AiQuoteGoalSourceDraft, model: Model, candidates: AiQuoteGoalModelOutputDraft,
    sources: Awaited<ReturnType<AiQuoteGoalProjectionService['sources']>>,
    effectiveConditions: AiQuoteGoalModelOutputDraft['conditions']): AiQuoteGoalProjectionDraft {
    const missing = new Map<string, AiQuoteGoalProjectionDraft['missingFields'][number]['reason']>();
    const choices: AiQuoteGoalChoiceGroupDraft[] = [];
    const priority = { model_unresolved: 0, not_supplied: 1, human_choice_required: 2,
      not_observed_in_bounded_source: 3, unsupported_by_current_configuration: 4, original_enterprise_flow_required: 5 };
    const add = (field: string, reason: AiQuoteGoalProjectionDraft['missingFields'][number]['reason']) => {
      const previous = missing.get(field);
      // A model hint cannot conceal a current source restriction.
      if (!previous || priority[reason] > priority[previous]) missing.set(field, reason);
    };
    const group = (field: string, rows: AiQuoteGoalChoiceGroupDraft['choices'], basis: AiQuoteGoalChoiceGroupDraft['source']) => {
      choices.push({ field, choices: rows.slice(0, AI_QUOTE_GOAL_LIMITS.choices),
        source: { ...basis, truncated: basis.truncated || rows.length > AI_QUOTE_GOAL_LIMITS.choices }, selection: 'explicit_human_choice_required' });
    };
    const configurationSource = { kind: 'workspace_configuration' as const, version: sources.configuration.version,
      observedAt: sources.observedAt, truncated: false };
    const conditions = effectiveConditions;
    for (const field of candidates.unresolvedFields) {
      if (field !== 'customerType' || !sources.selectedCustomerType) add(field, 'model_unresolved');
    }
    for (const field of ['customerName', 'start', 'end', 'fulfillmentMode'] as const) if (!conditions[field]) add(field, 'not_supplied');
    if (!sources.customerType) add('customerType', 'not_supplied');
    if (sources.customerType === 'corporate') add('customerType', 'original_enterprise_flow_required');
    add('customerId', 'human_choice_required');
    if (sources.members) {
      const rows = sources.members.candidates.filter(row => row.membershipStatus === 'active')
        .map(row => ({ id: row.customerId, label: row.name, phoneMasked: row.phoneMasked }));
      group('customerId', rows, { kind: 'membership_candidates', version: requestFingerprint({ candidates: sources.members.candidates,
        truncated: sources.members.truncated, nextCursor: sources.members.nextCursor ?? null }), observedAt: sources.members.observedAt, truncated: sources.members.truncated });
      if (!rows.length) add('customerName', 'not_observed_in_bounded_source');
    }
    if (!conditions.items) add('items', 'not_supplied');
    for (const [index, item] of (conditions.items ?? []).entries()) {
      const field = `items.${index}.itemGroupId`;
      add(field, 'human_choice_required');
      for (const key of ['productName', 'quantity', 'pricingUnit'] as const) if (item[key] === undefined) add(`items.${index}.${key}`, 'not_supplied');
      if (item.pricingUnit && !sources.configuration.pricingUnits.includes(item.pricingUnit)) add(`items.${index}.pricingUnit`, 'unsupported_by_current_configuration');
      if (item.pricingUnit === 'usage' && item.usageQuantity === undefined) add(`items.${index}.usageQuantity`, 'not_supplied');
      const page = sources.catalogs.find(row => row.name === item.productName)?.page;
      if (page) {
        const rows = page.items.filter(row => row.status === 'enabled').map(row => ({ id: row.id, label: row.name }));
        group(field, rows, { kind: 'catalog', version: page.configurationVersion, observedAt: page.observedAt, truncated: page.truncated });
        if (!rows.length) add(`items.${index}.productName`, 'not_observed_in_bounded_source');
      }
      // These are category/configuration possibilities, not effective product
      // rates. The original price/rate reader must still validate a human choice.
      group(`items.${index}.pricingUnit`, sources.configuration.pricingUnits.map(unit => ({ id: unit, label: unit })), configurationSource);
    }
    if (conditions.fulfillmentMode && !sources.configuration.fulfillmentModes.includes(conditions.fulfillmentMode)) add('fulfillmentMode', 'unsupported_by_current_configuration');
    group('fulfillmentMode', sources.configuration.fulfillmentModes.map(mode => ({ id: mode, label: mode })), configurationSource);
    const pickupCapability = conditions.fulfillmentMode
      ? ['delivery', 'onsite_delivery'].includes(conditions.fulfillmentMode) ? 'delivery' : 'pickup' : undefined;
    if (pickupCapability === 'delivery' && sources.deliveryDestination === 'customer_address') add('deliveryAddressId', 'human_choice_required');
    for (const [field, capability] of [['locationId', pickupCapability], ['returnLocationId', 'return']] as const) {
      add(field, 'human_choice_required');
      const name = field === 'locationId' ? conditions.locationName : conditions.returnLocationName;
      const rows = sources.locations.filter(row => (!capability || row.capabilities.includes(capability)) && (!name || row.name === name))
        .map(row => ({ id: row.id, label: row.name }));
      group(field, rows, configurationSource);
    }
    const output: AiQuoteGoalProjectionDraft = { ...this.base(source, model), status: 'requires_input', candidates,
      missingFields: [...missing].map(([field, reason]) => ({ field, reason })), choices,
      configuration: sources.configuration, nextAction: 'review_candidates' };
    if (!validateAiQuoteGoalProjectionDraft(output)) throw unavailable();
    return freezeOriginalInput(output);
  }

  private base(source: AiQuoteGoalSourceDraft, model: Model) {
    return { draftVersion: AI_QUOTE_GOAL_DRAFT_VERSION, original: source.original, goalHash: source.goalHash,
      model: { taskId: model.taskId, runId: model.runId, resultId: model.resultId, observedAt: model.observedAt },
      modelSemantics: 'unconfirmed_intent_candidates' as const, businessSemantics: 'authorized_source_choices_not_selected' as const,
      consistency: 'revalidated_reads_not_atomic_snapshot' as const,
      automaticRetry: false as const, sideEffects: { quoteSaved: false as const, inventoryReserved: false as const,
        orderCreated: false as const, approvalGranted: false as const } };
  }

  async read(value: unknown): Promise<AiQuoteGoalProjectionDraft> {
    const parsed = commandSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data), original: Original = await this.dependencies.requests.readHistorical(command.original);
    const source = bindQuoteGoalOriginal(original), model = await this.readModel(command, source);
    if (model.status !== 'available') {
      const latest = await this.readModel(command, source);
      if (!same(this.modelIdentity(model), this.modelIdentity(latest))) throw denied();
      const after = await this.dependencies.requests.readHistorical(command.original);
      assertAiReadContextBinding(after.context, original.context);
      if (!same(bindQuoteGoalOriginal(after), source)) throw denied();
      const output: AiQuoteGoalProjectionDraft = { ...this.base(source, model), status: model.status,
        candidates: null, missingFields: [], choices: [], configuration: null,
        nextAction: model.status === 'unknown' ? 'read_original_result' : 'manual_review' };
      if (!validateAiQuoteGoalProjectionDraft(output)) throw unavailable();
      return freezeOriginalInput(output);
    }
    if (typeof model.candidateText !== 'string' || !model.callId || !model.materialHash) throw unavailable();
    const candidates = parseQuoteGoalModelOutput(model.candidateText), before = await this.savedGoal(model, source);
    const lookupCandidates = { ...candidates, conditions: originalQuoteGoalHints(candidates.conditions, before.history) };
    // Preserve the human's actual names/time words. Resolving a date or choosing
    // another product belongs to the existing Core/human clarification path.
    const words = [lookupCandidates.conditions.customerName, lookupCandidates.conditions.start, lookupCandidates.conditions.end,
      lookupCandidates.conditions.locationName, lookupCandidates.conditions.returnLocationName,
      ...(lookupCandidates.conditions.items ?? []).map(item => item.productName)].filter((word): word is string => word !== undefined);
    if (words.some(word => !before.intent.texts.some(text => text.includes(word)))) throw unavailable();
    return this.dependencies.authority.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, original.context);
      const first = await this.sources(lookupCandidates, context, before.intent.selectedCustomerType);
      const afterOriginal = await this.dependencies.requests.readHistorical(command.original);
      assertAiReadContextBinding(afterOriginal.context, context);
      if (!same(bindQuoteGoalOriginal(afterOriginal), source)) throw denied();
      const afterModel = await this.readModel(command, source);
      if (!same(this.modelIdentity(model), this.modelIdentity(afterModel))) throw denied();
      const after = await this.savedGoal(afterModel, source);
      if (before.proof !== after.proof
        || before.bindingKey !== after.bindingKey) throw denied();
      // The result/provenance reads can outlast the candidate window. Finish
      // with the actual current sources, rather than publish the pre-await list.
      const second = await this.sources(lookupCandidates, context, after.intent.selectedCustomerType);
      if (first.fingerprint !== second.fingerprint) throw denied();
      const closingOriginal = await this.dependencies.requests.readHistorical(command.original);
      assertAiReadContextBinding(closingOriginal.context, context);
      if (!same(bindQuoteGoalOriginal(closingOriginal), source)) throw denied();
      if ((await this.dependencies.tasks.resolveAccess(model.taskId, 'read_step_terminal')).bindingKey !== after.bindingKey) throw denied();
      return this.project(source, afterModel, candidates, second, lookupCandidates.conditions);
    });
  }
}
