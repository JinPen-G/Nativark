/** Public Runner aggregate commits under the original request and Native lease.
 * Persisted Steps decide outcomes; this entry grants no tool or business action. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { createPublicTenantTaskAuthority } from './public-tenant-task-authority';
import type { createPublicAiTaskPersistence } from './task-persistence';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionBoundary } from './task-transactions';
import { AiTaskRepositoryError } from './task-errors';
import { aiTaskAccessFromContext } from './runtime/task-owner-access';
import { isAiStepExecutionContext } from './execution-context-validation';
import { AiTaskTransitionResultUnknownError, lockTaskTransition, recordTaskTransition,
  taskTransitionCommandSchema, taskTransitionSelect } from './runtime/task-transition-commit';
import { createAiTaskRunnerOutcomePort } from './runtime/runner/ai-task-runner-outcome-adapter';

export { AiTaskTransitionResultUnknownError } from './runtime/task-transition-commit';
type BoundAuthority = Awaited<ReturnType<ReturnType<typeof createPublicTenantTaskAuthority>['bind']>>;
type Operation = 'transition_task' | 'read_step_terminal';
const transactionOptions = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 } as const;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Supply one request binding and the same strict boundary as Task/Step/Gateway.
 * Pauses requiring input/approval and cancellation retain their own repositories. */
export function createPublicAiTaskTransitions(input: {
  db: Pick<PrismaClient, '$transaction'>;
  transactions: AiTaskTransactionBoundary<Prisma.TransactionClient>;
  authority: Pick<BoundAuthority, 'actions' | 'actionOn' | 'transaction'>;
  clock?: () => Date;
}) {
  if (!isStrictAiTaskTransactionBoundary(input?.transactions) || typeof input.db?.$transaction !== 'function'
    || typeof input.authority?.actions?.resolve !== 'function' || typeof input.authority.actionOn !== 'function'
    || !input.authority.transaction?.binding || typeof input.authority.transaction.begin !== 'function')
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { db, transactions, authority } = input, clock = input.clock ?? (() => new Date());
  const resolve = async (taskId: string, operation: Operation, tx?: Prisma.TransactionClient) => {
    try {
      const context = await (tx ? authority.actionOn(tx, taskId, operation) : authority.actions.resolve(taskId, operation));
      if (!isAiStepExecutionContext(context)) throw denied();
      return aiTaskAccessFromContext(context, taskId, clock());
    } catch { throw denied(); }
  };
  return Object.freeze({ async transition(value: unknown) {
    const parsed = taskTransitionCommandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data;
    if (!command.lease || !['running', 'succeeded', 'partially_succeeded', 'failed', 'waiting_external'].includes(command.to))
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const start = command.reason === 'start', operation = start ? 'transition_task' : 'read_step_terminal';
    const before = await resolve(command.taskId, operation);
    let writeAttempted = false, callbackCompleted = false;
    try {
      const result = await transactions.withAiTaskTransactionAuthority(authority.transaction, () => db.$transaction(async tx => {
        const result = await transactions.withAiTaskTransaction(tx,
          { kind: start ? 'task' : 'task_control', taskId: command.taskId }, async () => {
            const task = await tx.aiTask.findFirst({ where: before.where, select: taskTransitionSelect });
            if (!task || task.id !== command.taskId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
            if (!['QUEUED', 'RUNNING', 'WAITING_EXTERNAL'].includes(task.status))
              throw new AiTaskRepositoryError('AI_INVALID_INPUT');
            const rows = await lockTaskTransition(tx, before, task, command, () => { writeAttempted = true; });
            return recordTaskTransition(tx, before, task, rows, command, false,
              () => resolve(command.taskId, operation, tx));
          });
        // The Native participant has also revalidated. A lost COMMIT reply or
        // denied delivery must now be reconciled against the original facts.
        callbackCompleted = true;
        return result;
      }, transactionOptions));
      const after = await resolve(command.taskId, 'read_step_terminal');
      if (after.bindingKey !== before.bindingKey) throw denied();
      return result;
    } catch (error) {
      if (callbackCompleted) throw new AiTaskTransitionResultUnknownError();
      if (error instanceof AiTaskRepositoryError) throw error;
      if (writeAttempted) throw new AiTaskTransitionResultUnknownError();
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  } });
}

/** Preserve the original Runner acknowledgement and read-before-resume rules. */
export function createPublicAiTaskRunnerOutcomePort(transitions: ReturnType<typeof createPublicAiTaskTransitions>,
  tasks: Pick<ReturnType<typeof createPublicAiTaskPersistence>, 'readMetadata'>) {
  return createAiTaskRunnerOutcomePort({ transitions, tasks, commands: { transition: value => value } });
}
