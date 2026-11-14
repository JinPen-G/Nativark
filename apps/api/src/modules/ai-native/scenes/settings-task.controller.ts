import { Body, Controller, Header, HttpCode, Inject, Post, Req, HttpException } from '@nestjs/common';
import { AI_SCENE_MODEL_HTTP_DRAFT as routes } from '@rental-os/shared';
import type { AiSceneHttpRequest, composeRequestBoundOriginalSceneModel, composeRequestBoundSettingsTaskCreation,
  composeRequestBoundSettingsTaskControls, composeRequestBoundSettingsChanges } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';
import { settingsContract } from '../approval-execution/approved-settings-contracts';
import type { composeRequestBoundSettingsTaskReads } from './settings-task-read.composition';

/** Keep internal acknowledgements behind the existing shared contract. A bad
 * post-write reply may already be committed; it can only be observed, not retried. */
function invalidSettingsResponse(writing: boolean): never {
  throw Object.assign(new Error(writing ? 'AI_RESULT_UNKNOWN' : 'AI_STORAGE_UNAVAILABLE'), {
    code: writing ? 'AI_RESULT_UNKNOWN' : 'AI_STORAGE_UNAVAILABLE', retryable: false
  });
}
async function settingsCreationResponse(work: () => Promise<unknown>, body: unknown, writing: boolean) {
  const command = structuredClone(body) as { creationKey?: string };
  const reply = await work();
  try {
    if (writing) return settingsContract('AiApprovedSettingsTaskCreatedDraft', reply, true);
    const result = settingsContract('AiApprovedSettingsTaskCreationReadDraft', reply, true);
    if (result.receipt.creationKey !== command.creationKey) return invalidSettingsResponse(false);
    return result;
  } catch { return invalidSettingsResponse(writing); }
}
async function settingsCancellationResponse(work: () => Promise<unknown>, body: unknown,
  writing: boolean, target: 'cancel_requested' | 'cancelled') {
  const command = structuredClone(body) as { expectedRevision?: number };
  const reply = await work();
  try {
    const result = writing ? settingsContract('AiApprovedSettingsTaskCancellationResultDraft', reply, true)
      : settingsContract('AiApprovedSettingsTaskCancellationReadDraft', reply, true);
    const receipt = result.receipt, event = receipt.event;
    const originalSettlement = !writing && target === 'cancelled';
    const meaning = target === 'cancel_requested' ? 'request_not_rollback'
      : event?.data.to === 'succeeded' || event?.data.to === 'partially_succeeded'
        ? 'request_settled_not_business_rollback' : 'task_cancelled_not_business_rollback';
    if ('expectedRevision' in receipt && (receipt.expectedRevision !== command.expectedRevision
      || receipt.cancellation !== meaning))
      return invalidSettingsResponse(writing);
    if (event && (event.taskRevision !== Number(command.expectedRevision) + 1
      || (originalSettlement ? event.data.from !== 'cancel_requested' || !['cancelled', 'succeeded', 'partially_succeeded'].includes(event.data.to) : event.data.to !== target)
      || event.data.reason !== (target === 'cancel_requested' ? 'cancel_requested' : 'cancel_settled')
      || ('taskId' in receipt && (event.taskId !== receipt.taskId || event.taskRevision > receipt.snapshot.revision
        || BigInt(event.cursor) > BigInt(receipt.snapshot.cursor)
        || originalSettlement && receipt.snapshot.status !== event.data.to)))) return invalidSettingsResponse(writing);
    return result;
  } catch { return invalidSettingsResponse(writing); }
}
type SettingsLifecycleContract = 'AiApprovedSettingsTaskRunDraft' | 'AiApprovedSettingsTaskCheckpointDraft'
  | 'AiApprovedSettingsTaskRecoveryDraft' | 'AiApprovedSettingsTaskCancelResponseDraft' | 'AiApprovedSettingsDecisionReceiptDraft';
