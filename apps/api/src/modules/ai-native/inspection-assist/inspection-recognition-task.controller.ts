import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_STAFF_INSPECTION_ACCOUNTING, type composeStaffInspectionAccounting } from '../staff-inspection-accounting.composition';
import { AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT, AI_INSPECTION_TASK_RESULT_REFERENCE_PATH,
  AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS, AI_INSPECTION_TASK_HTTP_CONTRACTS } from '@rental-os/shared';
import { inspectionCancellationRequest, inspectionCancellationResponse, inspectionTaskRequest, inspectionTaskResponse } from './inspection-task-http.contract';
import type { InspectionRecognitionTaskApplication } from './inspection-recognition-task.application';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { respondInspectionHttp, withInspectionRequestSignal, type InspectionHttpRequest } from './inspection-http';

export const INSPECTION_RECOGNITION_TASKS = Symbol('INSPECTION_RECOGNITION_TASKS');
type Request = InspectionHttpRequest;

/** Original staff task transport. The application rechecks current owner,
 * resource and action authority; explicit execution delegates lease handling to
 * the original runner. Receipt reads do not execute or submit an inspection. */
@Controller(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath)
export class InspectionRecognitionTaskController {
  constructor(@Inject(INSPECTION_RECOGNITION_TASKS) private readonly tasks: Omit<InspectionRecognitionTaskApplication, 'requestCancel'> & {
    requestCancel(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
    readCancelReceipt?(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
    settleUnstartedCancellation?(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
    settleReleasedInputCancellation?(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
    readCancellationSettlementReceipt?(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
  }) {}

  private async respond<T>(work: () => Promise<T>, nextAction = 'read_creation') {
    return respondInspectionHttp(work, nextAction);
  }

  private async run<T>(request: Request, work: (signal: AbortSignal) => Promise<T>) {
    return withInspectionRequestSignal(request, work, 120000);
  }

  private snapshot(request: Request) { return { headers: { authorization: request?.headers?.authorization } }; }
  private task(request: Request, value: unknown, action: keyof typeof AI_INSPECTION_TASK_HTTP_CONTRACTS) {
    const current = this.snapshot(request), contract = AI_INSPECTION_TASK_HTTP_CONTRACTS[action];
    return this.respond(async () => {
      const command = inspectionTaskRequest(action, value);
      return this.run(request, async signal => {
        let result: unknown;
        if ('submission' in command) {
          const operation: (request: Request, reference: unknown, submission: unknown, signal?: AbortSignal) => Promise<unknown>
            = this.tasks[action as 'resume' | 'readAnswer' | 'continueAnswer'];
          result = await operation.call(this.tasks, current, structuredClone(command.reference), structuredClone(command.submission), signal);
        } else {
          const operation: (request: Request, reference: unknown, signal?: AbortSignal) => Promise<unknown>
            = this.tasks[action as 'create' | 'readCreation' | 'start' | 'reconcile' | 'readInput' | 'readResultReference'];
          result = await operation.call(this.tasks, current, structuredClone(command), signal);
        }
        return inspectionTaskResponse(action, result, command);
      });
    }, contract.nextAction);
  }

  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.create)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'create'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCreation)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCreation(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'readCreation'); }
  @Post(AI_INSPECTION_TASK_RESULT_REFERENCE_PATH)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readResultReference(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'readResultReference'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.start)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'start'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.reconcile)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'reconcile'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.requestCancel)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancel(@Req() request: Request, @Body() body: unknown) { return this.cancellation(request, body, 'requestCancel'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCancelReceipt)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancelReceipt(@Req() request: Request, @Body() body: unknown) { return this.cancellation(request, body, 'readCancelReceipt'); }
  private cancellation(request: Request, body: unknown, action: keyof typeof AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS) {
    const current = this.snapshot(request), contract = AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS[action];
    return this.respond(async () => {
      const input = inspectionCancellationRequest(body), operation = this.tasks[action];
      if (!operation) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return this.run(request, async signal => inspectionCancellationResponse(action,
        await operation.call(this.tasks, current, structuredClone(input.reference), input.expectedRevision, signal), input.expectedRevision));
    }, contract.nextAction);
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.settleUnstartedCancellation)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleUnstartedCancellation(@Req() request: Request, @Body() body: unknown) { return this.cancellation(request, body, 'settleUnstartedCancellation'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.settleReleasedInputCancellation)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  settleReleasedInputCancellation(@Req() request: Request, @Body() body: unknown) { return this.cancellation(request, body, 'settleReleasedInputCancellation'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCancellationSettlementReceipt)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancellationSettlementReceipt(@Req() request: Request, @Body() body: unknown) { return this.cancellation(request, body, 'readCancellationSettlementReceipt'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readInput)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInput(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'readInput'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.resume)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  resume(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'resume'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readAnswer)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readAnswer(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'readAnswer'); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.continueAnswer)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueAnswer(@Req() request: Request, @Body() body: unknown) { return this.task(request, body, 'continueAnswer'); }
}

/** Original financial receipts stay available when NEW recognition is disabled.
 * This controller has no file/model configuration or task-start dependency. */
@Controller(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath)
export class StaffInspectionAccountingController {
  constructor(@Inject(AI_STAFF_INSPECTION_ACCOUNTING) private readonly accounting: ReturnType<typeof composeStaffInspectionAccounting>) {}
  private observe(request: Request, body: unknown, reconcile: boolean) {
    const current = { headers: { authorization: request?.headers?.authorization } }, command = structuredClone(body);
    return respondInspectionHttp(() => withInspectionRequestSignal(request,
      signal => this.accounting[reconcile ? 'reconcile' : 'read'](current, command, signal), 15000), 'read_original_accounting');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() body: unknown) { return this.observe(request, body, false); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.reconcileAccounting) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: Request, @Body() body: unknown) { return this.observe(request, body, true); }
}
