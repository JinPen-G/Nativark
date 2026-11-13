/** Explicit operator workbench controls around the existing pure model host.
 * New generation, original observation and cancellation stay distinct. This
 * service never runs a business tool or retries an existing operation. */
import { AiTaskRepositoryError } from './ai-task.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { originalIdentityHash, type AiOriginalRequestAuthority } from './task-request/original-request.authority';
import type { composeTaskModelHost } from './runner/model-task-host.composition';
import type { WorkbenchModelControlRepository } from './workbench-model-control.repository';
import type { WorkbenchModelControlSource, WorkbenchModelControlPreparedSource } from './workbench-model-control.source';
import { WORKBENCH_MODEL_CONTROL_VERSION, workbenchModelControlCommandSchema, workbenchModelControlReferenceSchema,
  parseWorkbenchModelControl, type WorkbenchModelControlCommand, type WorkbenchModelControlReceipt,
  type WorkbenchModelControlObservation, type WorkbenchModelControlOriginReader } from './workbench-model-control.contract';

export interface WorkbenchModelControlDependencies {
  repository: WorkbenchModelControlRepository;
  source: WorkbenchModelControlSource;
  /** Request-bound current business/model policy and budget preflight. It
   * cannot be inferred from an old result or from an operation-log receipt. */
  authority: Pick<AiOriginalRequestAuthority, 'create'>;
  /** The normal model host, configured for ai.model.text only. Its original
   * Gateway, metering, preparation and Task resource gates remain in charge. */
  build(input: { receipt: WorkbenchModelControlReceipt;
    material: ReturnType<WorkbenchModelControlSource['material']>;
    revalidate: () => Promise<ReturnType<WorkbenchModelControlSource['material']>>;
    readOrigin: WorkbenchModelControlOriginReader;
    readPreparationOrigin: WorkbenchModelControlSource['readPreparationOrigin'] }): Promise<ReturnType<typeof composeTaskModelHost>>;
}
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export class WorkbenchModelControlService {
  constructor(private readonly input: WorkbenchModelControlDependencies) {
    if (typeof input?.authority?.create !== 'function' || typeof input.build !== 'function'
      || typeof input.repository?.register !== 'function' || typeof input.source?.revalidate !== 'function') throw unavailable();
  }
  private async authorize(source: WorkbenchModelControlPreparedSource) {
    // This is the original current scene/resource/subscription preflight. It
    // creates no original request or Task and changes no old receipt lifetime.
    const access = await this.input.authority.create(source.original.request);
    if (access.context.audience !== 'operator' || access.context.actor.kind !== 'user' || access.context.scope.kind !== 'workspace'
      || access.scopeId !== source.scopeId || originalIdentityHash(access.context) !== source.identityHash
      || access.sceneVersion !== source.original.witness.binding.capabilityVersion
      || !Number.isFinite(Date.parse(access.expiresAt)) || Date.parse(access.expiresAt) <= Date.parse(access.context.authorizedAt)) throw denied();
  }
  async read(value: unknown): Promise<WorkbenchModelControlObservation> {
    const reference = parseWorkbenchModelControl(workbenchModelControlReferenceSchema, value);
    const observed = await this.input.repository.read(reference), receipt = observed.receipt;
    const base = { version: WORKBENCH_MODEL_CONTROL_VERSION, ...reference, nextAction: 'read_original_operation' as const };
    if (!receipt) return { ...base, status: 'not_observed' };
    const bound = { ...base, operationLogId: receipt.operationLogId, kind: receipt.command.kind, runId: receipt.runId,
      sourceRunId: receipt.command.sourceRunId, sourceResultId: receipt.command.sourceResultId,
      presentationRevision: receipt.presentationRevision };
    if (!observed.run) throw unavailable();
    if (observed.uncertain || observed.step?.status === 'UNKNOWN') return { ...bound, status: 'unknown' };
    if (observed.run.status === 'SUCCEEDED' && observed.step?.status === 'SUCCEEDED' && observed.resultId) {
      // The original source reader includes current read authorization, the
      // actual completed model/financial evidence and the frozen field witness.
      await this.input.source.readResult(receipt, observed.resultId);
      const closing = await this.input.repository.read(reference);
      if (closing.current.identityHash !== observed.current.identityHash
        || closing.run?.revision !== observed.run.revision || closing.step?.revision !== observed.step.revision
        || closing.resultId !== observed.resultId) throw denied();
      return { ...bound, status: 'available', resultId: observed.resultId };
    }
    if (observed.run.status === 'FAILED' || observed.run.status === 'CANCELLED') return { ...bound, status: 'failed' };
    return { ...bound, status: !observed.started && !observed.step ? 'registered' : 'running' };
  }
  async execute(value: unknown, signal?: AbortSignal): Promise<WorkbenchModelControlObservation> {
    const command = parseWorkbenchModelControl(workbenchModelControlCommandSchema, value);
    const reference = { taskId: command.taskId, operationId: command.operationId };
    const existing = await this.input.repository.read(reference);
    if (existing.receipt) {
      if (existing.receipt.commandHash !== requestFingerprint(command)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      return this.read(reference);
    }
    if (signal?.aborted) throw unavailable();
    const source = await this.input.source.prepare(command);
    await this.authorize(source);
    await this.input.source.revalidate(command, source);
    if (signal?.aborted) throw unavailable();
    const registered = await this.input.repository.register(command, source);
    if (!registered.created) return this.read(reference);
    const receipt = registered.receipt;
    try {
      const revalidate = async () => {
        const current = await this.input.source.revalidate(command, source);
        await this.authorize(current);
        const latest = await this.input.repository.read(reference);
        if (!latest.receipt || latest.receipt.commandHash !== receipt.commandHash || signal?.aborted) throw denied();
        return this.input.source.material(receipt, current);
      };
      const material = await revalidate();
      const root = await this.input.build({ receipt, material, revalidate,
        readOrigin: (tx, access, key) => this.input.source.readOrigin(tx, access, key),
        readPreparationOrigin: key => this.input.source.readPreparationOrigin(key) });
      if (signal?.aborted) throw unavailable();
      await revalidate();
      await root.application.start({ taskId: command.taskId, runId: receipt.runId }, signal);
      return await this.read(reference);
    } catch (error) {
      // Registration may already be committed and model dispatch may be
      // unknown. Preserve the original operation; never invoke build/start
      // from a duplicate request or turn a timeout into not_observed.
      try { return await this.read(reference); }
      catch {
        const current = await this.input.repository.current(command.taskId);
        if (current.identityHash !== receipt.identityHash) throw denied();
        if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
        return { version: WORKBENCH_MODEL_CONTROL_VERSION, ...reference, status: 'unknown',
          operationLogId: receipt.operationLogId, kind: command.kind, runId: receipt.runId,
          sourceRunId: command.sourceRunId, sourceResultId: command.sourceResultId,
          presentationRevision: receipt.presentationRevision, nextAction: 'read_original_operation' };
      }
    }
  }
}