async function settingsLifecycleResponse(name: SettingsLifecycleContract, work: () => Promise<unknown>, body: unknown, writing: boolean) {
  const command = structuredClone(body) as Record<string, unknown>;
  const reply = await work();
  try {
    const result = settingsContract(name, reply, true);
    const sameSnapshot = (value: { task: { taskId: string }; run: { runId: string } }) =>
      value.task.taskId === command.taskId && value.run.runId === command.runId;
    if ('checkpointRef' in result && (result.taskId !== command.taskId || result.runId !== command.runId
      || result.stepId !== command.stepId)) return invalidSettingsResponse(writing);
    if ('mode' in result && !sameSnapshot(result.snapshot)) return invalidSettingsResponse(writing);
    if ('approval' in result && (result.approval.proposalId !== command.proposalId
      || result.approval.proposalRevision !== command.proposalRevision || result.approval.payloadHash !== command.reviewedPayloadHash
      || command.decision !== undefined && result.approval.decision !== (command.decision === 'approve' ? 'approved' : 'rejected')))
      return invalidSettingsResponse(writing);
    if ('reconciliation' in result && (result.receipt.event.taskId !== command.taskId
      || result.receipt.event.taskRevision !== Number(command.expectedRevision) + 1
      || result.receipt.event.data.to !== 'cancel_requested' || result.receipt.event.data.reason !== 'cancel_requested'
      || 'mode' in result.reconciliation && !sameSnapshot(result.reconciliation.snapshot))) return invalidSettingsResponse(writing);
    return result;
  } catch { return invalidSettingsResponse(writing); }
}
async function settingsPolicyResponse(work: () => Promise<unknown>, body: unknown, writing: boolean, current = false) {
  const command = structuredClone(body) as { operation: string; expectedRevision: number | null; mutation?: string };
  const reply = await work();
  try {
    const result = writing ? settingsContract('AiApprovedSettingsTaskPolicyMutationDraft', reply, true)
      : current ? settingsContract('AiApprovedSettingsTaskPolicyReadResultDraft', reply, true)
        : settingsContract('AiApprovedSettingsTaskPolicyOperationDraft', reply, true);
    if ('mutation' in result && (result.mutation !== command.mutation || result.expectedRevision !== command.expectedRevision))
      return invalidSettingsResponse(writing);
    const policy = 'state' in result.receipt ? 'policy' in result.receipt ? result.receipt.policy : null : result.receipt;
    if (policy && (policy.operation !== command.operation || !current && policy.revision !== (command.expectedRevision ?? 0) + 1))
      return invalidSettingsResponse(writing);
    return result;
  } catch { return invalidSettingsResponse(writing); }
}

