/** Original R1 opening proposal metadata, not a business configuration draft.
 * Freezes checked per-section material, registers a real PENDING/NONE Step and
 * saves the original AiProposal. No active setting, publication or dispatch. */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_TASK_RULE_DRAFT_FIELDS, type AiProposalPayloadDraft } from '@rental-os/shared';
import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import { AiStepRegistrationRepository, aiStepActionId, type AiStepRegistrationCommand } from '../ai-step-registration.repository';
import { AiProposalRepository } from '../ai-proposal-repository';
import { fingerprintAiProposalDraft } from '../proposal-binding-draft';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { assertAiReadContextBinding } from './read-context-binding';
import { AiOpeningSectionDifferenceService, openingSectionChangeSchema, verifyOpeningSectionMaterial, openingSectionFromMaterial } from './opening-section-difference.service';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const leaseSchema = z.object({ taskId: id.max(36), runId: id.max(36), holderId: id,
  revision: z.number().int().min(1).max(4294967294), fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
export type OpeningProposalLease = z.infer<typeof leaseSchema>;
export class AiOpeningProposalUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN' as const; readonly retryable = false;
  readonly nextAction = 'read_original_opening_proposal' as const;
  readonly reference?: Readonly<{ taskId: string; runId: string; registrationRef: string }>;
  constructor(reference?: { taskId: string; runId: string; registrationRef: string }) {
    super('AI_RESULT_UNKNOWN'); this.reference = reference && Object.freeze({ ...reference });
  }
}
export class AiOpeningSectionProposalService {
  private readonly authorization;
  private readonly routes;
  private readonly clock;
  constructor(private readonly d: PersistedTaskAuthorizationDependencies & { db: PrismaClient;
    guard: Pick<ApiAuthGuard, 'canActivate'>; holderId: string; scene: { code: string; version: string } },
    private readonly differences: AiOpeningSectionDifferenceService, private readonly calendarOnly = false,
    private readonly calendarReader?: { current(taskId: string): Promise<import('@rental-os/shared').AiExecutionContext> },
    private readonly rule?: { id: string; version: string; reader?: { current(taskId: string): Promise<import('@rental-os/shared').AiExecutionContext> } }) {
    if (calendarReader && !calendarOnly) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    if (rule && calendarOnly) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    this.authorization = composePersistedTaskAuthorization(d);
    this.routes = new AiBusinessReadRouteAuthority(d.guard, d.credentials, d.clock);
    this.clock = d.clock ?? (() => new Date());
  }
  private withMaterial<T>(material: ReturnType<typeof verifyOpeningSectionMaterial>, consume: (context: import('@rental-os/shared').AiExecutionContext) => Promise<T>) {
    if (this.rule) {
      if (material.key !== 'business_rule' || material.targetId !== this.rule.id || material.expectedVersion !== this.rule.version
        || material.changes.some(change => !(AI_TASK_RULE_DRAFT_FIELDS as readonly string[]).includes(change.field))) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return this.routes.withRuleDraftPreview(this.rule.id, consume);
    }
    if (!this.calendarOnly) return this.routes.withRead('opening', { limit: 50 }, consume);
    if (material.key !== 'business_calendar' || !material.date)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return this.routes.withCalendarSourceRead({ year: Number(material.date.slice(0, 4)), date: material.date }, consume);
  }
  private async access(taskId: string, writing: boolean) {
    const reader = this.calendarReader ?? this.rule?.reader;
    const context = writing ? await this.authorization.execution.authorize(taskId)
      : reader ? await reader.current(taskId) : await this.authorization.authority.resolve(taskId, 'read_metadata');
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const access = !writing && reader ? aiTaskAccessFromContext(context, taskId, this.clock())
      : await this.authorization.tasks.resolveAccess(taskId, 'read_metadata');
    if (access.bindingKey !== aiTaskAccessFromContext(context, taskId, this.clock()).bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const task = await this.d.db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== taskId || task.ownerId !== context.actor.userId || task.ownerKind !== 'USER'
      || task.sceneCode !== this.d.scene.code || task.sceneVersion !== this.d.scene.version || task.archivedAt !== null
      || writing && (task.status !== 'RUNNING' || task.cancelRequestedAt !== null)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { context, access, task, actorId: context.actor.userId };
  }
  private async policy(scopeId: string) {
    const policy = await this.d.db.aiTaskPlanPolicy.findFirst({ where: { scopeId, sceneCode: this.d.scene.code, sceneVersion: this.d.scene.version } });
    const tools = z.array(z.object({ code: id, version: z.literal(AI_TOOL_DRAFT_VERSION) }).strict()).min(1).max(8).safeParse(policy?.allowedTools);
    if (!policy || policy.scopeId !== scopeId || policy.sceneCode !== this.d.scene.code || policy.sceneVersion !== this.d.scene.version
      || !policy.enabled || !Number.isSafeInteger(policy.revision) || policy.revision < 1 || policy.revision > 4294967294
      || !(policy.expiresAt instanceof Date) || !Number.isFinite(policy.expiresAt.getTime()) || policy.expiresAt <= this.clock()
      || !tools.success || !tools.data.some(tool => tool.code === 'tenant.config.propose')) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const limits = aiTaskRunnerLimitsSchema.parse(policy.limits);
    return { policy, limits, hash: requestFingerprint({ ...policy, expiresAt: policy.expiresAt.toISOString() }) };
  }
  private async held(lease: OpeningProposalLease, scopeId: string, actorId: string) {
    const run = await this.d.db.aiRun.findFirst({ where: { id: lease.runId, taskId: lease.taskId, scopeId } });
    if (!run || run.id !== lease.runId || run.taskId !== lease.taskId || run.scopeId !== scopeId
      || run.actorKind !== 'USER' || run.actorId !== actorId || run.status !== 'RUNNING' || run.leaseOwnerId !== this.d.holderId || lease.holderId !== this.d.holderId
      || run.revision !== lease.revision || run.fencingToken.toFixed(0) !== lease.fencingToken || !run.leaseExpiresAt
      || run.leaseExpiresAt.toISOString() !== lease.expiresAt || run.leaseExpiresAt <= this.clock()) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  /** Original runner callback after its durable POSSIBLE marker and resource
   * reservation. It consumes an already-published input/Step; never registers
   * another Step, rewrites the plan, adopts a lease or updates Core settings. */
  async executePreparedInput(value: unknown, signal: AbortSignal) {
    const command = z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36), actionId: id,
      inputRef: id.max(36), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), lease: leaseSchema }).strict().parse(structuredClone(value));
    const lease = command.lease;
    if (signal.aborted || lease.taskId !== command.taskId || lease.runId !== command.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const before = await this.access(command.taskId, true), policy = await this.policy(before.task.scopeId);
    await this.held(lease, before.task.scopeId, before.actorId);
    const key = { scopeId: before.task.scopeId, taskId: command.taskId, runId: command.runId };
    const step = await this.d.db.aiStep.findFirst({ where: { ...key, id: command.stepId } });
    const input = await this.d.db.aiTaskActionInput.findFirst({ where: { ...key, id: command.inputRef } });
    if (!step || !input || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE'
      || step.actionId !== command.actionId || step.inputRef !== input.id || step.requestFingerprint !== command.fingerprint
      || input.fingerprint !== command.fingerprint || step.toolCode !== 'tenant.config.propose'
      || step.toolVersion !== AI_TOOL_DRAFT_VERSION || input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion
      || input.policyRevision !== policy.policy.revision || input.expiresAt <= this.clock()) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const material = verifyOpeningSectionMaterial(input.payload), registrationRef = `opening-section:${material.key}:${material.materialHash}`;
    if (input.registrationRef !== registrationRef || material.materialHash !== input.fingerprint
      || step.actionId !== aiStepActionId(before.access.scope, command.taskId, registrationRef)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const section = openingSectionFromMaterial(material);
    const verify = async () => {
      if (signal.aborted || (await this.differences.prepare(section, before.context)).materialHash !== material.materialHash)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await this.held(lease, key.scopeId, before.actorId);
      if ((await this.access(command.taskId, false)).access.bindingKey !== before.access.bindingKey
        || (await this.policy(key.scopeId)).hash !== policy.hash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verify();
    const snapshot = { recordId: input.id, revision: 1, contentHash: material.materialHash };
    const payload: AiProposalPayloadDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, taskId: command.taskId,
      proposalId: `oc-${material.materialHash.slice(0, 32)}`, revision: 1, audience: before.context.audience, scope: before.context.scope,
      actions: [{ actionId: step.actionId, toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION,
        input: snapshot, preview: snapshot, target: { resourceType: 'configuration', resourceId: material.targetId, version: material.expectedVersion } }],
      atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: input.expiresAt.toISOString() };
    try {
      await new AiProposalRepository(this.d.db).createPending({ scopeId: key.scopeId, taskId: key.taskId, payload,
        actions: [{ actionId: step.actionId, requestFingerprint: material.materialHash }] });
      await verify();
      return { state: 'ai_proposal_saved' as const, reference: { taskId: key.taskId, runId: key.runId, registrationRef,
        proposalId: payload.proposalId, proposalRevision: 1, payloadHash: fingerprintAiProposalDraft(payload) },
        material: input.payload, businessDraft: 'not_created' as const, activeConfiguration: 'unchanged' as const,
        approval: 'not_granted' as const, publication: 'not_attempted' as const };
    } catch { throw new AiOpeningProposalUnknownError({ taskId: key.taskId, runId: key.runId, registrationRef }); }
  }

  async prepare(value: unknown, acknowledgedLease: OpeningProposalLease) {
    const command = z.object({ taskId: id.max(36), section: openingSectionChangeSchema }).strict().parse(structuredClone(value));
    let lease = leaseSchema.parse(structuredClone(acknowledgedLease));
    if (lease.taskId !== command.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const before = await this.access(command.taskId, true), policy = await this.policy(before.task.scopeId);
    await this.held(lease, before.task.scopeId, before.actorId);
    const material = await this.differences.prepare(command.section, before.context);
    if (material.status === 'no_change') return { state: 'no_change' as const, material, persistence: 'not_attempted' as const };
    const registrationRef = `opening-section:${material.key}:${material.materialHash}`;
    const key = { scopeId: before.task.scopeId, taskId: command.taskId, runId: lease.runId, registrationRef };
    let input: Prisma.AiTaskActionInputGetPayload<{}>, metadataAttempted = false;
    try {
      input = await this.d.db.$transaction(async tx => {
        const where = { ...before.access.where, scopeId: before.task.scopeId, revision: before.task.revision, status: 'RUNNING' as const, cancelRequestedAt: null };
        if ((await tx.aiTask.updateMany({ where, data: { revision: before.task.revision } })).count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await this.held(lease, before.task.scopeId, before.actorId);
        const existing = await tx.aiTaskActionInput.findFirst({ where: key });
        if (existing) {
          metadataAttempted = true;
          if (verifyOpeningSectionMaterial(existing.payload).materialHash !== existing.fingerprint) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          if (existing.fingerprint !== material.materialHash || existing.policyRevision !== policy.policy.revision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          return existing;
        }
        if (await tx.aiTaskRunPlan.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } })) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        if (await tx.aiTaskActionInput.count({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } }) >= policy.limits.maxSteps) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if ((await this.policy(key.scopeId)).hash !== policy.hash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        verifyOpeningSectionMaterial(material);
        metadataAttempted = true;
        return tx.aiTaskActionInput.create({ data: { ...key, id: randomUUID(), toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION,
          payload: JSON.parse(JSON.stringify(material)), fingerprint: material.materialHash, policyRevision: policy.policy.revision,
          expiresAt: new Date(Math.min(Date.parse(lease.expiresAt), policy.policy.expiresAt.getTime())) } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      const resolve = async (raw: Readonly<AiStepRegistrationCommand>) => {
        if (raw.taskId !== command.taskId || raw.registrationRef !== registrationRef || raw.lease.runId !== lease.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const current = await this.access(raw.taskId, true);
        if (current.access.bindingKey !== before.access.bindingKey || (await this.policy(key.scopeId)).hash !== policy.hash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        await this.held({ ...lease, ...raw.lease }, key.scopeId, before.actorId);
        const row = await this.d.db.aiTaskActionInput.findFirst({ where: key });
        if (!row || row.id !== input.id || row.fingerprint !== material.materialHash || requestFingerprint(row.payload) !== requestFingerprint(input.payload)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { context: current.context, registrationAllowed: true as const, authorizationKey: `opening-input-${material.materialHash}`,
          taskId: raw.taskId, registrationRef, expiresAt: row.expiresAt.toISOString(), toolCode: 'tenant.config.propose' as const,
          toolVersion: AI_TOOL_DRAFT_VERSION, inputRef: row.id, requestFingerprint: row.fingerprint };
      };
      const registered = await new AiStepRegistrationRepository(this.d.db, { resolve }, this.clock).register({ taskId: command.taskId,
        registrationRef, expectedTaskRevision: (await this.authorization.tasks.readMetadata(command.taskId)).revision,
        lease: { runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } });
      if (!registered.replayed) {
        if (registered.runRevision !== lease.revision + 1) throw new AiOpeningProposalUnknownError();
        lease = { ...lease, revision: registered.runRevision };
      }
      await this.held(lease, key.scopeId, before.actorId);
      const step = await this.d.db.aiStep.findFirst({ where: { id: registered.stepId, scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } });
      if (!step || step.status !== 'PENDING' || step.effect !== 'NONE' || step.inputRef !== input.id || step.requestFingerprint !== material.materialHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const snapshot = { recordId: input.id, revision: 1, contentHash: material.materialHash };
      const payload: AiProposalPayloadDraft = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, taskId: command.taskId,
        proposalId: `oc-${material.materialHash.slice(0, 32)}`, revision: 1, audience: before.context.audience, scope: before.context.scope,
        actions: [{ actionId: step.actionId, toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION,
          input: snapshot, preview: snapshot, target: { resourceType: 'configuration', resourceId: material.targetId, version: material.expectedVersion } }],
        atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: input.expiresAt.toISOString() };
      if (material.materialHash !== (await this.differences.prepare(command.section, before.context)).materialHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await new AiProposalRepository(this.d.db).createPending({ scopeId: key.scopeId, taskId: key.taskId, payload,
        actions: [{ actionId: step.actionId, requestFingerprint: material.materialHash }] });
      await this.held(lease, key.scopeId, before.actorId);
      const current = await this.access(command.taskId, false);
      if (current.access.bindingKey !== before.access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      await this.withMaterial(verifyOpeningSectionMaterial(material), async context => { assertAiReadContextBinding(context, current.context); });
      return { state: 'ai_proposal_saved' as const, reference: { taskId: key.taskId, runId: key.runId, registrationRef,
        proposalId: payload.proposalId, proposalRevision: 1, payloadHash: fingerprintAiProposalDraft(payload) }, lease,
        material: input.payload, businessDraft: 'not_created' as const, activeConfiguration: 'unchanged' as const,
        approval: 'not_granted' as const, publication: 'not_attempted' as const };
    } catch (error) {
      if (!metadataAttempted && error instanceof AiTaskRepositoryError) throw error;
      throw new AiOpeningProposalUnknownError({ taskId: key.taskId, runId: key.runId, registrationRef });
    }
  }
  async readReceipt(value: unknown) {
    const command = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id }).strict().parse(structuredClone(value));
    const before = await this.access(command.taskId, false);
    const selected = this.calendarOnly || this.rule ? await this.d.db.aiTaskActionInput.findFirst({ where: { scopeId: before.task.scopeId, ...command } }) : null;
    if ((this.calendarOnly || this.rule) && !selected) {
      if ((await this.access(command.taskId, false)).access.bindingKey !== before.access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { state: 'not_observed' as const, retryable: false as const };
    }
    const consume = async (context: import('@rental-os/shared').AiExecutionContext) => {
      assertAiReadContextBinding(context, before.context);
      if (context.scope.kind !== 'workspace') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const key = { scopeId: before.task.scopeId, ...command }, input = selected ?? await this.d.db.aiTaskActionInput.findFirst({ where: key });
      if (!input) return { state: 'not_observed' as const, retryable: false as const };
      const material = verifyOpeningSectionMaterial(input.payload);
      if (material.materialHash !== input.fingerprint || material.scope.tenantId !== context.scope.tenantId
        || material.scope.workspaceId !== (context.scope.kind === 'workspace' ? context.scope.workspaceId : null)
        || command.registrationRef !== `opening-section:${material.key}:${material.materialHash}`
        || input.toolCode !== 'tenant.config.propose' || input.toolVersion !== AI_TOOL_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const step = await this.d.db.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
        actionId: aiStepActionId(before.access.scope, command.taskId, command.registrationRef) } });
      const version = step && await this.d.db.aiProposalVersion.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
        proposalId: `oc-${input.fingerprint.slice(0, 32)}`, revision: 1 } });
      if (!step || !version) {
        if ((await this.access(command.taskId, false)).access.bindingKey !== before.access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { state: 'incomplete_original_metadata' as const, retryable: false as const };
      }
      const proposal = version.payload as unknown as AiProposalPayloadDraft, action = proposal.actions[0];
      if (step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId || step.inputRef !== input.id
        || step.toolCode !== 'tenant.config.propose' || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.requestFingerprint !== input.fingerprint
        || version.scopeId !== key.scopeId || version.taskId !== key.taskId || proposal.taskId !== key.taskId
        || proposal.proposalId !== version.proposalId || proposal.revision !== version.revision || proposal.actions.length !== 1
        || requestFingerprint(proposal.scope) !== requestFingerprint(context.scope) || proposal.audience !== context.audience
        || action.actionId !== step.actionId || action.toolCode !== 'tenant.config.propose' || action.toolVersion !== AI_TOOL_DRAFT_VERSION
        || action.input.recordId !== input.id || action.input.contentHash !== input.fingerprint || action.input.revision !== 1
        || requestFingerprint(action.preview) !== requestFingerprint(action.input)
        || action.target.resourceId !== material.targetId || action.target.version !== material.expectedVersion
        || fingerprintAiProposalDraft(proposal) !== version.payloadHash
        || (await this.access(command.taskId, false)).access.bindingKey !== before.access.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { state: 'ai_proposal_saved' as const, material: input.payload, proposal: version.payload, payloadHash: version.payloadHash,
        businessDraft: 'not_created' as const, activeConfiguration: 'not_attested_by_read' as const,
        publication: 'not_attempted' as const, retryable: false as const };
    };
    if (this.rule && selected) {
      const material = verifyOpeningSectionMaterial(selected.payload);
      if (material.key !== 'business_rule' || material.targetId !== this.rule.id || material.expectedVersion !== this.rule.version)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return this.routes.withRead('rule_version', { version: this.rule.version }, consume);
    }
    if (this.calendarOnly && selected) {
      const material = verifyOpeningSectionMaterial(selected.payload);
      if (material.key !== 'business_calendar' || !material.date) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return this.routes.withRead('calendar_version', { year: Number(material.date.slice(0, 4)), version: material.expectedVersion }, consume);
    }
    return this.routes.withRead('opening', { limit: 50 }, consume);
  }
}
