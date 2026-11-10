/** Original opening-request consumer. The canonical creation receipt selects
 * the Task/Run; caller bodies contain no task, run, lease, policy or limits.
 * Explicit start freezes one partition or a bounded partition batch on the
 * normal R1 runner. Each proposal remains independent. Historical
 * reads/recovery only observe original metadata, even after input expiry or
 * config change. Cancellation never rolls back saved proposals; recovery does
 * not prepare differences, dispatch tail partitions or erase original debt. */
import { z } from 'zod';
import type { AiOriginalSceneDependencies } from './original-scenes.composition';
import { composeAiOriginalScenes } from './original-scenes.composition';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { AiCurrentOriginalRequestAuthority, originalIdentityHash } from '../task-request/original-request.authority';
import { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiGuardedOpeningConfigurationSource } from '../tools/opening-configuration.source';
import { AiOpeningSectionDifferenceService, openingSectionChangeSchema, verifyOpeningSectionMaterial } from '../tools/opening-section-difference.service';
import { AiOpeningSectionProposalService } from '../tools/opening-section-proposal.service';
import { AiOpeningVersionFieldSource } from '../tools/opening-version-fields.source';
import { AiTaskRunnerError, snapshotAiTaskRunnerRecoveryLease, callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import type { AiTaskRunnerRecoveryLease } from '../runner/ai-task-runner.ports';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { aiTaskRunnerLimitsSchema, aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiStepActionId } from '../ai-step-registration.repository';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { composeOpeningProposalTaskHost } from '../runner/opening-proposal-task-host.composition';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from '../runner/prisma-task-application';

const commandSchema = z.object({ original: originalRequestReferenceSchema, section: openingSectionChangeSchema }).strict();
const batchSchema = z.object({ original: originalRequestReferenceSchema,
  sections: z.array(openingSectionChangeSchema).min(1).max(4).refine(sections => new Set(sections.map(section => section.key)).size === sections.length)
}).strict();
const batchReadSchema = z.object({ original: originalRequestReferenceSchema }).strict();
const receiptSchema = z.object({ original: originalRequestReferenceSchema,
  registrationRef: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
export function composeOpeningProposalWorkflow(input: AiOriginalSceneDependencies,
  host: AiTaskApplicationHost, monotonic?: () => number) {
  const scenes = composeAiOriginalScenes(input), authorization = composePersistedTaskAuthorization(input);
  const clock = input.clock ?? (() => new Date());
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, clock);
  const differences = new AiOpeningSectionDifferenceService(new AiGuardedOpeningConfigurationSource(input.core, routes), routes, clock,
    new AiOpeningVersionFieldSource(input.db, routes));
  // Opening request bodies name workspace sections, not business records. Their
  // original read ACL is the opening Guard; a fresh full diagnosis is neither
  // historical evidence nor a prerequisite for stopping/reconciling old debt.
  // Use the original authority/repository, scoped ONLY to historical opening
  // reads. Fresh preview/start retain the existing complete admission path.
  const history = new PrismaOriginalRequestRepository(input.db, new AiCurrentOriginalRequestAuthority(input.db, {
    ...input, authorizeResources: async body => {
      if (body.sceneCode !== 'opening_diagnosis') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return routes.withRead('opening', {}, async context => context);
    }
  }, clock), clock);
  const target = async (reference: z.infer<typeof originalRequestReferenceSchema>, historical: boolean) => {
    const requests = historical ? history : scenes.requests;
    const read = async () => {
      if (!historical) await requests.read(reference);
      return requests.readHistorical(reference);
    };
    const original = await read();
    if (original.request.sceneCode !== 'opening_diagnosis' || original.receipt.state === 'revoked') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const created = await requests.readTaskReceipt(reference.inputRef);
    if (created.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const access = await authorization.tasks.resolveAccess(created.taskId, 'read_metadata');
    const task = await input.db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== created.taskId || task.inputRef !== reference.inputRef || task.inputHash !== original.receipt.contentHash
      || task.sceneCode !== 'opening_diagnosis' || task.sceneVersion !== original.receipt.sceneVersion || task.archivedAt !== null)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const identity = originalIdentityHash(original.context);
    const verify = async (historicalRead = historical) => {
      const selected = historicalRead ? history : scenes.requests;
      if (!historicalRead) await selected.read(reference);
      const current = await selected.readHistorical(reference);
      const receipt = await selected.readTaskReceipt(reference.inputRef);
      if (current.receipt.state === 'revoked' || current.receipt.contentHash !== original.receipt.contentHash
        || originalIdentityHash(current.context) !== identity || receipt.state !== 'observed'
        || receipt.taskId !== created.taskId || receipt.runId !== created.runId
        || (await authorization.tasks.resolveAccess(created.taskId, 'read_metadata')).bindingKey !== access.bindingKey)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verify();
    return { original, created, task, verify, sections: original.request.input.sections };
  };
  const transitions = new AiTaskTransitionRepository(input.db, authorization.authority, clock);
  const cancellationSchema = batchReadSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
  const cancel = async (value: unknown, mode: 'request' | 'settle_unstarted' | 'read_request' | 'read_settlement') => {
    const command = cancellationSchema.parse(structuredClone(value)), found = await target(command.original, true);
    const reference = { taskId: found.created.taskId, expectedRevision: command.expectedRevision };
    const write = mode === 'request' || mode === 'settle_unstarted';
    if (write) { await authorization.authority.resolve(reference.taskId, 'transition_task'); await found.verify(); }
    let receipt;
    try {
      receipt = mode === 'request' ? await transitions.transition({ ...reference, to: 'cancel_requested', reason: 'cancel_requested' })
        : mode === 'settle_unstarted' ? await transitions.settleUnstartedCancellation({ ...reference, to: 'cancelled', reason: 'cancel_settled' }, found.created.runId)
          : mode === 'read_request' ? await transitions.readCancellationReceipt(reference)
            : await transitions.readCancellationSettlementReceipt(reference);
    } catch (error) {
      if (write && (!(error && typeof error === 'object' && 'code' in error)
        || !['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT'].includes(String(error.code)))) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      throw error;
    }
    try { await found.verify(); } catch (error) { if (write) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); throw error; }
    return freezeOriginalInput({ original: command.original, receipt, cancellation: 'not_metadata_or_business_rollback' as const,
      automaticRetry: false as const, businessDraft: 'not_created' as const, publication: 'not_attempted' as const });
  };
  // Recovery consumes ONLY the original frozen plan/inputs. New configuration,
  // input expiry and new-execution policy do not rewrite prior metadata or debt.
  // The existing runner still checks current read/cleanup rights and exact lease.
  const savedHost = async (reference: z.infer<typeof originalRequestReferenceSchema>) => {
    const found = await target(reference, true), key = { scopeId: found.task.scopeId, taskId: found.task.id, runId: found.created.runId };
    const saved = await input.db.aiTaskRunPlan.findFirst({ where: key });
    if (!saved || Object.entries(key).some(([name, value]) => saved[name as keyof typeof saved] !== value)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const plan = aiTaskRunPlanSchema.parse(saved.payload);
    if (plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash || plan.steps.length < 1 || plan.steps.length > 4
      || plan.steps.some(step => step.toolCode !== 'tenant.config.propose' || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.operation !== 'idempotent'))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const packets: ReturnType<typeof verifyOpeningSectionMaterial>[] = [], hashes: string[] = [];
    for (const definition of plan.steps) {
      const where = { ...key, registrationRef: definition.registrationRef }, stored = await input.db.aiTaskActionInput.findFirst({ where });
      if (!stored || Object.entries(where).some(([name, value]) => stored[name as keyof typeof stored] !== value)
        || stored.toolCode !== definition.toolCode || stored.toolVersion !== definition.toolVersion) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const material = verifyOpeningSectionMaterial(stored.payload);
      if (found.original.context.scope.kind !== 'workspace' || material.scope.tenantId !== found.original.context.scope.tenantId
        || material.scope.workspaceId !== found.original.context.scope.workspaceId
        || !found.sections.includes(material.key) || packets.some(packet => packet.key === material.key)
        || stored.fingerprint !== material.materialHash || definition.registrationRef !== `opening-section:${material.key}:${material.materialHash}`)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      packets.push(material); hashes.push(requestFingerprint(stored));
    }
    const verify = async () => {
      await found.verify();
      const latest = await input.db.aiTaskRunPlan.findFirst({ where: key });
      if (!latest || latest.planHash !== saved.planHash || requestFingerprint(latest) !== requestFingerprint(saved)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      for (const [index, definition] of plan.steps.entries()) {
        const stored = await input.db.aiTaskActionInput.findFirst({ where: { ...key, registrationRef: definition.registrationRef } });
        if (!stored || requestFingerprint(stored) !== hashes[index]) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      }
      await found.verify();
    };
    await verify();
    const root = composeOpeningProposalTaskHost({ ...input, host, monotonic,
      scene: { code: found.task.sceneCode, version: found.task.sceneVersion }, revalidateOriginal: verify,
      task: { taskId: key.taskId, runId: key.runId, material: packets[0], materials: packets,
        limits: plan.limits, expiresAt: found.original.receipt.expiresAt } });
    return { found, key, root, verify };
  };
  const prepareBatch = async (command: z.infer<typeof batchSchema>) => {
    const found = await target(command.original, false);
    if (command.sections.some(section => !found.sections.includes(section.key))) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const materials: ReturnType<typeof verifyOpeningSectionMaterial>[] = [];
    for (const section of command.sections) materials.push(verifyOpeningSectionMaterial(await differences.prepare(section, found.original.context)));
    // Compare the same independent sources before any publication. An input
    // observer cannot certify a cross-partition snapshot from a closing ACL alone.
    for (const [index, section] of command.sections.entries()) {
      if ((await differences.prepare(section, found.original.context)).materialHash !== materials[index].materialHash)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    await found.verify();
    return { found, materials };
  };
  return Object.freeze({
    requestCancellation: (value: unknown) => cancel(value, 'request'),
    settleUnstartedCancellation: (value: unknown) => cancel(value, 'settle_unstarted'),
    readCancellation: (value: unknown) => cancel(value, 'read_request'),
    readCancellationSettlement: (value: unknown) => cancel(value, 'read_settlement'),
    async recoverOriginal(value: unknown, signal?: AbortSignal) {
      const command = batchReadSchema.parse(structuredClone(value));
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      const { root, verify, claim } = await waitForTaskApplicationDependency(async () => {
        const { key, root, verify } = await savedHost(command.original);
        const task = await root.authorization.tasks.readMetadata(key.taskId), run = await input.db.aiRun.findFirst({
          where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId }
        });
        if (!run || run.id !== key.runId || run.taskId !== key.taskId || run.scopeId !== key.scopeId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const claim = { taskId: key.taskId, runId: key.runId, holderId: host.holderId, leaseMs: host.leaseMs,
          expectedTaskRevision: task.revision, expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) };
        await verify();
        return { root, verify, claim };
      }, false, signal);
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      let lease: AiTaskRunnerRecoveryLease;
      try {
        const received = await waitForTaskApplicationDependency(() => root.authorization.tasks.claimRecoveryRun(structuredClone(claim)), true, signal);
        lease = snapshotAiTaskRunnerRecoveryLease(claim, received);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'AI_STORAGE_UNAVAILABLE') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      }
      let runnerOwnsLease = false;
      try {
        if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        // The original engine accepts cleanup inside its try/finally, after
        // pure reads. Missing ACK never authorizes a holder readback or dispatch.
        const outcome = await root.runner.recover(lease, signal, () => { runnerOwnsLease = true; });
        try { await waitForTaskApplicationDependency(verify, false, signal); } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
        return freezeOriginalInput({ original: command.original, kind: 'run_outcome' as const, outcome,
          execution: 'recovery_only_no_redispatch' as const, atomicity: 'independent_partitions' as const,
          businessDraft: 'not_created' as const, publication: 'not_attempted' as const, retryable: false as const });
      } finally {
        if (!runnerOwnsLease) {
          // Cleanup is this acknowledged generation's CAS, independently of
          // host cancellation. It does not cancel remote work or clear old debt.
          try {
            await callAiTaskRunnerDependency(async child => {
              const current = structuredClone(await root.authorization.tasks.readMetadata(lease.taskId));
              if (child.aborted || current.taskId !== lease.taskId) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
              const release = { taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
                expectedTaskRevision: current.revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken };
              const receipt = structuredClone(await root.authorization.tasks.releaseRun(structuredClone(release)));
              if (child.aborted || !receipt || receipt.released !== true || receipt.revision !== release.expectedRunRevision + 1) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            }, 5000, 'opening_proposal_recovery_cleanup');
          } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'opening recovery cleanup requires original receipt'); }
        }
      }
    },
    async previewSections(value: unknown) {
      const command = batchSchema.parse(structuredClone(value)), { materials } = await prepareBatch(command);
      return freezeOriginalInput({ original: command.original, sections: materials, persistence: 'not_attempted' as const,
        atomicity: 'independent_partitions' as const });
    },
    async startSections(value: unknown, signal?: AbortSignal) {
      const command = batchSchema.parse(structuredClone(value));
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      const { found, materials, root } = await waitForTaskApplicationDependency(async () => {
        const prepared = await prepareBatch(command), { found } = prepared;
        const changed = prepared.materials.filter(material => material.status === 'difference_ready');
        if (!changed.length) return { ...prepared, root: null };
        const policy = await input.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: found.task.scopeId,
          sceneCode: found.task.sceneCode, sceneVersion: found.task.sceneVersion } });
        const tools = aiPersistedPlanToolsSchema.safeParse(policy?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(policy?.limits);
        if (!policy?.enabled || !tools.success || !limits.success || !tools.data.some(tool => tool.code === 'tenant.config.propose')
          || !(policy.expiresAt instanceof Date) || policy.expiresAt <= clock() || changed.length > limits.data.maxSteps)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const key = { scopeId: found.task.scopeId, taskId: found.task.id, runId: found.created.runId };
        const steps = changed.map(material => ({ registrationRef: `opening-section:${material.key}:${material.materialHash}`,
          toolCode: 'tenant.config.propose', toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'idempotent' as const }));
        const saved = await input.db.aiTaskRunPlan.findFirst({ where: key });
        if (saved) {
          const plan = aiTaskRunPlanSchema.parse(saved.payload);
          if (requestFingerprint(plan) !== saved.planHash || plan.taskId !== key.taskId || plan.runId !== key.runId
            || requestFingerprint(plan.steps) !== requestFingerprint(steps) || requestFingerprint(plan.limits) !== requestFingerprint(limits.data))
            throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        }
        const packets: ReturnType<typeof verifyOpeningSectionMaterial>[] = [];
        for (const [index, material] of changed.entries()) {
          const prior = await input.db.aiTaskActionInput.findFirst({ where: { ...key, registrationRef: steps[index].registrationRef } });
          if (!prior) packets.push(material);
          else {
            const packet = verifyOpeningSectionMaterial(prior.payload);
            if (packet.materialHash !== material.materialHash || prior.fingerprint !== packet.materialHash)
              throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            packets.push(packet);
          }
        }
        const root = composeOpeningProposalTaskHost({ ...input, host, monotonic,
          scene: { code: found.task.sceneCode, version: found.task.sceneVersion }, revalidateOriginal: () => found.verify(false),
          task: { taskId: key.taskId, runId: key.runId, material: packets[0], materials: packets,
            limits: limits.data, expiresAt: found.original.receipt.expiresAt } });
        return { ...prepared, root };
      }, false, signal);
      if (!root) return freezeOriginalInput({ kind: 'no_change' as const, original: command.original, sections: materials, persistence: 'not_attempted' as const });
      const outcome = await root.application.start({ taskId: found.task.id, runId: found.created.runId }, signal);
      try { await waitForTaskApplicationDependency(() => found.verify(true), false, signal); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ original: command.original, outcome,
        references: root.registrationRefs.map(registrationRef => ({ registrationRef })),
        unchanged: materials.filter(material => material.status === 'no_change'), atomicity: 'independent_partitions' as const,
        failurePolicy: 'stop_and_reconcile' as const, businessDraft: 'not_created' as const, publication: 'not_attempted' as const });
    },
    async readSections(value: unknown) {
      const command = batchReadSchema.parse(structuredClone(value)), found = await target(command.original, true);
      const key = { scopeId: found.task.scopeId, taskId: found.task.id, runId: found.created.runId };
      const saved = await input.db.aiTaskRunPlan.findFirst({ where: key });
      if (!saved) { await found.verify(); return { state: 'plan_not_observed' as const, retryable: false as const }; }
      const plan = aiTaskRunPlanSchema.parse(saved.payload);
      if (plan.taskId !== key.taskId || plan.runId !== key.runId || requestFingerprint(plan) !== saved.planHash || plan.steps.length > 4
        || plan.steps.some(step => step.toolCode !== 'tenant.config.propose' || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.operation !== 'idempotent'))
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const access = await authorization.tasks.resolveAccess(key.taskId, 'read_metadata');
      const proposals = new AiOpeningSectionProposalService({ ...input, holderId: host.holderId,
        scene: { code: found.task.sceneCode, version: found.task.sceneVersion } }, differences);
      const sections = [];
      const observedKeys = new Set<string>();
      for (const definition of plan.steps) {
        const originalInput = await input.db.aiTaskActionInput.findFirst({ where: { ...key, registrationRef: definition.registrationRef } });
        if (!originalInput) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const material = verifyOpeningSectionMaterial(originalInput.payload);
        if (observedKeys.has(material.key) || !found.sections.includes(material.key) || originalInput.fingerprint !== material.materialHash
          || definition.registrationRef !== `opening-section:${material.key}:${material.materialHash}`) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        observedKeys.add(material.key);
        const step = await input.db.aiStep.findFirst({ where: { ...key, actionId: aiStepActionId(access.scope, key.taskId, definition.registrationRef) } });
        const receipt = await proposals.readReceipt({ taskId: key.taskId, runId: key.runId, registrationRef: definition.registrationRef });
        sections.push({ key: material.key, registrationRef: definition.registrationRef, expectedVersion: material.expectedVersion,
          step: step ? { stepId: step.id, revision: step.revision, status: step.status, effect: step.effect, resultRef: step.resultRef }
            : { status: 'NOT_REGISTERED' as const }, receipt });
      }
      await found.verify();
      const current = await input.db.aiTask.findFirst({ where: access.where });
      const latest = await input.db.aiTaskRunPlan.findFirst({ where: key });
      if (!current || current.revision !== found.task.revision || current.status !== found.task.status
        || !latest || latest.planHash !== saved.planHash || requestFingerprint(latest.payload) !== saved.planHash)
        throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return freezeOriginalInput({ original: command.original, state: 'observed' as const, taskStatus: current.status, sections,
        atomicity: 'independent_partitions' as const, execution: 'read_only_no_lease_or_dispatch' as const,
        publication: 'not_attempted' as const, retryable: false as const });
    },
    async preview(value: unknown) {
      const command = commandSchema.parse(structuredClone(value)), found = await target(command.original, false);
      if (!found.sections.includes(command.section.key)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const material = await differences.prepare(command.section, found.original.context);
      await found.verify();
      return freezeOriginalInput({ original: command.original, material, persistence: 'not_attempted' as const });
    },
    async start(value: unknown, signal?: AbortSignal) {
      const command = commandSchema.parse(structuredClone(value));
      if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
      const { found, root } = await waitForTaskApplicationDependency(async () => {
        const found = await target(command.original, false);
        if (!found.sections.includes(command.section.key)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        let material = verifyOpeningSectionMaterial(await differences.prepare(command.section, found.original.context));
        if (material.status === 'no_change') return { found, root: null, material };
        const row = await input.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: found.task.scopeId,
          sceneCode: found.task.sceneCode, sceneVersion: found.task.sceneVersion } });
        const tools = aiPersistedPlanToolsSchema.safeParse(row?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(row?.limits);
        if (!row?.enabled || !tools.success || !limits.success || !tools.data.some(tool => tool.code === 'tenant.config.propose')
          || !(row.expiresAt instanceof Date) || row.expiresAt <= clock()) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const registrationRef = `opening-section:${material.key}:${material.materialHash}`;
        const prior = await input.db.aiTaskActionInput.findFirst({ where: { scopeId: found.task.scopeId, taskId: found.task.id,
          runId: found.created.runId, registrationRef } });
        if (prior) {
          const packet = verifyOpeningSectionMaterial(prior.payload);
          if (packet.materialHash !== material.materialHash || prior.fingerprint !== packet.materialHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          material = packet;
        }
        const root = composeOpeningProposalTaskHost({ ...input, host, monotonic,
          scene: { code: found.task.sceneCode, version: found.task.sceneVersion }, revalidateOriginal: () => found.verify(false),
          task: { taskId: found.task.id, runId: found.created.runId, material, limits: limits.data, expiresAt: found.original.receipt.expiresAt } });
        return { found, root, material };
      }, false, signal);
      if (!root) { await found.verify(); return { kind: 'no_change' as const, persistence: 'not_attempted' as const }; }
      const outcome = await root.application.start({ taskId: found.task.id, runId: found.created.runId }, signal);
      // Task/Run revision and status may legitimately advance. Identity and
      // original binding must not; a delivery failure never proves no R1 write.
      try { await waitForTaskApplicationDependency(() => found.verify(true), false, signal); }
      catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN'); }
      return freezeOriginalInput({ original: command.original, reference: { registrationRef: root.registrationRef }, outcome,
        businessDraft: 'not_created' as const, publication: 'not_attempted' as const });
    },
    async readReceipt(value: unknown) {
      const command = receiptSchema.parse(structuredClone(value)), found = await target(command.original, true);
      const proposals = new AiOpeningSectionProposalService({ ...input, holderId: host.holderId,
        scene: { code: found.task.sceneCode, version: found.task.sceneVersion } }, differences);
      const receipt = await proposals.readReceipt({ taskId: found.task.id, runId: found.created.runId, registrationRef: command.registrationRef });
      if (receipt.state === 'ai_proposal_saved') {
        const material = verifyOpeningSectionMaterial(receipt.material);
        if (!found.sections.includes(material.key)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
      await found.verify();
      return freezeOriginalInput({ original: command.original, receipt, execution: 'read_only_no_lease_or_dispatch' as const });
    }
  });
}