export const AI_SETTINGS_TASK_HTTP_REQUESTS = Symbol('AI_SETTINGS_TASK_HTTP_REQUESTS');
export const AI_SETTINGS_TASK_CREATION_REQUESTS = Symbol('AI_SETTINGS_TASK_CREATION_REQUESTS');
export const AI_SETTINGS_TASK_CONTROL_REQUESTS = Symbol('AI_SETTINGS_TASK_CONTROL_REQUESTS');
export const AI_SETTINGS_CHANGE_REQUESTS = Symbol('AI_SETTINGS_CHANGE_REQUESTS');
export const AI_SETTINGS_TASK_READ_REQUESTS = Symbol('AI_SETTINGS_TASK_READ_REQUESTS');
@Controller(routes.basePath)
export class AiSettingsTaskReadController {
  constructor(@Inject(AI_SETTINGS_TASK_READ_REQUESTS) private readonly reads: ReturnType<typeof composeRequestBoundSettingsTaskReads>) {}
  @Post(routes.readOriginalSettingsResult) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readResult(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(async () => settingsContract('AiApprovedSettingsTaskResultDraft',
      await this.reads.readResult(request, body), true), 'read_original_settings_result');
  }
  @Post(routes.readOriginalSettingsConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readConfirmation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(async () => settingsContract('AiApprovedSettingsTaskConfirmationReadDraft',
      await this.reads.readConfirmation(request, body), true), 'read_settings_task_creation');
  }
  @Post(routes.readOriginalSettingsSnapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSnapshot(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(async () => settingsContract('AiTaskSnapshotDraft',
      await this.reads.readSnapshot(request, body), true), 'read_settings_task_creation');
  }
  @Post(routes.readOriginalSettingsEvents) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readEvents(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(async () => settingsContract('AiApprovedSettingsTaskEventsDraft',
      await this.reads.readEvents(request, body), true), 'read_settings_task_creation');
  }
}
@Controller(routes.basePath)
export class AiSettingsChangeController {
  constructor(@Inject(AI_SETTINGS_CHANGE_REQUESTS) private readonly changes: ReturnType<typeof composeRequestBoundSettingsChanges>) {}
  private respond<T>(work: () => Promise<T>) {
    return respondAiScene(async () => {
      try { return await work(); }
      catch (error) {
        // Original Core validation/CAS errors have no public AI code. Preserve
        // their refusal semantics without exposing domain messages or fields.
        if (error instanceof HttpException && [400, 409].includes(error.getStatus())) {
          const code = error.getStatus() === 400 ? 'AI_INVALID_INPUT' : 'AI_REVISION_CONFLICT';
          throw Object.assign(new Error(code), { code });
        }
        throw error;
      }
    }, 'read_change_receipt');
  }
  @Post(routes.readCurrentSettings) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCurrent(@Req() request: AiSceneHttpRequest, @Body() body: unknown = {}) {
    return this.respond(async () => {
      settingsContract('AiApprovedSettingsCurrentReadDraft', body);
      const reply = await this.changes.readCurrent(request);
      try { return settingsContract('AiApprovedSettingsCurrentDraft', reply, true); }
      catch { return invalidSettingsResponse(false); }
    });
  }
  @Post(routes.prepareOriginalSettingsChange) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const result = await this.changes.prepare(request, body);
      try { return settingsContract('AiApprovedSettingsChangePreparationResultDraft', result, true); }
      catch {
        // Preparation may already be durable. A malformed acknowledgement is
        // not permission to prepare again under a different operation key.
        throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
      }
    });
  }
  @Post(routes.readOriginalSettingsChange) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readReceipt(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return this.respond(async () => {
      const reply = await this.changes.readReceipt(request, body);
      try { return settingsContract('AiApprovedSettingsChangeReceiptDraft', reply, true); }
      catch { return invalidSettingsResponse(false); }
    });
  }
  @Post(routes.readSettingsReconfirmationDifference) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readReconfirmationDifference(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal => {
      const command = settingsContract('AiSettingsReconfirmationReviewDraft', body);
      return settingsContract('AiSettingsReconfirmationDifferenceDraft', await this.changes.readUpdatedDifference(request, command, signal), true);
    }));
  }
  @Post(routes.prepareReconfirmedSettingsChange) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepareReconfirmation(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal => {
      const { decision: _decision, ...command } = settingsContract('AiSettingsReconfirmationPrepareDraft', body);
      const result = await this.changes.prepareReconfirmedChange(request, command, signal);
      try { return settingsContract('AiSettingsReconfirmationPreparedDraft', result, true); }
      catch { return invalidSettingsResponse(true); }
    }));
  }
  @Post(routes.readReconfirmedSettingsChange) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readReconfirmation(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return this.respond(() => withRequestAbort(request, async signal => {
      const command = settingsContract('AiSettingsReconfirmationReadDraft', body);
      return settingsContract('AiSettingsReconfirmationObservationDraft', await this.changes.readReconfirmedChange(request, command, signal), true);
    }));
  }
}
/** Original receipt selects the owned task; the body cannot supply permissions,
 * holder, limits, plan or approval. Configuration remains a guarded CAS action. */
