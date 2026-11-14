import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { AiTaskEventRepository } from '../ai-task-event.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { AiTaskRepository, AiTaskRepositoryError,
  type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { PrismaTaskApplication, waitForTaskApplicationDependency } from '../runner/prisma-task-application';
import { PrismaTaskRecoverySnapshotRepository } from '../runner/prisma-task-recovery-snapshot.repository';
import { composeApprovedSettingsApplication } from '../approval-execution/approved-settings-application.composition';
import { composeApprovedSettingsWaiting } from '../approval-execution/approved-settings-waiting.executor';
import { ApprovedSettingsResultUnknownError } from '../../rental-core/approved-settings-change.ports';
import { AI_APPROVED_SETTINGS_DRAFT_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { composeRequestBoundSettingsTaskCreation, type AiSceneHttpRequest,
  type AiSceneRequestOptions } from './request-bound-scenes.application';
import { bindOriginalSettingsRead } from './settings-original-read.authority';

const key = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const reference = z.object({ creationKey: key, changeKey: key }).strict();
const events = reference.extend({ after: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u),
  limit: z.number().int().min(1).max(100) }).strict();
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

/** Original owner reference -> existing persistent snapshot/event readers.
 * No current plan, Gateway, admission, lease or execution driver is constructed.
 * Current Core change access and its original creation receipt authorize only
 * metadata, events and terminal receipts, independently of execution-policy TTL. */
