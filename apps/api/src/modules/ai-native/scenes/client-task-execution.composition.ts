import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskRepository, AiTaskRepositoryError, aiTaskAccessFromContext,
  type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { AiClientTaskAuthority, clientTaskSceneSchema, type AiAuthorizedClientMaterial,
  type AiClientTaskDependencies } from './client-task.authority';
import { composeClientMaterialTasks } from './client-task.composition';
import { clientTaskCommandSchema, PrismaClientTaskInputRepository } from './prisma-client-task-input.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { PrismaTaskInputRepository } from '../task-input/prisma-task-input.repository';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
type ClientTaskOperation = 'read' | 'claim' | 'execute' | 'transition' | 'accounting' | 'request_input' | 'submit_input' | 'resume_input' | 'cancel';
const identityHash = (context: AiExecutionContext) => {
  const { requestId: _request, authorizedAt: _at, ...identity } = context;
  return requestFingerprint(identity);
};

/** Request-bound CUSTOMER authority for the existing repositories/runner. The
 * material loader must be the original Guard/ALS/publication-aware server loader,
 * not a caller-provided context. No registration, plan, invocation or dispatch is
 * created here; every tool still requires its own authorization and financial gate.
 */
export function composePersistedClientTaskAuthorization(dependencies: AiClientTaskDependencies,
  value: unknown, loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>,
  clock: () => Date = () => new Date()) {
  const command = freezeOriginalInput(clientTaskCommandSchema.parse(structuredClone(value)));
  const scene = clientTaskSceneSchema.parse({ sceneCode: dependencies.sceneCode, sceneVersion: dependencies.sceneVersion });
  const authority = new AiClientTaskAuthority(dependencies, scene, loadMaterial, randomUUID(), clock);
  const creation = composeClientMaterialTasks(dependencies, loadMaterial, clock);
  const inputs = new PrismaClientTaskInputRepository(dependencies.db);

  const snapshot = async (taskId: string | null, operation: ClientTaskOperation) => {
    const observingOriginal = ['read', 'accounting', 'cancel'].includes(operation);
    // Original accounting uses current read authority; reserve/dispatch still require execute.
    const grant = await authority.authorize(command.materialRef, operation === 'read' || operation === 'accounting' ? 'read'
      : operation === 'request_input' || operation === 'submit_input' || operation === 'resume_input' || operation === 'cancel' ? operation : 'execute');
    const receipt = await creation.readCreation(command);
    if (!receipt.task || (taskId !== null && receipt.task.taskId !== taskId)) throw denied();
    const id = receipt.task.taskId;
    const input = await inputs.findCreation(grant.material, command.creationKey);
    if (!input || input.id !== receipt.inputRef || input.inputHash !== receipt.inputHash
      || input.sceneCode !== scene.sceneCode || input.sceneVersion !== scene.sceneVersion
      || input.policyId !== grant.policy.id || (!observingOriginal
        && (input.policyRevision !== grant.policy.revision || input.expiresAt <= clock()))) throw denied();
    const access = aiTaskAccessFromContext(grant.context, id, clock());
    const task = await dependencies.db.aiTask.findFirst({ where: access.where, select: {
      id: true, scopeId: true, scopeKind: true, scope: true, audience: true, ownerKind: true, ownerId: true,
      contractVersion: true, revision: true, sceneCode: true, sceneVersion: true, status: true,
      archivedAt: true, cancelRequestedAt: true, inputRef: true, inputRevision: true, inputHash: true
    } });
    if (!task || task.id !== id || task.ownerKind !== 'CUSTOMER' || task.ownerId !== access.actorId
      || task.audience !== 'CLIENT' || task.scopeKind !== access.scope.kind
      || !task.scope || Object.entries(access.scope).some(([key, expected]) => task.scope[key as keyof typeof task.scope] !== expected)
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.archivedAt !== null
      || task.sceneCode !== scene.sceneCode || task.sceneVersion !== scene.sceneVersion
      || task.inputRef !== input.id || task.inputHash !== input.inputHash || task.inputRevision !== input.revision
      || !Number.isSafeInteger(task.revision) || task.revision < 1 || task.revision > 4294967294) throw denied();
    if ((operation === 'claim' || operation === 'execute') && (task.cancelRequestedAt !== null
      || !(operation === 'claim' ? ['QUEUED', 'RUNNING'] : ['RUNNING']).includes(task.status))) throw denied();
    // The repository proves the legal transition and holder/fence. Starting a
    // queued run or converging cancellation is not permission for a new effect.
    if (operation === 'transition' && !['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_CONFIRMATION',
      'WAITING_EXTERNAL', 'CANCEL_REQUESTED'].includes(task.status)) throw denied();
    if (operation === 'cancel' && !['QUEUED', 'RUNNING', 'WAITING_INPUT', 'WAITING_CONFIRMATION',
      'WAITING_EXTERNAL', 'CANCEL_REQUESTED'].includes(task.status)) throw denied();
    if (['request_input', 'submit_input', 'resume_input'].includes(operation) && (task.cancelRequestedAt !== null
      || (operation === 'request_input' ? !['RUNNING', 'WAITING_INPUT'].includes(task.status) : task.status !== 'WAITING_INPUT'))) throw denied();
    return { context: grant.context, taskId: id, expiresAt: new Date(observingOriginal ? grant.policy.expiresAt.getTime()
      : Math.min(grant.policy.expiresAt.getTime(), input.expiresAt.getTime())),
      proof: requestFingerprint({ identity: identityHash(grant.context),
      task, inputHash: input.inputHash, policy: grant.policy, gates: grant.policyHash }) };
  };
  const readGrant = async (taskId: string | null, operation: ClientTaskOperation) => {
    const first = await snapshot(taskId, operation), current = await snapshot(first.taskId, operation);
    if (first.proof !== current.proof || identityHash(first.context) !== identityHash(current.context)) throw denied();
    return structuredClone(current);
  };
  const authorize = async (taskId: string | null, operation: ClientTaskOperation) =>
    (await readGrant(taskId, operation)).context;
  const actions: AiTaskRepositoryAuthority = {
    resolve: (taskId, operation) => {
      if (['read_metadata', 'read_events', 'read_step_terminal', 'claim_recovery_run', 'release_run'].includes(operation)) return authorize(taskId, 'read');
      if (operation === 'claim_run') return authorize(taskId, 'claim');
      if (operation === 'transition_task') return authorize(taskId, 'transition');
      if (operation === 'request_input' || operation === 'submit_input' || operation === 'resume_input') return authorize(taskId, operation);
      // Takeover is not granted by an input/execute policy.
      return Promise.reject(denied());
    }
  };
  const scopes = new AiScopeRepository(dependencies.db, { resolve: () => authorize(null, 'read') }, clock);
  return Object.freeze({ scopes, authority: actions, tasks: new AiTaskRepository(dependencies.db, actions, clock),
    /** Narrow cancellation consumer, not a general transition/execute grant.
     * Only the fixed cancel_requested command can reach this private writer. */
    cancellation: Object.freeze({
      /** Read the exact original revision's event with current READ authority.
       * Absence is not permission to retry, refund or infer non-dispatch. */
      async readReceipt(value: unknown, settled = false) {
        const input = z.object({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict()
          .safeParse(structuredClone(value));
        if (!input.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const before = await readGrant(null, 'read');
        const repository = new AiTaskTransitionRepository(dependencies.db, actions, clock);
        const selector = { taskId: before.taskId, ...input.data };
        const result = await (settled ? repository.readCancellationSettlementReceipt(selector)
          : repository.readCancellationReceipt(selector));
        const after = await readGrant(before.taskId, 'read');
        if (identityHash(before.context) !== identityHash(after.context)) throw denied();
        return freezeOriginalInput(result);
      },
      /** The original task-lock transaction must prove no steps, plan, result,
       * Gateway invocation or either budget exists. A queued label or TTL alone
       * never proves the absence of an external effect. */
      async settleUnstarted(value: unknown) {
        const input = z.object({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict()
          .safeParse(structuredClone(value));
        if (!input.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const before = await readGrant(null, 'cancel');
        const original = await creation.readCreation(command);
        if (!original.task || original.task.taskId !== before.taskId) throw denied();
        const cancellationAuthority: AiTaskRepositoryAuthority = { resolve: (taskId, operation) => {
          if (taskId !== before.taskId) return Promise.reject(denied());
          if (operation === 'transition_task') return authorize(taskId, 'cancel');
          if (operation === 'read_metadata') return authorize(taskId, 'read');
          return Promise.reject(denied());
        } };
        const receipt = await new AiTaskTransitionRepository(dependencies.db, cancellationAuthority, clock)
          .settleUnstartedCancellation({ taskId: before.taskId, expectedRevision: input.data.expectedRevision,
            to: 'cancelled', reason: 'cancel_settled' }, original.task.runId);
        const after = await readGrant(before.taskId, 'read');
        if (identityHash(before.context) !== identityHash(after.context)) throw denied();
        return freezeOriginalInput({ receipt, cancellation: 'unstarted_task_settled' as const,
          externalRollback: 'not_claimed' as const, retryable: false as const });
      },
      /** Server-only convergence of an already requested, proved released input
       * wait. No execute/transition capability is exported to the caller. */
      async settleReleasedInputWait(db: ConstructorParameters<typeof PrismaTaskInputRepository>[0],
        _plans?: ConstructorParameters<typeof PrismaTaskInputRepository>[2],
        _source?: ConstructorParameters<typeof PrismaTaskInputRepository>[3]) {
        if (!Object.is(db, dependencies.db)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const before = await readGrant(null, 'cancel');
        const cancellationAuthority: AiTaskRepositoryAuthority = { resolve: (taskId, operation) => {
          if (taskId !== before.taskId) return Promise.reject(denied());
          if (operation === 'transition_task') return authorize(taskId, 'cancel');
          if (operation === 'read_metadata') return authorize(taskId, 'read');
          return Promise.reject(denied());
        } };
        const scopedTasks = new AiTaskRepository(dependencies.db, cancellationAuthority, clock);
        const access = await scopedTasks.resolveAccess(before.taskId, 'read_metadata');
        const task = await dependencies.db.aiTask.findFirst({ where: access.where,
          select: { id: true, revision: true, status: true } });
        if (!task || task.id !== before.taskId) throw denied();
        if (task.status !== 'CANCEL_REQUESTED') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const receipt = await new AiTaskTransitionRepository(dependencies.db, cancellationAuthority, clock)
          .settleInputCancellation({ taskId: before.taskId, expectedRevision: task.revision,
            to: 'cancelled', reason: 'cancel_settled' }, PrismaTaskInputRepository.releasedCancellationWitness(db, scopedTasks, clock));
        const after = await readGrant(before.taskId, 'read');
        if (identityHash(before.context) !== identityHash(after.context)) throw denied();
        return freezeOriginalInput({ receipt, cancellation: 'released_input_wait_settled' as const,
          externalRollback: 'not_claimed' as const, retryable: false as const });
      }, async request(value: unknown) {
      const parsed = z.object({ expectedRevision: z.number().int().min(1).max(4294967294) }).strict()
        .safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const before = await readGrant(null, 'cancel');
      const cancellationAuthority: AiTaskRepositoryAuthority = { resolve: (taskId, operation) => {
        if (taskId !== before.taskId || operation !== 'transition_task') return Promise.reject(denied());
        return authorize(taskId, 'cancel');
      } };
      const receipt = await new AiTaskTransitionRepository(dependencies.db, cancellationAuthority, clock).transition({
        taskId: before.taskId, expectedRevision: parsed.data.expectedRevision,
        to: 'cancel_requested', reason: 'cancel_requested' });
      const after = await readGrant(before.taskId, 'cancel');
      if (identityHash(before.context) !== identityHash(after.context)) throw denied();
      return freezeOriginalInput({ receipt, cancellation: 'requested_not_rollback' as const,
        retryable: false as const, nextAction: 'read_original_task' as const });
    } }),
    execution: Object.freeze({ authorize: (taskId: string) => authorize(taskId, 'execute'),
      readOriginalGrant: () => readGrant(null, 'read'),
      authorizeAccounting: (taskId: string) => authorize(taskId, 'accounting'),
      readGrant: (taskId: string, operation: 'read' | 'execute' | 'accounting') => readGrant(taskId, operation) }) });
}
