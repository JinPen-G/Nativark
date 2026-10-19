import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_STAFF_INSPECTION_ACCOUNTING, type composeStaffInspectionAccounting } from '../staff-inspection-accounting.composition';
import { AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT } from '@rental-os/shared';
import { z } from 'zod';
import type { InspectionRecognitionTaskApplication } from './inspection-recognition-task.application';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { respondInspectionHttp, withInspectionRequestSignal, type InspectionHttpRequest } from './inspection-http';

export const INSPECTION_RECOGNITION_TASKS = Symbol('INSPECTION_RECOGNITION_TASKS');
type Request = InspectionHttpRequest;
const cancellation = z.object({ reference: z.unknown(), expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
const resume = z.object({ reference: z.unknown(), submission: z.unknown() }).strict();

/** Opt-in only. All operations delegate to the same request-bound current staff
 * authority and persisted original task. No inspection submission or new lease. */
@Controller(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath)
export class InspectionRecognitionTaskController {
  constructor(@Inject(INSPECTION_RECOGNITION_TASKS) private readonly tasks: Omit<InspectionRecognitionTaskApplication, 'requestCancel'> & {
    requestCancel(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
    readCancelReceipt?(request: { headers: { authorization?: unknown } }, reference: unknown, revision: number, signal?: AbortSignal): Promise<unknown>;
  }) {}

  private async respond<T>(work: () => Promise<T>, nextAction = 'read_creation') {
    return respondInspectionHttp(work, nextAction);
  }

  private async run<T>(request: Request, work: (signal: AbortSignal) => Promise<T>) {
    return withInspectionRequestSignal(request, work, 120000);
  }

  private snapshot(request: Request) { return { headers: { authorization: request?.headers?.authorization } }; }

  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.create)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  create(@Req() request: Request, @Body() reference: unknown) {
    const current = this.snapshot(request), input = structuredClone(reference);
    return this.respond(() => this.run(request, signal => this.tasks.create(current, input, signal)));
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCreation)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCreation(@Req() request: Request, @Body() reference: unknown) {
    const current = this.snapshot(request), input = structuredClone(reference);
    return this.respond(() => this.run(request, signal => this.tasks.readCreation(current, input, signal)));
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.start)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: Request, @Body() reference: unknown) {
    const current = this.snapshot(request), input = structuredClone(reference);
    return this.respond(() => this.run(request, signal => this.tasks.start(current, input, signal)), 'reconcile');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.reconcile)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: Request, @Body() reference: unknown) {
    const current = this.snapshot(request), input = structuredClone(reference);
    return this.respond(() => this.run(request, signal => this.tasks.reconcile(current, input, signal)), 'reconcile');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.requestCancel)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  requestCancel(@Req() request: Request, @Body() body: unknown) {
    const current = this.snapshot(request), input = structuredClone(body);
    return this.respond(async () => { const parsed = cancellation.parse(input);
      return this.run(request, signal => this.tasks.requestCancel(current, parsed.reference, parsed.expectedRevision, signal)); }, 'read_cancel_receipt');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCancelReceipt)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCancelReceipt(@Req() request: Request, @Body() body: unknown) {
    const current = this.snapshot(request), input = structuredClone(body);
    return this.respond(async () => { const parsed = cancellation.parse(input);
      if (!this.tasks.readCancelReceipt) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return this.run(request, signal => this.tasks.readCancelReceipt!(current, parsed.reference, parsed.expectedRevision, signal)); }, 'read_cancel_receipt');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readInput)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInput(@Req() request: Request, @Body() reference: unknown) {
    const current = this.snapshot(request), input = structuredClone(reference);
    return this.respond(() => this.run(request, signal => this.tasks.readInput(current, input, signal)));
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.resume)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  resume(@Req() request: Request, @Body() body: unknown) {
    const current = this.snapshot(request), input = structuredClone(body);
    return this.respond(async () => { const parsed = resume.parse(input);
      return this.run(request, signal => this.tasks.resume(current, parsed.reference, parsed.submission, signal)); }, 'read_answer');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readAnswer)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  readAnswer(@Req() request: Request, @Body() body: unknown) {
    const current = this.snapshot(request), input = structuredClone(body);
    return this.respond(async () => { const parsed = resume.parse(input);
      return this.run(request, signal => this.tasks.readAnswer(current, parsed.reference, parsed.submission, signal)); }, 'read_answer');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.continueAnswer)
  @HttpCode(200) @Header('Cache-Control', 'no-store')
  continueAnswer(@Req() request: Request, @Body() body: unknown) {
    const current = this.snapshot(request), input = structuredClone(body);
    return this.respond(async () => { const parsed = resume.parse(input);
      return this.run(request, signal => this.tasks.continueAnswer(current, parsed.reference, parsed.submission, signal)); }, 'read_answer');
  }
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
