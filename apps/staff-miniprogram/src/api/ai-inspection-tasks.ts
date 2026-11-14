/** Original staff inspection Task transports. The original employee HTTP
 * client owns credentials and context; writes never replay after refresh.
 * Task/result references do not authorize an inspection or Core action. */
import type { AiInspectionDraftReadRequest, AiInspectionDraftReadResponse, AiInspectionRecognitionRequest,
  AiInspectionInputPrepareResponse, AiInspectionInputReceiptResponse, AiInspectionRecognitionTaskReference,
  AiInspectionRecognitionTaskResumeRequest, AiInspectionTaskCreationResponse, AiInspectionTaskCreationObservation,
  AiInspectionTaskExecutionResponse, AiInspectionTaskPendingInputResponse, AiInspectionTaskResumeResponse,
  AiInspectionTaskAnswerObservation, AiInspectionTaskContinueResponse, AiInspectionTaskResultReferenceObservation,
  AiInspectionResultReadRequest, AiInspectionResultReadResponse, AiInspectionManualHttpRequests,
  AiInspectionManualHttpResponses } from '@rental-os/shared';
import { request } from '../core/http';
import { taskContracts, taskHttp } from '../components/ai-native/inspection-wire-schemas';
import { validateInspectionWire, validateInspectionTaskWire } from '../components/ai-native/inspection-wire';

interface TaskRequests {
  create: AiInspectionRecognitionTaskReference; readCreation: AiInspectionRecognitionTaskReference;
  start: AiInspectionRecognitionTaskReference; reconcile: AiInspectionRecognitionTaskReference;
  readInput: AiInspectionRecognitionTaskReference; resume: AiInspectionRecognitionTaskResumeRequest;
  readAnswer: AiInspectionRecognitionTaskResumeRequest; continueAnswer: AiInspectionRecognitionTaskResumeRequest;
  readResultReference: AiInspectionRecognitionTaskReference;
}
interface TaskResponses {
  create: AiInspectionTaskCreationResponse; readCreation: AiInspectionTaskCreationObservation;
  start: AiInspectionTaskExecutionResponse; reconcile: AiInspectionTaskExecutionResponse;
  readInput: AiInspectionTaskPendingInputResponse; resume: AiInspectionTaskResumeResponse;
  readAnswer: AiInspectionTaskAnswerObservation; continueAnswer: AiInspectionTaskContinueResponse;
  readResultReference: AiInspectionTaskResultReferenceObservation;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function createStaffInspectionTaskApi(context: { current(): boolean }) {
  const callTask = async <K extends keyof TaskRequests>(operation: K, value: TaskRequests[K]): Promise<TaskResponses[K]> => {
    if (!context.current() || !(operation in taskContracts) || !validateInspectionTaskWire(operation, 'request', value))
      throw Error('staff_inspection_task_unavailable');
    const base = taskHttp.basePath;
    if (!base.startsWith('staff/v1/')) throw Error('staff_inspection_task_route_unavailable');
    const response: unknown = await request(`/${base.slice('staff/v1/'.length)}/${taskHttp[operation]}`,
      { method: 'POST', data: clone(value), replayAfterRefresh: false, timeoutMs: taskContracts[operation].write ? 120000 : 15000 });
    if (!context.current() || !validateInspectionTaskWire(operation, 'response', response)) throw Error('staff_inspection_task_changed');
    return clone(response) as TaskResponses[K];
  };
  const callInspection = async <T>(operation: 'draft-read' | 'input-prepare' | 'input-receipt' | 'result-read'
    | 'template-read' | 'evidence-bind' | 'draft-create' | 'draft-operation', value: unknown): Promise<T> => {
    if (!context.current() || !validateInspectionWire(operation, 'request', value)) throw Error('staff_inspection_unavailable');
    const response: unknown = await request(`/ai-native/inspection-assist/${operation}`,
      { method: 'POST', data: clone(value), replayAfterRefresh: false, timeoutMs: 15000 });
    if (!context.current() || !validateInspectionWire(operation, 'response', response)) throw Error('staff_inspection_changed');
    return clone(response) as T;
  };
  return Object.freeze({
    readTemplate: (value: AiInspectionManualHttpRequests['template-read']) => callInspection<AiInspectionManualHttpResponses['template-read']>('template-read', value),
    bindEvidence: (value: AiInspectionManualHttpRequests['evidence-bind']) => callInspection<AiInspectionManualHttpResponses['evidence-bind']>('evidence-bind', value),
    createDraft: (value: AiInspectionManualHttpRequests['draft-create']) => callInspection<AiInspectionManualHttpResponses['draft-create']>('draft-create', value),
    readDraftOperation: (value: AiInspectionManualHttpRequests['draft-operation']) => callInspection<AiInspectionManualHttpResponses['draft-operation']>('draft-operation', value),
    readDraft: (value: AiInspectionDraftReadRequest) => callInspection<AiInspectionDraftReadResponse>('draft-read', value),
    prepareInput: (value: AiInspectionRecognitionRequest) => callInspection<AiInspectionInputPrepareResponse>('input-prepare', value),
    readInputPreparation: (value: AiInspectionRecognitionRequest) => callInspection<AiInspectionInputReceiptResponse>('input-receipt', value),
    create: (value: TaskRequests['create']) => callTask('create', value),
    readCreation: (value: TaskRequests['readCreation']) => callTask('readCreation', value),
    start: (value: TaskRequests['start']) => callTask('start', value),
    readInput: (value: TaskRequests['readInput']) => callTask('readInput', value),
    // This original operation explicitly saves and continues. Its UI must
    // express both human intents; an uncertain reply never repeats it.
    submitAndContinue: (value: TaskRequests['resume']) => callTask('resume', value),
    readAnswer: (value: TaskRequests['readAnswer']) => callTask('readAnswer', value),
    continueAnswer: (value: TaskRequests['continueAnswer']) => callTask('continueAnswer', value),
    readResultReference: (value: TaskRequests['readResultReference']) => callTask('readResultReference', value),
    readResult: (value: AiInspectionResultReadRequest) => callInspection<AiInspectionResultReadResponse>('result-read', value),
  });
}
export type StaffInspectionTaskApi = ReturnType<typeof createStaffInspectionTaskApi>;
