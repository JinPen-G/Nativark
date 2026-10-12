import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT } from '@rental-os/shared';
import { z } from 'zod';
import type { InspectionRecognitionTaskApplication } from './inspection-recognition-task.application';
import { respondInspectionHttp, withInspectionRequestSignal, type InspectionHttpRequest } from './inspection-http';

export const INSPECTION_RECOGNITION_TASKS = Symbol('INSPECTION_RECOGNITION_TASKS');
type Request = InspectionHttpRequest;
const cancellation = z.object({ reference: z.unknown(), expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
const resume = z.object({ reference: z.unknown(), submission: z.unknown() }).strict();

/** Opt-in only. All operations delegate to the same request-bound current staff
 * authority and persisted original task. No inspection submission or new lease. */
@Controller(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath)
export class InspectionRecognitionTaskController {
  constructor(@Inject(INSPECTION_RECOGNITION_TASKS) private readonly tasks: InspectionRecognitionTaskApplication) {}

  private async respond<T>(work: () => Promise<T>, nextAction = 'read_creation') {
    return respondInspectionHttp(work, nextAction);
  }

  private async run<T>(request: Request, work: (signal: AbortSignal) => Promise<T>) {
    return withInspectionRequestSignal(request, work);
  }

  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.create)
  create(@Req() request: Request, @Body() reference: unknown) { return this.respond(() => this.tasks.create(request, reference)); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCreation)
  readCreation(@Req() request: Request, @Body() reference: unknown) { return this.respond(() => this.tasks.readCreation(request, reference)); }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.start)
  start(@Req() request: Request, @Body() reference: unknown) {
    return this.respond(() => this.run(request, signal => this.tasks.start(request, reference, signal)), 'reconcile');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.reconcile)
  reconcile(@Req() request: Request, @Body() reference: unknown) {
    return this.respond(() => this.run(request, signal => this.tasks.reconcile(request, reference, signal)), 'reconcile');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.requestCancel)
  requestCancel(@Req() request: Request, @Body() body: unknown) {
    return this.respond(async () => { const parsed = cancellation.parse(body);
      return this.tasks.requestCancel(request, parsed.reference, parsed.expectedRevision); }, 'reconcile');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readInput)
  readInput(@Req() request: Request, @Body() reference: unknown) {
    return this.respond(() => this.tasks.readInput(request, reference));
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.resume)
  resume(@Req() request: Request, @Body() body: unknown) {
    return this.respond(async () => { const parsed = resume.parse(body);
      return this.run(request, signal => this.tasks.resume(request, parsed.reference, parsed.submission, signal)); }, 'read_answer');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readAnswer)
  readAnswer(@Req() request: Request, @Body() body: unknown) {
    return this.respond(async () => { const parsed = resume.parse(body);
      return this.tasks.readAnswer(request, parsed.reference, parsed.submission); }, 'read_answer');
  }
  @Post(AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.continueAnswer)
  continueAnswer(@Req() request: Request, @Body() body: unknown) {
    return this.respond(async () => { const parsed = resume.parse(body);
      return this.run(request, signal => this.tasks.continueAnswer(request, parsed.reference, parsed.submission, signal)); }, 'read_answer');
  }
}