export function composeRequestBoundSettingsTaskReads(
  dependencies: Parameters<typeof composeRequestBoundSettingsTaskCreation>[0], options: AiSceneRequestOptions) {
  const selected = z.object({ enabled: z.boolean(), audience: z.literal('operator') }).strict().safeParse(structuredClone(options));
  if (!selected.success || 'credentials' in dependencies || 'originalReadAuthority' in dependencies)
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const server = { ...dependencies, scene: freezeOriginalInput(structuredClone(dependencies.scene)) };
  const creation = selected.data.enabled ? composeRequestBoundSettingsTaskCreation(server, selected.data) : undefined;
  const clock = dependencies.clock ?? (() => new Date());
  const consume = async <T>(request: AiSceneHttpRequest, original: z.infer<typeof reference>,
    read: (center: { tasks: AiTaskRepository; events: AiTaskEventRepository }, taskId: string, runId: string,
      change: { changeId: string; changeHash: string }, bound: typeof server & {
        credentials: AiTaskCredentialSource; originalReadAuthority: AiTaskRepositoryAuthority }) => Promise<T>) => {
    if (!creation) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const authorization = bearer.safeParse(request?.headers?.authorization);
    if (!authorization.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const boundRequest = { headers: { authorization: authorization.data } };
    const credential = Object.freeze({ authorization: authorization.data, audience: 'operator' as const, requestId: randomUUID() });
    let active = true;
    const credentials = { current: async () => {
      if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { ...credential };
    } };
    try {
      return await waitForTaskApplicationDependency(() => runWithRequestIdentity({}, async () => {
        const identity = new AiTaskCurrentIdentityAuthority(server.auth, credentials, clock);
        const before = await identity.resolve();
        const bound = await bindOriginalSettingsRead({ ...server, credentials }, original, value => creation.read(boundRequest, value));
        const originalReadAuthority = bound.authority;
        // This authority is kept in the request closure and is never returned
        // as a policy, approval, lease or reusable execution credential.
        const center = { tasks: new AiTaskRepository(server.db, originalReadAuthority, clock),
          events: new AiTaskEventRepository(server.db, originalReadAuthority, clock) };
        const result = structuredClone(await read(center, bound.task.taskId, bound.task.runId,
          bound.original, { ...server, credentials, originalReadAuthority }));
        await bound.verify();
        const latest = await creation.read(boundRequest, original);
        const after = await identity.resolve();
        if (originalIdentityHash(before) !== originalIdentityHash(after)
          || !('state' in latest.receipt) || latest.receipt.state !== 'observed' || !latest.receipt.task
          || latest.receipt.task.taskId !== bound.task.taskId || latest.receipt.task.runId !== bound.task.runId
          || latest.original.changeId !== bound.original.changeId || latest.original.changeHash !== bound.original.changeHash) {
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        }
        // Legitimate concurrent task transitions do not invalidate an already
        // consistent repository snapshot. Its exact watermark remains intact.
        return freezeOriginalInput(result);
      }), false);
    } finally { active = false; }
  };
  return Object.freeze({
    readResult(request: AiSceneHttpRequest, value: unknown) {
      const parsed = reference.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return consume(request, freezeOriginalInput(parsed.data), async (center, taskId, runId, change, bound) => {
        const input = { taskId, runId };
        const recovery = new PrismaTaskRecoverySnapshotRepository(bound.db, center.tasks);
        const snapshot = await recovery.read(input);
        // Confirmation continuation ends in a phase receipt, not a model
        // artifact. Preserve the original workflow projection and do not try
        // to decode that receipt through the artifact-only result reader.
        if (snapshot.steps.length > 1 || snapshot.steps.some(step =>
          step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
          || step.inputRef !== change.changeId || step.fingerprint !== change.changeHash))
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const source = composeApprovedSettingsWaiting(bound);
        const readOperation = async () => {
          if (snapshot.steps.length === 0) return null;
          try { return await source.readCommittedChange({ taskId, ...change }); }
          catch (error) {
            if (!(error instanceof ApprovedSettingsResultUnknownError)) throw error;
            throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
          }
        };
        // The existing reader derives the original key from THIS task/step,
        // then verifies Core receipt + approval consumption. No caller key or
        // latest workspace operation can stand in for this original action.
        const operation = await readOperation();
        if (requestFingerprint(await recovery.read(input)) !== requestFingerprint(snapshot)
          || requestFingerprint(await readOperation()) !== requestFingerprint(operation))
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return freezeOriginalInput({ snapshot, operation,
          businessOutcome: operation ? 'committed' as const
            : snapshot.steps.some(step => step.status === 'unknown' || ['possible', 'committed'].includes(step.effect)) ? 'unknown' as const : 'not_observed' as const,
          originalOperation: snapshot.steps.length ? 'original_task_step_key_read' as const : 'no_registered_step' as const,
          execution: 'not_invoked' as const, automaticRetry: false as const });
      });
    },
    readConfirmation(request: AiSceneHttpRequest, value: unknown) {
      const parsed = reference.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return consume(request, freezeOriginalInput(parsed.data), async (center, taskId, runId, change, bound) => {
        const snapshot = await center.events.readSnapshot({ taskId });
        if (snapshot.status !== 'waiting_confirmation') {
          const recovery = new PrismaTaskRecoverySnapshotRepository(bound.db, center.tasks);
          const original = await recovery.read({ taskId, runId });
          const steps = original.steps;
          if (steps.length > 1 || steps.some(step => step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE
            || step.toolVersion !== AI_TOOL_DRAFT_VERSION || step.inputRef !== change.changeId || step.fingerprint !== change.changeHash))
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const history = steps.length ? await PrismaTaskApplication.readConfirmationHistory(
            { db: bound.db, tasks: center.tasks }, { taskId, runId, stepId: steps[0].stepId }) : null;
          if (requestFingerprint(await center.events.readSnapshot({ taskId })) !== requestFingerprint(snapshot)
            || requestFingerprint(await recovery.read({ taskId, runId })) !== requestFingerprint(original))
            throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          return freezeOriginalInput({ state: 'not_waiting' as const, snapshot, history,
            execution: 'not_attested' as const, continuation: 'not_invoked' as const });
        }
        const steps = snapshot.steps.filter(step => step.runId === runId && step.status === 'running');
        if (steps.length !== 1) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const originalWait = { taskId, runId, stepId: steps[0].stepId };
        const checkpoint = await PrismaTaskApplication.readConfirmation({ db: bound.db, tasks: center.tasks }, originalWait);
        const proposal = { draftVersion: AI_APPROVED_SETTINGS_DRAFT_VERSION, taskId,
          proposalId: checkpoint.proposal.proposalId, proposalRevision: checkpoint.proposal.proposalRevision,
          reviewedPayloadHash: checkpoint.proposal.reviewedPayloadHash };
        const settings = composeApprovedSettingsApplication(bound);
        const review = await settings.readProposal(proposal), decision = await settings.readDecisionReceipt(proposal);
        if (review.change.changeId !== change.changeId || review.change.changeHash !== change.changeHash)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const current = await PrismaTaskApplication.readConfirmation({ db: bound.db, tasks: center.tasks }, originalWait);
        if (requestFingerprint(current) !== requestFingerprint(checkpoint)
          || requestFingerprint(await settings.readProposal(proposal)) !== requestFingerprint(review)
          || requestFingerprint(await settings.readDecisionReceipt(proposal)) !== requestFingerprint(decision))
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return freezeOriginalInput({ state: 'waiting_confirmation' as const, checkpoint, reference: proposal,
          review, decision, execution: 'not_attested' as const, continuation: 'not_invoked' as const });
      });
    },
    readSnapshot(request: AiSceneHttpRequest, value: unknown) {
      const parsed = reference.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return consume(request, freezeOriginalInput(parsed.data), (center, taskId) => center.events.readSnapshot({ taskId }));
    },
    readEvents(request: AiSceneHttpRequest, value: unknown) {
      const parsed = events.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = freezeOriginalInput(parsed.data);
      return consume(request, { creationKey: command.creationKey, changeKey: command.changeKey },
        (center, taskId) => center.events.readPage({ taskId, after: command.after, limit: command.limit }));
    }
  });
}