@Controller(routes.basePath)
export class AiSettingsTaskControlController {
  constructor(@Inject(AI_SETTINGS_TASK_CONTROL_REQUESTS) private readonly controls: ReturnType<typeof composeRequestBoundSettingsTaskControls>) {}
  @Post(routes.requestOriginalSettingsCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancellation(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsCancellationResponse(
      () => this.controls.requestCancellation(request, body, signal), body, true, 'cancel_requested')), 'read_original_settings_cancellation');
  }
  @Post(routes.readOriginalSettingsCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsCancellationResponse(() => this.controls.readCancellation(request, body), body, false, 'cancel_requested'));
  }
  @Post(routes.settleUnstartedSettingsCancellation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsCancellationResponse(
      () => this.controls.settleUnstartedCancellation(request, body, signal), body, true, 'cancelled')), 'read_original_settings_cancellation_settlement');
  }
  @Post(routes.readOriginalSettingsCancellationSettlement) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationSettlement(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsCancellationResponse(() => this.controls.readCancellationSettlement(request, body), body, false, 'cancelled'));
  }
  @Post(routes.readSettingsTaskPolicy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsPolicyResponse(() => this.controls.readPolicy(request, body), body, false, true));
  }
  @Post(routes.readSettingsTaskPolicyOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPolicyOperation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsPolicyResponse(() => this.controls.readPolicyOperation(request, body), body, false));
  }
  @Post(routes.configureSettingsTaskPolicy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  configure(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsPolicyResponse(
      () => this.controls.configurePolicy(request, body, signal), body, true)), 'read_settings_task_policy_operation');
  }
  @Post(routes.clearSettingsTaskPolicy) @HttpCode(200) @Header('Cache-Control', 'no-store')
  clear(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsPolicyResponse(
      () => this.controls.clearPolicy(request, body, signal), body, true)), 'read_settings_task_policy_operation');
  }
  @Post(routes.startOriginalSettingsTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsLifecycleResponse('AiApprovedSettingsTaskRunDraft',
      () => this.controls.start(request, body, signal), body, true)), 'read_original_settings_result');
  }
}
/** Metadata producer only. This neither publishes a run plan nor starts work. */
@Controller(routes.basePath)
export class AiSettingsTaskCreationController {
  constructor(@Inject(AI_SETTINGS_TASK_CREATION_REQUESTS) private readonly creation: ReturnType<typeof composeRequestBoundSettingsTaskCreation>) {}
  @Post(routes.createSettingsTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() request: AiSceneHttpRequest & AiRequestAbortSource, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsCreationResponse(
      () => this.creation.create(request, body, signal), body, true)), 'read_settings_task_creation');
  }
  @Post(routes.readSettingsTaskCreation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsCreationResponse(() => this.creation.read(request, body), body, false), 'read_settings_task_creation');
  }
}
export const settingsTaskHttpMethods = Object.freeze(['startSettingsTask', 'readSettingsConfirmation',
  'decideSettingsProposal', 'readSettingsDecision', 'continueSettingsConfirmation', 'reconcileSettingsTask', 'cancelSettingsTask'] as const);
/** Request-bound port only. No model runtime, raw lease, approval grant or Core
 * write is supplied by this Controller; the existing application owns them. */
export type SettingsTaskHttpRequests = Pick<ReturnType<typeof composeRequestBoundOriginalSceneModel>, typeof settingsTaskHttpMethods[number]>;
type RunRequest = AiSceneHttpRequest & AiRequestAbortSource;

@Controller(routes.basePath)
export class AiSettingsTaskController {
  constructor(@Inject(AI_SETTINGS_TASK_HTTP_REQUESTS) private readonly requests: SettingsTaskHttpRequests) {}
  @Post(routes.startSettingsTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  startSettingsTask(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsLifecycleResponse('AiApprovedSettingsTaskRunDraft',
      () => this.requests.startSettingsTask(request, body, signal), body, true)));
  }
  @Post(routes.readSettingsConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSettingsConfirmation(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsLifecycleResponse('AiApprovedSettingsTaskCheckpointDraft',
      () => this.requests.readSettingsConfirmation(request, body), body, false));
  }
  @Post(routes.decideSettingsProposal) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decideSettingsProposal(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsLifecycleResponse('AiApprovedSettingsDecisionReceiptDraft',
      () => this.requests.decideSettingsProposal(request, body, signal), body, true)), 'read_decision_receipt');
  }
  @Post(routes.readSettingsDecision) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSettingsDecision(@Req() request: AiSceneHttpRequest, @Body() body: unknown) {
    return respondAiScene(() => settingsLifecycleResponse('AiApprovedSettingsDecisionReceiptDraft',
      () => this.requests.readSettingsDecision(request, body), body, false), 'read_decision_receipt');
  }
  @Post(routes.continueSettingsConfirmation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueSettingsConfirmation(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsLifecycleResponse('AiApprovedSettingsTaskRunDraft',
      () => this.requests.continueSettingsConfirmation(request, body, signal), body, true)));
  }
  @Post(routes.reconcileSettingsTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcileSettingsTask(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsLifecycleResponse('AiApprovedSettingsTaskRecoveryDraft',
      () => this.requests.reconcileSettingsTask(request, body, signal), body, true)));
  }
  @Post(routes.cancelSettingsTask) @HttpCode(200) @Header('Cache-Control', 'no-store')
  cancelSettingsTask(@Req() request: RunRequest, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => settingsLifecycleResponse('AiApprovedSettingsTaskCancelResponseDraft',
      () => this.requests.cancelSettingsTask(request, body, signal), body, true)), 'read_original_settings_cancellation');
  }
}
