/** Closed wire contracts for the original staff task and its human-input and
 * cancellation receipts. The request-bound application owns task selection;
 * validation never grants recognition, a run lease or inspection submission. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_INSPECTION_DRAFT_SCHEMAS, AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS, AI_INSPECTION_TASK_HTTP_CONTRACTS,
  AI_TASK_INPUT_DRAFT_SCHEMAS, AI_TASK_RECOVERY_HTTP_SCHEMAS, isAiTaskInputSubmissionDraft, isAiTaskInputContractDraft,
  type AiInspectionRecognitionTaskReference, type AiInspectionRecognitionTaskResumeRequest,
  type AiInspectionRecognitionTaskCancelRequest, type AiInspectionTaskCancellationObservation,
  type AiInspectionTaskCancelResponse, type AiInspectionTaskSettlementResponse, type AiInspectionTaskCreationObservation,
  type AiInspectionTaskAnswerObservation, type AiInspectionTaskPendingInputResponse, type AiInspectionTaskResumeResponse,
  type AiInspectionTaskContinueResponse, AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS,
  type AiInspectionTaskPolicyRequest, type AiInspectionTaskPolicyConfigureRequest,
  type AiInspectionTaskPolicyReadResponse, type AiInspectionTaskPolicyChangeResponse } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { InspectionAssistError } from './inspection-assist.validation';

type Action = keyof typeof AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS;
type Response = AiInspectionTaskCancellationObservation | AiInspectionTaskCancelResponse | AiInspectionTaskSettlementResponse;
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
    ? child.replace(/^#\/components\/schemas\//u, '#/$defs/') : refs(child)])) : value;
const ajv = new Ajv({ strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const definitions = refs({ ...AI_INSPECTION_DRAFT_SCHEMAS, ...AI_TASK_INPUT_DRAFT_SCHEMAS, ...AI_TASK_RECOVERY_HTTP_SCHEMAS });
const compile = (name: string) => ajv.compile({ $defs: definitions, $ref: `#/$defs/${name}` });
const request = compile('AiInspectionRecognitionTaskCancelRequest');
const responses = Object.fromEntries(Object.entries(AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS)
  .map(([action, contract]) => [action, compile(contract.response)]));
type TaskAction = keyof typeof AI_INSPECTION_TASK_HTTP_CONTRACTS;
const tasks = Object.fromEntries(Object.entries(AI_INSPECTION_TASK_HTTP_CONTRACTS)
  .map(([action, contract]) => [action, { request: compile(contract.request), response: compile(contract.response) }]));
export function inspectionTaskRequest(action: TaskAction, value: unknown): AiInspectionRecognitionTaskReference | AiInspectionRecognitionTaskResumeRequest {
  let copy;
  try { copy = structuredClone(value); } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
  if (!tasks[action].request(copy) || ['resume', 'readAnswer', 'continueAnswer'].includes(action)
    && !isAiTaskInputSubmissionDraft((copy as AiInspectionRecognitionTaskResumeRequest).submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return copy as AiInspectionRecognitionTaskReference | AiInspectionRecognitionTaskResumeRequest;
}
export function inspectionTaskResponse(action: TaskAction, value: unknown, command: AiInspectionRecognitionTaskReference | AiInspectionRecognitionTaskResumeRequest) {
  try {
    const copy = structuredClone(value);
    if (!tasks[action].response(copy)) throw Error();
    if (action === 'readCreation') {
      const result = copy as AiInspectionTaskCreationObservation;
      if (result.state === 'observed' && result.task.replayed !== true) throw Error();
    }
    if (action === 'readInput') {
      const result = copy as AiInspectionTaskPendingInputResponse;
      if (result && !isAiTaskInputContractDraft(result.contract)) throw Error();
    }
    if ('submission' in command) {
      const receipt = action === 'readAnswer' ? copy as AiInspectionTaskAnswerObservation
        : (copy as AiInspectionTaskResumeResponse | AiInspectionTaskContinueResponse).receipt;
      if ('taskId' in receipt && (receipt.taskId !== command.submission.taskId || receipt.requestId !== command.submission.requestId)) throw Error();
      if (action === 'resume' && (copy as AiInspectionTaskResumeResponse).receipt.replayed) {
        const continuation = (copy as AiInspectionTaskResumeResponse).continuation;
        if (continuation.kind !== 'not_started' || continuation.reason !== 'receipt_replayed') throw Error();
      }
    }
    return copy;
  } catch {
    if (AI_INSPECTION_TASK_HTTP_CONTRACTS[action].write) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}
type PolicyAction = keyof typeof AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS;
const policies = Object.fromEntries(Object.entries(AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS)
  .map(([action, contract]) => [action, { request: compile(contract.request), response: compile(contract.response) }]));
export function inspectionPolicyRequest(action: PolicyAction, value: unknown): AiInspectionTaskPolicyRequest | AiInspectionTaskPolicyConfigureRequest {
  let copy;
  try { copy = structuredClone(value); } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
  if (!policies[action].request(copy)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return copy as AiInspectionTaskPolicyRequest | AiInspectionTaskPolicyConfigureRequest;
}
export function inspectionPolicyResponse(action: PolicyAction, value: unknown, command: AiInspectionTaskPolicyRequest | AiInspectionTaskPolicyConfigureRequest) {
  try {
    const copy = structuredClone(value) as AiInspectionTaskPolicyReadResponse | AiInspectionTaskPolicyChangeResponse;
    if (!policies[action].response(copy)) throw Error();
    const policy = 'state' in copy.result ? copy.result.state === 'observed' ? copy.result.policy : null : copy.result;
    if (policy && (policy.operation !== command.operation || action !== 'read'
      && (!('expectedRevision' in command) || policy.revision !== (command.expectedRevision ?? 0) + 1))) throw Error();
    if (policy && action === 'configure' && (policy.requiredPermissions.length !== 2
      || !policy.requiredPermissions.includes('rental-os:order:view')
      || !policy.requiredPermissions.includes(`rental-os:order:${command.reference.stage}`))) throw Error();
    return copy;
  } catch {
    if (AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS[action].write) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}
export function inspectionCancellationRequest(value: unknown): AiInspectionRecognitionTaskCancelRequest {
  let copy;
  try { copy = structuredClone(value); } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
  if (!request(copy)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return copy as AiInspectionRecognitionTaskCancelRequest;
}
export function inspectionCancellationResponse(action: Action, value: unknown, expectedRevision: number): Response {
  try {
    const copy = structuredClone(value) as Response;
    // Existing direct transitions return null; original-event replays omit the
    // property on JSON transport. Neither form claims a run lease/revision.
    if (copy && 'receipt' in copy && copy.receipt?.runRevision === undefined) delete copy.receipt.runRevision;
    if (!responses[action](copy)) throw Error();
    const event = 'receipt' in copy ? copy.receipt.event : copy.event;
    if (event && (event.taskRevision !== expectedRevision + 1 || BigInt(event.cursor) > 99999999999999999999n)) throw Error();
    if ('snapshot' in copy) {
      if (copy.expectedRevision !== expectedRevision || BigInt(copy.snapshot.cursor) > 99999999999999999999n
        || event && (event.taskId !== copy.taskId || event.taskRevision > copy.snapshot.revision
          || BigInt(event.cursor) > BigInt(copy.snapshot.cursor)
          || event.taskRevision === copy.snapshot.revision && event.data.to !== copy.snapshot.status)) throw Error();
    }
    return copy;
  } catch {
    if (AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS[action].write) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}
