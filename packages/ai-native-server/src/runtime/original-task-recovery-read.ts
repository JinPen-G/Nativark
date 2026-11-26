/** Bounded original Task recovery observation. No lease, continuation or budget action. */
import type { Prisma } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS, AI_ORIGINAL_TASK_RECOVERY_SCHEMAS, type AiSceneRequestReadDraft,
  type AiSceneRequestRecoveryDraft, type AiSceneTaskReceiptDraft } from '@rental-os/platform-contracts/ai-original-result';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../task-errors';
import { aiTaskAccessFromContext } from './task-owner-access';
import type { AiOriginalResultReadLease } from './original-result-reads';

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validQuery = ajv.compile<AiSceneRequestReadDraft>(AI_ORIGINAL_RESULT_LOCATOR_SCHEMAS.AiSceneRequestReadDraft);
const validResult = ajv.compile<AiSceneRequestRecoveryDraft>(AI_ORIGINAL_TASK_RECOVERY_SCHEMAS.AiSceneRequestRecoveryDraft);
const select = { id: true, runId: true, actionId: true, status: true, effect: true, revision: true, resultRef: true } satisfies Prisma.AiStepSelect;
const identity = ({ requestId: _request, authorizedAt: _at, ...binding }: AiExecutionContext) => requestFingerprint(binding);
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export interface AiOriginalTaskRecoverySources extends AiOriginalResultReadLease {
  /** Actual original-input receipt lookup, including current reader/resource authority. */
  readTaskReceipt(inputRef: string): Promise<AiSceneTaskReceiptDraft>;
  readTaskLocator(reference: AiSceneRequestReadDraft): Promise<{ material: 'retained' | 'erased'; receipt: { state: string };
    task: AiSceneTaskReceiptDraft; context: AiExecutionContext }>;
  resolveMetadataAccess(taskId: string): Promise<{ where: Prisma.AiTaskWhereInput; bindingKey: string }>;
}

export function createOriginalTaskRecoveryRead(db: Pick<Prisma.TransactionClient, 'aiStep'>, source: AiOriginalTaskRecoverySources,
  clock: () => Date = () => new Date()) {
  const readReceipt = source.readTaskReceipt.bind(source), locate = source.readTaskLocator.bind(source);
  const taskAccess = source.resolveMetadataAccess.bind(source), currentAuthority = source.assertCurrent.bind(source);
  const findSteps = db.aiStep.findMany.bind(db.aiStep);
  return async (value: unknown, signal: AbortSignal): Promise<AiSceneRequestRecoveryDraft> => {
    const ref: unknown = structuredClone(value);
    if (!validQuery(ref)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const live = async () => { if (signal.aborted) throw denied(); await currentAuthority(); if (signal.aborted) throw denied(); };
    const finish = async (result: unknown) => {
      await live();
      if (!validResult(result)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return structuredClone(result);
    };
    const steps = async <T>(work: () => PromiseLike<T>): Promise<T> => {
      await live();
      try { return await work(); } catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
    };
    await live();
    const task = await readReceipt(ref.inputRef);
    if (task.state === 'not_observed') return finish({ task, nextAction: 'reconcile_request_or_explicit_create_task', automaticExecution: false });
    const metadata = { automaticExecution: false, observedResults: 'preserved_even_if_task_cancelled', snapshot: 'bounded_sequential_read' };
    if (task.status === 'queued' && task.revision === 1 && task.plan === 'not_observed' && !task.resultAvailable) {
      // An untouched metadata-only Task can be observed under the original
      // request's current authority, before it receives its first action policy.
      const before = await locate(ref);
      const verify = (observation: typeof before) => {
        if (observation.material !== 'retained' || observation.receipt.state === 'revoked' || observation.task.state !== 'observed'
          || requestFingerprint(observation.task) !== requestFingerprint(task)) throw changed();
      };
      verify(before);
      const access = aiTaskAccessFromContext(before.context, task.taskId, clock());
      const existing = await steps(() => findSteps({ where: { taskId: task.taskId, task: { is: access.where } }, take: 1, select: { id: true } }));
      const after = await locate(ref); verify(after);
      if (identity(before.context) !== identity(after.context)) throw changed();
      if (!existing.length) return finish({ ...metadata, task: after.task, steps: [], hasMore: false, nextAction: 'host_plan_handoff' });
    }
    await live();
    const access = await taskAccess(task.taskId);
    const rows = await steps(() => findSteps({ where: { taskId: task.taskId, task: { is: access.where } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 51, select }));
    const latest = await readReceipt(ref.inputRef);
    if (latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision)
      throw changed();
    // The final receipt await can outlast the persisted metadata policy.
    if ((await taskAccess(task.taskId)).bindingKey !== access.bindingKey) throw denied();
    return finish({ ...metadata, task: latest, steps: rows.slice(0, 50).map(row => ({
      stepId: row.id, runId: row.runId, actionId: row.actionId, revision: row.revision, status: row.status.toLowerCase(),
      effect: row.effect.toLowerCase(), resultAvailable: row.resultRef !== null,
      nextAction: row.status === 'UNKNOWN' || row.status === 'RUNNING' && row.effect === 'POSSIBLE' ? 'reconcile_original_action'
        : row.status === 'SUCCEEDED' ? 'read_authorized_result' : 'runner_owned'
    })), hasMore: rows.length > 50, nextAction: task.plan === 'not_observed' ? 'host_plan_handoff' : 'existing_runner_recovery' });
  };
}
