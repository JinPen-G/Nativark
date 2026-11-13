/** Closed task-center recovery transport. The server selects the original
 * host; each write binds the reviewed Task, Run, plan and CAS. Credential
 * refresh cannot replay a mutation, and reads never acquire a lease. */
import { AI_TASK_CENTER_RECOVERY_HTTP, AI_TASK_CENTER_RECOVERY_CONTRACTS, validateAiTaskCenterRecoveryValue,
  type ApiResult, type AiSceneRequestReadDraft, type AiTaskRecoveryCommandDraft,
  type AiTaskRecoveryReceiptQueryDraft } from '@rental-os/shared';
import { http } from './http';
import { currentSessionEpoch, currentSessionSignal } from '@/app/queryClient';
import { useAuthStore } from '@/features/auth/authStore';
import { AI_EXECUTION_RESPONSE_TIMEOUT_MS } from './aiRequestTiming';
import { parseTaskRecoverySnapshot, parseTaskRecoveryOutcome, parseTaskTakeoverReceipt,
  parseTaskRecoveryOperation, sameTaskRecovery, type TaskRecoveryAction, type TaskRecoveryTarget,
  type TaskRecoveryOperation, type TaskRecoveryPort, type TaskRecoveryLocator } from '@/features/ai-native/task-recovery-session';

type Action = keyof typeof AI_TASK_CENTER_RECOVERY_CONTRACTS;
async function post(action: Action, body: unknown, signal: AbortSignal): Promise<unknown> {
  const contract = AI_TASK_CENTER_RECOVERY_CONTRACTS[action];
  const command: unknown = structuredClone(body);
  if (!validateAiTaskCenterRecoveryValue(contract.request, command)) throw Error('AI_INVALID_INPUT');
  const epoch = currentSessionEpoch(), auth = useAuthStore.getState(), owner = JSON.stringify([auth.user, auth.tenant?.tenantId, auth.currentWorkspaceId]);
  const active = AbortSignal.any([signal, currentSessionSignal()]);
  const check = () => {
    const current = useAuthStore.getState();
    if (active.aborted || epoch !== currentSessionEpoch() || !current.token || !current.user || current.user.isSaasAdmin
      || !current.tenant?.tenantId || !current.currentWorkspaceId
      || JSON.stringify([current.user, current.tenant.tenantId, current.currentWorkspaceId]) !== owner) throw Error('AI_SCOPE_CHANGED');
  };
  check();
  const response = await http.post<ApiResult<unknown>>(`/${AI_TASK_CENTER_RECOVERY_HTTP.basePath}/${AI_TASK_CENTER_RECOVERY_HTTP[action]}`,
    command, { signal: active, timeout: contract.write ? AI_EXECUTION_RESPONSE_TIMEOUT_MS : 15000,
      ...(contract.write ? { _authRetry: true } : {}) });
  check();
  const value: unknown = structuredClone(response.data.data);
  if (!validateAiTaskCenterRecoveryValue(contract.response, value)) throw Error(contract.write ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE');
  return value;
}
const locate: TaskRecoveryLocator = async (taskId, signal) => {
  const value = await post('target', { taskId }, signal);
  if (!validateAiTaskCenterRecoveryValue('AiTaskRecoveryTargetDraft', value) || value.taskId !== taskId) throw Error('AI_SCOPE_CHANGED');
  if (value.status !== 'available') throw Error('AI_RESOURCE_UNAVAILABLE');
  const snapshot = parseTaskRecoverySnapshot(value.snapshot, taskId, value.runId);
  if (!snapshot.plan || snapshot.plan.planHash !== value.planHash || value.host === 'opening_read' && value.actions.length !== 0)
    throw Error('AI_RESOURCE_UNAVAILABLE');
  return { original: value.original, host: value.host, snapshot, actions: [...value.actions] };
};
async function snapshot(original: AiSceneRequestReadDraft, taskId: string, runId: string, signal: AbortSignal) {
  const value = await post('snapshot', { taskId, runId }, signal);
  if (!validateAiTaskCenterRecoveryValue('AiSceneModelRecoverySnapshotReadResponse', value)
    || !sameTaskRecovery(value.original, original)) throw Error('AI_SCOPE_CHANGED');
  return parseTaskRecoverySnapshot(value.snapshot, taskId, runId);
}
async function execute(action: TaskRecoveryAction, target: TaskRecoveryTarget, signal: AbortSignal) {
  if (!target.actions.includes(action) || target.host === 'opening_read') throw Error('AI_RESOURCE_UNAVAILABLE');
  const observed = parseTaskRecoverySnapshot(target.snapshot, target.snapshot.task.taskId);
  if (!observed.plan) throw Error('AI_RESOURCE_UNAVAILABLE');
  const command: AiTaskRecoveryCommandDraft = { taskId: observed.task.taskId, runId: observed.run.runId, planHash: observed.plan.planHash,
    expectedTaskRevision: observed.task.revision, expectedRunRevision: observed.run.revision, expectedFencingToken: observed.run.fencingToken };
  const value = await post(action, command, signal);
  if (!validateAiTaskCenterRecoveryValue('AiTaskRecoveryResultDraft', value)
    || value.taskId !== command.taskId || value.runId !== command.runId) throw Error('AI_RESULT_UNKNOWN');
  return parseTaskRecoveryOutcome(value.outcome);
}
async function takeoverReceipt(value: TaskRecoveryOperation, signal: AbortSignal) {
  const operation = parseTaskRecoveryOperation(value, value.taskId);
  const command: AiTaskRecoveryReceiptQueryDraft = { taskId: operation.taskId, runId: operation.runId,
    expectedTaskRevision: operation.expectedTaskRevision, expectedRunRevision: operation.expectedRunRevision,
    expectedFencingToken: operation.expectedFencingToken };
  const result = await post('receipt', command, signal);
  if (!validateAiTaskCenterRecoveryValue('AiTaskRecoveryReceiptDraft', result) || result.taskId !== operation.taskId
    || result.runId !== operation.runId || !sameTaskRecovery(result.original, operation.original)) throw Error('AI_SCOPE_CHANGED');
  return parseTaskTakeoverReceipt(result.receipt, operation);
}
export const aiTaskRecoveryApi: TaskRecoveryPort & { locate: TaskRecoveryLocator } = Object.freeze({ locate, snapshot, execute, takeoverReceipt });
